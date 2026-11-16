using System.Net;
using LFPortal.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.Extensions.Options;

namespace LFPortal.Web.Authentication;

/// <summary>
/// Opens a Dynamic Dashboard page only when the Admin Portal says the signed-in account
/// holds it in the signed-in repository (see <see cref="PortalAccessOptions"/>).
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item>No Dynamic Dashboard in the portal: every page answers 403 with an explanation.</item>
///   <item>The Dynamic Dashboard but not this page: 403, with links to the pages the account holds.
///         The home page instead opens the first page the account holds.</item>
///   <item>Portal unreachable or misconfigured: 503, nothing opens (it never fails open).</item>
///   <item>Settings stays open to a browser on the server itself, so a broken Laserfiche
///         connection, which blocks every sign-in, can still be repaired there.</item>
/// </list>
/// The answer is also kept in <c>HttpContext.Items</c>: the layout hides the links the account
/// does not hold, and the boards page applies the boards and «إنشاء لوحة جديدة» from it.
/// </remarks>
public sealed class PortalAccessFilter(
    IOptionsMonitor<PortalAccessOptions> options, IPortalAccessClient portal,
    ILaserficheAuthService auth, IRepositoryContext repositories,
    ILogger<PortalAccessFilter> logger) : IAsyncActionFilter
{
    /// <summary><c>HttpContext.Items</c> key holding the <see cref="DashboardAccess"/>.</summary>
    public const string ItemKey = "PortalAccess.Dynamic";

    /// <summary><c>HttpContext.Items</c> key holding the account name the portal was asked about.</summary>
    public const string AccountKey = "PortalAccess.Account";

    /// <inheritdoc />
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        if (!options.CurrentValue.IsEnabled ||
            http.Request.Path.StartsWithSegments("/Share", StringComparison.OrdinalIgnoreCase) ||
            http.Request.Path.StartsWithSegments("/api/portal", StringComparison.OrdinalIgnoreCase))
        {
            await next(); return;
        }

        var section = DashboardSections.For(http.Request.Path);
        var account = await AccountAsync(http);
        DashboardAccess? access = null;
        if (account is { } signedIn)
        {
            http.Items[AccountKey] = signedIn.Name;
            try
            {
                access = await portal.GetAsync(signedIn.RepositoryId, signedIn.Name, http.RequestAborted);
                http.Items[ItemKey] = access;
            }
            catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Admin Portal access check failed for {Account} in {Repository}.",
                    signedIn.Name, signedIn.RepositoryId);
            }
        }

        if (section is null || (section == DashboardSections.Settings && IsServerItself(http)))
        {
            await next(); return;
        }
        if (account is null) { context.Result = SignIn(http); return; }
        if (access is null) { context.Result = Refuse(context, AccessDeniedReason.PortalUnavailable, section, null); return; }
        if (access.Has(section))
        {
            // One creator's documents (from «المستندات حسب نشاط المستخدم»): their own, their
            // managers' up the chain of portal groups, and the main admin's. Not a peer's.
            if (section == DashboardSections.Archive && CreatorAsked(http) is { } creator)
            {
                var opens = await OpensDocumentsOfAsync(http, account.Value, creator);
                if (opens != true)
                {
                    context.Result = Refuse(context,
                        opens is null ? AccessDeniedReason.PortalUnavailable : AccessDeniedReason.Documents,
                        section, access, creator);
                    return;
                }
            }
            await next(); return;
        }

        if (access.FirstSection is { } first && section == DashboardSections.Overview && IsHomePage(http))
        {
            context.Result = new LocalRedirectResult(DashboardSections.HomeOf(first));
            return;
        }
        context.Result = Refuse(context,
            access.Allowed ? AccessDeniedReason.Section : AccessDeniedReason.Dashboard, section, access);
    }

    /// <summary>The signed-in repository and the account name the portal knows, or null.</summary>
    private async Task<(string RepositoryId, string Name)?> AccountAsync(HttpContext http)
    {
        if (http.User.Identity?.IsAuthenticated != true) return null;
        var repositoryId = http.User.FindFirst(DashboardAuthenticationDefaults.RepositoryClaimType)?.Value;
        if (string.IsNullOrWhiteSpace(repositoryId)) return null;

        string? name = null;
        try
        {
            var active = await repositories.GetActiveRepositoryAsync(http.RequestAborted);
            if (string.Equals(active.RepositoryId, repositoryId, StringComparison.OrdinalIgnoreCase))
                name = PortalAccountName.FromToken(await auth.GetTokenAsync(active, http.RequestAborted));
        }
        catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "No Laserfiche token to read the account name from; using the sign-in name.");
        }
        name ??= PortalAccountName.FromSignIn(http.User.Identity?.Name);
        return name is null ? null : (repositoryId, name);
    }

    /// <summary>The creator whose documents the archive is asked for (<c>/Archive?scope=creator</c>), or null.</summary>
    internal static string? CreatorAsked(HttpContext http)
    {
        var path = (http.Request.Path.Value ?? "").TrimEnd('/');
        if (!path.Equals("/Archive", StringComparison.OrdinalIgnoreCase) &&
            !path.Equals("/Archive/Index", StringComparison.OrdinalIgnoreCase))
            return null;
        if (!string.Equals(http.Request.Query["scope"].ToString().Trim(), "creator", StringComparison.OrdinalIgnoreCase))
            return null;
        return http.Request.Query["creator"].ToString().Trim();
    }

    /// <summary>True when the account may open what <paramref name="creator"/> created; null when the portal cannot say.</summary>
    private async Task<bool?> OpensDocumentsOfAsync(HttpContext http, (string RepositoryId, string Name) account, string creator)
    {
        var people = portal as IPortalPeopleClient ?? http.RequestServices.GetService<IPortalPeopleClient>();
        if (people is null) return null;
        try
        {
            return (await people.GetPeopleAsync(account.RepositoryId, account.Name, http.RequestAborted)).Opens(creator);
        }
        catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Admin Portal did not list the people {Account} sees in {Repository}.",
                account.Name, account.RepositoryId);
            return null;
        }
    }

    private static bool IsServerItself(HttpContext http)
    {
        var ip = http.Connection.RemoteIpAddress;
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return IPAddress.IsLoopback(ip);
    }

    private static bool IsHomePage(HttpContext http) =>
        HttpMethods.IsGet(http.Request.Method) && !IsPartial(http) &&
        (http.Request.Path == "/" ||
         http.Request.Path.Equals("/DynamicDashboard", StringComparison.OrdinalIgnoreCase) ||
         http.Request.Path.Equals("/DynamicDashboard/Index", StringComparison.OrdinalIgnoreCase) ||
         http.Request.Path.Equals("/Dashboard", StringComparison.OrdinalIgnoreCase));

    private static bool IsPartial(HttpContext http) =>
        http.Request.Headers["X-Requested-With"] == "XMLHttpRequest" ||
        http.Request.Path.StartsWithSegments("/Document/Preview", StringComparison.OrdinalIgnoreCase) ||
        http.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase);

    private static IActionResult SignIn(HttpContext http)
    {
        var destination = http.Request.PathBase + http.Request.Path + http.Request.QueryString;
        var loginUrl = "/Login?returnUrl=" + Uri.EscapeDataString(destination);
        return IsPartial(http)
            ? new JsonResult(new { loginUrl, message = "سجّل الدخول للمتابعة." }) { StatusCode = 401 }
            : new LocalRedirectResult(loginUrl);
    }

    private static IActionResult Refuse(ActionExecutingContext context, AccessDeniedReason reason,
        string section, DashboardAccess? access, string? subject = null)
    {
        var http = context.HttpContext;
        var status = reason == AccessDeniedReason.PortalUnavailable ? 503 : 403;
        if (IsPartial(http))
            return new JsonResult(new { message = AccessDeniedViewModel.Message(reason, section, subject) }) { StatusCode = status };

        var metadata = http.RequestServices.GetService<IModelMetadataProvider>() ?? new EmptyModelMetadataProvider();
        return new ViewResult
        {
            ViewName = "~/Views/Shared/AccessDenied.cshtml",
            StatusCode = status,
            ViewData = new ViewDataDictionary(metadata, new ModelStateDictionary())
            {
                Model = new AccessDeniedViewModel
                {
                    Reason = reason,
                    Section = section,
                    Subject = subject,
                    Allowed = access is null ? [] : DashboardSections.All.Where(access.Has).ToArray(),
                },
            },
        };
    }
}

/// <summary>Why a page did not open.</summary>
public enum AccessDeniedReason
{
    /// <summary>The account does not hold the Dynamic Dashboard in this repository.</summary>
    Dashboard,
    /// <summary>The account holds the Dynamic Dashboard but not this page.</summary>
    Section,
    /// <summary>The account opens the archive, but not the documents of this creator.</summary>
    Documents,
    /// <summary>The Admin Portal could not be asked.</summary>
    PortalUnavailable,
}

/// <summary>The page shown when a page does not open.</summary>
public sealed class AccessDeniedViewModel
{
    /// <summary>Why it did not open.</summary>
    public AccessDeniedReason Reason { get; init; }
    /// <summary>The page that was asked for.</summary>
    public string Section { get; init; } = "";
    /// <summary>Whose documents were asked for (<see cref="AccessDeniedReason.Documents"/>).</summary>
    public string? Subject { get; init; }
    /// <summary>The pages the account may open instead.</summary>
    public IReadOnlyList<string> Allowed { get; init; } = [];

    /// <summary>The resource key of the explanation.</summary>
    public string MessageKey => Reason switch
    {
        AccessDeniedReason.Dashboard => "AccessDeniedDashboard",
        AccessDeniedReason.Section when Section == DashboardSections.Download => "AccessDeniedDownload",
        AccessDeniedReason.Section   => "AccessDeniedSection",
        AccessDeniedReason.Documents => "AccessDeniedDocuments",
        _                            => "AccessCheckUnavailable",
    };

    /// <summary>The explanation in Arabic, for script callers that show a message.</summary>
    public static string Message(AccessDeniedReason reason, string section = "", string? subject = null) => reason switch
    {
        AccessDeniedReason.Dashboard => "ليست لديك صلاحية على Dynamic Dashboard في هذا المستودع. اطلبها من مسؤول بوابة الإدارة.",
        AccessDeniedReason.Section when section == DashboardSections.Download =>
            "ليست لديك صلاحية تنزيل الملفات. اطلبها من مسؤول بوابة الإدارة.",
        AccessDeniedReason.Section   => "ليست لديك صلاحية على هذا القسم. اطلبها من مسؤول بوابة الإدارة.",
        AccessDeniedReason.Documents => $"ليست لديك صلاحية على وثائق {subject}.",
        _                            => "تعذّر التحقق من صلاحياتك من بوابة الإدارة. حاول مرة أخرى بعد قليل.",
    };
}

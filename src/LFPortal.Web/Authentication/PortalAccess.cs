using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LFPortal.Web.Authentication;

/// <summary>
/// Connection to the ISB Admin Portal, which decides what a signed-in Laserfiche account
/// may open in the Dynamic Dashboard (configuration section <c>PortalAccess</c>).
/// </summary>
/// <remarks>
/// With <see cref="BaseUrl"/> empty the portal is not asked and everything stays open
/// exactly as before. Once it is set, the portal's answer is required: if the portal
/// cannot be reached, nothing opens. <see cref="Key"/> is also the key the portal sends
/// when it reads the board list (<c>/api/portal/boards</c>).
/// </remarks>
public sealed class PortalAccessOptions
{
    /// <summary>Configuration section name.</summary>
    public const string SectionName = "PortalAccess";

    /// <summary>The portal's address, for example <c>https://desktop-lr7l5jt:8090</c>. https only.</summary>
    public string BaseUrl { get; set; } = "";

    /// <summary>The same value as <c>PORTAL_KEY_DYNAMIC</c> in the portal's <c>.env</c>.</summary>
    public string Key { get; set; } = "";

    /// <summary>How long to wait for the portal, in seconds.</summary>
    public int TimeoutSeconds { get; set; } = 5;

    /// <summary>
    /// How long one answer is reused for the same account, in seconds. Access taken
    /// away in the portal holds here after at most this long. 0 asks every time.
    /// </summary>
    public int CacheSeconds { get; set; } = 30;

    /// <summary>True when the portal decides access.</summary>
    public bool IsEnabled => !string.IsNullOrWhiteSpace(BaseUrl);
}

/// <summary>The Dynamic Dashboard's parts, by the ids the Admin Portal uses.</summary>
public static class DashboardSections
{
    /// <summary>The boards page (لوحة المعلومات). Each board is "overview/&lt;id&gt;".</summary>
    public const string Overview = "overview";
    /// <summary>The «إنشاء لوحة جديدة» button.</summary>
    public const string Create = "create";
    /// <summary>
    /// The «تخصيص اللوحة» button and what only customize mode shows: adding, editing, moving,
    /// resizing, hiding and removing tables, and renaming or deleting one's own boards.
    /// Without it the account only views. Creating a board needs it too.
    /// </summary>
    public const string Customize = "customize";
    /// <summary>The archive browser and document viewer (الأرشيف).</summary>
    public const string Archive = "archive";
    /// <summary>The connection settings (الإعدادات).</summary>
    public const string Settings = "settings";

    /// <summary>The main board's id.</summary>
    public const string MainBoard = "default";

    /// <summary>The pages, in the order of the navigation bar.</summary>
    public static readonly IReadOnlyList<string> All = [Overview, Archive, Settings];

    /// <summary>
    /// The page a request belongs to, or <c>null</c> for what every account needs
    /// whatever it holds: sign-in, launch, error pages, language, health checks, the
    /// credential-free diagnostics, the separate external share and the portal's own board list.
    /// </summary>
    public static string? For(PathString path)
    {
        // Only sends the browser to Web Access, which applies Laserfiche's own rights;
        // it is deliberately reachable without a Dashboard token (see the auth guard).
        if (Starts(path, "/Archive/OpenInLaserfiche")) return null;
        if (path == "/" || Starts(path, "/DynamicDashboard") || Starts(path, "/Dashboard")) return Overview;
        if (Starts(path, "/Archive") || Starts(path, "/Document")) return Archive;
        if (Starts(path, "/Settings") || Starts(path, "/api/laserfiche")) return Settings;
        return null;
    }

    /// <summary>The page that opens a section.</summary>
    public static string HomeOf(string section) => section switch
    {
        Overview => "/DynamicDashboard",
        Archive  => "/Archive",
        _        => "/Settings",
    };

    /// <summary>The navigation label (a shared resource key) of a section.</summary>
    public static string LabelOf(string section) => section switch
    {
        Overview => "Dashboard",
        Archive  => "Archive",
        _        => "Settings",
    };

    private static bool Starts(PathString path, string prefix) =>
        path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase);
}

/// <summary>What one account may open in the Dynamic Dashboard, as the Admin Portal answered.</summary>
public sealed record DashboardAccess(bool Allowed, IReadOnlySet<string> Sections)
{
    /// <summary>True when the account holds the Dynamic Dashboard and this section.</summary>
    public bool Has(string section) => Allowed && Sections.Contains(section);

    /// <summary>The first page the account may open, in navigation order.</summary>
    public string? FirstSection => DashboardSections.All.FirstOrDefault(Has);

    /// <summary>True when the account sees every board (the portal's main admin).</summary>
    public bool SeesAllBoards => Has(DashboardSections.Overview + "/*");

    /// <summary>
    /// True when the account was given this board (or every board). A board the account
    /// created is always theirs; the caller checks that first.
    /// </summary>
    public bool SeesBoard(string boardId) =>
        Has(DashboardSections.Overview) && (SeesAllBoards || Has(DashboardSections.Overview + "/" + boardId));
}

/// <summary>The Admin Portal could not give an answer.</summary>
public sealed class PortalAccessException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>A portal group that links a person to the account asking, and whether they manage it.</summary>
public sealed record PortalPersonGroup(string Name, bool Leads);

/// <summary>One person the account may see in «المستندات حسب نشاط المستخدم».</summary>
/// <param name="Name">The account name, exactly as Laserfiche spells it.</param>
/// <param name="Groups">The groups linking them to the account asking (for the main admin: all of theirs).</param>
/// <param name="Opens">True when the account asking may open the documents this person created.</param>
public sealed record PortalPerson(string Name, IReadOnlyList<PortalPersonGroup> Groups, bool Opens);

/// <summary>
/// Whom «المستندات حسب نشاط المستخدم» shows an account, by the Admin Portal's groups: the
/// repository's users the account may see, the account itself first.
/// </summary>
/// <param name="All">The account is the portal's main admin: it sees everyone and opens every
/// creator's documents, including creators who are no longer users.</param>
/// <param name="People">The people, the account itself first.</param>
public sealed record PortalPeople(bool All, IReadOnlyList<PortalPerson> People)
{
    /// <summary>True when the account may open the documents <paramref name="creator"/> created.</summary>
    public bool Opens(string creator) =>
        All || People.Any(person => person.Opens && string.Equals(person.Name, creator, StringComparison.Ordinal));
}

/// <summary>Asks the Admin Portal what an account may open in the Dynamic Dashboard.</summary>
public interface IPortalAccessClient
{
    /// <summary>
    /// The account's access in a repository. Throws <see cref="PortalAccessException"/>
    /// when the portal cannot answer; callers keep everything closed then.
    /// </summary>
    Task<DashboardAccess> GetAsync(string repositoryId, string accountName, CancellationToken cancellationToken);
}

/// <summary>Asks the Admin Portal whom an account sees in the user-activity table.</summary>
public interface IPortalPeopleClient
{
    /// <summary>
    /// The people the account may see in a repository. Throws <see cref="PortalAccessException"/>
    /// when the portal cannot answer; callers then show the account only itself.
    /// </summary>
    Task<PortalPeople> GetPeopleAsync(string repositoryId, string accountName, CancellationToken cancellationToken);
}

/// <summary>
/// Calls <c>GET {BaseUrl}/api/systems/dynamic/access?repo=&amp;user=</c> (and <c>/people</c>) with the
/// Dynamic Dashboard's key, and keeps each answer for <see cref="PortalAccessOptions.CacheSeconds"/>.
/// </summary>
public sealed class PortalAccessClient(
    IHttpClientFactory httpClients, IMemoryCache cache,
    IOptionsMonitor<PortalAccessOptions> options) : IPortalAccessClient, IPortalPeopleClient
{
    /// <summary>Named HttpClient: no redirects, so the key is never sent anywhere else.</summary>
    public const string HttpClientName = "AdminPortal";

    /// <summary>The header the portal reads the key from.</summary>
    public const string KeyHeader = "X-Portal-Key";

    /// <inheritdoc />
    public Task<DashboardAccess> GetAsync(string repositoryId, string accountName, CancellationToken cancellationToken) =>
        AskAsync<Answer, DashboardAccess>("access", repositoryId, accountName,
            answer => new DashboardAccess(answer.Allowed, new HashSet<string>(answer.Sections ?? [], StringComparer.Ordinal)),
            cancellationToken);

    /// <inheritdoc />
    public Task<PortalPeople> GetPeopleAsync(string repositoryId, string accountName, CancellationToken cancellationToken) =>
        AskAsync<PeopleAnswer, PortalPeople>("people", repositoryId, accountName,
            answer => new PortalPeople(answer.All, (answer.People ?? [])
                .OfType<PersonAnswer>()
                .Where(person => !string.IsNullOrEmpty(person.Name))
                .Select(person => new PortalPerson(person.Name!,
                    (person.Groups ?? []).OfType<GroupAnswer>().Where(group => !string.IsNullOrEmpty(group.Name))
                        .Select(group => new PortalPersonGroup(group.Name!, group.Leads)).ToArray(),
                    person.Opens))
                .ToArray()),
            cancellationToken);

    private async Task<TResult> AskAsync<TAnswer, TResult>(string what, string repositoryId, string accountName,
        Func<TAnswer, TResult> read, CancellationToken cancellationToken) where TAnswer : class where TResult : class
    {
        var opts = options.CurrentValue;
        if (!Uri.TryCreate(opts.BaseUrl.TrimEnd('/'), UriKind.Absolute, out var baseUri) || baseUri.Scheme != Uri.UriSchemeHttps)
            throw new PortalAccessException("PortalAccess:BaseUrl must be an https address.");
        if (string.IsNullOrWhiteSpace(opts.Key))
            throw new PortalAccessException("PortalAccess:Key is empty.");

        // Account names are exact in the portal ("admin" and "ADMIN" are different accounts).
        var cacheKey = $"PortalAccess|{what}|{repositoryId.ToLowerInvariant()}|{accountName}";
        if (opts.CacheSeconds > 0 && cache.TryGetValue(cacheKey, out TResult? cached) && cached is not null)
            return cached;

        var url = $"{baseUri.AbsoluteUri.TrimEnd('/')}/api/systems/dynamic/{what}" +
                  $"?repo={Uri.EscapeDataString(repositoryId)}&user={Uri.EscapeDataString(accountName)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation(KeyHeader, opts.Key.Trim());

        TAnswer? answer;
        try
        {
            using var response = await httpClients.CreateClient(HttpClientName).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new PortalAccessException($"Admin Portal answered HTTP {(int)response.StatusCode}.");
            answer = await response.Content.ReadFromJsonAsync<TAnswer>(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (PortalAccessException) { throw; }
        catch (Exception ex) { throw new PortalAccessException("Admin Portal could not be reached.", ex); }
        if (answer is null) throw new PortalAccessException("Admin Portal sent an empty answer.");

        var result = read(answer);
        if (opts.CacheSeconds > 0)
            cache.Set(cacheKey, result, TimeSpan.FromSeconds(opts.CacheSeconds));
        return result;
    }

    private sealed record Answer(bool Allowed, string[]? Sections);
    private sealed record PeopleAnswer(bool All, PersonAnswer?[]? People);
    private sealed record PersonAnswer(string? Name, GroupAnswer?[]? Groups, bool Opens);
    private sealed record GroupAnswer(string? Name, bool Leads);
}

/// <summary>The account name the Admin Portal knows an account by.</summary>
public static class PortalAccountName
{
    private const string DirectorySuffix = "@LFDS";

    /// <summary>
    /// The <c>name</c> claim of a Laserfiche access token: the account's own spelling,
    /// the same one the portal's Laserfiche sign-in reads. <c>null</c> if the token is
    /// not a JWT or carries no name. The token came straight from the Repository API
    /// to this server, so it is read here, not verified.
    /// </summary>
    public static string? FromToken(string? token)
    {
        var parts = token?.Split('.');
        if (parts is not { Length: 3 }) return null;
        try
        {
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var json = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
            return json.RootElement.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String
                ? Clean(name.GetString())
                : null;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException)
        {
            return null;
        }
    }

    /// <summary>
    /// The name typed on the sign-in page. A Directory Server sign-in adds
    /// <c>@LFDS</c>; the portal lists the account without it.
    /// </summary>
    public static string? FromSignIn(string? name) => Clean(name);

    private static string? Clean(string? name)
    {
        var value = name?.Trim();
        if (value is not null && value.EndsWith(DirectorySuffix, StringComparison.OrdinalIgnoreCase))
            value = value[..^DirectorySuffix.Length].Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }
}

/// <summary>What the pages may draw and allow for the current request.</summary>
public static class PortalAccessView
{
    /// <summary>True when the portal decides access (PortalAccess:BaseUrl is set).</summary>
    public static bool IsEnabled(HttpContext context) =>
        context.RequestServices.GetService<IOptionsMonitor<PortalAccessOptions>>()?.CurrentValue.IsEnabled == true;

    /// <summary>
    /// The portal's answer for the signed-in account, or <c>null</c> when the portal is not used
    /// (then everything is open, as before).
    /// </summary>
    public static DashboardAccess? Current(HttpContext context) =>
        IsEnabled(context) ? context.Items[PortalAccessFilter.ItemKey] as DashboardAccess ?? Closed : null;

    /// <summary>The account name the portal knows the signed-in account by, when it was read.</summary>
    public static string? AccountName(HttpContext context) => context.Items[PortalAccessFilter.AccountKey] as string;

    /// <summary>
    /// True when the section's link may be shown. Without the portal every section
    /// shows, as before; with it, only the sections the signed-in account holds.
    /// </summary>
    public static bool CanShow(HttpContext context, string section) => Current(context)?.Has(section) ?? true;

    private static readonly DashboardAccess Closed = new(false, new HashSet<string>());
}

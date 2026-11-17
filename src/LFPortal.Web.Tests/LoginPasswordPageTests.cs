using System.Security.Claims;
using System.Text.Json;
using LFPortal.Domain.Exceptions;
using LFPortal.Infrastructure.Options;
using LFPortal.Web.Authentication;
using LFPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// The second way in: <c>/Login/Password</c>, a username / password page next to LFDS SSO.
/// </summary>
public sealed partial class LoginControllerSsoDormantTests
{
    private sealed class FixedRepositories(params string[] ids) : ISignInRepositories
    {
        public Task<IReadOnlyList<string>> ListAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<string>>(ids);
    }

    private static LaserficheOptions SsoOptionsWithDemo()
    {
        var options = SsoOptions();
        options.RepositoryId = "demo";
        return options;
    }

    private static (LoginController ctrl, SpyAuthService auth) PasswordPage(bool directBrowser = true)
    {
        var (ctrl, auth, _) = Build(SsoOptionsWithDemo(), directBrowser, new FixedRepositories("Demo", "isb"));
        return (ctrl, auth);
    }

    private static LoginInputModel PasswordForm(string repository, string username = "amir") => new()
    {
        PasswordPage = true,
        Repository = repository,
        Username = username,
        Password = "secret",
        AccountType = LoginAccountType.DirectoryServer,
    };

    [Fact]
    public async Task PasswordPage_Get_OffersTheRepositoriesWithTheConfiguredOneAndLfdsChosen()
    {
        var (ctrl, _) = PasswordPage();
        var result = await ctrl.Password();

        var view = Assert.IsType<ViewResult>(result);
        Assert.Equal("Index", view.ViewName);
        var model = Assert.IsType<LoginViewModel>(view.Model);
        Assert.True(model.PasswordPage);
        Assert.True(model.AllowRepositoryInput);
        Assert.Equal(["Demo", "isb"], model.Repositories);
        Assert.Equal("Demo", model.SubmittedRepository);
        Assert.Equal(LoginAccountType.DirectoryServer, model.SelectedAccountType);
        Assert.False(model.SsoFailed);
    }

    [Fact]
    public async Task PasswordPage_Get_KeepsOnlyALocalReturnUrl()
    {
        var (ctrl, _) = PasswordPage();
        var local = Assert.IsType<LoginViewModel>(Assert.IsType<ViewResult>(
            await ctrl.Password(returnUrl: "/DynamicDashboard")).Model);
        var foreign = Assert.IsType<LoginViewModel>(Assert.IsType<ViewResult>(
            await ctrl.Password(returnUrl: "https://elsewhere.test/")).Model);
        Assert.Equal("/DynamicDashboard", local.ReturnUrl);
        Assert.Null(foreign.ReturnUrl);
    }

    [Fact]
    public async Task PasswordPage_Get_WithoutTheServerList_FallsBackToATextBox()
    {
        var (ctrl, _, _) = Build(SsoOptionsWithDemo(), signInRepositories: new FixedRepositories());
        var model = Assert.IsType<LoginViewModel>(Assert.IsType<ViewResult>(await ctrl.Password()).Model);
        Assert.Empty(model.Repositories);
        Assert.Equal("TestRepo", model.SubmittedRepository);
    }

    [Fact]
    public async Task Login_Get_WithSso_StillStartsSsoForEveryoneElse()
    {
        var (ctrl, _) = PasswordPage();
        var redirect = Assert.IsType<RedirectToActionResult>(await ctrl.Index(cancellationToken: default));
        Assert.Equal("StartSso", redirect.ActionName);
    }

    [Fact]
    public async Task Login_Get_ABrowserThatSignedInWithAPassword_ComesBackToThePasswordPage()
    {
        var (ctrl, _) = PasswordPage();
        ctrl.HttpContext.Request.Headers.Cookie = LoginController.PasswordPageCookie + "=password";
        var redirect = Assert.IsType<RedirectToActionResult>(
            await ctrl.Index(returnUrl: "/DynamicDashboard", cancellationToken: default));
        Assert.Equal(nameof(LoginController.Password), redirect.ActionName);
        Assert.Equal("/DynamicDashboard", redirect.RouteValues?["returnUrl"]);
    }

    [Theory]
    [InlineData(false, "/DynamicDashboard")]          // the session came from the Web Client
    [InlineData(true, "/Dashboard?source=webclient")] // a new Web Client launch
    public async Task Login_Get_WebClientLaunchesKeepSso_EvenWithThePasswordMark(bool directBrowser, string returnUrl)
    {
        var (ctrl, _) = PasswordPage(directBrowser);
        ctrl.HttpContext.Request.Headers.Cookie = LoginController.PasswordPageCookie + "=password";
        var redirect = Assert.IsType<RedirectToActionResult>(
            await ctrl.Index(returnUrl: returnUrl, cancellationToken: default));
        Assert.Equal("StartSso", redirect.ActionName);
    }

    [Fact]
    public async Task PasswordPage_Post_AnAccountThatIsNotInTheRepository_IsToldItHasNoAccess()
    {
        var (ctrl, auth) = PasswordPage();
        auth.LoginException = new LaserficheException("Access denied. [9013]", 403);

        var view = Assert.IsType<ViewResult>(await ctrl.Index(PasswordForm("isb"), CancellationToken.None));
        var model = Assert.IsType<LoginViewModel>(view.Model);
        Assert.Equal("الحساب amir ليست له صلاحية على مستودع isb. " +
                     "اختر مستودعًا آخر أو اطلب الصلاحية من مسؤول النظام.", model.ErrorMessage);
        Assert.True(model.PasswordPage);
        Assert.Equal(["Demo", "isb"], model.Repositories);
        Assert.Equal("isb", model.SubmittedRepository);
        Assert.Equal("amir@LFDS", auth.LastLoginUsername);
    }

    [Fact]
    public async Task PasswordPage_Post_AWrongPassword_SaysSoPlainly()
    {
        var (ctrl, auth) = PasswordPage();
        auth.TryAuthenticateResult = false;
        var model = Assert.IsType<LoginViewModel>(Assert.IsType<ViewResult>(
            await ctrl.Index(PasswordForm("Demo"), CancellationToken.None)).Model);
        Assert.Equal("اسم المستخدم أو كلمة المرور غير صحيحة.", model.ErrorMessage);
        Assert.DoesNotContain(LoginController.PasswordPageCookie, ctrl.Response.Headers.SetCookie.ToString());
    }

    [Fact]
    public async Task PasswordPage_Post_ARepositoryOutsideTheList_IsNeverTried()
    {
        var (ctrl, auth) = PasswordPage();
        var model = Assert.IsType<LoginViewModel>(Assert.IsType<ViewResult>(
            await ctrl.Index(PasswordForm("other"), CancellationToken.None)).Model);
        Assert.Equal("اختر مستودعًا من القائمة.", model.ErrorMessage);
        Assert.Equal(0, auth.TryAuthenticateCallCount);
    }

    [Fact]
    public async Task PasswordPage_Post_Success_SignsInToTheListedRepositoryAndRemembersThePage()
    {
        // Even a browser that came from the Web Client before may pick the repository here.
        var (ctrl, auth) = PasswordPage(directBrowser: false);
        var result = await ctrl.Index(PasswordForm("ISB"), CancellationToken.None);

        Assert.IsType<RedirectToActionResult>(result);
        Assert.Equal("isb", auth.LastLoginRepository);
        Assert.Equal("isb", ctrl.HttpContext.Session.GetString("AuthenticatedRepositoryId"));
        Assert.Null(ctrl.HttpContext.Session.GetString("ActiveRepositorySource"));
        var cookies = ctrl.Response.Headers.SetCookie.ToString();
        Assert.Contains(LoginController.PasswordPageCookie + "=password", cookies);
        Assert.Contains("httponly", cookies, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SignOut_APasswordSignIn_GoesBackToThePasswordPageNotLfds()
    {
        var (ctrl, _) = PasswordPage();
        ctrl.HttpContext.Session.SetString("ActiveRepositoryId", "Demo");
        ctrl.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Name, "amir@LFDS"),
            new Claim(ClaimTypes.AuthenticationMethod, DashboardAuthenticationDefaults.PasswordAuthenticationMethod),
        ], DashboardAuthenticationDefaults.Scheme));

        var redirect = Assert.IsType<RedirectToActionResult>(await ctrl.SignOut(CancellationToken.None));
        Assert.Equal(nameof(LoginController.Password), redirect.ActionName);
    }

    [Fact]
    public async Task SignOut_AnLfdsSignIn_StillStartsSso()
    {
        var (ctrl, _) = PasswordPage();
        ctrl.HttpContext.Session.SetString("ActiveRepositoryId", "Demo");
        ctrl.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.AuthenticationMethod, DashboardAuthenticationDefaults.LfdsAuthenticationMethod),
        ], DashboardAuthenticationDefaults.Scheme));

        var redirect = Assert.IsType<RedirectToActionResult>(await ctrl.SignOut(CancellationToken.None));
        Assert.Equal("StartSso", redirect.ActionName);
    }

    [Fact]
    public async Task Sso_Callback_Success_ForgetsThePasswordPage()
    {
        var (ctrl, _, _) = Build(SsoOptions(), directBrowser: false);
        await ctrl.StartSso(returnUrl: "/Dashboard", cancellationToken: default, repository: "TestRepo");
        var state = ctrl.HttpContext.Session.GetString("OAuth_PendingState");
        ctrl.HttpContext.Request.Headers.Cookie = LoginController.PasswordPageCookie + "=password";

        await ctrl.Callback(code: "valid-code", state: state, cancellationToken: default);

        Assert.Contains(LoginController.PasswordPageCookie + "=;",
            ctrl.Response.Headers.SetCookie.ToString());
    }

    [Theory]
    [InlineData("amir@LFDS", "isb", "الحساب amir ليست له صلاحية على مستودع isb.")]
    [InlineData(" ADMIN ", "Demo", "الحساب ADMIN ليست له صلاحية على مستودع Demo.")]
    public void NoAccessToRepository_NamesTheAccountAsTyped(string username, string repository, string start)
    {
        Assert.StartsWith(start, LoginController.NoAccessToRepository(username, repository));
    }

    [Fact]
    public void SignInRepositories_ReadsTheIdsOfTheServerList()
    {
        var json = JsonDocument.Parse("""
            {"value":[{"id":"Demo","name":"Demo"},{"id":"isb"},{"id":"ISB"},{"id":""},{"name":"no id"}]}
            """);
        Assert.Equal(["Demo", "isb"], SignInRepositories.Read(json));
        Assert.Empty(SignInRepositories.Read(JsonDocument.Parse("""{"error":"x"}""")));
    }

    [Theory]
    [InlineData("https://lf.test", "/LFRepositoryAPI", "https://lf.test/LFRepositoryAPI/v2/Repositories")]
    [InlineData("https://lf.test/LFRepositoryAPI/", "/LFRepositoryAPI", "https://lf.test/LFRepositoryAPI/v2/Repositories")]
    [InlineData("", "/LFRepositoryAPI", null)]
    public void SignInRepositories_AsksTheRepositoryApiNextToAuthorize(string server, string basePath, string? expected)
    {
        var options = new LaserficheOptions { ServerUrl = server, ApiBasePath = basePath };
        Assert.Equal(expected, SignInRepositories.RepositoriesUrl(options));
    }
}

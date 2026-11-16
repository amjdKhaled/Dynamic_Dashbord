using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using LFPortal.Application.DTOs;
using LFPortal.Application.Interfaces;
using LFPortal.Web.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// The Admin Portal decides what a signed-in account may open in the Dynamic Dashboard.
/// </summary>
public sealed class PortalAccessFilterTests
{
    private const string Portal = "https://portal.test:8090";
    private const string Test2 = "be97d9837678980991cc348bcf3c4eab";

    // ---------- which section a page belongs to ----------

    [Theory]
    [InlineData("/", "overview")]
    [InlineData("/DynamicDashboard", "overview")]
    [InlineData("/DynamicDashboard/Layout", "overview")]
    [InlineData("/DynamicDashboard/SaveLayout", "overview")]
    [InlineData("/Dashboard", "overview")]
    [InlineData("/Dashboard/Probe", "overview")]
    [InlineData("/Archive", "archive")]
    [InlineData("/Archive/Detail", "archive")]
    [InlineData("/Document/PageImage/4/1", "archive")]
    [InlineData("/settings", "settings")]
    [InlineData("/Settings/Save", "settings")]
    [InlineData("/api/laserfiche/status", "settings")]
    [InlineData("/Archive/OpenInLaserfiche", null)]
    [InlineData("/Login", null)]
    [InlineData("/Launch", null)]
    [InlineData("/Home/Error", null)]
    [InlineData("/SetCulture", null)]
    [InlineData("/Share/Dashboard", null)]
    [InlineData("/api/diagnostics/laserfiche", null)]
    [InlineData("/api/portal/boards", null)]
    public void EveryPageBelongsToItsSection(string path, string? section) =>
        Assert.Equal(section, DashboardSections.For(path));

    [Fact]
    public void TheBoardsPageIsTheHomeOfTheOverview() =>
        Assert.Equal("/DynamicDashboard", DashboardSections.HomeOf("overview"));

    // ---------- boards ----------

    [Fact]
    public void ABoard_IsSeenOnlyWhenGivenAndWithTheBoardsPage()
    {
        var given = Access(true, "overview", "overview/" + Test2);
        Assert.True(given.SeesBoard(Test2));
        Assert.False(given.SeesBoard("default"));
        Assert.False(given.SeesBoard("d5064f2e375fac30dd49cb79d634fae4"));
        Assert.False(given.SeesAllBoards);

        Assert.False(Access(true, "overview/" + Test2).SeesBoard(Test2));
        Assert.False(Access(false, "overview", "overview/" + Test2).SeesBoard(Test2));
        Assert.True(Access(true, "overview", "overview/default").SeesBoard("default"));
    }

    [Fact]
    public void TheMainAdmin_SeesEveryBoard()
    {
        var admin = Access(true, "overview", "overview/*");
        Assert.True(admin.SeesAllBoards);
        Assert.True(admin.SeesBoard("default"));
        Assert.True(admin.SeesBoard(Test2));
    }

    // ---------- the filter ----------

    [Fact]
    public async Task WithoutThePortal_EverythingStaysOpen()
    {
        var (context, ran) = await Run("/Settings", portal: Throws(), baseUrl: "");
        Assert.True(ran);
        Assert.Null(context.Result);
        Assert.Null(PortalAccessView.Current(context.HttpContext));
        Assert.True(PortalAccessView.CanShow(context.HttpContext, "settings"));
    }

    [Fact]
    public async Task GrantedSection_Opens_AndTheAnswerReachesThePage()
    {
        var (context, ran) = await Run("/DynamicDashboard/Layout", portal: Answers(true, "overview"));
        Assert.True(ran);
        var access = Assert.IsType<DashboardAccess>(context.HttpContext.Items[PortalAccessFilter.ItemKey]);
        Assert.Same(access, PortalAccessView.Current(context.HttpContext));
        Assert.Equal("amir", PortalAccessView.AccountName(context.HttpContext));
        Assert.True(PortalAccessView.CanShow(context.HttpContext, "overview"));
        Assert.False(PortalAccessView.CanShow(context.HttpContext, "archive"));
        Assert.False(access.Has("settings"));
    }

    [Fact]
    public async Task PortalUnreachable_TheBoardsPageSeesNothing()
    {
        var (context, _) = await Run("/Login", portal: Throws());
        var access = PortalAccessView.Current(context.HttpContext);
        Assert.NotNull(access);
        Assert.False(access.Allowed);
        Assert.False(PortalAccessView.CanShow(context.HttpContext, "overview"));
    }

    [Theory]
    [InlineData("/Archive")]
    [InlineData("/Settings")]
    [InlineData("/Document/Download")]
    public async Task OtherSections_AreRefusedWithLinksToWhatTheAccountHolds(string path)
    {
        var (context, ran) = await Run(path, portal: Answers(true, "overview"));
        Assert.False(ran);
        var view = Assert.IsType<ViewResult>(context.Result);
        Assert.Equal(403, view.StatusCode);
        var model = Assert.IsType<AccessDeniedViewModel>(view.ViewData.Model);
        Assert.Equal(AccessDeniedReason.Section, model.Reason);
        Assert.Equal(["overview"], model.Allowed);
    }

    [Theory]
    [InlineData("/Archive/Detail", "overview")]
    [InlineData("/DynamicDashboard/Layout", "archive")]
    public async Task ScriptCalls_GetJsonInsteadOfAPage(string path, string held)
    {
        var (context, _) = await Run(path, portal: Answers(true, held), ajax: true);
        var json = Assert.IsType<JsonResult>(context.Result);
        Assert.Equal(403, json.StatusCode);
    }

    [Fact]
    public async Task NoDynamicDashboard_RefusesEverySection()
    {
        var (context, ran) = await Run("/DynamicDashboard", portal: Answers(false));
        Assert.False(ran);
        var model = Assert.IsType<AccessDeniedViewModel>(Assert.IsType<ViewResult>(context.Result).ViewData.Model);
        Assert.Equal(AccessDeniedReason.Dashboard, model.Reason);
        Assert.Empty(model.Allowed);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/DynamicDashboard")]
    [InlineData("/DynamicDashboard/Index")]
    [InlineData("/Dashboard")]
    public async Task HomePage_OpensTheFirstSectionTheAccountHolds(string path)
    {
        var (context, _) = await Run(path, portal: Answers(true, "archive", "settings"));
        Assert.Equal("/Archive", Assert.IsType<LocalRedirectResult>(context.Result).Url);
    }

    [Fact]
    public async Task ABoardRequest_IsRefusedNotRedirected()
    {
        var (context, ran) = await Run("/DynamicDashboard/SaveLayout", portal: Answers(true, "archive"));
        Assert.False(ran);
        Assert.Equal(403, Assert.IsType<ViewResult>(context.Result).StatusCode);
    }

    [Fact]
    public async Task PortalUnreachable_NothingOpens()
    {
        var (context, ran) = await Run("/DynamicDashboard", portal: Throws());
        Assert.False(ran);
        var view = Assert.IsType<ViewResult>(context.Result);
        Assert.Equal(503, view.StatusCode);
        Assert.Equal(AccessDeniedReason.PortalUnavailable, Assert.IsType<AccessDeniedViewModel>(view.ViewData.Model).Reason);
    }

    [Theory]
    [InlineData("/Login")]
    [InlineData("/Share/Dashboard")]
    [InlineData("/api/portal/boards")]
    public async Task PagesWithoutASection_OpenEvenWhenThePortalIsDown(string path)
    {
        var (_, ran) = await Run(path, portal: Throws());
        Assert.True(ran);
    }

    [Fact]
    public async Task ThePortalsOwnBoardList_NeverAsksThePortal()
    {
        var portal = new RecordingPortal(null);
        var (_, ran) = await Run("/api/portal/boards", portal: portal, signedIn: false);
        Assert.True(ran);
        Assert.Empty(portal.Asked);
    }

    [Fact]
    public async Task SettingsWithoutSignIn_GoesToSignIn()
    {
        var (context, ran) = await Run("/Settings", portal: Answers(true, "settings"), signedIn: false);
        Assert.False(ran);
        Assert.Equal("/Login?returnUrl=%2FSettings", Assert.IsType<LocalRedirectResult>(context.Result).Url);
    }

    [Fact]
    public async Task SettingsOnTheServerItself_StaysOpenForRepairs()
    {
        var (_, ran) = await Run("/Settings", portal: Throws(), signedIn: false, remote: IPAddress.Loopback);
        Assert.True(ran);
        var (_, mapped) = await Run("/Settings", portal: Throws(), signedIn: false, remote: IPAddress.Parse("::ffff:127.0.0.1"));
        Assert.True(mapped);
        var (_, other) = await Run("/Archive", portal: Throws(), signedIn: false, remote: IPAddress.Loopback);
        Assert.False(other);
    }

    [Fact]
    public async Task AccountName_ComesFromTheLaserficheToken()
    {
        var portal = new RecordingPortal(Access(true, "overview"));
        var (context, _) = await Run("/DynamicDashboard", portal: portal, signInName: "AMIR@LFDS", token: Jwt("""{"name":"amir"}"""));
        Assert.Equal(("Demo", "amir"), portal.Asked.Single());
        Assert.Equal("amir", context.HttpContext.Items[PortalAccessFilter.AccountKey]);
    }

    [Theory]
    [InlineData("amir@LFDS", "amir")]
    [InlineData("forms", "forms")]
    public async Task WithoutANameInTheToken_TheSignInNameIsUsed(string signInName, string expected)
    {
        var portal = new RecordingPortal(Access(true, "overview"));
        await Run("/DynamicDashboard", portal: portal, signInName: signInName, token: "not-a-jwt");
        Assert.Equal(("Demo", expected), portal.Asked.Single());
    }

    [Theory]
    [InlineData("""{"name":"amir"}""", "amir")]
    [InlineData("""{"name":"amir@LFDS"}""", "amir")]
    [InlineData("""{"sub":"5"}""", null)]
    public void TokenName_IsReadFromThePayload(string payload, string? expected) =>
        Assert.Equal(expected, PortalAccountName.FromToken(Jwt(payload)));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a.b")]
    [InlineData("a.%%%.c")]
    public void TokenName_IgnoresWhatIsNotAJwt(string? token) => Assert.Null(PortalAccountName.FromToken(token));

    // ---------- the client ----------

    [Fact]
    public async Task Client_SendsTheKeyAndReadsTheAnswer()
    {
        var handler = new StubHandler(_ => Json($$"""{"allowed":true,"sections":["overview","archive","overview/{{Test2}}"]}"""));
        var client = Client(handler, cacheSeconds: 0);
        var access = await client.GetAsync("Demo Repo", "amir", default);
        Assert.True(access.Has("archive"));
        Assert.False(access.Has("settings"));
        Assert.True(access.SeesBoard(Test2));
        var request = handler.Requests.Single();
        Assert.Equal($"{Portal}/api/systems/dynamic/access?repo=Demo%20Repo&user=amir", request.RequestUri!.AbsoluteUri);
        Assert.Equal("dynamic-key", request.Headers.GetValues(PortalAccessClient.KeyHeader).Single());
    }

    [Fact]
    public async Task Client_ReusesAnAnswerForTheCacheTime()
    {
        var handler = new StubHandler(_ => Json("""{"allowed":true,"sections":[]}"""));
        var client = Client(handler, cacheSeconds: 30);
        await client.GetAsync("Demo", "amir", default);
        await client.GetAsync("demo", "amir", default);
        await client.GetAsync("Demo", "forms", default);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Redirect)]
    public async Task Client_RefusesAnythingButAnAnswer(HttpStatusCode status)
    {
        var client = Client(new StubHandler(_ => new HttpResponseMessage(status)), cacheSeconds: 0);
        await Assert.ThrowsAsync<PortalAccessException>(() => client.GetAsync("Demo", "amir", default));
    }

    [Theory]
    [InlineData("http://portal.test:8090", "dynamic-key")]
    [InlineData(Portal, "")]
    public async Task Client_NeverSendsTheKeyInTheClearOrWithoutOne(string baseUrl, string key)
    {
        var handler = new StubHandler(_ => Json("""{"allowed":true,"sections":[]}"""));
        var client = Client(handler, cacheSeconds: 0, baseUrl: baseUrl, key: key);
        await Assert.ThrowsAsync<PortalAccessException>(() => client.GetAsync("Demo", "amir", default));
        Assert.Empty(handler.Requests);
    }

    // ---------- helpers ----------

    private static DashboardAccess Access(bool allowed, params string[] sections) =>
        new(allowed, new HashSet<string>(sections));

    private static async Task<(ActionExecutingContext Context, bool Ran)> Run(
        string path, IPortalAccessClient portal, string baseUrl = Portal, bool signedIn = true, bool ajax = false,
        IPAddress? remote = null, string signInName = "amir", string token = "no-jwt-here")
    {
        var options = Options(baseUrl);
        var services = new ServiceCollection();
        services.AddSingleton<IOptionsMonitor<PortalAccessOptions>>(options);
        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        http.Request.Method = "GET"; http.Request.Path = path;
        http.Connection.RemoteIpAddress = remote ?? IPAddress.Parse("192.168.1.20");
        if (ajax) http.Request.Headers["X-Requested-With"] = "XMLHttpRequest";
        if (signedIn)
            http.User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(DashboardAuthenticationDefaults.RepositoryClaimType, "Demo"),
                new Claim(ClaimTypes.Name, signInName),
            ], DashboardAuthenticationDefaults.Scheme));

        var context = new ActionExecutingContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()), [], new Dictionary<string, object?>(), new object());
        var filter = new PortalAccessFilter(options, portal,
            Proxy<ILaserficheAuthService>(_ => Task.FromResult(token)),
            Proxy<IRepositoryContext>(_ => Task.FromResult(new RepositoryDescriptor("demo", "https://lf.test", "Demo", "Demo"))),
            NullLogger<PortalAccessFilter>.Instance);
        var ran = false;
        await filter.OnActionExecutionAsync(context, () => { ran = true; return Task.FromResult(new ActionExecutedContext(context, [], new object())); });
        return (context, ran);
    }

    private static IPortalAccessClient Answers(bool allowed, params string[] sections) =>
        new RecordingPortal(Access(allowed, sections));

    private static IPortalAccessClient Throws() => new RecordingPortal(null);

    private sealed class RecordingPortal(DashboardAccess? answer) : IPortalAccessClient
    {
        public List<(string, string)> Asked { get; } = [];
        public Task<DashboardAccess> GetAsync(string repositoryId, string accountName, CancellationToken cancellationToken)
        {
            Asked.Add((repositoryId, accountName));
            return answer is null ? Task.FromException<DashboardAccess>(new PortalAccessException("down")) : Task.FromResult(answer);
        }
    }

    private static PortalAccessClient Client(StubHandler handler, int cacheSeconds, string baseUrl = Portal, string key = "dynamic-key") =>
        new(new StubFactory(handler), new MemoryCache(new MemoryCacheOptions()), Options(baseUrl, key, cacheSeconds));

    private static IOptionsMonitor<PortalAccessOptions> Options(string baseUrl, string key = "dynamic-key", int cacheSeconds = 30) =>
        new Monitor(new PortalAccessOptions { BaseUrl = baseUrl, Key = key, CacheSeconds = cacheSeconds });

    private static string Jwt(string payload) =>
        "eyJhbGciOiJSUzI1NiJ9." + Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_') + ".sig";

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class Monitor(PortalAccessOptions value) : IOptionsMonitor<PortalAccessOptions>
    {
        public PortalAccessOptions CurrentValue => value;
        public PortalAccessOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<PortalAccessOptions, string?> listener) => null;
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static T Proxy<T>(Func<MethodInfo, object?> call) where T : class
    {
        var proxy = DispatchProxy.Create<T, Calls>(); ((Calls)(object)proxy).Call = call; return proxy;
    }
    public class Calls : DispatchProxy
    {
        public Func<MethodInfo, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Call(targetMethod!);
    }
}

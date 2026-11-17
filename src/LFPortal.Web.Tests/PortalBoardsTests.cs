using System.Text.Json;
using LFPortal.Web.Authentication;
using LFPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// The Admin Portal's board list: owner records written when a user opens or saves the
/// Dynamic Dashboard, and <c>GET /api/portal/boards</c>, which reads them behind the portal key.
/// </summary>
public sealed class PortalBoardsTests : IDisposable
{
    private const string Key = "test-dynamic-key-0123456789abcdefgh";
    private static readonly string AdminScope = new('A', 64);
    private static readonly string AmirScope = new('B', 64);
    private static readonly string IsbScope = new('C', 64);
    private const string New = "d5064f2e375fac30dd49cb79d634fae4";
    private const string Test2 = "be97d9837678980991cc348bcf3c4eab";
    private const string Purchases = "8176bd6a2a5bdbad398021bf849145fa";
    private const string Hr = "0123456789abcdef0123456789abcdef";

    private readonly string _root = Path.Combine(Path.GetTempPath(), "dd-portal-boards-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private void SaveBoard(string scope, string id, string json, DateTime created)
    {
        var path = Path.Combine(_root, scope, id + ".json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);
        File.SetCreationTimeUtc(path, created);
    }

    private Task Remember(string scope, string repository, string user) =>
        DynamicBoardOwners.RememberAsync(_root, scope, new DynamicBoardOwners.Owner(repository, user), CancellationToken.None);

    private async Task SeedAsync()
    {
        SaveBoard(AdminScope, Test2, """{"name":"Test 2","charts":[]}""", new DateTime(2026, 11, 14, 15, 23, 0, DateTimeKind.Utc));
        SaveBoard(AdminScope, New, """{"name":"new","charts":[]}""", new DateTime(2026, 11, 14, 15, 36, 0, DateTimeKind.Utc));
        SaveBoard(AmirScope, Purchases, """{"name":"لوحة المشتريات","charts":[]}""", new DateTime(2026, 11, 14, 12, 53, 0, DateTimeKind.Utc));
        SaveBoard(IsbScope, Hr, """{"name":"الموارد البشرية","charts":[]}""", new DateTime(2026, 11, 13, 9, 0, 0, DateTimeKind.Utc));
        // The main board sits beside the folder, not in it, and is never listed.
        File.WriteAllText(Path.Combine(_root, AdminScope + ".json"), """{"name":"اللوحة الرئيسية","charts":[]}""");
        await Remember(AdminScope, "demo", "admin");
        await Remember(AmirScope, "demo", "amir");
        await Remember(IsbScope, "isb", "admin");
    }

    // ── Owner records ────────────────────────────────────────────────────────

    [Fact]
    public async Task Remember_WritesTheOwnerOnceAndKeepsItUntilItChanges()
    {
        await Remember(AdminScope, "demo", "admin");
        var path = Path.Combine(_root, DynamicBoardOwners.OwnersFolder, AdminScope + ".json");
        Assert.Equal("""{"repository":"demo","user":"admin"}""", File.ReadAllText(path));

        var written = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(path, written);
        await Remember(AdminScope, "demo", "admin");
        Assert.Equal(written, File.GetLastWriteTimeUtc(path));

        await Remember(AdminScope, "isb", "admin");
        Assert.Equal("""{"repository":"isb","user":"admin"}""", File.ReadAllText(path));
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(path)!));
    }

    [Theory]
    [InlineData("..\\..\\evil")]
    [InlineData("abc")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task Remember_IgnoresAnythingThatIsNotAScope(string scope)
    {
        await Remember(scope, "demo", "admin");
        Assert.False(Directory.Exists(Path.Combine(_root, DynamicBoardOwners.OwnersFolder)));
    }

    [Fact]
    public async Task Remember_IgnoresAnUnknownUser()
    {
        await Remember(AdminScope, "demo", " ");
        Assert.False(Directory.Exists(Path.Combine(_root, DynamicBoardOwners.OwnersFolder)));
    }

    [Fact]
    public void KeepCreationTime_ASavedBoardKeepsWhenItWasCreated()
    {
        var created = new DateTime(2026, 11, 12, 9, 12, 0, DateTimeKind.Utc);
        SaveBoard(AdminScope, New, """{"name":"new"}""", created);
        var path = Path.Combine(_root, AdminScope, New + ".json");
        var temp = path + ".1234.tmp";
        File.WriteAllText(temp, """{"name":"new, renamed"}""");

        DynamicBoardOwners.KeepCreationTime(path, temp);
        File.Move(temp, path, overwrite: true);

        Assert.Equal(created, File.GetCreationTimeUtc(path));
        Assert.Contains("renamed", File.ReadAllText(path));
    }

    [Fact]
    public void KeepCreationTime_ANewBoardKeepsItsOwnTime()
    {
        Directory.CreateDirectory(_root);
        var temp = Path.Combine(_root, "new.tmp");
        File.WriteAllText(temp, "{}");
        var before = File.GetCreationTimeUtc(temp);

        DynamicBoardOwners.KeepCreationTime(Path.Combine(_root, "missing.json"), temp);

        Assert.Equal(before, File.GetCreationTimeUtc(temp));
    }

    // ── Listing ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_GivesTheRepositorysBoardsWithOwnersNewestFirst()
    {
        await SeedAsync();

        var boards = DynamicBoardOwners.List(_root, "Demo");

        Assert.Equal(new[] { New, Test2, Purchases }, boards.Select(b => b.Id));
        Assert.Equal(new[] { "new", "Test 2", "لوحة المشتريات" }, boards.Select(b => b.Name));
        Assert.Equal(new[] { "admin", "admin", "amir" }, boards.Select(b => b.Owner));
        Assert.Equal(new DateTime(2026, 11, 14, 15, 36, 0, DateTimeKind.Utc), boards[0].Created);
        Assert.Equal(new[] { Hr }, DynamicBoardOwners.List(_root, "isb").Select(b => b.Id));
        Assert.Empty(DynamicBoardOwners.List(_root, "other"));
    }

    [Fact]
    public void List_IsEmptyBeforeAnyoneOpensTheDashboard()
    {
        SaveBoard(AdminScope, New, """{"name":"new"}""", DateTime.UtcNow);
        Assert.Empty(DynamicBoardOwners.List(_root, "demo"));
    }

    [Fact]
    public async Task List_SkipsFilesThatAreNotBoardsAndNamesABrokenBoardByItsId()
    {
        await SeedAsync();
        File.WriteAllText(Path.Combine(_root, AdminScope, "notes.json"), "{}");
        File.WriteAllText(Path.Combine(_root, AdminScope, "{" + Hr + "}.json"), "{}");
        File.WriteAllText(Path.Combine(_root, AdminScope, New + ".json.1234.tmp"), "{}");
        SaveBoard(AdminScope, Hr, "{ not json", new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc));
        File.WriteAllText(Path.Combine(_root, DynamicBoardOwners.OwnersFolder, new string('D', 64) + ".json"), "{ not json");
        File.WriteAllText(Path.Combine(_root, DynamicBoardOwners.OwnersFolder, "readme.json"), """{"repository":"demo","user":"x"}""");

        var boards = DynamicBoardOwners.List(_root, "demo");

        Assert.Equal(new[] { New, Test2, Purchases, Hr }, boards.Select(b => b.Id));
        Assert.Equal(Hr, boards[^1].Name);
    }

    // ── GET /api/portal/boards ───────────────────────────────────────────────

    private PortalBoardsController Controller(string? key = Key, string? header = Key)
    {
        var settings = new Dictionary<string, string?>();
        if (key is not null) settings[PortalBoardsController.KeySetting] = key;
        var context = new DefaultHttpContext();
        if (header is not null) context.Request.Headers[PortalBoardsController.KeyHeader] = header;
        return new PortalBoardsController(
            new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            NullLogger<PortalBoardsController>.Instance)
        {
            LayoutsRoot = _root,
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Get_IsOffUntilTheKeyIsSet(string? key)
    {
        Assert.IsType<NotFoundResult>(Controller(key: key).Get("demo"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong-key")]
    [InlineData(Key + "x")]
    public void Get_RefusesAMissingOrWrongKey(string? header)
    {
        Assert.IsType<UnauthorizedResult>(Controller(header: header).Get("demo"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("de\nmo")]
    public void Get_NeedsARepository(string? repo)
    {
        Assert.IsType<BadRequestObjectResult>(Controller().Get(repo));
    }

    [Fact]
    public async Task Get_AnswersTheBoardsAsThePortalReadsThem()
    {
        await SeedAsync();

        var result = Assert.IsType<JsonResult>(Controller().Get(" demo "));

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Value));
        var boards = json.RootElement.GetProperty("boards").EnumerateArray().ToList();
        Assert.Equal(3, boards.Count);
        Assert.Equal(New, boards[0].GetProperty("id").GetString());
        Assert.Equal("new", boards[0].GetProperty("name").GetString());
        Assert.Equal("admin", boards[0].GetProperty("owner").GetString());
        Assert.Equal("2026-11-14T15:36:00Z", boards[0].GetProperty("created").GetString());
        Assert.Equal("amir", boards[2].GetProperty("owner").GetString());
        Assert.DoesNotContain(boards, b => b.GetProperty("id").GetString() == "default");
    }

    [Fact]
    public void Get_AnswersAnEmptyListWhenNothingWasSaved()
    {
        var result = Assert.IsType<JsonResult>(Controller().Get("demo"));
        Assert.Equal("""{"boards":[]}""", JsonSerializer.Serialize(result.Value));
    }

    // ── Boards given through the portal ──────────────────────────────────────

    private static DashboardAccess Access(params string[] sections) => new(true, new HashSet<string>(sections));

    [Fact]
    public async Task Granted_GivesOnlyTheBoardsThePortalListsAndNeverTheAccountsOwn()
    {
        await SeedAsync();
        var boards = DynamicBoardOwners.List(_root, "demo");

        var amir = DynamicBoardOwners.Granted(Access("overview", "overview/" + Test2, "overview/" + Purchases), boards, AmirScope);
        var given = Assert.Single(amir);
        Assert.Equal(Test2, given.Id);
        Assert.Equal("admin", given.Owner);

        Assert.Empty(DynamicBoardOwners.Granted(Access("overview/" + Test2), boards, AmirScope));
        Assert.Empty(DynamicBoardOwners.Granted(new DashboardAccess(false, new HashSet<string> { "overview", "overview/" + Test2 }), boards, AmirScope));
        Assert.Empty(DynamicBoardOwners.Granted(null, boards, AmirScope));
    }

    [Fact]
    public async Task Granted_TheMainAdminSeesEveryoneElsesBoards()
    {
        await SeedAsync();
        var boards = DynamicBoardOwners.List(_root, "demo");

        var admin = DynamicBoardOwners.Granted(Access("overview", "overview/*"), boards, AdminScope);

        Assert.Equal(new[] { Purchases }, admin.Select(b => b.Id));
    }

    [Fact]
    public async Task BelongsToSomeoneElse_FindsABoardSavedForAnotherAccount()
    {
        await SeedAsync();
        Assert.True(DynamicBoardOwners.BelongsToSomeoneElse(_root, AmirScope, Test2));
        Assert.False(DynamicBoardOwners.BelongsToSomeoneElse(_root, AdminScope, Test2));
        Assert.False(DynamicBoardOwners.BelongsToSomeoneElse(_root, AmirScope, "ffffffffffffffffffffffffffffffff"));
        Assert.False(DynamicBoardOwners.BelongsToSomeoneElse(Path.Combine(_root, "missing"), AmirScope, Test2));
        // The owner records are not boards.
        Assert.False(DynamicBoardOwners.BelongsToSomeoneElse(_root, AmirScope, AdminScope));
    }

    [Theory]
    // Without the portal, everything the owner could do stays allowed.
    [InlineData(false, "", "default", false, false, null)]
    [InlineData(false, "", New, false, false, null)]
    // The main board needs the portal's "overview/default", and «تخصيص اللوحة» to change it.
    [InlineData(true, "overview,customize", "default", false, false, "ليست لديك صلاحية على اللوحة الرئيسية.")]
    [InlineData(true, "overview,overview/default,customize", "default", false, false, null)]
    [InlineData(true, "overview,overview/*,customize", "default", false, false, null)]
    [InlineData(true, "overview,overview/default", "default", false, false, "ليست لديك صلاحية تخصيص اللوحات.")]
    // An account's own board is its own to save while it holds «تخصيص اللوحة».
    [InlineData(true, "overview,customize", New, true, false, null)]
    [InlineData(true, "overview,create", New, true, false, "ليست لديك صلاحية تخصيص اللوحات.")]
    // Another account's board is view only, even for the main admin.
    [InlineData(true, "overview,overview/" + Test2, Test2, false, true, "هذه اللوحة للعرض فقط. يعدّلها من أنشأها وحده.")]
    [InlineData(true, "overview,overview/*,create,customize", Test2, false, true, "هذه اللوحة للعرض فقط. يعدّلها من أنشأها وحده.")]
    // A new board needs «إنشاء لوحة جديدة», which comes with «تخصيص اللوحة».
    [InlineData(true, "overview,customize", Hr, false, false, "ليست لديك صلاحية إنشاء لوحات جديدة.")]
    [InlineData(true, "overview,create", Hr, false, false, "ليست لديك صلاحية تخصيص اللوحات.")]
    [InlineData(true, "overview,create,customize", Hr, false, false, null)]
    public void WhyNotSave_FollowsThePortal(
        bool portal, string sections, string boardId, bool ownsIt, bool someoneElses, string? expected)
    {
        var access = portal ? Access(sections.Split(',', StringSplitOptions.RemoveEmptyEntries)) : null;
        Assert.Equal(expected, DynamicBoardOwners.WhyNotSave(access, boardId, ownsIt, someoneElses));
    }

    [Theory]
    // Without the portal, a new board may be public as before.
    [InlineData(false, "", New, false, false, null)]
    // A private board needs nothing more; a public one needs «يختار أن تكون اللوحة عامة أو خاصة».
    [InlineData(true, "overview,customize,create", Hr, false, true, null)]
    [InlineData(true, "overview,customize,create", Hr, false, false, "ليست لديك صلاحية إنشاء لوحات عامة.")]
    [InlineData(true, "overview,customize,create,public", Hr, false, false, null)]
    // A saved board keeps what it was given when created (a board from before the choice is public).
    [InlineData(true, "overview,customize,create", New, true, false, null)]
    // The main board has no visibility.
    [InlineData(true, "overview,overview/default,customize", "default", false, false, null)]
    public void WhyNotPublic_NeedsThePublicChoice(
        bool portal, string sections, string boardId, bool ownsIt, bool wantsPrivate, string? expected)
    {
        var access = portal ? Access(sections.Split(',', StringSplitOptions.RemoveEmptyEntries)) : null;
        Assert.Equal(expected, DynamicBoardOwners.WhyNotPublic(access, boardId, ownsIt, wantsPrivate));
    }

    [Fact]
    public void WhyNotChange_NeedsCustomizeOnlyWithThePortal()
    {
        Assert.Null(DynamicBoardOwners.WhyNotChange(null));
        Assert.Null(DynamicBoardOwners.WhyNotChange(Access("overview", "customize")));
        Assert.Equal("ليست لديك صلاحية تخصيص اللوحات.", DynamicBoardOwners.WhyNotChange(Access("overview", "create")));
        Assert.Equal("ليست لديك صلاحية تخصيص اللوحات.",
            DynamicBoardOwners.WhyNotChange(new DashboardAccess(false, new HashSet<string> { "overview", "customize" })));
    }

    // ── Private boards ───────────────────────────────────────────────────────

    private async Task SeedPrivateAsync()
    {
        await SeedAsync();
        // amir keeps «لوحة المشتريات» to himself; admin says out loud that «new» is public.
        SaveBoard(AmirScope, Purchases, """{"name":"لوحة المشتريات","visibility":"private","charts":[]}""",
            new DateTime(2026, 11, 14, 12, 53, 0, DateTimeKind.Utc));
        SaveBoard(AdminScope, New, """{"name":"new","visibility":"public","charts":[]}""",
            new DateTime(2026, 11, 14, 15, 36, 0, DateTimeKind.Utc));
    }

    [Fact]
    public async Task List_TellsWhichBoardsArePrivate()
    {
        await SeedPrivateAsync();

        var boards = DynamicBoardOwners.List(_root, "demo");

        Assert.Equal(new[] { New, Test2, Purchases }, boards.Select(b => b.Id));
        Assert.Equal(new[] { false, false, true }, boards.Select(b => b.Private));
    }

    [Fact]
    public async Task Get_NeverListsAPrivateBoard()
    {
        await SeedPrivateAsync();

        var result = Assert.IsType<JsonResult>(Controller().Get("demo"));

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Value));
        var ids = json.RootElement.GetProperty("boards").EnumerateArray().Select(b => b.GetProperty("id").GetString());
        Assert.Equal(new[] { New, Test2 }, ids);
    }

    [Fact]
    public async Task Granted_NeverGivesAPrivateBoardNotEvenToTheMainAdmin()
    {
        await SeedPrivateAsync();
        var boards = DynamicBoardOwners.List(_root, "demo");

        Assert.Empty(DynamicBoardOwners.Granted(Access("overview", "overview/*"), boards, AdminScope));
        Assert.Empty(DynamicBoardOwners.Granted(Access("overview", "overview/" + Purchases), boards, AdminScope));
        Assert.Equal(new[] { New, Test2 },
            DynamicBoardOwners.Granted(Access("overview", "overview/*"), boards, AmirScope).Select(b => b.Id));
    }

    [Fact]
    public async Task ChangesVisibility_KeepsWhatTheCreatorChose()
    {
        await SeedPrivateAsync();
        string Saved(string scope, string id) => Path.Combine(_root, scope, id + ".json");

        // «لوحة المشتريات» was made private, «new» public, «Test 2» before the choice (so public).
        Assert.True(DynamicBoardOwners.ChangesVisibility(Saved(AmirScope, Purchases), wantsPrivate: false));
        Assert.False(DynamicBoardOwners.ChangesVisibility(Saved(AmirScope, Purchases), wantsPrivate: true));
        Assert.True(DynamicBoardOwners.ChangesVisibility(Saved(AdminScope, New), wantsPrivate: true));
        Assert.False(DynamicBoardOwners.ChangesVisibility(Saved(AdminScope, Test2), wantsPrivate: false));
        Assert.True(DynamicBoardOwners.ChangesVisibility(Saved(AdminScope, Test2), wantsPrivate: true));
        // A board not saved yet is being created: its creator picks either.
        Assert.False(DynamicBoardOwners.ChangesVisibility(Saved(AdminScope, Hr), wantsPrivate: true));
    }

    [Theory]
    [InlineData("public", true)]
    [InlineData("private", true)]
    [InlineData("Private", false)]
    [InlineData("shared", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsVisibility_AcceptsOnlyPublicOrPrivate(string? value, bool expected)
    {
        Assert.Equal(expected, DynamicBoardOwners.IsVisibility(value));
    }
}

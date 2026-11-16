using System.Text.Json;
using System.Text.RegularExpressions;
using LFPortal.Infrastructure.Configuration;

namespace LFPortal.Web.Controllers;

/// <summary>
/// Who each saved layout folder belongs to, so the Admin Portal can list every board in a
/// repository with its owner.
/// </summary>
/// <remarks>
/// A user's boards live in <c>DynamicLayouts\{scope}\{boardId}.json</c>, where the scope is a
/// one-way hash of (server, repository, user). The hash alone cannot say whose boards are inside,
/// so each time a user opens or saves the Dynamic Dashboard their owner record is written to
/// <c>DynamicLayouts\owners\{scope}.json</c>. A board whose owner has not opened the Dynamic
/// Dashboard since this was added is not listed until they do.
/// </remarks>
internal static class DynamicBoardOwners
{
    internal const string OwnersFolder = "owners";
    internal const int MaxBoards = 5000;

    private static readonly Regex Scope = new("^[0-9A-F]{64}$", RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static string DefaultRoot =>
        Path.Combine(DashboardConfigPaths.ProgramDataDirectory, "DynamicLayouts");

    internal sealed record Owner(string Repository, string User);

    /// <summary>A board's "visibility" in its saved layout. Missing means public (boards made before it).</summary>
    internal const string PublicBoard = "public";
    internal const string PrivateBoard = "private";

    /// <summary>True for a value a saved layout may carry as its "visibility".</summary>
    internal static bool IsVisibility(string? value) => value is PublicBoard or PrivateBoard;

    /// <param name="Private">
    /// The owner keeps it to themself: the Admin Portal does not list it and nobody is given it,
    /// not even the portal's main admin.
    /// </param>
    internal sealed record Board(string Id, string Name, string Owner, DateTime Created, string Scope, bool Private = false)
    {
        /// <summary>Where the board's layout is saved.</summary>
        internal string PathIn(string root) => Path.Combine(root, Scope, Id + ".json");
    }

    /// <summary>Records who owns <paramref name="scope"/>. Writes only when the record changes.</summary>
    internal static async Task RememberAsync(
        string root, string scope, Owner owner, CancellationToken cancellationToken)
    {
        if (!Scope.IsMatch(scope) || string.IsNullOrWhiteSpace(owner.Repository) ||
            string.IsNullOrWhiteSpace(owner.User))
            return;

        var path = Path.Combine(root, OwnersFolder, scope + ".json");
        var json = JsonSerializer.Serialize(owner, Json);
        if (File.Exists(path) && await File.ReadAllTextAsync(path, cancellationToken) == json)
            return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, json, cancellationToken);
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    /// <summary>
    /// A save writes a new file over the old one, which would make every save look like a new
    /// board. Before that, the new file takes the old one's creation time.
    /// </summary>
    internal static void KeepCreationTime(string existing, string replacement)
    {
        if (File.Exists(existing))
            File.SetCreationTimeUtc(replacement, File.GetCreationTimeUtc(existing));
    }

    /// <summary>
    /// Every board (not the main one) whose owner is known and who works in
    /// <paramref name="repository"/>, newest first. Unreadable files are skipped.
    /// </summary>
    internal static List<Board> List(string root, string repository, ILogger? logger = null)
    {
        var boards = new List<Board>();
        var owners = Path.Combine(root, OwnersFolder);
        if (!Directory.Exists(owners)) return boards;

        foreach (var file in Directory.EnumerateFiles(owners, "*.json"))
        {
            var scope = Path.GetFileNameWithoutExtension(file);
            if (!Scope.IsMatch(scope)) continue;

            Owner? owner;
            try { owner = JsonSerializer.Deserialize<Owner>(File.ReadAllText(file), Json); }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
            {
                logger?.LogWarning("Skipped an unreadable board owner record ({ErrorType}).", ex.GetType().Name);
                continue;
            }
            if (owner is null || string.IsNullOrWhiteSpace(owner.User) ||
                !string.Equals(owner.Repository, repository, StringComparison.OrdinalIgnoreCase))
                continue;

            var folder = Path.Combine(root, scope);
            if (!Directory.Exists(folder)) continue;
            foreach (var layout in Directory.EnumerateFiles(folder, "*.json"))
            {
                var id = Path.GetFileNameWithoutExtension(layout);
                if (!Guid.TryParseExact(id, "N", out var parsed) || id != parsed.ToString("N")) continue;
                var (name, isPrivate) = ReadSummary(layout, logger);
                boards.Add(new Board(id, name ?? id, owner.User,
                    File.GetCreationTimeUtc(layout), scope, isPrivate));
            }
        }

        return boards.OrderByDescending(board => board.Created).ThenBy(board => board.Id)
            .Take(MaxBoards).ToList();
    }

    /// <summary>
    /// True when a board with this id is saved for someone other than <paramref name="ownScope"/>,
    /// whether or not their owner is recorded. Such an id is never saved over (it is not theirs).
    /// </summary>
    internal static bool BelongsToSomeoneElse(string root, string ownScope, string boardId)
    {
        if (!Directory.Exists(root)) return false;
        foreach (var folder in Directory.EnumerateDirectories(root))
        {
            var scope = Path.GetFileName(folder);
            if (Scope.IsMatch(scope) && scope != ownScope && File.Exists(Path.Combine(folder, boardId + ".json")))
                return true;
        }
        return false;
    }

    /// <summary>
    /// The boards given to the account through the Admin Portal, which it sees read-only:
    /// every recorded public board in the repository that is not its own and that the portal
    /// lists for it ("overview/&lt;id&gt;", or "overview/*" for the main admin). A private board
    /// is never given, not even to the main admin. None without the portal.
    /// </summary>
    internal static IEnumerable<Board> Granted(
        LFPortal.Web.Authentication.DashboardAccess? access, IEnumerable<Board> repositoryBoards, string ownScope) =>
        access is null ? [] : repositoryBoards.Where(board =>
            board.Scope != ownScope && !board.Private && access.SeesBoard(board.Id));

    /// <summary>
    /// Why the account may not save this board, or <c>null</c> when it may. A board is saved only
    /// in its owner's own folder, so another person's board is never changed: it is view only.
    /// Changing even one's own boards needs «تخصيص اللوحة», and a new one «إنشاء لوحات جديدة» too.
    /// Without the portal (<paramref name="access"/> null) everything the owner had stays allowed.
    /// </summary>
    internal static string? WhyNotSave(
        LFPortal.Web.Authentication.DashboardAccess? access, string boardId, bool ownsIt, bool someoneElses)
    {
        if (access is null) return null;
        if (boardId == LFPortal.Web.Authentication.DashboardSections.MainBoard && !access.SeesBoard(boardId))
            return "ليست لديك صلاحية على اللوحة الرئيسية.";
        if (boardId != LFPortal.Web.Authentication.DashboardSections.MainBoard && !ownsIt && someoneElses)
            return "هذه اللوحة للعرض فقط. يعدّلها من أنشأها وحده.";
        if (WhyNotChange(access) is { } refusal) return refusal;
        if (boardId == LFPortal.Web.Authentication.DashboardSections.MainBoard || ownsIt) return null;
        return access.Has(LFPortal.Web.Authentication.DashboardSections.Create)
            ? null : "ليست لديك صلاحية إنشاء لوحات جديدة.";
    }

    /// <summary>
    /// Why the account may not change or delete its own boards (no «تخصيص اللوحة»), or <c>null</c>.
    /// </summary>
    internal static string? WhyNotChange(LFPortal.Web.Authentication.DashboardAccess? access) =>
        access is null || access.Has(LFPortal.Web.Authentication.DashboardSections.Customize)
            ? null : "ليست لديك صلاحية تخصيص اللوحات.";

    /// <summary>
    /// True when saving <paramref name="wantsPrivate"/> over the board saved at <paramref name="path"/>
    /// would change who sees it. That is chosen once, when the board is created (a board saved
    /// before the choice existed counts as public).
    /// </summary>
    internal static bool ChangesVisibility(string path, bool wantsPrivate) =>
        File.Exists(path) && ReadSummary(path, null).Private != wantsPrivate;

    /// <summary>The board's saved name (null when missing or unreadable) and whether it is private.</summary>
    private static (string? Name, bool Private) ReadSummary(string path, ILogger? logger)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return (null, false);
            var name = root.TryGetProperty("name", out var saved) &&
                       saved.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(saved.GetString())
                ? saved.GetString()!.Trim()
                : null;
            var isPrivate = root.TryGetProperty("visibility", out var visibility) &&
                            visibility.ValueKind == JsonValueKind.String && visibility.GetString() == PrivateBoard;
            return (name, isPrivate);
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            logger?.LogWarning("Could not read a board's name ({ErrorType}).", ex.GetType().Name);
            return (null, false);
        }
    }
}

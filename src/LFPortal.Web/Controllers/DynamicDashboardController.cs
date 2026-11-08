using System.Text.Json;
using System.Security.Claims;
using LFPortal.Web.Authentication;
using LFPortal.Application.DTOs;
using LFPortal.Application.Interfaces;
using LFPortal.Infrastructure.Configuration;
using LFPortal.Domain.Entities;
using LFPortal.Domain.Exceptions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LFPortal.Web.Controllers;

/// <summary>
/// An additive, user-configurable dashboard. All document and field data is read with
/// the current authenticated Laserfiche repository context; no privileged search is used.
/// </summary>
[Authorize]
[ResponseCache(Location = ResponseCacheLocation.None, NoStore = true)]
public sealed class DynamicDashboardController : Controller
{
    private readonly ILaserficheEntryService _entries;
    private readonly ILaserficheFieldDefinitionService _fields;
    private readonly IRepositoryContext _repository;
    private readonly ILogger<DynamicDashboardController> _logger;

    public DynamicDashboardController(
        ILaserficheEntryService entries,
        ILaserficheFieldDefinitionService fields,
        IRepositoryContext repository,
        ILogger<DynamicDashboardController> logger)
    {
        _entries = entries;
        _fields = fields;
        _repository = repository;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromServices] ILaserficheDashboardService dashboard, CancellationToken cancellationToken)
    {
        var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
        ViewBag.RepositoryId = repo.RepositoryId;
        ViewBag.StorageScope = GetLayoutScope(repo.ServerUrl, repo.RepositoryId);
        // The main board uses the same permission-scoped statistics as the existing overview.
        DashboardStatsDto stats;
        try
        {
            stats = await dashboard.GetDashboardStatsAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning("Could not load the main overview ({ErrorType}).", ex.GetType().Name);
            stats = new() { ErrorMessage = "تعذر تحميل إحصائيات اللوحة الرئيسية." };
        }
        return View(new DashboardViewModel { Stats = stats });
    }

    [HttpGet]
    public async Task<IActionResult> Repositories(
        [FromServices] ILaserficheRepositoryService repositories, CancellationToken cancellationToken)
    {
        var active = await _repository.GetActiveRepositoryAsync(cancellationToken);
        if (!string.Equals(User.FindFirstValue(DashboardAuthenticationDefaults.RepositoryClaimType),
                active.RepositoryId, StringComparison.OrdinalIgnoreCase))
            return Unauthorized();
        try
        {
            var choices = await repositories.ListRepositoriesAsync(cancellationToken);
            return Json(new
            {
                repositories = choices.Where(item => !string.IsNullOrWhiteSpace(item.RepositoryId))
                    .DistinctBy(item => item.RepositoryId, StringComparer.OrdinalIgnoreCase)
                    .OrderBy(item => item.RepositoryName)
                    .Select(item => new { id = item.RepositoryId, name = item.RepositoryName }),
                requiresPassword = User.FindFirstValue(ClaimTypes.AuthenticationMethod) ==
                    DashboardAuthenticationDefaults.PasswordAuthenticationMethod
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning("Could not list repositories ({ErrorType}).", ex.GetType().Name);
            return StatusCode(503);
        }
    }

    private bool IsCurrentRepository(string repositoryId) =>
        string.Equals(Request.Headers["X-Dashboard-Repository"].ToString(), repositoryId,
            StringComparison.OrdinalIgnoreCase);

    private string? GetLayoutScope(string serverUrl, string repositoryId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(userId)) return null;
        var scope = string.Join("|", serverUrl, repositoryId, userId);
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(scope)));
    }

    private bool MatchesLayoutScope(string scope) =>
        string.Equals(Request.Headers["X-Dashboard-Layout-Scope"].ToString(), scope,
            StringComparison.Ordinal);

    private static string GetLayoutPath(string scope, string boardId) => boardId == "default"
        ? Path.Combine(DashboardConfigPaths.ProgramDataDirectory, "DynamicLayouts", scope + ".json")
        : Path.Combine(DashboardConfigPaths.ProgramDataDirectory, "DynamicLayouts", scope, boardId + ".json");

    /// <summary>Loads the current user's layout stored locally on the IIS server.</summary>
    [HttpGet]
    public async Task<IActionResult> Layout(CancellationToken cancellationToken)
    {
        try
        {
            var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
            if (!IsCurrentRepository(repo.RepositoryId)) return StatusCode(409);
            var scope = GetLayoutScope(repo.ServerUrl, repo.RepositoryId);
            if (scope is null) return Forbid();
            if (!MatchesLayoutScope(scope)) return StatusCode(409);
            var boards = new List<object>();
            var original = GetLayoutPath(scope, "default");
            if (System.IO.File.Exists(original)) await ReadBoardAsync(original, "default");

            var directory = Path.Combine(Path.GetDirectoryName(original)!, scope);
            if (Directory.Exists(directory))
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.json").OrderBy(path => path))
                {
                    var id = Path.GetFileNameWithoutExtension(file);
                    if (Guid.TryParseExact(id, "N", out _)) await ReadBoardAsync(file, id);
                }
            }
            return Json(new { boards });

            async Task ReadBoardAsync(string path, string id)
            {
                var json = await System.IO.File.ReadAllTextAsync(path, cancellationToken);
                var layout = JsonSerializer.Deserialize<JsonElement>(json);
                var name = layout.TryGetProperty("name", out var savedName) && savedName.ValueKind == JsonValueKind.String
                    ? savedName.GetString() : "اللوحة الرئيسية";
                boards.Add(new { id, name, layout });
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not load dynamic dashboard layout.");
            return StatusCode(503, new { error = "تعذر قراءة التخطيط المحفوظ." });
        }
    }

    /// <summary>Saves layout only; no document values or credentials are stored.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveLayout(
        [FromQuery] string boardId,
        [FromBody] JsonElement layout,
        CancellationToken cancellationToken)
    {
        if ((boardId != "default" && (!Guid.TryParseExact(boardId, "N", out var parsedId) ||
                                      boardId != parsedId.ToString("N"))) ||
            layout.ValueKind != JsonValueKind.Object ||
            !layout.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(name.GetString()) || name.GetString()!.Length > 80 ||
            !layout.TryGetProperty("charts", out var cards) ||
            cards.ValueKind != JsonValueKind.Array || cards.GetArrayLength() > 60)
            return BadRequest(new { error = "مخطط اللوحة غير صالح." });

        var json = layout.GetRawText();
        if (System.Text.Encoding.UTF8.GetByteCount(json) > 100_000)
            return BadRequest(new { error = "تجاوز التخطيط الحد الأقصى للحفظ." });

        string? temp = null;
        try
        {
            var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
            if (!IsCurrentRepository(repo.RepositoryId)) return StatusCode(409);
            var scope = GetLayoutScope(repo.ServerUrl, repo.RepositoryId);
            if (scope is null) return Forbid();
            if (!MatchesLayoutScope(scope)) return StatusCode(409);
            var path = GetLayoutPath(scope, boardId);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            await System.IO.File.WriteAllTextAsync(temp, json, cancellationToken);
            System.IO.File.Move(temp, path, overwrite: true);
            temp = null;
            return Ok(new { saved = true });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Could not persist dynamic dashboard layout.");
            return StatusCode(503, new { error = "تعذر حفظ التخطيط على الخادم." });
        }
        finally
        {
            if (temp is not null && System.IO.File.Exists(temp))
                System.IO.File.Delete(temp);
        }
    }

    /// <summary>Authoritative field schema; list/multi-value types are retained.</summary>
    [HttpGet]
    public async Task<IActionResult> Fields(CancellationToken cancellationToken)
    {
        try
        {
            var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
            if (!IsCurrentRepository(repo.RepositoryId)) return StatusCode(409);
            var definitions = await _fields.GetFieldDefinitionsAsync(cancellationToken);
            return Json(definitions.Values.OrderBy(f => f.Name).Select(f => new
            {
                id = f.Id,
                name = f.Name,
                type = f.FieldType,
                multi = f.IsMultiValue
            }).ToArray());
        }
        catch (LaserficheException ex) when (ex.StatusCode is 401 or 403)
        {
            return StatusCode(ex.StatusCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Dynamic dashboard field catalog failed.");
            return StatusCode(503, new { error = "تعذر تحميل تعريفات الحقول من Laserfiche." });
        }
    }

    /// <summary>
    /// Scans all readable documents. Reports fields the repository could not return.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Rows(CancellationToken cancellationToken)
    {
        try
        {
            var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
            if (!IsCurrentRepository(repo.RepositoryId)) return StatusCode(409);
            var scope = GetLayoutScope(repo.ServerUrl, repo.RepositoryId);
            if (scope is not null && !MatchesLayoutScope(scope)) return StatusCode(409);

            var catalog = new Dictionary<string, DashboardField>();
            try
            {
                var definitions = await _fields.GetFieldDefinitionsAsync(cancellationToken);
                foreach (var field in definitions.Values)
                {
                    var key = FieldKey(field.Id);
                    catalog[key] = new DashboardField(key, field.Name, field.FieldType, field.IsMultiValue);
                }
            }
            catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
            {
                // The catalog can be unavailable even when entry metadata is readable.
            }
            var rootId = await _entries.GetRootEntryIdAsync(cancellationToken);
            var folders = new Queue<int>();
            var seenFolders = new HashSet<int>();
            var seenDocuments = new HashSet<int>();
            var documents = new List<LFEntry>();
            folders.Enqueue(rootId);

            while (folders.Count > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var folderId = folders.Dequeue();
                if (!seenFolders.Add(folderId)) continue;

                IReadOnlyList<LFEntry> children;
                try
                {
                    children = await _entries.GetAllFolderChildrenAsync(folderId, cancellationToken);
                }
                catch (LaserficheException ex) when (folderId != rootId && (ex.StatusCode == 403 || ex.StatusCode == 404))
                {
                    // A hidden subtree must not be traversed or disclosed to the caller.
                    continue;
                }

                foreach (var child in children)
                {
                    if (child.EntryType is LFEntryType.Folder or LFEntryType.RecordSeries)
                        folders.Enqueue(child.Id);
                    else if (child.EntryType == LFEntryType.Document && seenDocuments.Add(child.Id))
                        documents.Add(child);
                }
            }

            var results = new List<object>();
            var rows = new (LFEntry? Entry, IReadOnlyList<LFFieldValue>? Fields)[documents.Count];
            await Parallel.ForEachAsync(Enumerable.Range(0, documents.Count),
                new ParallelOptions { MaxDegreeOfParallelism = 6, CancellationToken = cancellationToken },
                async (index, token) =>
                {
                    var entry = documents[index];
                    try
                    {
                        var visibleEntry = await _entries.GetEntryAsync(entry.Id, token);
                        if (visibleEntry.Id != entry.Id)
                            throw new InvalidOperationException("Laserfiche returned an unexpected entry identifier.");
                        rows[index] = (visibleEntry, null);
                        try
                        {
                            rows[index] = (visibleEntry, await _entries.GetEntryFieldsAsync(entry.Id, token));
                        }
                        catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
                        {
                            // Read access to the entry and to its metadata are separate.
                        }
                        catch (JsonException ex)
                        {
                            _logger.LogWarning(ex, "Could not decode metadata for entry {EntryId}.", entry.Id);
                        }
                    }
                    catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
                    {
                        // An unreadable document is excluded entirely.
                    }
                });

            // Add fields returned by actual entries, even if the definition catalog omitted them.
            foreach (var field in rows.Where(row => row.Fields is not null).SelectMany(row => row.Fields!))
            {
                if (field.FieldDefinitionId <= 0 || string.IsNullOrWhiteSpace(field.FieldName)) continue;
                var key = FieldKey(field.FieldDefinitionId);
                if (!catalog.TryGetValue(key, out var known) || string.IsNullOrWhiteSpace(known.Name))
                    catalog[key] = new DashboardField(key, field.FieldName.Trim(), field.FieldType, field.IsMultiValue);
            }

            var knownNames = catalog.Values.Where(field => !string.IsNullOrWhiteSpace(field.Name))
                .GroupBy(field => NormalizeFieldName(field.Name), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
            var namesWithoutIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var fieldDataIncomplete = false;
            foreach (var row in rows)
            {
                if (row.Entry is null) continue;
                var values = row.Fields is null ? null : new Dictionary<string, HashSet<string>>();
                if (row.Fields is null) fieldDataIncomplete = true;
                foreach (var field in row.Fields ?? Array.Empty<LFFieldValue>())
                {
                    fieldDataIncomplete |= field.HasMoreValues;
                    var key = ResolveFieldKey(field);
                    if (key is null)
                    {
                        fieldDataIncomplete = true;
                        continue;
                    }

                    if (field.HasMoreValues && field.Values.Count == 0 && string.IsNullOrWhiteSpace(field.Value))
                        continue;
                    if (!values!.TryGetValue(key, out var distinct))
                        values[key] = distinct = new HashSet<string>(StringComparer.Ordinal);
                    distinct.UnionWith(field.Values.Where(value => !string.IsNullOrWhiteSpace(value)));
                    if (field.Values.Count == 0 && !string.IsNullOrWhiteSpace(field.Value))
                        distinct.Add(field.Value);
                }
                results.Add(new
                {
                    id = row.Entry.Id,
                    name = row.Entry.Name,
                    template = row.Entry.TemplateName ?? "",
                    creator = row.Entry.Creator ?? "",
                    folder = row.Entry.FolderPath ?? "",
                    pages = row.Entry.PageCount,
                    created = row.Entry.CreationTime,
                    modified = row.Entry.LastModifiedTime,
                    fields = values
                });
            }

            return Json(new
            {
                rows = results,
                fields = catalog.Values.OrderBy(field => field.Name).ThenBy(field => field.Id),
                fieldDataIncomplete,
                examined = documents.Count,
                visible = results.Count
            });

            string? ResolveFieldKey(LFFieldValue field)
            {
                if (field.FieldDefinitionId > 0)
                {
                    var id = FieldKey(field.FieldDefinitionId);
                    if (!catalog.ContainsKey(id))
                        catalog[id] = new DashboardField(id, $"حقل {id}", field.FieldType, field.IsMultiValue);
                    return id;
                }

                if (string.IsNullOrWhiteSpace(field.FieldName)) return null;
                var name = NormalizeFieldName(field.FieldName);
                if (knownNames.TryGetValue(name, out var matches))
                    return matches.Length == 1 ? matches[0].Id : null;
                if (!namesWithoutIds.TryGetValue(name, out var key))
                {
                    key = "field:" + name.ToUpperInvariant();
                    namesWithoutIds.Add(name, key);
                    catalog[key] = new DashboardField(key, field.FieldName.Trim(), field.FieldType, field.IsMultiValue);
                }
                return key;
            }
        }
        catch (LaserficheException ex) when (ex.StatusCode is 401 or 403)
        {
            return StatusCode(ex.StatusCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Dynamic dashboard rows scan failed.");
            return StatusCode(503, new { error = "تعذر قراءة البيانات. لم يتم عرض نتائج ناقصة على أنها كاملة." });
        }
    }

    private sealed record DashboardField(string Id, string Name, string? Type, bool Multi);

    private static string FieldKey(int id) => id.ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static string NormalizeFieldName(string name) => name.Trim().Normalize();
}

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
    private const int MaxDocuments = 2000;
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
    public async Task<IActionResult> Index(CancellationToken cancellationToken)
    {
        var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
        ViewBag.StorageScope = string.Concat(repo.ServerUrl, "|", repo.RepositoryId, "|",
            User.Identity?.Name ?? "anonymous");
        return View();
    }

    private async Task<string> GetLayoutPathAsync(CancellationToken cancellationToken)
    {
        var repo = await _repository.GetActiveRepositoryAsync(cancellationToken);
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.Identity?.Name ?? throw new InvalidOperationException("Authenticated identity missing.");
        var scope = string.Join("|", repo.ServerUrl, repo.RepositoryId, userId);
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(scope)));
        return Path.Combine(
            DashboardConfigPaths.ProgramDataDirectory,
            "DynamicLayouts", hash + ".json");
    }

    /// <summary>Loads the current user's layout stored locally on the IIS server.</summary>
    [HttpGet]
    public async Task<IActionResult> Layout(CancellationToken cancellationToken)
    {
        try
        {
            var path = await GetLayoutPathAsync(cancellationToken);
            if (!System.IO.File.Exists(path)) return Json(new { });
            var json = await System.IO.File.ReadAllTextAsync(path, cancellationToken);
            return Content(json, "application/json; charset=utf-8");
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
        [FromBody] System.Text.Json.JsonElement layout,
        CancellationToken cancellationToken)
    {
        if (layout.ValueKind != System.Text.Json.JsonValueKind.Object ||
            !layout.TryGetProperty("charts", out var cards) ||
            cards.ValueKind != System.Text.Json.JsonValueKind.Array)
            return BadRequest(new { error = "مخطط اللوحة غير صالح." });

        var json = layout.GetRawText();
        if (System.Text.Encoding.UTF8.GetByteCount(json) > 100_000)
            return BadRequest(new { error = "تجاوز التخطيط الحد الأقصى للحفظ." });

        string? temp = null;
        try
        {
            var path = await GetLayoutPathAsync(cancellationToken);
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
    /// Bounded, permission-aware document scan. A partial result is clearly flagged;
    /// it must never be presented as an exhaustive repository total.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Rows(CancellationToken cancellationToken)
    {
        try
        {
            var rootId = await _entries.GetRootEntryIdAsync(cancellationToken);
            var folders = new Queue<int>();
            var seenFolders = new HashSet<int>();
            var seenDocuments = new HashSet<int>();
            var documents = new List<LFEntry>();
            var partial = false;
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
                    {
                        if (documents.Count >= MaxDocuments)
                        {
                            partial = true;
                            break;
                        }
                        documents.Add(child);
                    }
                }

                if (partial) break;
            }

            // Reaching the safety ceiling is always reported as partial.
            partial |= documents.Count >= MaxDocuments;

            var results = new List<object>();
            // Respect the connected user's authorization for every document's metadata.
            // Throttle concurrent requests so large repositories are not flooded.
            using var gate = new SemaphoreSlim(6);
            var rows = new (LFEntry Entry, IReadOnlyList<LFFieldValue>? Fields, bool Denied)[documents.Count];
            await Task.WhenAll(documents.Select(async (entry, index) =>
            {
                await gate.WaitAsync(cancellationToken);
                try
                {
                    // Require a per-document read, not merely visibility in a parent listing.
                    var visibleEntry = await _entries.GetEntryAsync(entry.Id, cancellationToken);
                    if (visibleEntry.Id != entry.Id)
                        throw new InvalidOperationException("Laserfiche returned an unexpected entry identifier.");
                    rows[index] = (visibleEntry,
                        await _entries.GetEntryFieldsAsync(entry.Id, cancellationToken), false);
                }
                catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
                {
                    rows[index] = (entry, null, true);
                }
                finally { gate.Release(); }
            }));

            foreach (var row in rows)
            {
                if (row.Denied || row.Fields is null) continue;
                var values = row.Fields
                    .Where(f => f.FieldDefinitionId > 0)
                    .GroupBy(f => f.FieldDefinitionId.ToString(System.Globalization.CultureInfo.InvariantCulture))
                    .ToDictionary(g => g.Key, g => g.SelectMany(f => f.Values).ToArray());
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
                partial,
                examined = documents.Count,
                visible = results.Count,
                warning = partial ? "البيانات جزئية: وصل التحليل للحد الآمن (2000 مستند). لا تُعدّ النتائج إجمالي المستودع." : null
            });
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
}

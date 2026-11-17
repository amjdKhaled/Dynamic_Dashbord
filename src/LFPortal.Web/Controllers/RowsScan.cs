using System.Collections.Concurrent;
using LFPortal.Application.Interfaces;
using LFPortal.Domain.Entities;
using LFPortal.Domain.Exceptions;
using Microsoft.Extensions.Caching.Memory;

namespace LFPortal.Web.Controllers;

/// <summary>
/// Reads every document the signed-in account can see, for /DynamicDashboard/Rows.
/// <list type="bullet">
/// <item>Folders are listed several at a time, level by level (the order of the documents
/// is the same as a one-at-a-time walk).</item>
/// <item>A document's details and fields are remembered per account. The next scan reuses
/// them while the folder listing shows the same last-modified time and template, and they
/// are no older than <see cref="MaxAge"/>; otherwise they are read again.</item>
/// </list>
/// The folder listing itself is read live on every scan, so a document the account can no
/// longer see disappears at once.
/// </summary>
internal sealed class RowsScan
{
    /// <summary>How many Laserfiche requests run at the same time.</summary>
    internal const int Parallelism = 6;

    /// <summary>
    /// A remembered document is read again after this long even when nothing in the listing
    /// changed (for example a change of field rights, which does not touch the document).
    /// </summary>
    internal static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(15);

    /// <summary>An account's memory is dropped when the account has not scanned for this long.</summary>
    internal static readonly TimeSpan IdleExpiry = TimeSpan.FromHours(1);

    private readonly ILaserficheEntryService _entries;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _clock;

    public RowsScan(ILaserficheEntryService entries, IMemoryCache cache, TimeProvider? clock = null)
    {
        _entries = entries;
        _cache = cache;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>One readable document. <see cref="Fields"/> is null when its metadata could not be read.</summary>
    internal sealed record Row(LFEntry Entry, IReadOnlyList<LFFieldValue>? Fields);

    internal sealed record Result(IReadOnlyList<Row> Rows, int Examined, int Reused);

    private sealed record Remembered(
        DateTimeOffset LastModified, int? TemplateId, DateTimeOffset ReadAt, LFEntry Entry, IReadOnlyList<LFFieldValue>? Fields);

    /// <param name="scope">The account + repository (null: nothing is remembered).</param>
    public async Task<Result> ScanAsync(int rootId, string? scope, Action<int, Exception>? undecodable,
        CancellationToken cancellationToken)
    {
        var documents = await ListDocumentsAsync(rootId, cancellationToken);
        var memory = scope is null ? null : _cache.GetOrCreate("dd-rows:" + scope, entry =>
        {
            entry.SlidingExpiration = IdleExpiry;
            return new ConcurrentDictionary<int, Remembered>();
        })!;

        var rows = new Row?[documents.Count];
        var reused = 0;
        await Parallel.ForEachAsync(Enumerable.Range(0, documents.Count),
            new ParallelOptions { MaxDegreeOfParallelism = Parallelism, CancellationToken = cancellationToken },
            async (index, token) =>
            {
                var listed = documents[index];
                var now = _clock.GetUtcNow();
                if (memory is not null && memory.TryGetValue(listed.Id, out var known) &&
                    listed.LastModifiedTime is { } modified && known.LastModified == modified &&
                    known.TemplateId == listed.TemplateId && now - known.ReadAt < MaxAge)
                {
                    rows[index] = new Row(Freshen(known.Entry, listed), known.Fields);
                    Interlocked.Increment(ref reused);
                    return;
                }

                memory?.TryRemove(listed.Id, out _);
                try
                {
                    var entry = await _entries.GetEntryAsync(listed.Id, token);
                    if (entry.Id != listed.Id)
                        throw new InvalidOperationException("Laserfiche returned an unexpected entry identifier.");
                    IReadOnlyList<LFFieldValue>? fields = null;
                    var complete = true;
                    try
                    {
                        fields = await _entries.GetEntryFieldsAsync(listed.Id, token);
                    }
                    catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
                    {
                        // Read access to the entry and to its metadata are separate.
                    }
                    catch (System.Text.Json.JsonException ex)
                    {
                        undecodable?.Invoke(listed.Id, ex);
                        complete = false;
                    }
                    rows[index] = new Row(entry, fields);
                    // Only what the listing can vouch for is remembered.
                    if (memory is not null && complete && listed.LastModifiedTime is { } stamp)
                        memory[listed.Id] = new Remembered(stamp, listed.TemplateId, now, entry, fields);
                }
                catch (LaserficheException ex) when (ex.StatusCode is 403 or 404)
                {
                    // An unreadable document is excluded entirely.
                }
            });

        // Documents that left the listing are forgotten.
        if (memory is not null)
        {
            var listedIds = documents.Select(document => document.Id).ToHashSet();
            foreach (var id in memory.Keys)
                if (!listedIds.Contains(id)) memory.TryRemove(id, out _);
        }

        return new Result(rows.Where(row => row is not null).Select(row => row!).ToList(), documents.Count, reused);
    }

    /// <summary>
    /// Every document under <paramref name="rootId"/>, in the order a one-at-a-time
    /// breadth-first walk finds them. A folder the account cannot open (403/404) is skipped,
    /// except the root.
    /// </summary>
    internal async Task<IReadOnlyList<LFEntry>> ListDocumentsAsync(int rootId, CancellationToken cancellationToken)
    {
        var seenFolders = new HashSet<int> { rootId };
        var seenDocuments = new HashSet<int>();
        var documents = new List<LFEntry>();
        IReadOnlyList<int> level = new[] { rootId };

        while (level.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var listings = new IReadOnlyList<LFEntry>[level.Count];
            await Parallel.ForEachAsync(Enumerable.Range(0, level.Count),
                new ParallelOptions { MaxDegreeOfParallelism = Parallelism, CancellationToken = cancellationToken },
                async (index, token) =>
                {
                    var folderId = level[index];
                    try
                    {
                        listings[index] = await _entries.GetAllFolderChildrenAsync(folderId, token);
                    }
                    catch (LaserficheException ex) when (folderId != rootId && ex.StatusCode is 403 or 404)
                    {
                        // A hidden subtree must not be traversed or disclosed to the caller.
                        listings[index] = Array.Empty<LFEntry>();
                    }
                });

            var next = new List<int>();
            foreach (var children in listings)
            foreach (var child in children)
            {
                if (child.EntryType is LFEntryType.Folder or LFEntryType.RecordSeries)
                {
                    if (seenFolders.Add(child.Id)) next.Add(child.Id);
                }
                else if (child.EntryType == LFEntryType.Document && seenDocuments.Add(child.Id))
                    documents.Add(child);
            }
            level = next;
        }

        return documents;
    }

    /// <summary>A remembered document with what the live listing says about it now (name, place, creator, template).</summary>
    private static LFEntry Freshen(LFEntry remembered, LFEntry listed) => remembered with
    {
        Name = string.IsNullOrEmpty(listed.Name) ? remembered.Name : listed.Name,
        ParentId = listed.ParentId > 0 ? listed.ParentId : remembered.ParentId,
        FullPath = string.IsNullOrEmpty(listed.FullPath) ? remembered.FullPath : listed.FullPath,
        FolderPath = string.IsNullOrEmpty(listed.FolderPath) ? remembered.FolderPath : listed.FolderPath,
        Creator = listed.Creator ?? remembered.Creator,
        TemplateName = listed.TemplateName ?? remembered.TemplateName,
    };
}

using System.Collections.Concurrent;
using LFPortal.Application.Interfaces;
using LFPortal.Domain.Common;
using LFPortal.Domain.Entities;
using LFPortal.Domain.Exceptions;
using LFPortal.Web.Controllers;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// /DynamicDashboard/Rows reads folders several at a time and reuses unchanged documents.
/// </summary>
public sealed class RowsScanTests
{
    private static readonly DateTimeOffset Monday = new(2026, 11, 16, 9, 0, 0, TimeSpan.FromHours(3));

    // Root 1 ─┬─ folder 10 ─┬─ doc 101
    //         │             └─ folder 30 ── doc 301
    //         ├─ doc 100
    //         └─ folder 20 ─── doc 201, doc 101 (listed twice)
    private static FakeRepository Sample() => new FakeRepository()
        .Folder(1, Folder(10), Doc(100), Folder(20))
        .Folder(10, Doc(101), Folder(30))
        .Folder(20, Doc(201), Doc(101))
        .Folder(30, Doc(301));

    [Fact]
    public async Task Documents_come_in_the_order_of_a_one_at_a_time_walk()
    {
        var repo = Sample();

        var result = await new RowsScan(repo, NewCache()).ScanAsync(1, "A", null, default);

        Assert.Equal(new[] { 100, 101, 201, 301 }, result.Rows.Select(row => row.Entry.Id));
        Assert.Equal(4, result.Examined);
        Assert.Equal(0, result.Reused);
        Assert.Equal(4, repo.Count("fields"));
    }

    [Fact]
    public async Task Folders_of_one_level_are_listed_at_the_same_time()
    {
        var repo = new FakeRepository { ListingDelay = TimeSpan.FromMilliseconds(150) }
            .Folder(1, Enumerable.Range(10, 6).Select(Folder).ToArray());
        foreach (var id in Enumerable.Range(10, 6)) repo.Folder(id, Doc(id * 10));

        await new RowsScan(repo, NewCache()).ScanAsync(1, null, null, default);

        Assert.True(repo.MostListingsAtOnce > 1, $"listings ran one at a time ({repo.MostListingsAtOnce})");
        Assert.True(repo.MostListingsAtOnce <= RowsScan.Parallelism);
    }

    [Fact]
    public async Task A_folder_the_account_cannot_open_is_skipped()
    {
        var repo = Sample().Refuse(10, 403);

        var result = await new RowsScan(repo, NewCache()).ScanAsync(1, "A", null, default);

        Assert.Equal(new[] { 100, 201, 101 }, result.Rows.Select(row => row.Entry.Id));
    }

    [Fact]
    public async Task The_root_refusing_is_an_error()
    {
        var repo = Sample().Refuse(1, 403);

        var ex = await Assert.ThrowsAsync<LaserficheException>(() =>
            new RowsScan(repo, NewCache()).ScanAsync(1, "A", null, default));
        Assert.Equal(403, ex.StatusCode);
    }

    [Fact]
    public async Task A_document_without_readable_fields_keeps_its_row_and_an_unreadable_one_is_left_out()
    {
        var repo = Sample().RefuseFields(101, 403).RefuseEntry(201, 404);

        var result = await new RowsScan(repo, NewCache()).ScanAsync(1, "A", null, default);

        Assert.Equal(new[] { 100, 101, 301 }, result.Rows.Select(row => row.Entry.Id));
        Assert.Null(result.Rows.Single(row => row.Entry.Id == 101).Fields);
    }

    [Fact]
    public async Task The_second_scan_reuses_unchanged_documents()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.ResetCounts();

        var result = await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        Assert.Equal(4, result.Reused);
        Assert.Equal(0, repo.Count("entry"));
        Assert.Equal(0, repo.Count("fields"));
        Assert.Equal(4, repo.Count("listing")); // folders are always read live
        Assert.Equal("v1", Value(result, 100));
    }

    [Fact]
    public async Task A_changed_document_is_read_again()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.Edit(100, "v2", Monday.AddHours(2));
        repo.ResetCounts();

        var result = await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        Assert.Equal("v2", Value(result, 100));
        Assert.Equal(3, result.Reused);
        Assert.Equal(1, repo.Count("fields"));
    }

    [Fact]
    public async Task A_new_template_is_read_again_even_with_the_same_time()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.Retemplate(100, 7);
        repo.ResetCounts();

        var result = await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        Assert.Equal(1, repo.Count("fields"));
        Assert.Equal(7, result.Rows.Single(row => row.Entry.Id == 100).Entry.TemplateId);
    }

    [Fact]
    public async Task Remembered_documents_are_read_again_after_the_maximum_age()
    {
        var repo = Sample();
        var cache = NewCache();
        var clock = new Clock(Monday);
        await new RowsScan(repo, cache, clock).ScanAsync(1, "A", null, default);
        clock.Now += RowsScan.MaxAge;
        repo.ResetCounts();

        var result = await new RowsScan(repo, cache, clock).ScanAsync(1, "A", null, default);

        Assert.Equal(0, result.Reused);
        Assert.Equal(4, repo.Count("fields"));
    }

    [Fact]
    public async Task Each_account_has_its_own_memory()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.ResetCounts();

        var other = await new RowsScan(repo, cache).ScanAsync(1, "B", null, default);
        var none = await new RowsScan(repo, cache).ScanAsync(1, null, null, default);

        Assert.Equal(0, other.Reused);
        Assert.Equal(0, none.Reused);
        Assert.Equal(8, repo.Count("fields"));
    }

    [Fact]
    public async Task A_document_the_account_no_longer_sees_is_gone_at_once()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.Refuse(30, 403);

        var result = await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        Assert.DoesNotContain(result.Rows, row => row.Entry.Id == 301);
    }

    [Fact]
    public async Task A_reused_document_shows_its_new_name_and_place_from_the_listing()
    {
        var repo = Sample();
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.Rename(100, "Renamed", @"\Elsewhere");

        var result = await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        var row = result.Rows.Single(r => r.Entry.Id == 100);
        Assert.Equal(4, result.Reused);
        Assert.Equal("Renamed", row.Entry.Name);
        Assert.Equal(@"\Elsewhere", row.Entry.FolderPath);
        Assert.Equal(3, row.Entry.PageCount); // from the remembered details
    }

    [Fact]
    public async Task A_listing_without_a_time_is_never_reused()
    {
        var repo = Sample().NoTime(100);
        var cache = NewCache();
        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);
        repo.ResetCounts();

        await new RowsScan(repo, cache).ScanAsync(1, "A", null, default);

        Assert.Equal(1, repo.Count("fields"));
    }

    private static string? Value(RowsScan.Result result, int id) =>
        result.Rows.Single(row => row.Entry.Id == id).Fields!.Single().Value;

    private static MemoryCache NewCache() => new(new MemoryCacheOptions());

    private static LFEntry Folder(int id) => new() { Id = id, Name = "F" + id, EntryType = LFEntryType.Folder };

    private static LFEntry Doc(int id) => new()
    {
        Id = id, Name = "D" + id, EntryType = LFEntryType.Document, LastModifiedTime = Monday, TemplateId = 4,
        FolderPath = @"\Here",
    };

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeRepository : ILaserficheEntryService
    {
        private readonly Dictionary<int, List<int>> _children = new();
        private readonly Dictionary<int, LFEntry> _entries = new();
        private readonly Dictionary<int, string> _values = new();
        private readonly Dictionary<int, int> _refuseListing = new();
        private readonly Dictionary<int, int> _refuseFields = new();
        private readonly Dictionary<int, int> _refuseEntry = new();
        private readonly ConcurrentDictionary<string, int> _counts = new();
        private int _listingsNow;

        public TimeSpan ListingDelay { get; init; }
        public int MostListingsAtOnce { get; private set; }

        public FakeRepository Folder(int id, params LFEntry[] children)
        {
            _children[id] = children.Select(child => child.Id).ToList();
            foreach (var child in children)
            {
                _entries[child.Id] = child;
                if (child.EntryType == LFEntryType.Document) _values.TryAdd(child.Id, "v1");
            }
            return this;
        }

        public FakeRepository Refuse(int folder, int status) { _refuseListing[folder] = status; return this; }
        public FakeRepository RefuseFields(int doc, int status) { _refuseFields[doc] = status; return this; }
        public FakeRepository RefuseEntry(int doc, int status) { _refuseEntry[doc] = status; return this; }
        public FakeRepository NoTime(int doc) { _entries[doc] = _entries[doc] with { LastModifiedTime = null }; return this; }

        public void Edit(int doc, string value, DateTimeOffset at)
        {
            _values[doc] = value;
            _entries[doc] = _entries[doc] with { LastModifiedTime = at };
        }

        public void Retemplate(int doc, int templateId) => _entries[doc] = _entries[doc] with { TemplateId = templateId };

        public void Rename(int doc, string name, string folderPath) =>
            _entries[doc] = _entries[doc] with { Name = name, FolderPath = folderPath };

        public int Count(string kind) => _counts.GetValueOrDefault(kind);
        public void ResetCounts() => _counts.Clear();

        public async Task<IReadOnlyList<LFEntry>> GetAllFolderChildrenAsync(int entryId, CancellationToken cancellationToken = default)
        {
            _counts.AddOrUpdate("listing", 1, (_, n) => n + 1);
            var now = Interlocked.Increment(ref _listingsNow);
            lock (_counts) MostListingsAtOnce = Math.Max(MostListingsAtOnce, now);
            try
            {
                if (ListingDelay > TimeSpan.Zero) await Task.Delay(ListingDelay, cancellationToken);
                if (_refuseListing.TryGetValue(entryId, out var status))
                    throw new LaserficheException("refused", status);
                // The listing has no page count; the entry details do.
                return _children[entryId].Select(id => _entries[id]).ToList();
            }
            finally
            {
                Interlocked.Decrement(ref _listingsNow);
            }
        }

        public Task<LFEntry> GetEntryAsync(int entryId, CancellationToken cancellationToken = default)
        {
            _counts.AddOrUpdate("entry", 1, (_, n) => n + 1);
            if (_refuseEntry.TryGetValue(entryId, out var status)) throw new LaserficheException("refused", status);
            return Task.FromResult(_entries[entryId] with { PageCount = 3 });
        }

        public Task<IReadOnlyList<LFFieldValue>> GetEntryFieldsAsync(int entryId, CancellationToken cancellationToken = default)
        {
            _counts.AddOrUpdate("fields", 1, (_, n) => n + 1);
            if (_refuseFields.TryGetValue(entryId, out var status)) throw new LaserficheException("refused", status);
            IReadOnlyList<LFFieldValue> fields = new[] { new LFFieldValue { FieldDefinitionId = 5, FieldName = "Status", Value = _values[entryId] } };
            return Task.FromResult(fields);
        }

        public Task<LFTemplate?> GetEntryTemplateAsync(int entryId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<string> GetEntryPathAsync(int entryId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PagedResult<LFEntry>> GetEntryChildrenAsync(int entryId, int page, int pageSize, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<int> GetRootEntryIdAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);
        public Task<IReadOnlyList<LFEntry>> GetFolderTreeAsync(int rootEntryId, int depth, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}

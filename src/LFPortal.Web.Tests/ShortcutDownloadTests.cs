using LFPortal.Domain.Entities;
using LFPortal.Domain.Exceptions;
using LFPortal.Web.Controllers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// A shortcut in the archive drawer: «تنزيل الأصل» of the document it points to when the account may
/// download files and Laserfiche lets it, otherwise «لا يمكن تنزيل هذا الاختصار» and why.
/// </summary>
public sealed class ShortcutDownloadTests
{
    private static readonly LFEntry Shortcut = new()
        { Id = 1700, Name = "S", EntryType = LFEntryType.Shortcut, TargetId = 1620, TargetType = LFEntryType.Document };

    private static readonly LFEntry Target = new() { Id = 1620, Name = "D", EntryType = LFEntryType.Document, FileSizeBytes = 10 };

    private static Task<ShortcutDownload> Resolve(LFEntry shortcut, bool canDownload = true,
        Func<int, LFEntry>? entry = null, Func<int, bool>? original = null, List<int>? asked = null) =>
        ShortcutDownload.ResolveAsync(shortcut, canDownload,
            (id, _) => { asked?.Add(id); return Task.FromResult((entry ?? (_ => Target))(id)); },
            (id, _) => { asked?.Add(-id); return Task.FromResult((original ?? (_ => true))(id)); },
            NullLogger.Instance, CancellationToken.None);

    [Fact]
    public async Task ADocumentsShortcut_DownloadsTheDocument()
    {
        var asked = new List<int>();
        var result = await Resolve(Shortcut, asked: asked);
        Assert.True(result.Allowed);
        Assert.Equal(1620, result.TargetId);
        Assert.Null(result.Refusal);
        Assert.Equal([1620, -1620], asked);
    }

    [Fact]
    public async Task WithoutDownloading_NothingIsAskedAndTheReasonIsTheMissingPermission()
    {
        var asked = new List<int>();
        var result = await Resolve(Shortcut, canDownload: false, asked: asked);
        Assert.False(result.Allowed);
        Assert.Equal(ShortcutDownload.NoPermission, result.Refusal);
        Assert.Empty(asked);
    }

    [Fact]
    public async Task AFoldersShortcut_IsNotDownloaded()
    {
        var asked = new List<int>();
        var result = await Resolve(Shortcut with { TargetType = LFEntryType.Folder }, asked: asked);
        Assert.Equal(ShortcutDownload.FolderTarget, result.Refusal);
        Assert.Empty(asked);
    }

    [Fact]
    public async Task WhenLaserficheDoesNotSayTheType_TheTargetItselfDecides()
    {
        var result = await Resolve(Shortcut with { TargetType = null },
            entry: id => new LFEntry { Id = id, EntryType = LFEntryType.Folder });
        Assert.Equal(ShortcutDownload.FolderTarget, result.Refusal);
        Assert.True((await Resolve(Shortcut with { TargetType = null })).Allowed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public async Task NoTarget_IsSaid(int? targetId)
    {
        var result = await Resolve(Shortcut with { TargetId = targetId });
        Assert.Equal(ShortcutDownload.UnknownTarget, result.Refusal);
    }

    [Theory]
    [InlineData(403, ShortcutDownload.NoAccess)]
    [InlineData(404, ShortcutDownload.Missing)]
    [InlineData(500, ShortcutDownload.Unavailable)]
    public async Task TheTargetRefused_IsSaid(int status, string reason)
    {
        var result = await Resolve(Shortcut, entry: _ => throw new LaserficheException("x", status));
        Assert.False(result.Allowed);
        Assert.Equal(reason, result.Refusal);
    }

    [Theory]
    [InlineData(404, 10L, ShortcutDownload.NoOriginal)]
    [InlineData(400, 0L, ShortcutDownload.NoOriginal)]
    [InlineData(400, 10L, ShortcutDownload.Unavailable)]
    [InlineData(403, 10L, ShortcutDownload.NoExport)]
    [InlineData(500, 10L, ShortcutDownload.Unavailable)]
    public async Task TheOriginalFileRefused_IsSaid(int status, long size, string reason)
    {
        var result = await Resolve(Shortcut, entry: id => Target with { FileSizeBytes = size },
            original: _ => throw new LaserficheException("x", status));
        Assert.Equal(reason, result.Refusal);
    }

    [Fact]
    public async Task AnEmptyOriginalFile_IsNoOriginal()
    {
        var result = await Resolve(Shortcut, original: _ => false);
        Assert.Equal(ShortcutDownload.NoOriginal, result.Refusal);
    }
}

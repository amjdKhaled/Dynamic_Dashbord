using LFPortal.Domain.Entities;
using LFPortal.Domain.Exceptions;

namespace LFPortal.Web.Controllers;

/// <summary>
/// What the archive drawer offers for a shortcut: the original file of the document it points to
/// («تنزيل الأصل»), or why this shortcut cannot be downloaded («لا يمكن تنزيل هذا الاختصار»).
/// </summary>
/// <param name="TargetId">The document to download, when it may be downloaded.</param>
/// <param name="Refusal">Why not, in Arabic, when it may not.</param>
public sealed record ShortcutDownload(int? TargetId, string? Refusal)
{
    /// <summary>The account does not hold «تنزيل الملفات» in the Admin Portal.</summary>
    public const string NoPermission = "ليست لديك صلاحية تنزيل الملفات.";
    /// <summary>Laserfiche did not say what the shortcut points to.</summary>
    public const string UnknownTarget = "تعذّر معرفة الوثيقة التي يشير إليها.";
    /// <summary>The shortcut points to a folder.</summary>
    public const string FolderTarget = "يشير إلى مجلد لا إلى وثيقة.";
    /// <summary>The shortcut points to something else that is not a document.</summary>
    public const string NotADocument = "لا يشير إلى وثيقة.";
    /// <summary>Laserfiche refused the target to this account.</summary>
    public const string NoAccess = "ليست لديك صلاحية في Laserfiche على الوثيقة التي يشير إليها.";
    /// <summary>Laserfiche does not know the target (deleted, or hidden from this account).</summary>
    public const string Missing = "الوثيقة التي يشير إليها غير موجودة أو لا تظهر لحسابك في Laserfiche.";
    /// <summary>The target has no electronic file.</summary>
    public const string NoOriginal = "الوثيقة التي يشير إليها ليس لها ملف أصلي.";
    /// <summary>Laserfiche refused the target's electronic file to this account.</summary>
    public const string NoExport = "لا تسمح لك Laserfiche بتنزيل الملف الأصلي للوثيقة التي يشير إليها.";
    /// <summary>Laserfiche could not be asked.</summary>
    public const string Unavailable = "تعذّر التحقق من الوثيقة التي يشير إليها. أعد المحاولة.";

    /// <summary>True when «تنزيل الأصل» is shown.</summary>
    public bool Allowed => TargetId is not null;

    /// <summary>
    /// Decides for one shortcut. <paramref name="getEntry"/> loads an entry and
    /// <paramref name="hasOriginal"/> tells whether a document has a non-empty electronic file;
    /// both throw <see cref="LaserficheException"/> as Laserfiche answers.
    /// </summary>
    public static async Task<ShortcutDownload> ResolveAsync(
        LFEntry shortcut, bool canDownload,
        Func<int, CancellationToken, Task<LFEntry>> getEntry,
        Func<int, CancellationToken, Task<bool>> hasOriginal,
        ILogger logger, CancellationToken cancellationToken)
    {
        if (!canDownload) return Refused(NoPermission);
        if (shortcut.TargetId is not { } targetId || targetId <= 0) return Refused(UnknownTarget);
        if (NotADocumentType(shortcut.TargetType) is { } early) return Refused(early);

        LFEntry target;
        try
        {
            target = await getEntry(targetId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (LaserficheException ex) when (ex.StatusCode == 403) { return Refused(NoAccess); }
        catch (LaserficheException ex) when (ex.StatusCode == 404) { return Refused(Missing); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Shortcut {ShortcutId}: its target {TargetId} could not be loaded.", shortcut.Id, targetId);
            return Refused(Unavailable);
        }
        if (NotADocumentType(target.EntryType) is { } late) return Refused(late);

        try
        {
            return await hasOriginal(targetId, cancellationToken)
                ? new ShortcutDownload(targetId, null)
                : Refused(NoOriginal);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (LaserficheException ex) when (ex.StatusCode == 404) { return Refused(NoOriginal); }
        // As in the preview: a 400 alone does not prove the file is absent; an empty size as well does.
        catch (LaserficheException ex) when (ex.StatusCode == 400 && target.FileSizeBytes is null or 0) { return Refused(NoOriginal); }
        catch (LaserficheException ex) when (ex.StatusCode == 403) { return Refused(NoExport); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Shortcut {ShortcutId}: the electronic file of {TargetId} could not be checked.", shortcut.Id, targetId);
            return Refused(Unavailable);
        }
    }

    private static string? NotADocumentType(LFEntryType? type) => type switch
    {
        null or LFEntryType.Unknown or LFEntryType.Document => null,
        LFEntryType.Folder => FolderTarget,
        _ => NotADocument,
    };

    private static ShortcutDownload Refused(string reason) => new(null, reason);
}

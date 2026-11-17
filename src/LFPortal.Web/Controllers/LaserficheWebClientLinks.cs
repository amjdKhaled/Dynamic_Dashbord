namespace LFPortal.Web.Controllers;

public static class LaserficheWebClientLinks
{
    public const string OriginSessionKey = "LaserficheWebClientOrigin";

    public static string? ValidateOrigin(string serverUrl, string? candidate)
    {
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var server) ||
            !Uri.TryCreate(candidate, UriKind.Absolute, out var origin) ||
            origin.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(origin.UserInfo) ||
            !string.Equals(server.Host, origin.Host, StringComparison.OrdinalIgnoreCase)) return null;
        return origin.GetLeftPart(UriPartial.Authority);
    }

    public static string BaseUrl(string serverUrl, string repositoryId, string? webClientOrigin = null) =>
        $"{ClientDirectory(serverUrl, webClientOrigin)}Browse.aspx?db={Uri.EscapeDataString(repositoryId)}#";

    public static string? ValidateClientUrl(string serverUrl, string? candidate)
    {
        var origin = ValidateOrigin(serverUrl, candidate);
        if (origin is null || !Uri.TryCreate(candidate, UriKind.Absolute, out var uri)) return null;
        var path = uri.AbsolutePath;
        var slash = path.LastIndexOf('/');
        var page = path[(slash + 1)..];
        if (!page.Equals("Browse.aspx", StringComparison.OrdinalIgnoreCase) &&
            !page.Equals("index.aspx", StringComparison.OrdinalIgnoreCase)) return null;
        // Cookie paths are case-sensitive even when IIS routes are not. Keep the
        // exact virtual-directory spelling used by the authenticated Web Client.
        return origin + path[..(slash + 1)] + "Browse.aspx";
    }

    /// <summary>
    /// Opens the document itself in the Web Client viewer, the same link Laserfiche
    /// uses. The id is in the query string, so it survives the LFDS sign-in redirect,
    /// and Laserfiche decides whether the signed-in user may see the document.
    /// </summary>
    public static string Document(string serverUrl, string repositoryId, int entryId, string? webClientOrigin = null)
    {
        if (entryId <= 0) throw new ArgumentOutOfRangeException(nameof(entryId));
        return $"{ClientDirectory(serverUrl, webClientOrigin)}DocView.aspx?db={Uri.EscapeDataString(repositoryId)}&docid={entryId}";
    }

    /// <summary>Opens the folder in the Web Client browser (Web Access keeps it as "#?id=").</summary>
    public static string Folder(string serverUrl, string repositoryId, int entryId, string? webClientOrigin = null)
    {
        if (entryId <= 0) throw new ArgumentOutOfRangeException(nameof(entryId));
        return BaseUrl(serverUrl, repositoryId, webClientOrigin) + "?id=" + entryId;
    }

    // The Web Client folder, ending in "/", e.g. https://server/laserfiche/.
    private static string ClientDirectory(string serverUrl, string? webClientOrigin)
    {
        var browse = ValidateClientUrl(serverUrl, webClientOrigin) ??
            (ValidateOrigin(serverUrl, webClientOrigin) ??
             new Uri(serverUrl, UriKind.Absolute).GetLeftPart(UriPartial.Authority)) + "/laserfiche/Browse.aspx";
        return browse[..^"Browse.aspx".Length];
    }
}

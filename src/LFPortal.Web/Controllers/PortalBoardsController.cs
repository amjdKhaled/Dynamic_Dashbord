using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LFPortal.Web.Controllers;

/// <summary>
/// The Admin Portal reads every board in a repository from here, so its admin can grant them.
/// </summary>
/// <remarks>
/// <c>GET /api/portal/boards?repo=demo</c> with the header <c>X-Portal-Key</c> answers
/// <c>{"boards":[{"id","name","owner","created"}]}</c>. The main board ("default") is not
/// listed: the portal always shows it. A private board is not listed either: it is its
/// owner's alone, so the portal neither shows nor grants it (a board made private there
/// loses its grants). The route is off (404) until <c>PortalAccess:Key</c>
/// is set, and a wrong key gets 401. Nothing about a board's content is returned.
/// </remarks>
[AllowAnonymous]
[Route("api/portal/boards")]
[ResponseCache(Location = ResponseCacheLocation.None, NoStore = true)]
public sealed class PortalBoardsController(
    IConfiguration configuration, ILogger<PortalBoardsController> logger) : Controller
{
    internal const string KeyHeader = "X-Portal-Key";
    internal const string KeySetting = "PortalAccess:Key";
    private const int RepositoryMax = 128;

    /// <summary>Where the layouts are saved; tests point it elsewhere.</summary>
    internal string LayoutsRoot { get; init; } = DynamicBoardOwners.DefaultRoot;

    [HttpGet]
    public IActionResult Get([FromQuery] string? repo)
    {
        var expected = configuration[KeySetting]?.Trim();
        if (string.IsNullOrEmpty(expected)) return NotFound();

        var given = Request.Headers[KeyHeader].ToString();
        if (!CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(given)),
                SHA256.HashData(Encoding.UTF8.GetBytes(expected))))
        {
            logger.LogWarning("Refused a board list request with a missing or wrong portal key.");
            return Unauthorized();
        }

        repo = repo?.Trim();
        if (string.IsNullOrEmpty(repo) || repo.Length > RepositoryMax || repo.Any(char.IsControl))
            return BadRequest(new { error = "repo is required." });

        try
        {
            var boards = DynamicBoardOwners.List(LayoutsRoot, repo, logger).Where(board => !board.Private);
            return Json(new
            {
                boards = boards.Select(board => new
                {
                    id = board.Id,
                    name = board.Name,
                    owner = board.Owner,
                    created = board.Created.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",
                        System.Globalization.CultureInfo.InvariantCulture),
                }),
            });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Could not list the dynamic dashboard boards for the Admin Portal.");
            return StatusCode(503);
        }
    }
}

using System.Text.Json;
using LFPortal.Infrastructure.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LFPortal.Web.Authentication;

/// <summary>
/// The repositories offered on the username / password sign-in page, read before anyone signs in.
/// </summary>
public interface ISignInRepositories
{
    /// <summary>
    /// The repository ids of the Laserfiche server, in the server's order, or an empty list when
    /// the server cannot be read (the page then falls back to a text box).
    /// </summary>
    Task<IReadOnlyList<string>> ListAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Reads <c>GET {Repository API}/v2/Repositories</c>, which Laserfiche answers without a token,
/// and keeps a good answer for five minutes.
/// </summary>
public sealed class SignInRepositories : ISignInRepositories
{
    private const string CacheKey = "SignIn.Repositories";
    private static readonly TimeSpan KeepFor = TimeSpan.FromMinutes(5);

    private readonly IHttpClientFactory _httpClients;
    private readonly IOptionsMonitor<LaserficheOptions> _options;
    private readonly IMemoryCache _cache;
    private readonly ILogger<SignInRepositories> _logger;

    /// <summary>Initialises the reader.</summary>
    public SignInRepositories(
        IHttpClientFactory httpClients,
        IOptionsMonitor<LaserficheOptions> options,
        IMemoryCache cache,
        ILogger<SignInRepositories> logger)
    {
        _httpClients = httpClients;
        _options = options;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyList<string>? kept) && kept is not null)
            return kept;

        var url = RepositoriesUrl(_options.CurrentValue);
        if (url is null) return [];

        try
        {
            // The probe client is the unauthenticated one: no token exists before sign-in.
            using var client = _httpClients.CreateClient("LaserficheProbe");
            using var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Sign-in page: the repository list answered HTTP {StatusCode}.",
                    (int)response.StatusCode);
                return [];
            }

            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
            var ids = Read(await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken));
            if (ids.Count > 0) _cache.Set(CacheKey, ids, KeepFor);
            return ids;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException
                                       && !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Sign-in page: the repository list could not be read ({ErrorType}).",
                ex.GetType().Name);
            return [];
        }
    }

    /// <summary>The v2 repository list next to the configured Authorize endpoint, or null.</summary>
    internal static string? RepositoriesUrl(LaserficheOptions options)
    {
        var authorize = options.SsoAuthorizationEndpoint;
        return authorize.EndsWith("/Authorize", StringComparison.OrdinalIgnoreCase)
            ? authorize[..^"Authorize".Length] + "Repositories"
            : null;
    }

    /// <summary>The <c>id</c> of every entry in <c>value</c>, without blanks or repeats.</summary>
    internal static IReadOnlyList<string> Read(JsonDocument json)
    {
        using (json)
        {
            if (!json.RootElement.TryGetProperty("value", out var value) ||
                value.ValueKind != JsonValueKind.Array)
                return [];

            var ids = new List<string>();
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object ||
                    !item.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
                    continue;
                var text = id.GetString()?.Trim();
                if (!string.IsNullOrEmpty(text) &&
                    !ids.Contains(text, StringComparer.OrdinalIgnoreCase))
                    ids.Add(text);
            }
            return ids;
        }
    }
}

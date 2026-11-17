using System.Text;
using System.Text.Json;
using LFPortal.Infrastructure.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LFPortal.Infrastructure.Http;

/// <summary>
/// Writes one short line per Laserfiche request: method, URL, HTTP status and time taken.
/// The response body is written only when Laserfiche answers with an error (shortened to
/// <see cref="MaxLoggedBodyLength"/> characters, tokens and passwords redacted). Successful
/// bodies hold document names and field values, so they are never written to the log.
/// No credentials or authorization headers are logged.
/// </summary>
internal sealed class LaserficheRequestLoggingHandler : DelegatingHandler
{
    internal const int MaxLoggedBodyLength = 4000;

    private readonly IOptionsMonitor<LaserficheOptions> _optionsMonitor;
    private readonly ILogger<LaserficheRequestLoggingHandler> _logger;

    public LaserficheRequestLoggingHandler(
        IOptionsMonitor<LaserficheOptions> optionsMonitor,
        ILogger<LaserficheRequestLoggingHandler> logger)
    {
        _optionsMonitor = optionsMonitor;
        _logger = logger;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (_logger.IsEnabled(LogLevel.Debug))
        {
            var options = _optionsMonitor.CurrentValue;
            _logger.LogDebug(
                "Laserfiche request: ServerUrl={ServerUrl}, ApiBasePath={ApiBasePath}, Final Request URL={FinalRequestUrl}",
                options.ServerUrl, options.ApiBasePath, request.RequestUri);
        }

        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds;

        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation(
                "Laserfiche {Method} {RequestUrl} -> HTTP {StatusCode} in {ElapsedMs:0} ms",
                request.Method, request.RequestUri, (int)response.StatusCode, elapsed);
            return response;
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        var isText = mediaType is not null &&
            (mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase) ||
             mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ||
             mediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase));
        if (isText)
        {
            // ReadAsStringAsync buffers HttpContent; the caller can still read the body.
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            body = RedactSensitiveJson(body);
            if (body.Length > MaxLoggedBodyLength)
                body = body[..MaxLoggedBodyLength] + $"... [{body.Length - MaxLoggedBodyLength} more characters]";
            _logger.LogWarning(
                "Laserfiche {Method} {RequestUrl} -> HTTP {StatusCode} {ReasonPhrase} in {ElapsedMs:0} ms. Response body: {ResponseBody}",
                request.Method, request.RequestUri, (int)response.StatusCode, response.ReasonPhrase, elapsed, body);
        }
        else
        {
            // PDF/TIFF/JPEG and unknown content stay binary and streamed.
            _logger.LogWarning(
                "Laserfiche {Method} {RequestUrl} -> HTTP {StatusCode} {ReasonPhrase} in {ElapsedMs:0} ms. Content-Type={ContentType}; Content-Length={ContentLength}.",
                request.Method, request.RequestUri, (int)response.StatusCode, response.ReasonPhrase, elapsed,
                mediaType, response.Content.Headers.ContentLength);
        }

        return response;
    }

    private static string RedactSensitiveJson(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return body;

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return body;
            }

            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                foreach (var property in document.RootElement.EnumerateObject())
                {
                    if (property.Name.Equals("access_token", StringComparison.OrdinalIgnoreCase) ||
                        property.Name.Equals("refresh_token", StringComparison.OrdinalIgnoreCase) ||
                        property.Name.Equals("password", StringComparison.OrdinalIgnoreCase))
                    {
                        writer.WriteString(property.Name, "[REDACTED]");
                    }
                    else
                    {
                        property.WriteTo(writer);
                    }
                }

                writer.WriteEndObject();
            }

            return Encoding.UTF8.GetString(stream.ToArray());
        }
        catch (JsonException)
        {
            return body;
        }
    }
}
using System.Net;
using System.Text;
using LFPortal.Infrastructure.Http;
using LFPortal.Infrastructure.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace LFPortal.Infrastructure.Tests;

/// <summary>
/// The log gets one short line per Laserfiche request; a response body only on an error.
/// </summary>
public sealed class LaserficheRequestLoggingHandlerTests
{
    private const string Url = "https://lf.test/LFRepositoryAPI/v2/Repositories/demo/Entries/152/Fields";

    [Fact]
    public async Task A_successful_answer_is_one_line_without_the_body()
    {
        var log = new CapturingLog();
        using var client = Client(log, HttpStatusCode.OK, "{\"value\":[{\"name\":\"جهة القرار\",\"values\":[\"وزارة التعليم\"]}]}");

        using var response = await client.GetAsync(Url);

        var line = Assert.Single(log.Lines, l => l.Level >= LogLevel.Information);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("GET " + Url + " -> HTTP 200 in ", line.Text);
        Assert.DoesNotContain("وزارة", line.Text);
        Assert.DoesNotContain("Response body", line.Text);
        // The caller still reads the whole body.
        Assert.Contains("وزارة التعليم", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_error_is_a_warning_with_the_body_and_secrets_hidden()
    {
        var log = new CapturingLog();
        using var client = Client(log, HttpStatusCode.Forbidden,
            "{\"title\":\"Access denied. [9013]\",\"access_token\":\"abc\"}");

        using var response = await client.GetAsync(Url);

        var line = Assert.Single(log.Lines, l => l.Level >= LogLevel.Information);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("-> HTTP 403 Forbidden in ", line.Text);
        Assert.Contains("Access denied. [9013]", line.Text);
        Assert.Contains("[REDACTED]", line.Text);
        Assert.DoesNotContain("abc", line.Text);
        Assert.Contains("9013", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_long_error_body_is_shortened()
    {
        var log = new CapturingLog();
        using var client = Client(log, HttpStatusCode.InternalServerError, "{\"detail\":\"" + new string('x', 10_000) + "\"}");

        using var _ = await client.GetAsync(Url);

        var line = Assert.Single(log.Lines, l => l.Level >= LogLevel.Information);
        Assert.True(line.Text.Length < LaserficheRequestLoggingHandler.MaxLoggedBodyLength + 400, $"length {line.Text.Length}");
        Assert.Contains("more characters]", line.Text);
    }

    [Fact]
    public async Task A_binary_error_is_not_read()
    {
        var log = new CapturingLog();
        using var client = Client(log, HttpStatusCode.NotFound, "%PDF-1.7", "application/pdf");

        using var _ = await client.GetAsync(Url);

        var line = Assert.Single(log.Lines, l => l.Level >= LogLevel.Information);
        Assert.Contains("Content-Type=application/pdf", line.Text);
        Assert.DoesNotContain("%PDF", line.Text);
    }

    private static HttpClient Client(CapturingLog log, HttpStatusCode status, string body, string mediaType = "application/json")
    {
        var handler = new LaserficheRequestLoggingHandler(new Options(), log)
        {
            InnerHandler = new Answer(status, body, mediaType)
        };
        return new HttpClient(handler);
    }

    private sealed class Answer(HttpStatusCode status, string body, string mediaType) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, mediaType) });
    }

    private sealed class Options : IOptionsMonitor<LaserficheOptions>
    {
        public LaserficheOptions CurrentValue { get; } = new();
        public LaserficheOptions Get(string? name) => CurrentValue;
        public IDisposable? OnChange(Action<LaserficheOptions, string?> listener) => null;
    }

    private sealed class CapturingLog : ILogger<LaserficheRequestLoggingHandler>
    {
        public List<(LogLevel Level, string Text)> Lines { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Lines.Add((logLevel, formatter(state, exception)));
    }
}

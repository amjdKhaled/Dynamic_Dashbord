using System.Text.RegularExpressions;

namespace LFPortal.Application.Helpers;

/// <summary>
/// Presentation-only mapping for the SASO color templates.
/// Never changes repository template IDs, names, rights, fields or Workflow behavior.
/// </summary>
public static class SasoTemplateGrouping
{
    private static readonly Regex SasoPattern = new(
        @"^SASO(?:\s*\(\s*[1-6]\s*\)|\s+[1-6])?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool IsSasoFamily(string? name) =>
        !string.IsNullOrWhiteSpace(name) && SasoPattern.IsMatch(name.Trim());

    public static string Normalize(string? name)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        return IsSasoFamily(trimmed) ? "SASO" : trimmed;
    }

    // The physical templates can use either naming form.
    public static IReadOnlyList<string> SearchNames { get; } =
        new[] { "SASO" }.Concat(Enumerable.Range(1, 6)
            .SelectMany(i => new[] { $"SASO ({i})", $"SASO {i}" })).ToArray();
}

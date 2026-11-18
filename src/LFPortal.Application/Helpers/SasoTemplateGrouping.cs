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

    private static TemplateGroupMap _groups = new([]);

    public static void ConfigureGroups(IEnumerable<TemplateGroupDefinition> groups) =>
        _groups = new TemplateGroupMap(groups);

    public static IReadOnlyList<TemplateGroupDefinition> Groups => _groups.Groups;

    public static bool IsGroupedTemplate(string? name) =>
        IsSasoFamily(name) || _groups.Contains(name);

    public static string Normalize(string? name)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        return _groups.Contains(trimmed) ? _groups.Normalize(trimmed) : IsSasoFamily(trimmed) ? "SASO" : trimmed;
    }

    // The physical templates can use either naming form.
    public static IReadOnlyList<string> SearchNames { get; } =
        new[] { "SASO" }.Concat(Enumerable.Range(1, 6)
            .SelectMany(i => new[] { $"SASO ({i})", $"SASO {i}" })).ToArray();
}


public sealed record TemplateGroupDefinition
{
    public string Name { get; init; } = string.Empty;
    public string[] Templates { get; init; } = [];
}

/// <summary>Explicit display aliases. A physical template belongs to exactly one group.</summary>
public sealed class TemplateGroupMap
{
    private readonly Dictionary<string, string> _names = new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<TemplateGroupDefinition> Groups { get; }

    public TemplateGroupMap(IEnumerable<TemplateGroupDefinition> definitions)
    {
        var groups = new List<TemplateGroupDefinition>();
        foreach (var definition in definitions)
        {
            var name = definition.Name.Trim();
            if (name.Length == 0 || definition.Templates.Length == 0)
                throw new ArgumentException("Each template group needs a name and template names.");
            var templates = definition.Templates.Append(name).Select(value => value.Trim())
                .Where(value => value.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (var template in templates)
            {
                if (_names.ContainsKey(template))
                    throw new ArgumentException($"Template '{template}' belongs to more than one group.");
                _names.Add(template, name);
            }
            groups.Add(new TemplateGroupDefinition { Name = name, Templates = templates });
        }
        Groups = groups.AsReadOnly();
    }

    public bool Contains(string? name) => _names.ContainsKey(name?.Trim() ?? string.Empty);
    public string Normalize(string? name)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        return _names.GetValueOrDefault(trimmed, trimmed);
    }
}

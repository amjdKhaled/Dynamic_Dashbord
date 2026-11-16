using LFPortal.Application.DTOs;
using LFPortal.Web.Authentication;

namespace LFPortal.Web.Controllers;

/// <summary>One row of «المستندات حسب نشاط المستخدم».</summary>
/// <param name="Name">The account name, exactly as Laserfiche spells it.</param>
/// <param name="Created">Documents the account created (0 when none).</param>
/// <param name="LastActivity">When the last of them was changed or created, if any.</param>
/// <param name="Groups">The portal groups that link the person to the viewer.</param>
/// <param name="Opens">True when the viewer may open the documents this person created.</param>
public sealed record UserActivityRow(
    string Name, int Created, DateTimeOffset? LastActivity,
    IReadOnlyList<PortalPersonGroup> Groups, bool Opens);

/// <summary>
/// The rows of «المستندات حسب نشاط المستخدم» for one viewer.
/// </summary>
/// <remarks>
/// Without the Admin Portal the rows are the document creators, as before. With it, the rows are
/// the people the portal lists for the viewer (the repository's users, narrowed by the portal's
/// groups), each with the documents they created, 0 when none. The viewer comes first, then the
/// most documents, then by name. A creator who is not a user any more (a deleted or disabled
/// account) is not shown, not even to the main admin. Names match exactly: "admin" and "ADMIN"
/// are different accounts.
/// </remarks>
/// <param name="Rows">The rows, in order.</param>
/// <param name="ByGroups">True when the rows come from the portal (the «المجموعة» column shows).</param>
public sealed record UserActivityTable(IReadOnlyList<UserActivityRow> Rows, bool ByGroups)
{
    /// <summary>Builds the rows from the creators' counts and, when the portal is used, its people list.</summary>
    public static UserActivityTable Build(
        IReadOnlyList<UserDocumentActivityDto> creators, PortalPeople? people, string? viewer)
    {
        ArgumentNullException.ThrowIfNull(creators);
        if (people is null)
            return new(creators.Select(c => new UserActivityRow(c.Name, c.Created, c.LastActivity, [], true))
                .ToList(), false);

        var counts = new Dictionary<string, UserDocumentActivityDto>(StringComparer.Ordinal);
        foreach (var creator in creators) counts.TryAdd(creator.Name, creator);

        var rows = people.People
            .DistinctBy(person => person.Name, StringComparer.Ordinal)
            .Select(person => counts.TryGetValue(person.Name, out var count)
                ? new UserActivityRow(person.Name, count.Created, count.LastActivity, person.Groups, person.Opens)
                : new UserActivityRow(person.Name, 0, null, person.Groups, person.Opens))
            .OrderByDescending(row => string.Equals(row.Name, viewer, StringComparison.Ordinal))
            .ThenByDescending(row => row.Created)
            .ThenBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Name, StringComparer.Ordinal)
            .ToList();
        return new(rows, true);
    }
}

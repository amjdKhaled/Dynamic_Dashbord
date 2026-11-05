using System.Security.Claims;
using LFPortal.Application.Interfaces;
using LFPortal.Domain.Entities;
using LFPortal.Web.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LFPortal.Web.Controllers;

/// <summary>
/// A narrowly scoped, user-token-backed comparison of two field/value predicates.
/// Never accepts arbitrary Laserfiche search expression text from the browser.
/// </summary>
[ApiController]
[Authorize(AuthenticationSchemes = DashboardAuthenticationDefaults.Scheme)]
[Route("Dashboard/FieldCompare")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DashboardFieldCompareController(
    ILaserficheFieldDefinitionService definitions,
    ILaserficheSearchService search,
    IRepositoryContext repositories,
    ILogger<DashboardFieldCompareController> logger) : ControllerBase
{
    private const int PageSize = 100;
    private const int MaxExactPages = 50;

    [HttpGet("Fields")]
    public async Task<IActionResult> Fields(CancellationToken cancellationToken)
    {
        if (!await HasActiveRepositorySessionAsync(cancellationToken))
            return Forbid();

        var fields = await definitions.GetFieldDefinitionsAsync(cancellationToken);
        return Ok(fields.Values
            .Where(f => f.Id > 0 && !string.IsNullOrWhiteSpace(f.Name))
            .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .Select(f => new { id = f.Id, name = f.Name, type = f.FieldType })
            .ToArray());
    }

    [HttpPost("Count")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Count(
        [FromBody] FieldComparisonInput? input,
        CancellationToken cancellationToken)
    {
        if (!await HasActiveRepositorySessionAsync(cancellationToken))
            return Forbid();

        if (input is null || !ValidValue(input.ValueA) || !ValidValue(input.ValueB) ||
            input.FieldAId <= 0 || input.FieldBId <= 0)
            return BadRequest(new { error = "Choose two available fields and enter two values." });

        var fields = await definitions.GetFieldDefinitionsAsync(cancellationToken);
        if (!fields.TryGetValue(input.FieldAId, out var first) ||
            !fields.TryGetValue(input.FieldBId, out var second) ||
            string.IsNullOrWhiteSpace(first.Name) || string.IsNullOrWhiteSpace(second.Name))
            return BadRequest(new { error = "The selected field no longer exists." });

        try
        {
            // Perform both searches under the signed-in user's repository token.
            // Count all result pages and deduplicate entry IDs; never silently
            // return a capped first page as the total document count.
            var a = await CountAllMatchingEntriesAsync(first, input.ValueA.Trim(), cancellationToken);
            var b = await CountAllMatchingEntriesAsync(second, input.ValueB.Trim(), cancellationToken);
            return Ok(new
            {
                fieldA = first.Name, valueA = input.ValueA.Trim(), countA = a,
                fieldB = second.Name, valueB = input.ValueB.Trim(), countB = b
            });
        }
        catch (InvalidOperationException ex)
        {
            logger.LogInformation(ex, "Field comparison could not produce an exact count.");
            return UnprocessableEntity(new { error = ex.Message });
        }
    }

    private static bool ValidValue(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 250 &&
        !value.Contains('*') && !value.Contains('?') &&
        !value.Contains('\r') && !value.Contains('\n');

    private async Task<int> CountAllMatchingEntriesAsync(
        LFFieldDefinition field, string value, CancellationToken cancellationToken)
    {
        var ids = new HashSet<int>();
        for (var page = 1; page <= MaxExactPages; page++)
        {
            var response = await search.SearchByFieldAsync(field.Name, value, page, PageSize, cancellationToken);
            foreach (var item in response.Items)
                ids.Add(item.EntryId);

            if (!response.HasNextPage)
            {
                if (ids.Count != response.TotalCount)
                    throw new InvalidOperationException(
                        "Laserfiche returned an inconsistent result count; the chart was not generated.");
                return ids.Count;
            }
        }

        throw new InvalidOperationException(
            "More than 5,000 results matched. Add a narrower field value before comparing.");
    }

    private async Task<bool> HasActiveRepositorySessionAsync(CancellationToken cancellationToken)
    {
        var method = User.FindFirstValue(ClaimTypes.AuthenticationMethod);
        if (User.Identity?.IsAuthenticated != true ||
            method is not (DashboardAuthenticationDefaults.LfdsAuthenticationMethod
                or DashboardAuthenticationDefaults.PasswordAuthenticationMethod))
            return false;

        var repositoryClaim = User.FindFirstValue(DashboardAuthenticationDefaults.RepositoryClaimType);
        if (string.IsNullOrWhiteSpace(repositoryClaim))
            return false;

        var active = await repositories.GetActiveRepositoryAsync(cancellationToken);
        return string.Equals(repositoryClaim, active.RepositoryId, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed record FieldComparisonInput(
    int FieldAId,
    string ValueA,
    int FieldBId,
    string ValueB);

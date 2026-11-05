using System.Security.Claims;
using LFPortal.Application.DTOs;
using LFPortal.Web.Authentication;
using Microsoft.Extensions.Configuration;

namespace LFPortal.Web.Controllers;

/// <summary>
/// Restricts the "documents created by user" dashboard widget. A repository-visible
/// document does not imply permission to see a company-wide employee activity report.
/// Manager scopes are configured by an administrator on the server, never by the browser.
/// This does NOT claim to identify who edited a document (that requires audit events).
/// </summary>
public static class DashboardUserActivityScope
{
    public static DashboardStatsDto Apply(
        DashboardStatsDto stats,
        ClaimsPrincipal? principal,
        IConfiguration? configuration,
        bool externalShare = false)
    {
        var name = principal?.FindFirst(ClaimTypes.Name)?.Value?.Trim();
        var method = principal?.FindFirst(ClaimTypes.AuthenticationMethod)?.Value;
        if (externalShare || principal?.Identity?.IsAuthenticated != true ||
            string.IsNullOrWhiteSpace(name) ||
            method is not (DashboardAuthenticationDefaults.LfdsAuthenticationMethod
                or DashboardAuthenticationDefaults.PasswordAuthenticationMethod))
        {
            return stats with { UserDocumentActivity = [] };
        }

        var permitted = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { name };
        // Manager -> direct-report usernames. The key must exactly match the authenticated
        // login name; guessing manager status from naming conventions is not allowed.
        var section = configuration?.GetSection("Dashboard:UserActivityManagerTeams");
        if (section is not null)
        {
            var entry = section.GetChildren().FirstOrDefault(
                x => string.Equals(x.Key, name, StringComparison.OrdinalIgnoreCase));
            if (entry is not null)
            {
                foreach (var report in entry.GetChildren())
                {
                    if (!string.IsNullOrWhiteSpace(report.Value))
                        permitted.Add(report.Value.Trim());
                }
            }
        }

        return stats with
        {
            UserDocumentActivity = stats.UserDocumentActivity
                .Where(row => !string.IsNullOrWhiteSpace(row.Name) &&
                    permitted.Contains(row.Name.Trim()))
                .ToList()
                .AsReadOnly()
        };
    }
}

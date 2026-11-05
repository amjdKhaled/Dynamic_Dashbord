using System.Security.Claims;
using LFPortal.Application.DTOs;
using LFPortal.Web.Authentication;
using LFPortal.Web.Controllers;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace LFPortal.Web.Tests;

public sealed class DashboardUserActivityScopeTests
{
    private static DashboardStatsDto Sample() => new()
    {
        UserDocumentActivity =
        [
            new UserDocumentActivityDto { Name = "employee", Created = 4 },
            new UserDocumentActivityDto { Name = "manager", Created = 3 },
            new UserDocumentActivityDto { Name = "another", Created = 9 }
        ]
    };

    private static ClaimsPrincipal Principal(string? name, string method = "RepositoryPassword")
    {
        var claims = new List<Claim> { new(ClaimTypes.AuthenticationMethod, method) };
        if (name is not null) claims.Add(new Claim(ClaimTypes.Name, name));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, DashboardAuthenticationDefaults.Scheme));
    }

    private static IConfiguration Configuration() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Dashboard:UserActivityManagerTeams:manager:0"] = "employee"
        })
        .Build();

    [Fact]
    public void RegularUser_SeesOnlyOwnCreatedDocuments()
    {
        var scoped = DashboardUserActivityScope.Apply(Sample(), Principal("employee"), Configuration());
        Assert.Equal("employee", Assert.Single(scoped.UserDocumentActivity).Name);
    }

    [Fact]
    public void ExplicitlyConfiguredManager_SeesOnlyTheirOwnTeam()
    {
        var scoped = DashboardUserActivityScope.Apply(Sample(), Principal("manager"), Configuration());
        Assert.Equal(["employee", "manager"],
            scoped.UserDocumentActivity.Select(x => x.Name).OrderBy(x => x).ToArray());
        Assert.DoesNotContain(scoped.UserDocumentActivity, x => x.Name == "another");
    }

    [Theory]
    [InlineData(null, "RepositoryPassword")]
    [InlineData("employee", "FallbackCredentials")]
    public void MissingVerifiedIdentityOrFallback_DeniesActivity(string? name, string method)
    {
        var scoped = DashboardUserActivityScope.Apply(Sample(), Principal(name, method), Configuration());
        Assert.Empty(scoped.UserDocumentActivity);
    }

    [Fact]
    public void ExternalShare_NeverReceivesActivity()
    {
        var scoped = DashboardUserActivityScope.Apply(
            Sample(), Principal("manager"), Configuration(), externalShare: true);
        Assert.Empty(scoped.UserDocumentActivity);
    }
}

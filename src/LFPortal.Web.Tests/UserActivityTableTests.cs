using LFPortal.Application.DTOs;
using LFPortal.Web.Authentication;
using LFPortal.Web.Controllers;
using Xunit;

namespace LFPortal.Web.Tests;

/// <summary>
/// «المستندات حسب نشاط المستخدم»: the people the Admin Portal lists for the viewer, with the
/// documents each created.
/// </summary>
public sealed class UserActivityTableTests
{
    private static readonly DateTimeOffset Day = new(2026, 11, 15, 13, 0, 0, TimeSpan.Zero);

    private static readonly UserDocumentActivityDto[] Creators =
    [
        new() { Name = "ADMIN", Created = 184, LastActivity = Day },
        new() { Name = "workflow*", Created = 99, LastActivity = Day },
        new() { Name = "Admin", Created = 36, LastActivity = Day },
        new() { Name = "admin", Created = 19, LastActivity = Day },
        new() { Name = "yazan", Created = 12, LastActivity = Day },
        new() { Name = "eyad", Created = 8, LastActivity = Day },
        new() { Name = "amir", Created = 1, LastActivity = Day },
    ];

    private static PortalPerson Person(string name, bool opens = true, params PortalPersonGroup[] groups) =>
        new(name, groups, opens);

    [Fact]
    public void WithoutThePortal_EveryCreatorAsBefore()
    {
        var table = UserActivityTable.Build(Creators, null, null);
        Assert.False(table.ByGroups);
        Assert.Equal(Creators.Select(c => c.Name), table.Rows.Select(r => r.Name));
        Assert.All(table.Rows, row => Assert.True(row.Opens));
    }

    [Fact]
    public void TheViewerComesFirst_ThenTheMostDocuments_ThenByName()
    {
        var test = new PortalPersonGroup("test", false);
        var people = new PortalPeople(false,
        [
            Person("karem", true, test), Person("eyad", true, new PortalPersonGroup("test", true)),
            Person("khaled", true, test), Person("amir", true, test),
        ]);
        var table = UserActivityTable.Build(Creators, people, "eyad");
        Assert.True(table.ByGroups);
        Assert.Equal(["eyad", "amir", "karem", "khaled"], table.Rows.Select(r => r.Name));
        Assert.Equal([8, 1, 0, 0], table.Rows.Select(r => r.Created));
        Assert.Null(table.Rows[2].LastActivity);
        Assert.Equal([new PortalPersonGroup("test", true)], table.Rows[0].Groups);
    }

    [Fact]
    public void AViewerWhoCreatedNothing_IsStillFirst()
    {
        var people = new PortalPeople(false, [Person("yazan", false), Person("mohamed")]);
        var table = UserActivityTable.Build(Creators, people, "mohamed");
        Assert.Equal(["mohamed", "yazan"], table.Rows.Select(r => r.Name));
        Assert.Equal(0, table.Rows[0].Created);
        Assert.False(table.Rows[1].Opens);
    }

    [Fact]
    public void NamesAreExact()
    {
        // The main admin "admin", the repository user "ADMIN" and the deleted "Admin" are three accounts.
        var people = new PortalPeople(false, [Person("ADMIN")]);
        var row = Assert.Single(UserActivityTable.Build(Creators, people, "ADMIN").Rows);
        Assert.Equal(184, row.Created);
    }

    [Fact]
    public void CreatorsWhoAreNotUsers_AreNotShown_NotEvenToTheMainAdmin()
    {
        // "workflow*" (a deleted repository user), "Admin" (a deleted account), "yazan" and "eyad"
        // created documents but are not in the portal's list of users.
        var people = new PortalPeople(true, [Person("admin"), Person("ADMIN"), Person("ali"), Person("amir")]);
        var table = UserActivityTable.Build(Creators, people, "admin");
        Assert.Equal(["admin", "ADMIN", "amir", "ali"], table.Rows.Select(r => r.Name));
        Assert.All(table.Rows, row => Assert.True(row.Opens));

        var member = UserActivityTable.Build(Creators, new PortalPeople(false, [Person("amir")]), "amir");
        Assert.Equal(["amir"], member.Rows.Select(r => r.Name));
    }
}

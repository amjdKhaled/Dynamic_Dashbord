# Dashboard customization and activity visibility

## Dashboard UI only
- Existing cards can be reordered with the grip and resized with the bottom-corner drag handle while in customization mode.
- The eye toggles a translucent/ghost state in customization mode. When customization ends, hidden cards disappear. Re-enter customization to see their ghost placeholders and restore them with the eye. No separate hidden-card menu.
- Browser localStorage persists only layout and field-comparison definitions under a repository/user-scoped key; it does not synchronize devices.
- The comparison builder gets all available field definitions from the repository and compares counts of documents matching field A/value A versus field B/value B, using the signed-in user's search token. It does not hardcode a confidentiality field.
- A comparison search must be complete; when more than 5,000 entries match or counts are inconsistent, it reports an error instead of a partial chart.
- External Share remains read-only with its original layout.

## Documents by user
The widget is based on the document Creator, not a modification actor. LastModifiedTime does not reveal who performed the edit, and the UI now says so.

Backend restrictions: ordinary users see only their own creator activity, managers see self plus only their explicitly configured reports, anonymous or fallback users get no user activity, and external-share views get no user activity.

To enable team visibility, a server administrator may add the following to protected ASP.NET Core configuration (appsettings.json, or an equivalent trusted environment configuration):

    {
      "Dashboard": {
        "UserActivityManagerTeams": {
          "manager1": ["employee1", "employee2"]
        }
      }
    }

The manager key must match the signed-in ClaimTypes.Name and each report must match a Laserfiche document Creator value (case-insensitive). The application does not guess LDAP hierarchies, roles, or username aliases. Keep this configuration writable only by trusted administrators.

## Verification
Run dotnet test src/LFPortal.Web.Tests/LFPortal.Web.Tests.csproj and the other regression suites in a .NET 8 environment, then verify field searches under staff/manager tokens against the actual repository. The current environment cannot execute .NET tests or connect to the on-prem Laserfiche server. No installer or running installation was changed.
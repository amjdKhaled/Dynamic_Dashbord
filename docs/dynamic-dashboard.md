# Dynamic Laserfiche Dashboard — simple observed-value selection

This feature is a preview on branch `feature/dynamic-field-dashboard`, reached from the existing Dashboard. It does **not** modify the original Dashboard theme, shared layout, header, cards, or other application pages.

## How a user builds or edits a chart

1. Open the dynamic Dashboard from the existing Dashboard and click **تخصيص اللوحة**.
2. Click **إضافة شارت** or edit an existing widget with the gear icon.
3. Choose the chart title, type (bar, horizontal bar, line, doughnut, pie, table, KPI), and the grouping dimension. Dimensions include actual Laserfiche Field definitions and existing repository attributes such as template, folder, creator, and creation/modification date.
4. The editor queries the *already retrieved authorized documents*, then shows their **actual, observed category values** with a distinct-document count beside each value. Search, choose one or several values, or choose **عرض جميع القيم** to clear the selection.
5. Save. Each widget keeps its own selected values; editing it does not change other widgets. Values are never inferred from arbitrary example lists or hardcoded Priority/confidentiality categories.

**Removed:** The extra `طريقة الحساب` and `فلتر خاص بهذا الشارت` controls, numeric-field/page aggregation options, and the permanent global filter sidebar. Each widget automatically uses the **distinct number of matching documents** for its KPI or grouped chart. A multi-valued field may put one document in multiple groups, but the overall KPI counts that document only once. A missing field value is displayed as `بدون قيمة` only if at least one authorized document actually has no value.

In normal viewing mode, customization controls are not displayed. Editing mode supports reorder, visibility toggle (ghost placeholder with the same eye control), and size selection. Doughnut/Pie charts use a scrollable, separate legend so labels cannot obscure the chart when the card is short. The existing navy/white ISB palette remains unchanged.

## Source data and security

- `GET /DynamicDashboard/Fields` loads real repository field definitions.
- `GET /DynamicDashboard/Rows` traverses permitted folders through the active authenticated Laserfiche session, rechecks each document's access, and loads its `GetEntryFieldsAsync` values. Fields with several values retain each value separately, not a joined text string.
- Grouping and category options use only the metadata of those documents returned by the API. A user cannot select data outside their readable set. No mock values are used in production.
- Layout and selected category identifiers are stored on the IIS server under a user/repository-scoped file, protected by the authenticated Dashboard endpoints. The localStorage fallback intentionally omits **selected field values** so they are not exposed on a shared browser. If server saving fails, chart field selections may not persist.
- All chart dependencies remain local for offline operation.

## Verification and limitations

**Important:** The current document scan has a ceiling of 2,000 documents. Beyond that the backend returns `partial=true` and the UI explicitly marks charts as partial and **not an exact repository total**. This must be replaced with complete, permission-aware aggregation before a large-repository production rollout. Folder pagination failures in the shared entry-service code also require separate end-to-end validation; this preview does not independently prove complete repository coverage.

A chart with more than 30 categories shows only the first 30 in the visual and clearly tells the user that additional categories exist. The selection editor still lists all **observed** values from the loaded documents; tables list all observed categories.

Run regression tests using:

```powershell
node --test scripts/test-dynamic-dashboard-field-values.mjs
dotnet test src/LFPortal.Web.Tests/LFPortal.Web.Tests.csproj
```

Verify the actual repository under a regular staff login and a manager login, and verify a multi-value field, numeric/list/date field, empty values, hidden folders, scan limits and chart drill-down before deployment. Tests against live Laserfiche cannot be done from this environment.

Do not merge this draft PR or deploy/install it until the .NET and live Laserfiche integration tests are completed.

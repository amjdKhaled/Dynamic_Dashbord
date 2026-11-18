# SASO color templates — presentation grouping

This change is scoped to the dashboard and archive drill-down only. It does **not** modify Laserfiche 12 Web Client, Workflow, API, repository templates, fields or permissions.

## Goal

- Actual physical templates in Laserfiche: `SASO`, `SASO (1)` … `SASO (6)` (also accepts `SASO 1` ... `SASO 6`).
- Dashboard display: one logical group `SASO`.
- Underlying entry ID, template ID, field values and template color remain unchanged.
- Archive drill-down for `SASO` uses the same authoritative, permission-scoped document snapshot as the dashboard. No unverified multi-template search syntax is sent to Laserfiche.
- Saved dashboard charts using old SASO number selections are normalized on load.
- When colored variants have different Field IDs for the **same field name and compatible schema**, the browser dashboard creates read-only aliases from values already returned for that document. This makes selection of `إجراء الوثيقة = مرفوضة` include rejected colored-template documents under logical `SASO`.
- Ambiguous same-name fields, incompatible types and fields inaccessible to the current user are **not** guessed or merged. The dashboard displays a warning for ambiguous definitions.

## Affected surfaces

- Overview `TotalTemplates`, template distribution, document metadata text.
- Dynamic dashboard rows, dimensions, selected values and template-field filtering.
- Archive grouped template catalog and template-category drill-down.

## Separate browser extension

Template-picker options in the **original** Laserfiche Web Client cannot be filtered through this dashboard server application. Install the separate local browser extension `Laserfiche_SASO_Template_Filter_v2.zip` after testing. It only filters what a user sees in the picker; it is not a security measure. Existing colored templates must keep Read permissions so users can see their fields.

## Testing / deployment

1. Do **not** modify or rebuild the MSI installer for this feature.
2. With a test repository and user that has Read for all colored templates, verify the original Web Client fields/colors are intact.
3. Run the existing .NET 8 solution tests when a Windows/.NET build environment is available. Test coverage for normalization and template drill-down is in `src/LFPortal.Web.Tests/ArchiveDrillDownTests.cs`.
4. Verify grouped SASO drill-down against the dashboard snapshot, using ordinary-user permissions; open individual result documents in Web Client to verify access.
5. Run `node --test scripts/test-saso-logical-fields.cjs` to check logical field normalization and fail-closed behavior.
6. Test the filters `SASO → إجراء الوثيقة → مرفوضة` and the dashboard `عرض كل النتائج` with test red/green documents.
7. Deploy the Dashboard application only after build, automated tests and a real Laserfiche test-user check pass. Use the extension separately on a test Edge profile first.

No changes to repository data, source definitions, permissions, Workflow, Web Client installation, or Installer projects. The branch does not change the currently deployed application until separately deployed.

## Additional dashboard template groups

The dashboard can group templates directly using `TemplateGroups` in
`src/LFPortal.Web/appsettings.json` or the existing runtime configuration file.
Restart the dashboard after editing this setting. SASO and its six numbered
variants are grouped by default.

```json
"TemplateGroups": [
  {
    "Name": "Contracts",
    "Templates": ["Green contract", "Red contract"]
  }
]
```

Each physical template can belong to one group. Selecting the group includes
the readable documents of every member. The archive uses the same grouped
snapshot for its results. Field values from compatible definitions are combined
within their group. Empty alternate field IDs do not hide populated values.
The template field picker displays one choice per compatible field.
Incompatible definitions retain separate choices identified by field ID.

This configuration is independent of the browser extension. Extension edits
must also be added here to apply to the dashboard.

Archive and document action buttons use the existing pill radius without
additional icons. MSI packaging runs on manual dispatch or version tags.
The ordinary web validation workflow builds and tests application changes.

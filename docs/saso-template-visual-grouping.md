# SASO color templates — presentation grouping

This change is scoped to the dashboard and archive drill-down only. It does **not** modify Laserfiche 12 Web Client, Workflow, API, repository templates, fields or permissions.

## Goal

- Actual physical templates in Laserfiche: `SASO`, `SASO (1)` … `SASO (6)` (also accepts `SASO 1` ... `SASO 6`).
- Dashboard display: one logical group `SASO`.
- Underlying entry ID, template ID, field values and template color remain unchanged.
- Archive drill-down for `SASO` uses a logical OR across physical template names, rather than searching only the literal `SASO`.
- Saved dashboard charts using old SASO number selections are normalized on load.

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
4. Verify template drill-down query syntax on the actual Laserfiche 12 search endpoint, and verify ordinary-user permission filtering.
5. Deploy the Dashboard application only after tests pass. Use the extension separately on a test Edge profile first.

No changes to source definitions or Installer projects.

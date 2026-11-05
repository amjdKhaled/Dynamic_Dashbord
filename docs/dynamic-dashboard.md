# Dynamic Laserfiche Field Dashboard (preview)

This feature is **additive**: the existing `/Dashboard`, existing widgets, and the ISB identity stay unchanged. An authenticated user can open `/DynamicDashboard` through the new button on the original dashboard.

## Build a chart

1. Open `/DynamicDashboard` and choose **إضافة شارت**.
2. Name the chart and pick a type: KPI, vertical/horizontal bar, line, doughnut, pie, or table.
3. Choose a dimension: a live Laserfiche field, template, folder, creator, created date, modified date, or document name.
4. Choose **عدد الوثائق / القيم** or a numeric field, and select Count / Sum / Average / Min / Max.
5. Optionally choose one field-specific chart filter.
6. Save; use the gear to edit, resize to adjust width/height, drag to reorder, or hide/restore.

Global filters in the side panel include year, creator, template, date range, and a typed field filter. Numeric/date filters use ranges; list fields use values; text fields use contains/equals/starts-with. A multi-value field preserves each value as a separate array item. Clicking a chart group opens the permitted document list with links to Archive.

## Live-data security

- Reads run through the existing authenticated `ILaserficheEntryService` and `ILaserficheFieldDefinitionService`, not a privileged service account.
- Enumerated documents are individually verified with `GetEntryAsync` and then `GetEntryFieldsAsync`; 403/404 documents are excluded. 403/404 subfolders are not traversed.
- Authentication is required. The client may receive only metadata that the active user can read.
- Layout (not field values) is stored at `%ProgramData%\\Dashboard\\DynamicLayouts\\<scope hash>.json`, scoped by repository + authenticated user. Requests use ASP.NET Core antiforgery validation. A browser localStorage fallback is used if the server cannot save.
- All chart assets are local, with no CDN calls.

## Preview limitations / verification before production

- The document scan is capped at **2,000 eligible documents** to prevent unbounded synchronous queries; the UI warns if that ceiling is reached. Values beyond the cap are **not** represented, so this is not full-repository BI on larger systems. A paginated and cached/aggregated server query is needed before production-scale rollout.
- The data-loading endpoint reads metadata for each document; test latency and API rate limits on large repositories.
- Configured Laserfiche choice-list definitions are not yet retrieved separately from the field schema; field types marked `List` are rendered as picklists from visible values. Some environments expose constrained lists with `String` type and should receive additional metadata detection.
- The new view is Arabic-first. Formal translations and shared published team dashboards are not yet included.
- Verify current session credentials against Laserfiche Directory Server; `[Authorize]` rejects unauthenticated fallback.
- Verify `ProgramData` permissions for the IIS application pool and test permission changes while the dashboard is loaded.
- Re-run the Windows .NET 8 build, Razor compile, tests, installer and offline asset checks before merging.

## Files

- `src/LFPortal.Web/Controllers/DynamicDashboardController.cs`: fields, rows and layout endpoints
- `src/LFPortal.Web/Views/DynamicDashboard/Index.cshtml`: view and chart editor
- `src/LFPortal.Web/wwwroot/js/dynamic-dashboard.js`: filtering, visualization, customization
- `src/LFPortal.Web/wwwroot/css/dynamic-dashboard.css`: additive ISB styling
- `src/LFPortal.Domain/Entities/LFFieldValue.cs` and `src/LFPortal.Infrastructure/Services/LaserficheEntryService.cs`: multi-value preservation

# Install a separate IIS website: dynamic_dashboard

This is a **new IIS website**, not a virtual directory in the installed Dashboard and not the standalone Kestrel launcher. It uses the original ISB theme and dynamic chart functionality already in the repository.

## IIS layout

| Setting | Default |
|---|---|
| Site | `dynamic_dashboard` |
| Application Pool | `dynamic_dashboard` (No Managed Code, ApplicationPoolIdentity, loadUserProfile enabled) |
| Site binding | `http://127.0.0.1:5188/` (localhost only) |
| Web files | `C:\inetpub\dynamic_dashboard` |
| Laserfiche settings, DPAPI credentials, keys, logs, chart layouts | `C:\ProgramData\dynamic_dashboard` |
| Default page | Redirects `/` to `/DynamicDashboard` only for this named IIS instance |
| Original Dashboard | Not modified, stopped, or reconfigured |

The install script creates or updates only this named website and pool; validates path/binding ownership, refuses to share a pool, refuses original-site paths, and does not delete private settings when updating. The new site's **own** `web.config` contains the instance-specific environment variables `DASHBOARD_INSTANCE_NAME=dynamic_dashboard` and `DASHBOARD_STANDALONE_DATA_DIR=<private data path>` (the latter is the existing application's isolation mechanism and does **not** mean the IIS site runs in standalone/Kestrel mode). The original site's `web.config` is unchanged.

## Prerequisites

- Windows 10/11 with IIS features and IIS Management Scripts and Tools enabled, or Windows Server IIS.
- ASP.NET Core Hosting Bundle / `AspNetCoreModuleV2` installed for the web app.
- **.NET 8 SDK only if publishing from source**; the installer accepts a pre-published `WebApp` directory to avoid the SDK.
- Administrator privileges **only to create/update the IIS site**.
- Laserfiche Repository API reachable from the computer; account credentials and repository permissions are still required.

## Publish from the checked-out main branch

Open Windows PowerShell as Administrator:

```powershell
cd 'C:\Users\AmjadAlhawaseh\ChatBotProject\Dynamic_Dashbord'
git switch main
git pull --ff-only origin main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1
```

These commands apply only **after** the feature is merged to `main`. To test the feature branch first, use `git switch feat/isolated-dynamic-dashboard-iis-site` before running the installer.

If port 5188 is already in use, specify a different local port:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1 -Port 5190
```

To deploy from an already published web output (for example an extracted WebApp build), without .NET 8 SDK:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1 -PublishedPath 'C:\Builds\DynamicWebApp'
```

**Never run `build\deploy-fast.ps1` for dynamic_dashboard**: that script intentionally manages only the original site named Dashboard.

## Verify and configure

1. Visit `http://127.0.0.1:5188/_instance/ready`. It should return `application: Dynamic_Dashbord`, `instance: dynamic_dashboard`, `mode: iis` (with JSON syntax). This endpoint returns no user or repository data.
2. Visit `http://127.0.0.1:5188/` to reach the dynamic Dashboard, or open `/DynamicDashboard` directly.
3. On first run, visit `/Settings`, configure the real Laserfiche API URL, then `/Login` to select the repository and sign in.
4. Create a chart in customization mode; verify Field values against documents actually readable by that user.
5. Check the existing original Dashboard site still runs normally on its original URL.

**Important:** the dynamic document scan currently has a limit of 2,000 entries and clearly marks results partial beyond that limit. Do not use those charts as exact totals until full aggregation is validated. User permissions still depend on the connected Laserfiche Repository API.

## Test the install plan without changing IIS

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1 -PlanOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\Test-DynamicIisPlan.ps1
```

## Troubleshooting

- If port 5188 is already used by Kestrel, run with `-Port 5190` and open `http://127.0.0.1:5190/`. Existing bindings are never repointed automatically.
- If IIS `AspNetCoreModuleV2` is missing, install the appropriate ASP.NET Core Hosting Bundle and retry.
- Check `C:\ProgramData\dynamic_dashboard\Logs` and Windows Event Viewer for startup errors.
- HTTP 500.30 may indicate runtime errors; HTTP 500.19 may indicate IIS module/config errors; they require separate diagnosis.
- Settings and credentials are independent: re-enter connection settings for this IIS instance rather than expecting the old site to share credentials.
- This installer uses a localhost binding intentionally. Remote access requires a separate HTTPS binding, firewall review, and authentication validation; it is **not** enabled automatically.

## Safety and deployment constraints

- Original `Dashboard` IIS website, app pool, files, credentials and Data Protection keys stay untouched.
- Customization only affects this app's own user/repository layouts; it does not edit Laserfiche documents.
- `-PlanOnly` does not create a website, app pool or files; the Windows CI suite runs this check.
- Real installation and live Laserfiche sign-in must still be tested on the user's Windows/IIS server; GitHub CI cannot validate the on-prem environment.
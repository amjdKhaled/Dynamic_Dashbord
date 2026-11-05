# Running the Dynamic Dashboard independently (Windows; no IIS)

The independent app starts with ASP.NET Core Kestrel and runs **without IIS**, admin privileges, or changes to the installed Laserfiche Dashboard. It reads Laserfiche only through the connected Repository API.

## Source checkout (.NET 8 SDK required)

```powershell
cd C:\Users\AmjadAlhawaseh\ChatBotProject
git clone --single-branch --branch feature/dynamic-field-dashboard https://github.com/amjdKhaled/Dynamic_Dashbord.git Dynamic_Dashbord-Test
cd .\Dynamic_Dashbord-Test
.\Start-DynamicDashboard.cmd
```

If the checkout already exists:

```powershell
cd C:\Users\AmjadAlhawaseh\ChatBotProject\Dynamic_Dashbord-Test
git fetch origin
git switch feature/dynamic-field-dashboard
git pull --ff-only origin feature/dynamic-field-dashboard
.\Start-DynamicDashboard.cmd
```

The launcher selects an available loopback port starting at **5188**. If this port is occupied it tries the next free port, prints the chosen URL, and waits for the `/ _standalone / ready` endpoint (remove spaces in the path) to identify itself as `Dynamic_Dashbord` before opening `/DynamicDashboard`. It never assumes another service on port 5050 is the Dashboard.

## Self-contained Windows ZIP (no .NET SDK required)

Download the **standalone ZIP** produced by the latest verified Windows Installer GitHub Actions run for this branch. Extract all contents and double-click `Start-Dashboard.cmd`. The ZIP bundles the web app and dependencies and invokes its local `Start-Dashboard.ps1` script; do not launch the original IIS deployment script.

## First-time Laserfiche setup

1. Note the localhost port printed by the launcher, such as `http://127.0.0.1:5188`.
2. Open `<that-origin>/Settings`; enter the actual local Laserfiche Repository API server URL and select the repository and authentication method as appropriate.
3. Save and verify the repository connection; go to `<that-origin>/Login` and sign in.
4. Open `<that-origin>/DynamicDashboard`.

Settings and DPAPI-encrypted credentials are isolated from the installed app in `%LOCALAPPDATA%\Dynamic_Dashbord\Standalone`. Cookies and encryption keys are also separate. This directory is owned by the current Windows user and should not be shared or included in source control.

## Debugging `{"error":"not_found"`

- The literal JSON `{"error":"not_found"}` is **not** produced by the Dynamic Dashboard controller, so check the exact browser address and process running on that port.
- The launcher verifies its own identity before opening the page. Test `<that-origin>/_standalone/ready` to get `{"application":"Dynamic_Dashbord","mode":"standalone","dashboardPath":"/DynamicDashboard"}`.
- If the readiness check fails, look at the PowerShell startup output before changing any Laserfiche settings.
- If `/DynamicDashboard` redirects to `/Login` or `/Settings`, the local server is running correctly; finish configuring the Repository API and sign in.
- If documents are missing after a successful login, verify Repository API availability and access permissions. The current draft dynamic scan marks totals partial at 2,000 examined documents.

## Independent instance safeguards

- Does not run `deploy-fast.ps1`, deploy an MSI, or modify any IIS site.
- Explicit standalone data directory isolates Settings JSON, DPAPI credentials, encrypted Data Protection keys, logs and per-user chart layouts.
- Existing installed Dashboard continues using `%ProgramData%\Dashboard`, unchanged.
- The app only binds `127.0.0.1` and will not be reachable from other PCs unless explicitly reconfigured.
- On the source launcher, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Standalone.ps1 -Port 5200` to request a different port.

## Verification

CI should build the source, build the standalone ZIP, test the exact ZIP under `DASHBOARD_STANDALONE_DATA_DIR` and verify `/_standalone/ready`, offline frontend assets and Windows package dependencies. Validate a live authenticated Laserfiche user on the target machine before treating this as production-ready.
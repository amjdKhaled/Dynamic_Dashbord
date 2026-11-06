# Dynamic_Dashbord — Laserfiche Dashboard

This repository contains the original Laserfiche Dashboard and the opt-in Dynamic Dashboard available on the **feature/dynamic-field-dashboard** branch.

## Run the independent Dynamic Dashboard (Windows, no IIS)

Clone the feature branch and run the root launcher:

~~~powershell
git clone -b feature/dynamic-field-dashboard --single-branch https://github.com/amjdKhaled/Dynamic_Dashbord.git Dynamic_Dashbord-Test
cd Dynamic_Dashbord-Test
.\Start-DynamicDashboard.cmd
~~~

This source launcher requires the .NET 8 SDK. The standalone release ZIP contains the self-contained .NET runtime and a `Start-Dashboard.cmd` launcher instead; it requires **no IIS, no Visual Studio, no .NET SDK, and no administrator rights**.

The launcher selects an unused loopback port starting at **5188**, verifies that the port serves this exact app via `/_standalone/ready`, then opens `/DynamicDashboard`. It does **not** open another application's `{"error":"not_found"}` page. A different port is shown if 5188 is occupied.

Standalone data is deliberately separate from the original installed Dashboard:

- Settings and encrypted credentials: `%LOCALAPPDATA%\Dynamic_Dashbord\Standalone`
- User/repository chart layouts: the same standalone data directory
- IIS, the installed dashboard, and `%ProgramData%\Dashboard` remain untouched

If this is a fresh installation, use `http://127.0.0.1:<shown-port>/Settings` to configure the Laserfiche Repository API, then sign in via `/Login`. The app must have network access to your **own** Laserfiche server, but its local assets work offline.

To select a preferred port, use:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Standalone.ps1 -Port 5200
~~~

See [standalone startup guide](docs/standalone-dynamic-dashboard.md), [offline distribution](docs/offline-preview.md), and [dynamic chart limitations](docs/dynamic-dashboard.md).

**Development notice:** The Dynamic Dashboard PR is still a preview. Large repositories with more than 2,000 documents may produce marked partial results. Do not treat those as complete statistics or merge/deploy without live permission and accuracy tests.

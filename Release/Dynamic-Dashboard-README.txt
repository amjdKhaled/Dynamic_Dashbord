Dynamic Dashboard - Windows x64
===============================

1. Open Dynamic-Dashboard-Setup.exe and select Install in the setup wizard.
2. Launch Dynamic Dashboard from the Start menu.
3. Open Settings, configure the Laserfiche server and repository, then sign in.

The setup installs in Program Files\Dynamic Dashboard. The Start menu launcher
uses a free local port starting at 5190. Keep its window open to run the app.
IIS and the .NET SDK are unnecessary for this installation. The Laserfiche
server and any configured identity server must be reachable.

Settings and credentials are stored in %LocalAppData%\Dynamic Dashboard
for each Windows account. Repair and uninstall preserve these files.
Use Windows Installed apps to remove Dynamic Dashboard.

Verify the EXE using Dynamic-Dashboard-SHA256SUMS.txt.

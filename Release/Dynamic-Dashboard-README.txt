Dynamic Dashboard - Windows x64
===============================

Open Dynamic-Dashboard-Setup.msi. Enter the Laserfiche server and API settings,
then follow the prompts. The optional Web Access folder must be the local
installation folder containing Browse.aspx. Leave it blank if Web Access is
on a different machine. The Dashboard URL must be reachable from the browser
that uses the toolbar. The default is http://127.0.0.1:5190.

Dynamic Dashboard starts in the background when you finish interactive setup
and at Windows sign-in. Open it from Start or from the Laserfiche toolbar.
The default toolbar URL requires the browser and Dashboard on the same computer
and port 5190 to be available. Refresh Laserfiche Web Access after installation.

The MSI installs independently of the original Dashboard. Use Windows
Installed apps to uninstall. Removal preserves user settings and any Web Access
files that do not match the integration the installer added. Windows .NET
Framework 4.8 is required for the optional Web Access integration helper.

Verify the MSI using Dynamic-Dashboard-SHA256SUMS.txt.

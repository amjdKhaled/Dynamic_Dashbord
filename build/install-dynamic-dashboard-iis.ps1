#Requires -Version 5.1
<#
.SYNOPSIS
Install/update a completely separate IIS website named dynamic_dashboard.
.DESCRIPTION
Never modifies the existing Dashboard website, app pool or ProgramData store.
Uses a dedicated app pool, publish folder, loopback HTTP binding and isolated
settings/DPAPI credentials. Run in an elevated Windows PowerShell with IIS and
the ASP.NET Core Hosting Bundle installed.
-HttpsPort with -CertificateThumbprint adds one HTTPS binding on all addresses
(for the machine name, as LFDS sign-in needs) using a certificate that is already
in LocalMachine\My. The loopback HTTP binding stays for the readiness check.
Later updates may omit both: an existing HTTPS binding is kept as it is.
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1 -PublishedPath 'C:\Builds\WebApp' -Port 5190
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build\install-dynamic-dashboard-iis.ps1 -Port 5189 -HttpsPort 5191 -CertificateThumbprint 48FEA4604BDCD5E66286640D617430447A4E6870
#>
[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$Port = 5188,
    [string]$WebRoot = '',
    [string]$DataRoot = '',
    [string]$PublishedPath = '',
    [ValidateRange(0,65535)][int]$HttpsPort = 0,
    [string]$CertificateThumbprint = '',
    [switch]$PlanOnly
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$siteName = 'dynamic_dashboard'
$poolName = 'dynamic_dashboard'
if ([string]::IsNullOrWhiteSpace($WebRoot)) {
    $WebRoot = Join-Path $env:SystemDrive 'inetpub\dynamic_dashboard'
}
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    $DataRoot = Join-Path $env:ProgramData 'dynamic_dashboard'
}
function Canonical([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw "A fully qualified path is required: $Path" }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}
function Assert-NoReparse([string]$Path) {
    $current = Canonical $Path
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing symbolic-link/junction path: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}
function Overlaps([string]$A, [string]$B) {
    return $A.Equals($B,[StringComparison]::OrdinalIgnoreCase) -or
      $A.StartsWith($B + '\',[StringComparison]::OrdinalIgnoreCase) -or
      $B.StartsWith($A + '\',[StringComparison]::OrdinalIgnoreCase)
}
$root = Canonical $WebRoot
$data = Canonical $DataRoot
$oldData = Canonical (Join-Path $env:ProgramData 'Dashboard')
$oldWebDefault = Canonical (Join-Path $env:SystemDrive 'inetpub\wwwroot')
if ((Overlaps $root $data) -or (Overlaps $root $oldData) -or
    (Overlaps $data $oldData) -or (Overlaps $root $oldWebDefault) -or
    (Overlaps $data $oldWebDefault)) {
    throw 'Dynamic IIS paths must be separate from each other, Dashboard, and the default IIS root.'
}
foreach($p in @($root,$data)) {
    Assert-NoReparse $p
    if ($p -match '^[A-Za-z]:$') { throw "Unsafe filesystem root path: $p" }
}
$repoRoot = Canonical (Join-Path $PSScriptRoot '..')
if ((Overlaps $root $repoRoot) -or (Overlaps $data $repoRoot)) {
    throw 'Never publish into the source repository or put runtime credentials there.'
}
# Copied thumbprints often carry spaces or an invisible direction mark; keep hex only.
$CertificateThumbprint = ($CertificateThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
$machineHost = $env:COMPUTERNAME.ToLowerInvariant()
if ($HttpsPort -ne 0) {
    if ($HttpsPort -lt 1024) { throw '-HttpsPort must be between 1024 and 65535.' }
    if ($HttpsPort -eq $Port) { throw '-HttpsPort must differ from the loopback -Port.' }
    if ($CertificateThumbprint.Length -ne 40) {
        throw '-HttpsPort needs -CertificateThumbprint: the 40-character thumbprint of a certificate in LocalMachine\My.'
    }
} elseif ($CertificateThumbprint) {
    throw '-CertificateThumbprint is only used together with -HttpsPort.'
}
Write-Host "Target IIS website : $siteName"
Write-Host "Application pool   : $poolName"
Write-Host "Loopback address   : http://127.0.0.1:$Port/"
if ($HttpsPort) {
    Write-Host "HTTPS address      : https://$($machineHost):$HttpsPort/ (certificate $CertificateThumbprint)"
}
Write-Host "Publish directory  : $root"
Write-Host "Private data home  : $data"
if ($PlanOnly) {
    Write-Host 'PlanOnly: no IIS, registry, application, files or permissions were changed.'
    return
}

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator. This only manages the NEW dynamic_dashboard site.'
}
if (-not (Get-Module -ListAvailable -Name WebAdministration)) {
    throw 'IIS WebAdministration is missing. Enable IIS Management Scripts and Tools first.'
}
Import-Module WebAdministration -ErrorAction Stop
$appcmd = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
if (-not (Test-Path -LiteralPath $appcmd)) {
    throw 'IIS appcmd.exe not found. IIS must be installed.'
}
if (-not (@(Get-WebGlobalModule | Where-Object {$_.Name -eq 'AspNetCoreModuleV2'}).Count)) {
    throw 'ASP.NET Core Hosting Bundle (AspNetCoreModuleV2) is not installed on this IIS server.'
}

# Refuse port collisions and any path overlapping another IIS website.
$sites = @(Get-Website)
foreach ($site in $sites) {
    if ($site.Name -ine $siteName) {
        $otherRoot = [Environment]::ExpandEnvironmentVariables([string]$site.PhysicalPath)
        if (-not [string]::IsNullOrWhiteSpace($otherRoot) -and
            ((Overlaps $root (Canonical $otherRoot)) -or
             (Overlaps $data (Canonical $otherRoot)))) {
            throw "Target directory overlaps an unrelated IIS site: $($site.Name)"
        }
    }
    foreach ($binding in @(Get-WebBinding -Name $site.Name)) {
        $parts = ([string]$binding.bindingInformation).Split(':')
        if ($binding.protocol -eq 'http' -and $parts.Count -ge 2 -and
            $parts[1] -eq [string]$Port -and $site.Name -ine $siteName) {
            throw "HTTP port $Port is already bound by IIS site '$($site.Name)'. Choose -Port 5190."
        }
        if ($HttpsPort -and $parts.Count -ge 2 -and
            $parts[1] -eq [string]$HttpsPort -and $site.Name -ine $siteName) {
            throw "Port $HttpsPort is already bound by IIS site '$($site.Name)'. Choose another -HttpsPort."
        }
    }
}
$existingSite = Get-Website -Name $siteName -ErrorAction SilentlyContinue
$existingHttps = ''
if ($existingSite) {
    $physical = Canonical ([Environment]::ExpandEnvironmentVariables([string]$existingSite.PhysicalPath))
    if ($physical -ine $root) {
        throw "Existing $siteName site points to $physical; refusing to repoint it."
    }
    # Allowed: the loopback HTTP binding, plus at most one HTTPS binding added by -HttpsPort.
    $bindings = @(Get-WebBinding -Name $siteName)
    $httpBindings = @($bindings | Where-Object { $_.protocol -eq 'http' })
    $httpsBindings = @($bindings | Where-Object { $_.protocol -eq 'https' })
    if ($httpBindings.Count -ne 1 -or
        [string]$httpBindings[0].bindingInformation -ine "127.0.0.1:$($Port):" -or
        $httpsBindings.Count -gt 1 -or
        $bindings.Count -ne ($httpBindings.Count + $httpsBindings.Count)) {
        throw "Existing $siteName bindings differ from 127.0.0.1:$Port (plus at most one https binding). Refusing to change bindings."
    }
    if ($httpsBindings.Count -eq 1) { $existingHttps = [string]$httpsBindings[0].bindingInformation }
    if ($HttpsPort -and $existingHttps -and $existingHttps -ine "*:$($HttpsPort):") {
        throw "Existing https binding is $existingHttps; refusing to move it to *:$($HttpsPort):."
    }
    $effectivePool = [string](& $appcmd list app "$siteName/" /text:applicationPool)
    if ($LASTEXITCODE -ne 0 -or $effectivePool.Trim() -ine $poolName) {
        throw "Existing site is not in the dedicated $poolName application pool."
    }
}
$poolApps = [xml](& $appcmd list app /xml)
if ($LASTEXITCODE -ne 0) { throw 'IIS application inventory query failed.' }
foreach ($app in @($poolApps.SelectNodes('//APP'))) {
    if ([string]$app.GetAttribute('APPPOOL.NAME') -ieq $poolName -and
        [string]$app.GetAttribute('APP.NAME') -ine "$siteName/") {
        throw "Application pool $poolName is used by another site/app. Refusing to share it."
    }
}
$existingPool = Get-Item "IIS:\AppPools\$poolName" -ErrorAction SilentlyContinue
if (-not $existingSite) {
    # An independent Kestrel app or other non-IIS process may already own this port.
    # Check it before creating a Windows HTTP.sys binding.
    $tcpCommand = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
    if ($tcpCommand -and @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "Port $Port is already listening. Stop that app or use -Port 5190."
    }
}
if (-not $existingSite -and $existingPool) {
    throw "Application pool $poolName already exists without a matching site. Inspect IIS manually."
}
# Check the HTTPS port and certificate before anything is changed.
if ($HttpsPort -and $existingHttps) {
    $sslBinding = Get-Item "IIS:\SslBindings\0.0.0.0!$HttpsPort" -ErrorAction SilentlyContinue
    if (-not $sslBinding -or [string]$sslBinding.Thumbprint -ine $CertificateThumbprint) {
        throw "The existing https binding on port $HttpsPort uses a different certificate. Refusing to change it."
    }
} elseif ($HttpsPort) {
    $certificate = Get-Item "Cert:\LocalMachine\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
    if (-not $certificate) {
        throw "Certificate $CertificateThumbprint is not in LocalMachine\My. Import it there first."
    }
    if (-not $certificate.HasPrivateKey) {
        throw "Certificate $CertificateThumbprint has no private key, so IIS cannot use it for HTTPS."
    }
    if ($certificate.NotAfter -le (Get-Date)) {
        throw "Certificate $CertificateThumbprint expired on $($certificate.NotAfter)."
    }
    if (@(Get-NetTCPConnection -State Listen -LocalPort $HttpsPort -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "Port $HttpsPort is already listening. Choose another -HttpsPort."
    }
    if (Test-Path "IIS:\SslBindings\0.0.0.0!$HttpsPort") {
        throw "An SSL certificate binding already exists for 0.0.0.0:$HttpsPort. Inspect it with: netsh http show sslcert ipport=0.0.0.0:$HttpsPort"
    }
}
if (Test-Path -LiteralPath $root) {
    $marker = Join-Path $root '.dynamic_dashboard.owned'
    if (-not $existingSite -and -not (Test-Path -LiteralPath $marker) -and
        @(Get-ChildItem -LiteralPath $root -Force).Count -gt 0) {
        throw "Publish directory is not empty and not owned by this installer: $root"
    }
}

$publish = $PublishedPath
$stage = $null
if ([string]::IsNullOrWhiteSpace($publish)) {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw 'dotnet is missing. Install .NET 8 SDK or pass -PublishedPath with a compiled WebApp.'
    }
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('dynamic_dashboard_publish_'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $publish = $stage
    $project = Join-Path $repoRoot 'src\LFPortal.Web\LFPortal.Web.csproj'
    & dotnet publish $project -c Release -r win-x64 --self-contained true -o $publish --verbosity minimal
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed: site has not been changed.' }
}
$publish = Canonical $publish
Assert-NoReparse $publish
if ((Overlaps $publish $root) -or (Overlaps $publish $data)) {
    throw 'Source publish directory must be separate from the IIS web root and data store.'
}
foreach ($name in @('LFPortal.Web.dll','web.config')) {
    if (-not (Test-Path -LiteralPath (Join-Path $publish $name) -PathType Leaf)) {
        throw "Publish output missing $name"
    }
}

# All IIS mutations below refer only to dynamic_dashboard.
if (-not $existingPool) {
    New-WebAppPool -Name $poolName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$poolName" -Name managedRuntimeVersion -Value ''
Set-ItemProperty "IIS:\AppPools\$poolName" -Name enable32BitAppOnWin64 -Value $false
Set-ItemProperty "IIS:\AppPools\$poolName" -Name processModel.identityType -Value 'ApplicationPoolIdentity'
# User-profile loading is required for current-user DPAPI-protected auth keys.
Set-ItemProperty "IIS:\AppPools\$poolName" -Name processModel.loadUserProfile -Value $true
New-Item -ItemType Directory -Path $root -Force | Out-Null
New-Item -ItemType Directory -Path $data -Force | Out-Null

# Directory-only ACLs: web files are read-only, private runtime files writable.
& icacls.exe $root /grant "IIS APPPOOL\$($poolName):(OI)(CI)RX" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to grant app pool read permissions on webroot.' }
& icacls.exe $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "IIS APPPOOL\$($poolName):(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the independent data directory.' }

if (-not $existingSite) {
    New-Website -Name $siteName -PhysicalPath $root -Port $Port -IPAddress '127.0.0.1' -ApplicationPool $poolName | Out-Null
}
if ($HttpsPort -and -not $existingHttps) {
    New-WebBinding -Name $siteName -Protocol https -IPAddress '*' -Port $HttpsPort
    (Get-WebBinding -Name $siteName -Protocol https).AddSslCertificate($CertificateThumbprint, 'My')
    Write-Host "Added https binding *:$HttpsPort with certificate $CertificateThumbprint."
}
try {
    if ((Get-WebAppPoolState -Name $poolName).Value -eq 'Started') {
        Stop-WebAppPool -Name $poolName
    }
    # Wait for IIS to report Stopped before retrying any transient file locks.
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ($true) {
        if ((Get-WebAppPoolState -Name $poolName).Value -eq 'Stopped') { break }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "IIS application pool '$poolName' did not report Stopped within 60 seconds. No files were copied."
        }
        Start-Sleep -Milliseconds 500
    }

    # /E intentionally never deletes files or settings from an existing installation.
    $copyOutput = @(& robocopy.exe $publish $root /E /XJ /R:15 /W:2 /XF appsettings.Development.json /NFL /NDL /NJH /NP)
    $copyCode = $LASTEXITCODE
    if ($copyCode -ge 8) {
        throw ("robocopy failed with code {0} copying to '{1}'.{2}{3}" -f
            $copyCode, $root, [Environment]::NewLine, ($copyOutput -join [Environment]::NewLine))
    }
    $webConfig = Join-Path $root 'web.config'
    [xml]$xml = Get-Content -LiteralPath $webConfig -Raw
    $asp = $xml.SelectSingleNode('//aspNetCore')
    if (-not $asp) { throw 'Published web.config has no aspNetCore handler.' }
    $vars = $asp.SelectSingleNode('environmentVariables')
    if (-not $vars) {
        $vars = $xml.CreateElement('environmentVariables')
        [void]$asp.AppendChild($vars)
    }
    foreach ($pair in @(
        @{Name='DASHBOARD_INSTANCE_NAME';Value=$siteName},
        @{Name='DASHBOARD_STANDALONE_DATA_DIR';Value=$data}
    )) {
        $item = @($vars.SelectNodes('environmentVariable') | Where-Object {
            $_.GetAttribute('name') -eq $pair.Name }) | Select-Object -First 1
        if (-not $item) {
            $item = $xml.CreateElement('environmentVariable')
            [void]$vars.AppendChild($item)
        }
        $item.SetAttribute('name',$pair.Name)
        $item.SetAttribute('value',$pair.Value)
    }
    $xml.Save($webConfig)
    Set-Content -LiteralPath (Join-Path $root '.dynamic_dashboard.owned') -Value 'dynamic_dashboard IIS deployment; do not share this folder' -Encoding ASCII
}
finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ((Get-WebAppPoolState -Name $poolName).Value -eq 'Stopped') {
        Start-WebAppPool -Name $poolName
    }
    $installedSite = Get-Website -Name $siteName -ErrorAction SilentlyContinue
    if ($installedSite -and $installedSite.State -ne 'Started') {
        Start-Website -Name $siteName
    }
}
# Runtime files are outside the website, no data directory is web-accessible.
$url = "http://127.0.0.1:$Port"
$passed = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    try {
        $answer = Invoke-RestMethod -Uri "$url/_instance/ready" -Method Get -TimeoutSec 4 -ErrorAction Stop
        if ($answer.application -eq 'Dynamic_Dashbord' -and
            $answer.instance -eq 'dynamic_dashboard' -and $answer.mode -eq 'iis') {
            $passed = $true
            break
        }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $passed) {
    throw "Website was created but readiness failed at $url/_instance/ready. Inspect $data\Logs and IIS Event Viewer; the original Dashboard was not changed."
}
Write-Host "dynamic_dashboard IIS site is running and verified." -ForegroundColor Green
Write-Host "Open $url/ (redirects to DynamicDashboard), or $url/DynamicDashboard" -ForegroundColor Cyan
Write-Host "Configure this independent website using $url/Settings and $url/Login." -ForegroundColor Cyan
$httpsNow = @(Get-WebBinding -Name $siteName -Protocol https)
if ($httpsNow.Count -eq 1) {
    $httpsPortNow = ([string]$httpsNow[0].bindingInformation).Split(':')[1]
    Write-Host "HTTPS by machine name: https://$($machineHost):$httpsPortNow/DynamicDashboard" -ForegroundColor Cyan
}

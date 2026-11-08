<#
.SYNOPSIS
Run Dynamic_Dashbord with Kestrel, without IIS or administrator privileges.
.DESCRIPTION
Uses a separate LocalAppData config/credential store, chooses a free loopback port,
and opens the browser only when the exact dashboard app passes a readiness probe.
#>
param(
    [ValidateRange(1024,65515)][int]$Port = 5188,
    [switch]$Published,
    [switch]$InstalledDynamic,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$appRoot = if ($Published) { $PSScriptRoot } else { Join-Path $sourceRoot 'src\LFPortal.Web' }
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'Could not determine LocalAppData for the current Windows account.'
}

# Standalone settings/credentials/logs/keys never touch the installed Dashboard.
if ($InstalledDynamic) {
    $env:DASHBOARD_INSTALLED_DYNAMIC = '1'
}
$dataFolder = if ($InstalledDynamic) { 'Dynamic Dashboard' } else { 'Dynamic_Dashbord\Standalone' }
$env:DASHBOARD_STANDALONE_DATA_DIR = Join-Path $localAppData $dataFolder
New-Item -ItemType Directory -Path $env:DASHBOARD_STANDALONE_DATA_DIR -Force | Out-Null
$env:ASPNETCORE_ENVIRONMENT = 'Production'

function Test-LoopbackPortAvailable {
    param([int]$Candidate)
    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Loopback, $Candidate)
    try { $listener.Start(); return $true }
    catch [System.Net.Sockets.SocketException] { return $false }
    finally { $listener.Stop() }
}

# The installed edition has a stable toolbar URL and one launcher per Windows session.
$mutex = $null
$ownsMutex = $false
try {
if ($InstalledDynamic) {
    $mutex = [System.Threading.Mutex]::new($false, 'Local\ISB.DynamicDashboard.5190')
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        if ($NoBrowser) { return }
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            try {
                $reply = Invoke-RestMethod "http://127.0.0.1:$Port/_standalone/ready" -TimeoutSec 2
                if ($reply.application -eq 'Dynamic_Dashbord' -and $reply.mode -eq 'standalone' -and
                    $reply.dashboardPath -eq '/DynamicDashboard') {
                    Start-Process "http://127.0.0.1:$Port/DynamicDashboard"
                    return
                }
            } catch {}
            Start-Sleep -Seconds 1
        }
        throw 'Dynamic Dashboard is already starting but did not become ready.'
    }
}

$selectedPort = $null
$lastPort = if ($InstalledDynamic) { $Port } else { $Port + 20 }
for ($candidate = $Port; $candidate -le $lastPort; $candidate++) {
    if (Test-LoopbackPortAvailable $candidate) {
        $selectedPort = $candidate
        break
    }
}
if ($null -eq $selectedPort) {
    throw "No free loopback port between $Port and $lastPort."
}
if ($selectedPort -ne $Port) {
    Write-Host "Port $Port is already in use. Switching to $selectedPort." -ForegroundColor Yellow
}

$url = "http://127.0.0.1:$selectedPort"
if ($Published) {
    $executable = Join-Path $appRoot 'LFPortal.Web.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw 'LFPortal.Web.exe is missing. Extract the complete standalone ZIP.'
    }
    $arguments = '--urls "' + $url + '"'
}
else {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw 'Install .NET 8 SDK to run source code, or use the standalone ZIP.'
    }
    $project = Join-Path $sourceRoot 'src\LFPortal.Web\LFPortal.Web.csproj'
    if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
        throw "Web project not found: $project"
    }
    $executable = (Get-Command dotnet).Source
    $arguments = 'run --project "' + $project + '" --no-launch-profile -- --urls "' + $url + '"'
}

Write-Host "Private standalone data: $env:DASHBOARD_STANDALONE_DATA_DIR"
Write-Host "Starting Dynamic_Dashbord at $url (without IIS)..."
$process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $appRoot -NoNewWindow -PassThru

$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($process.HasExited) {
        throw "Dashboard exited with code $($process.ExitCode). See the console error."
    }
    try {
        $reply = Invoke-RestMethod -Uri "$url/_standalone/ready" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($reply.application -eq 'Dynamic_Dashbord' -and
            $reply.mode -eq 'standalone' -and
            $reply.dashboardPath -eq '/DynamicDashboard') {
            $ready = $true
            break
        }
    }
    catch {
        # App is still starting, or port no longer resolves to this application.
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    try { if (-not $process.HasExited) { $process.Kill() } } catch {}
    throw "Dashboard verification failed at $url/_standalone/ready. Browser was not opened."
}

Write-Host "Verified standalone Dynamic_Dashbord application." -ForegroundColor Green
Write-Host "Open: $url/DynamicDashboard" -ForegroundColor Cyan
Write-Host "For a first-time repository connection, use $url/Settings and $url/Login."
if (-not $NoBrowser) {
    Start-Process "$url/DynamicDashboard"
}
Write-Host 'Keep this PowerShell window open. Ctrl+C stops the local server.'
try { $process.WaitForExit() }
finally {
    try { if (-not $process.HasExited) { $process.Kill() } } catch {}
}
}
finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}

param([Parameter(Mandatory = $true)][string]$WebAppPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$cache = Join-Path $PSScriptRoot '..\.build-cache\office'
$null = New-Item -ItemType Directory -Path $cache -Force
$cache = (Resolve-Path $cache).Path
$version = '26.2.6.2'
$fileName = "LibreOffice_${version}_Win_x86-64.msi"
$msi = Join-Path $cache $fileName
$baseUrl = "https://downloadarchive.documentfoundation.org/libreoffice/old/$version/win/x86_64/$fileName"
# SHA-256 published on the Document Foundation archive mirror list for this exact MSI.
$checksum = '788ce7d4b56460357f57552cb8cd848e8f2254f28f6e51fa61e0c65a18096373'
if ((Test-Path -LiteralPath $msi) -and (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash -ne $checksum) {
    Write-Warning 'Cached LibreOffice MSI failed verification. Downloading a fresh copy.'
    Remove-Item -LiteralPath $msi
}
if (-not (Test-Path -LiteralPath $msi)) {
    $download = "$msi.$([Guid]::NewGuid().ToString('N')).partial"
    try {
        & curl.exe --fail --location --retry 3 --connect-timeout 30 --max-time 900 --output $download $baseUrl
        if ($LASTEXITCODE -ne 0) { throw "LibreOffice download failed (curl exit $LASTEXITCODE): $baseUrl" }
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $checksum) {
            throw 'LibreOffice checksum verification failed.'
        }
        Move-Item -LiteralPath $download -Destination $msi -Force
    }
    finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}
$extract = Join-Path $cache "administrative-image-$version"
$marker = Join-Path $extract 'complete.txt'
if (-not (Test-Path $marker)) {
    $null = New-Item -ItemType Directory -Path $extract -Force
    $logDirectory = Join-Path $PSScriptRoot '..\artifacts'
    $null = New-Item -ItemType Directory -Path $logDirectory -Force
    $logPath = Join-Path (Resolve-Path $logDirectory).Path 'msi-office-extract.log'
    Write-Host "Extracting verified Office MSI: $msi"
    $process = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @('/a', "`"$msi`"", '/qn', '/L*v', "`"$logPath`"", "TARGETDIR=`"$extract`"")
    if ($process.ExitCode -notin @(0, 3010)) { throw "LibreOffice extraction failed: $($process.ExitCode)" }
    Set-Content $marker $version
}
$soffice = Get-ChildItem $extract -Filter soffice.com -Recurse | Select-Object -First 1
if (-not $soffice) { throw 'LibreOffice administrative image has no soffice.com.' }
$runtimeRoot = Split-Path (Split-Path $soffice.FullName)
$destination = Join-Path $WebAppPath 'tools\LibreOffice'
$null = New-Item -ItemType Directory -Path $destination -Force
Copy-Item (Join-Path $runtimeRoot '*') $destination -Recurse -Force
# Administrative images may place VC runtime DLLs in system directories. Keep
# those redistributable DLLs beside the private converter for clean Windows hosts.
Get-ChildItem $extract -Recurse -File | Where-Object { $_.Name -match '^(vcruntime140.*|msvcp140.*|concrt140)\.dll$' } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $destination 'program') -Force
}
if (-not (Test-Path (Join-Path $destination 'program\soffice.com'))) { throw 'Office runtime was not staged.' }
Set-Content (Join-Path $destination 'DASHBOARD-RUNTIME.txt') "LibreOffice $version. Downloaded from $baseUrl. Includes publisher license and notices."
Write-Host "Staged offline Office converter: $destination"

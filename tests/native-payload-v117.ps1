$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = Join-Path $project 'logs/acceptance-20261020'
$stage = Join-Path $output ('payload-' + [Guid]::NewGuid().ToString('N') + ' path with spaces')
[IO.Directory]::CreateDirectory($stage) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.Windows.Forms
$assembly = [Reflection.Assembly]::LoadFile((Join-Path $project 'dist/native/Zavod7-Server-Setup.exe'))
$setup = $assembly.GetType('Setup', $true)
$flags = [Reflection.BindingFlags]'NonPublic, Static'
$extract = $setup.GetMethod('ExtractPayload', $flags)
$validate = $setup.GetMethod('ValidatePayload', $flags)
# Invoke these two helpers only: never Main, Install, registry, tray or process-control methods.
$extract.Invoke($null, [object[]]@([string]$stage)) | Out-Null
$dist = Join-Path $stage 'dist'
$validate.Invoke($null, [object[]]@([string]$dist)) | Out-Null
$rows = @()
foreach ($file in Get-ChildItem -LiteralPath $dist -File -Recurse) {
    $relative = $file.FullName.Substring($stage.Length + 1)
    $original = Join-Path $project $relative
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($hash -ne (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash) { throw "Payload mismatch: $relative" }
    $rows += [pscustomobject]@{ path = $relative; bytes = $file.Length; sha256 = $hash }
}
if ($rows.Count -ne 16) { throw "Unexpected payload entry count: $($rows.Count)" }
$required = @('index.html', 'native/server.mjs', 'native/node.exe', 'native/runtime-manifest.json', 'native/Zavod7-Server-Tray.exe')
foreach ($relative in $required) {
    $file = Join-Path $dist $relative
    $held = $file + '.test-held'
    [IO.File]::Move($file, $held)
    try {
        $rejected = $false
        try { $validate.Invoke($null, [object[]]@([string]$dist)) | Out-Null }
        catch {
            # Windows PowerShell may wrap reflection exceptions in MethodInvocationException.
            $cause = $_.Exception
            while ($cause.InnerException) { $cause = $cause.InnerException }
            if ($cause -isnot [IO.InvalidDataException]) { throw }
            $rejected = $true
        }
        if (!$rejected) { throw "Missing required payload accepted: $relative" }
    } finally { [IO.File]::Move($held, $file) }
}
$validate.Invoke($null, [object[]]@([string]$dist)) | Out-Null
$runtime = Join-Path $dist 'native/node.exe'
$version = & $runtime --version
if ($LASTEXITCODE -ne 0 -or $version -ne 'v22.23.2') { throw 'Extracted runtime failed' }
& $runtime --check (Join-Path $dist 'native/server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Extracted server bundle failed syntax verification' }
[pscustomobject]@{ state = 'passed'; runtime = $version; missingRequiredRejected = $required; files = $rows; limitation = 'Extraction and validation only; no installation, registry, tray, reboot or clean-Windows claim' } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'native-payload.json') -Encoding UTF8
Write-Output "PASS: $($rows.Count) actual installer files match the frozen candidate; five missing-file cases rejected; extracted runtime executes"

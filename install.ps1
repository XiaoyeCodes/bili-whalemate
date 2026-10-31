[CmdletBinding()]
param(
    [string]$Profile = '',
    [string]$DshHome = '',
    [string]$HarnessSource = '',
    [int]$ServicePort = 8080,
    [int]$BridgePort = 3081
)
$ErrorActionPreference = 'Stop'
$oldHome = $env:DSH_HOME
$oldProfile = $env:CMEM_DSH_PROFILE
$oldEncoding = $env:PYTHONIOENCODING
$oldUtf8 = $env:PYTHONUTF8
try {
    if (!$DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
    $DshHome = [IO.Path]::GetFullPath($DshHome)
    if (!$Profile) { $Profile = if (Test-Path (Join-Path $DshHome 'profiles/desktop/package.json')) { 'desktop' } else { 'web' } }
    if ($Profile -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid profile name' }
    $env:DSH_HOME = $DshHome
    $env:CMEM_DSH_PROFILE = $Profile
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONUTF8 = '1'
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<24||(major===24&&minor<9))process.exit(1)'
    if ($LASTEXITCODE) { throw 'Node.js 24.9+ is required' }
    $python = Get-Command python -ErrorAction Stop
    & $python.Source -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"'
    if ($LASTEXITCODE) { throw 'Install Python 3.11+ with the standard venv module' }

    $dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
    if (!$dshCommand -and !$HarnessSource -and (Test-Path 'apps/cli/src/plugin.ts')) { $HarnessSource = (Get-Location).Path }
    if (!$dshCommand -and !$HarnessSource) {
        $candidates = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Directory -Filter '*DeepSeek*' -ErrorAction SilentlyContinue)
        foreach ($candidate in $candidates) {
            $launcher = Join-Path $candidate.FullName 'resources/runtime/cli/bin/dsh.cmd'
            if (Test-Path $launcher) { $dshCommand = Get-Item $launcher; break }
        }
    }
    if (!$dshCommand -and !$HarnessSource) { throw 'dsh was not found. Enable the dsh command in Harness Desktop settings, or pass -HarnessSource <checkout>.' }
    function Invoke-Harness {
        param([string[]]$Arguments)
        if ($HarnessSource) { & pnpm --dir $HarnessSource dsh @Arguments }
        else {
            $commandPath = if ($dshCommand.Source) { $dshCommand.Source } else { $dshCommand.FullName }
            & $commandPath @Arguments
        }
        if ($LASTEXITCODE -ne 0) { throw "Harness command failed (exit $LASTEXITCODE)" }
    }
    $manifestPath = Join-Path $DshHome "profiles/$Profile/package.json"
    if (Test-Path $manifestPath) {
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        $bundles = @($manifest.dsh.profile.bundles)
        if (@($bundles | Where-Object { $_ -in @('dsh-remembers','dsh-bili-whale') }).Count) {
            throw 'A separate remembers/whale bundle is active. Remove its bundle registration before installing Whalemate; keep its data directory.'
        }
    } elseif ($Profile -eq 'desktop') {
        throw 'Open Harness Desktop once to initialize its profile, then fully quit it before installing.'
    } else {
        Invoke-Harness -Arguments @('--profile',$Profile,'--from-default-profile','web','--dump-config') | Out-Null
    }
    $venv = Join-Path $DshHome 'whalemate/venv'
    $venvPython = Join-Path $venv 'Scripts/python.exe'
    if (!(Test-Path $venvPython)) {
        & $python.Source -m venv $venv
        if ($LASTEXITCODE) { throw 'Python venv creation failed' }
    }
    & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'service/requirements.txt')
    if ($LASTEXITCODE) { throw 'Python dependency installation failed' }
    & $venvPython (Join-Path $PSScriptRoot 'scripts/fetch_gallery.py')
    if ($LASTEXITCODE) { throw 'Gallery download or integrity check failed' }
    & $venvPython (Join-Path $PSScriptRoot 'scripts/setup.py') --home $DshHome --profile $Profile --python $venvPython --node $node --port $ServicePort --bridge-port $BridgePort
    if ($LASTEXITCODE) { throw 'Whalemate data setup failed' }
    Invoke-Harness -Arguments @('plugin','--profile',$Profile,'add','@tencent-connect/dsh-qqbot@0.5.2')
    $bundle = 'file:' + $PSScriptRoot.Replace('\','/')
    Invoke-Harness -Arguments @('plugin','--profile',$Profile,'add',$bundle)
    & $node (Join-Path $PSScriptRoot 'install-official-qq-bridge.mjs')
    if ($LASTEXITCODE) { throw 'Official QQ adapter installation failed' }
    # Detect unresolved bundles and duplicate/invalid profile rows without launching any account.
    Invoke-Harness -Arguments @('--profile',$Profile,'--dump-config') | Out-Null
    Write-Host "Whalemate installed for profile '$Profile'. Restart Harness."
    Write-Host 'Enter API keys in local settings, log into Bilibili, set the owner UID, and bind the official QQ bot.'
    Write-Host "Private QQ pairing code: $(Join-Path $DshHome 'remembers-service/official-qq-bridge.json')"
} finally {
    $env:DSH_HOME = $oldHome
    $env:CMEM_DSH_PROFILE = $oldProfile
    $env:PYTHONIOENCODING = $oldEncoding
    $env:PYTHONUTF8 = $oldUtf8
}

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-TitleLine($text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Green
}

function Add-Candidate([System.Collections.Generic.List[object]]$list, [string]$exePath) {
  if ([string]::IsNullOrWhiteSpace($exePath) -or -not (Test-Path $exePath)) { return }
  try { $exePath = (Resolve-Path $exePath).Path } catch { return }
  $resources = Join-Path (Split-Path -Parent $exePath) 'resources'
  $asar = Join-Path $resources 'app.asar'
  if (Test-Path $asar) {
    if (-not ($list | Where-Object { $_.Asar -eq $asar })) {
      $list.Add([pscustomobject]@{ Exe=$exePath; Asar=$asar; Modified=(Get-Item $asar).LastWriteTime })
    }
  }
}

Write-TitleLine 'Nexa AI v1.7.0 Build 106.2 - Nexa Visual Evaluator v1'
Write-Host 'Buscando la copia REAL de Nexa que Windows esta ejecutando...'

# If this ZIP was extracted directly in a Nexa source project, patch the source first.
$sourceMain = Join-Path $PackageRoot 'main.js'
if (Test-Path $sourceMain) {
  Write-Host 'Proyecto fuente detectado en esta carpeta.' -ForegroundColor Cyan
  Push-Location $PackageRoot
  try {
    & node '.\Install-Nexa-Build-106.2.js'
    if ($LASTEXITCODE -ne 0) { throw 'Fallo al aplicar Build 106.2 al proyecto fuente.' }
  } finally { Pop-Location }
}

$candidates = New-Object 'System.Collections.Generic.List[object]'

# Resolve Nexa shortcuts from Desktop and Start Menu.
try {
  $wsh = New-Object -ComObject WScript.Shell
  $shortcutRoots = @(
    [Environment]::GetFolderPath('Desktop'),
    "$env:PUBLIC\Desktop",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
  foreach ($root in $shortcutRoots) {
    Get-ChildItem $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'Nexa' } |
      ForEach-Object {
        try {
          $shortcut = $wsh.CreateShortcut($_.FullName)
          Add-Candidate $candidates $shortcut.TargetPath
        } catch {}
      }
  }
} catch {}

# Common electron-builder NSIS locations.
$commonExe = @(
  "$env:LOCALAPPDATA\Programs\Nexa AI\Nexa AI.exe",
  "$env:LOCALAPPDATA\Programs\nexa-ai-local\Nexa AI.exe",
  "$env:ProgramFiles\Nexa AI\Nexa AI.exe",
  "${env:ProgramFiles(x86)}\Nexa AI\Nexa AI.exe"
)
foreach ($exe in $commonExe) { Add-Candidate $candidates $exe }

# Limited fallback scan. We intentionally avoid scanning all drives.
foreach ($root in @("$env:LOCALAPPDATA\Programs", "$env:LOCALAPPDATA")) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem $root -Filter 'Nexa AI.exe' -File -Recurse -ErrorAction SilentlyContinue -Depth 4 |
    ForEach-Object { Add-Candidate $candidates $_.FullName }
}

if ($candidates.Count -eq 0) {
  Write-Host ''
  Write-Host 'NO encontre una instalacion Electron con resources\app.asar.' -ForegroundColor Yellow
  Write-Host 'Esto normalmente significa que estas usando el EXE Portable.' -ForegroundColor Yellow
  Write-Host 'El Portable no puede conservar un parche externo porque se autoextrae cada vez.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'En ese caso necesitas recompilar el proyecto fuente con Build 106.2 y abrir el EXE nuevo.'
  Write-Host 'Si tienes la carpeta fuente, extrae este ZIP alli y ejecuta INSTALL-BUILD-106.2-SOURCE.cmd.'
  exit 2
}

$target = $candidates | Sort-Object Modified -Descending | Select-Object -First 1
Write-Host ''
Write-Host ('Ejecutable: ' + $target.Exe) -ForegroundColor Cyan
Write-Host ('Runtime:    ' + $target.Asar) -ForegroundColor Cyan

# Stop only the selected installed executable if it is running.
try {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -eq $target.Exe } |
    ForEach-Object {
      Write-Host 'Cerrando Nexa AI para actualizar el runtime...'
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Milliseconds 700
} catch {}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no esta disponible en PATH. Se necesita Node para aplicar el update.'
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx no esta disponible en PATH. Se necesita npm/npx para abrir app.asar.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = $target.Asar + '.build105-backup-' + $stamp
Copy-Item $target.Asar $backup -Force
Write-Host ('Backup: ' + $backup) -ForegroundColor DarkGray

$temp = Join-Path $env:TEMP ('NexaBuild1062-' + [guid]::NewGuid().ToString('N'))
$appRoot = Join-Path $temp 'app'
$newAsar = Join-Path $temp 'app.asar'
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null

try {
  Write-Host 'Extrayendo app.asar...' -ForegroundColor Cyan
  & npx --yes '@electron/asar@3.2.13' extract $target.Asar $appRoot
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo extraer app.asar.' }

  foreach ($required in @('main.js','preload.js','src\app.js','src\index.html','package.json')) {
    if (-not (Test-Path (Join-Path $appRoot $required))) { throw "El runtime no contiene $required" }
  }

  # Core installer expects project-only markers; create harmless temporary copies for patching.
  if (-not (Test-Path (Join-Path $appRoot 'README-Image-Stage1-Build-105.txt'))) {
    Set-Content -Path (Join-Path $appRoot 'README-Image-Stage1-Build-105.txt') -Value 'Nexa AI v1.7.0 Build 105 runtime baseline' -Encoding UTF8
  }
  if (-not (Test-Path (Join-Path $appRoot 'nexa.project.json'))) {
    '{"version":"1.7.0","application_version":"1.7.0","workspace_revision":"runtime"}' | Set-Content -Path (Join-Path $appRoot 'nexa.project.json') -Encoding UTF8
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $appRoot 'lib') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $appRoot 'scripts') | Out-Null
  Copy-Item (Join-Path $PackageRoot 'lib\visual-evaluator.js') (Join-Path $appRoot 'lib\visual-evaluator.js') -Force
  Copy-Item (Join-Path $PackageRoot 'scripts\validate-visual-evaluator.js') (Join-Path $appRoot 'scripts\validate-visual-evaluator.js') -Force
  Copy-Item (Join-Path $PackageRoot 'Install-Nexa-Build-106-Core.js') (Join-Path $appRoot 'Install-Nexa-Build-106-Core.js') -Force
  Copy-Item (Join-Path $PackageRoot 'Install-Nexa-Build-106.2.js') (Join-Path $appRoot 'Install-Nexa-Build-106.2.js') -Force

  Write-Host 'Aplicando Visual Evaluator al runtime real...' -ForegroundColor Cyan
  Push-Location $appRoot
  try {
    & node '.\Install-Nexa-Build-106.2.js'
    if ($LASTEXITCODE -ne 0) { throw 'El parche del runtime fallo.' }
  } finally { Pop-Location }

  $mainText = Get-Content (Join-Path $appRoot 'main.js') -Raw
  $uiText = Get-Content (Join-Path $appRoot 'src\index.html') -Raw
  if ($mainText -notmatch 'NEXA_VISUAL_EVALUATOR_BUILD_106') { throw 'main.js no contiene el Visual Evaluator despues del parche.' }
  if ($mainText -notmatch 'evaluateGeneratedImage') { throw 'generate -> evaluate no quedo conectado.' }
  if ($uiText -notmatch 'Nexa Visual Evaluator v1') { throw 'La interfaz de Visual Evaluator no quedo instalada.' }

  Write-Host 'Empaquetando runtime actualizado...' -ForegroundColor Cyan
  & npx --yes '@electron/asar@3.2.13' pack $appRoot $newAsar
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $newAsar)) { throw 'No se pudo crear el nuevo app.asar.' }

  Copy-Item $newAsar $target.Asar -Force
  Write-Host ''
  Write-Host 'RUNTIME ACTUALIZADO CORRECTAMENTE.' -ForegroundColor Green
  Write-Host 'Al abrir Nexa debes ver: v1.7.0 · Build 106.2' -ForegroundColor Green
  Write-Host 'En Ajustes debes ver: Nexa Visual Evaluator v1 = READY' -ForegroundColor Green

  Start-Process $target.Exe
  exit 0
}
catch {
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  if (Test-Path $backup) {
    Write-Host 'Restaurando app.asar anterior...' -ForegroundColor Yellow
    Copy-Item $backup $target.Asar -Force
  }
  throw
}
finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

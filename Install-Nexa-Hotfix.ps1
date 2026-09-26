$ErrorActionPreference = 'Stop'

# Nexa AI v1.7.0 Build 99 - small in-place chat hotfix.
# This script does NOT ship app.asar. It patches four exact byte sequences
# in the installed Build 99 app.asar while keeping the archive byte-for-byte
# the same size, then verifies the final SHA-256.

$expectedOriginal = '98f5b2f156ecfa5b44837056835910a441e929a894b225829d8809537c95536a'
$expectedPatched  = '59e8ed3201dde3b873a4a946bb04bd2dca124b9116fce3f6ebc310ae1fe2b432'
$backupName = 'app.asar.Build99-before-chat-hotfix.bak'

function Hash([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try { $full = [IO.Path]::GetFullPath($Path) } catch { return }
  if (-not $List.Contains($full)) { $List.Add($full) }
}

function Find-Nth([string]$Text, [string]$Needle, [int]$Occurrence) {
  $start = 0
  for ($n = 1; $n -le $Occurrence; $n++) {
    $index = $Text.IndexOf($Needle, $start, [StringComparison]::Ordinal)
    if ($index -lt 0) { return -1 }
    $start = $index + $Needle.Length
  }
  return $index
}

function Replace-Fixed([string]$Text, [string]$Old, [string]$New, [int]$Occurrence, [string]$Label) {
  if ($New.Length -gt $Old.Length) { throw "Replacement too long: $Label" }
  $index = Find-Nth $Text $Old $Occurrence
  if ($index -lt 0) { throw "No se encontro el patron esperado: $Label" }
  $replacement = $New.PadRight($Old.Length, ' ')
  return $Text.Substring(0, $index) + $replacement + $Text.Substring($index + $Old.Length)
}

function Find-NexaAsar {
  param([string]$OriginalHash, [string]$PatchedHash)
  $candidates = [System.Collections.Generic.List[string]]::new()
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $roots) {
    Get-ItemProperty $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Nexa AI*' } | ForEach-Object {
      if ($_.InstallLocation) { Add-Candidate $candidates (Join-Path $_.InstallLocation 'resources\app.asar') }
      foreach ($raw in @($_.DisplayIcon, $_.UninstallString)) {
        if (-not $raw) { continue }
        $s = [string]$raw
        $exe = $null
        if ($s -match '^\s*"([^"]+\.exe)"') { $exe = $matches[1] }
        elseif ($s -match '^\s*([^\s]+\.exe)') { $exe = $matches[1] }
        if ($exe) {
          try { Add-Candidate $candidates (Join-Path (Split-Path -Parent $exe) 'resources\app.asar') } catch {}
        }
      }
    }
  }
  foreach ($p in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Nexa AI\resources\app.asar'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nexa-ai-local\resources\app.asar'),
    (Join-Path $env:ProgramFiles 'Nexa AI\resources\app.asar'),
    (Join-Path ${env:ProgramFiles(x86)} 'Nexa AI\resources\app.asar')
  )) { Add-Candidate $candidates $p }

  $programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
  if (Test-Path $programsRoot) {
    Get-ChildItem -Path $programsRoot -Filter app.asar -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.FullName -match '(?i)nexa') { Add-Candidate $candidates $_.FullName }
    }
  }

  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $h = Hash $candidate
    if ($h -eq $PatchedHash) { return @{ Path=$candidate; State='patched' } }
    if ($h -eq $OriginalHash) { return @{ Path=$candidate; State='original' } }
  }
  return $null
}

$found = Find-NexaAsar $expectedOriginal $expectedPatched
if ($found -and $found.State -eq 'patched') {
  Write-Host 'El hotfix ya esta instalado correctamente:' -ForegroundColor Green
  Write-Host $found.Path
  exit 0
}

$target = if ($found) { $found.Path } else { $null }
if (-not $target) {
  Write-Host 'No encontre automaticamente el app.asar exacto de Nexa AI Build 99.' -ForegroundColor Yellow
  Write-Host 'La ruta debe terminar en resources\app.asar'
  $manual = Read-Host 'Pega la ruta de app.asar (o deja vacio para cancelar)'
  if ([string]::IsNullOrWhiteSpace($manual)) { exit 2 }
  $manual = $manual.Trim('"')
  if (Test-Path -LiteralPath $manual -PathType Container) { $manual = Join-Path $manual 'resources\app.asar' }
  if (-not (Test-Path -LiteralPath $manual -PathType Leaf)) { throw "No existe: $manual" }
  $h = Hash $manual
  if ($h -eq $expectedPatched) { Write-Host 'El hotfix ya esta instalado.' -ForegroundColor Green; exit 0 }
  if ($h -ne $expectedOriginal) {
    throw "Ese app.asar no corresponde al Build 99 original. No se modifico nada. SHA-256 encontrado: $h"
  }
  $target = $manual
}

Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Nexa AI*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700

if ((Hash $target) -ne $expectedOriginal) { throw 'El archivo instalado dejo de coincidir con Build 99 antes del parche. No se modifico nada.' }

$backup = Join-Path (Split-Path -Parent $target) $backupName
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
  Copy-Item -LiteralPath $target -Destination $backup -Force
}
if ((Hash $backup) -ne $expectedOriginal) { throw 'La copia de seguridad no coincide con Build 99 original. Se cancelo sin modificar Nexa.' }

$originalLength = (Get-Item -LiteralPath $target).Length
$bytes = [IO.File]::ReadAllBytes($target)
$latin1 = [Text.Encoding]::GetEncoding(28591)
$text = $latin1.GetString($bytes)

# 1) Keep only the last 8 chat messages in the model prompt.
$old1 = "  const clipped = sourceMessages.slice(-36).map(message => ({ role: message.role, content: String(message.content || '') }));"
$new1 = "  const clipped=sourceMessages.slice(-8).map(m=>({role:m.role,content:String(m.content||'')}));"
$text = Replace-Fixed $text $old1 $new1 1 'chat history -36 -> -8'

# 2) Only the SECOND occurrence belongs to streamChat. The first is warmModel and must remain untouched.
$old2 = '  const options = { num_ctx: Number(settings.contextLength) || 4096 };'
$new2 = '  const options={num_ctx:12288,num_predict:4096};'
$text = Replace-Fixed $text $old2 $new2 2 'chat context/output budget'

# 3) Disable hidden GPT-OSS reasoning for normal visible chat answers.
$old3 = '  const body = Buffer.from(JSON.stringify({ model: settings.model, messages, stream: true, keep_alive: settings.keepAlive, options }));'
$new3 = '  const body=Buffer.from(JSON.stringify({model:settings.model,messages,stream:true,think:!1,keep_alive:settings.keepAlive,options}));'
$text = Replace-Fixed $text $old3 $new3 1 'think=false in normal chat'

# 4) Hide source chips from the chat UI while preserving source data internally.
$old4 = "  if (!Array.isArray(message.sources) || !message.sources.length) return '';"
$new4 = "  return '';"
$text = Replace-Fixed $text $old4 $new4 1 'hide Fuentes usadas UI'

$patchedBytes = $latin1.GetBytes($text)
if ($patchedBytes.Length -ne $originalLength) { throw 'El parche intento cambiar el tamano de app.asar. Se cancelo antes de escribir.' }

$temp = "$target.nexa-hotfix.tmp"
[IO.File]::WriteAllBytes($temp, $patchedBytes)
if ((Get-Item -LiteralPath $temp).Length -ne $originalLength) { Remove-Item $temp -Force; throw 'El archivo temporal cambio de tamano.' }
$tempHash = Hash $temp
if ($tempHash -ne $expectedPatched) {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
  throw "La verificacion previa fallo. Esperado: $expectedPatched / obtenido: $tempHash. Nexa NO fue modificado."
}

Move-Item -LiteralPath $temp -Destination $target -Force
if ((Hash $target) -ne $expectedPatched) {
  Copy-Item -LiteralPath $backup -Destination $target -Force
  throw 'La verificacion final fallo. Se restauro automaticamente el Build 99 original.'
}

Write-Host ''
Write-Host 'HOTFIX INSTALADO CORRECTAMENTE' -ForegroundColor Green
Write-Host '--------------------------------'
Write-Host '1. Chat: think=false'
Write-Host '2. Contexto: 12,288 tokens'
Write-Host '3. Salida visible: hasta 4,096 tokens'
Write-Host '4. Historial enviado al modelo: ultimas 8 intervenciones'
Write-Host '5. Fuentes usadas: ocultas solo en la interfaz'
Write-Host ''
Write-Host "Destino: $target"
Write-Host "Backup:  $backup"
Write-Host 'Tus chats, Memory, Knowledge DB, Browser Bridge y configuracion no fueron borrados.'

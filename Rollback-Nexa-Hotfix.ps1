$ErrorActionPreference = 'Stop'
$expectedOriginal = '98f5b2f156ecfa5b44837056835910a441e929a894b225829d8809537c95536a'
$backupName = 'app.asar.Build99-before-chat-hotfix.bak'
function Hash([string]$Path) { if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }; return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
$backup = $null
foreach ($root in $roots) {
  $hit = Get-ChildItem -Path $root -Filter $backupName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $backup = $hit.FullName; break }
}
if (-not $backup) { throw "No encontre la copia de seguridad $backupName." }
if ((Hash $backup) -ne $expectedOriginal) { throw 'La copia de seguridad no coincide con Build 99 original. No se modifico nada.' }
$target = Join-Path (Split-Path -Parent $backup) 'app.asar'
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Nexa AI*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700
Copy-Item -LiteralPath $backup -Destination $target -Force
if ((Hash $target) -ne $expectedOriginal) { throw 'La restauracion no paso la verificacion SHA-256.' }
Write-Host 'ROLLBACK COMPLETADO' -ForegroundColor Green
Write-Host "Se restauro el app.asar original de Build 99: $target"

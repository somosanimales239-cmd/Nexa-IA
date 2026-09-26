$ErrorActionPreference = 'Stop'
$expectedOriginal = '98f5b2f156ecfa5b44837056835910a441e929a894b225829d8809537c95536a'
$expectedPatched  = '59e8ed3201dde3b873a4a946bb04bd2dca124b9116fce3f6ebc310ae1fe2b432'
$roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
$hits = @()
foreach ($root in $roots) {
  $hits += Get-ChildItem -Path $root -Filter app.asar -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '(?i)nexa' }
}
if (-not $hits) { throw 'No encontre app.asar de Nexa AI.' }
foreach ($hit in $hits) {
  $hash = (Get-FileHash -LiteralPath $hit.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -eq $expectedPatched) { Write-Host 'HOTFIX ACTIVO' -ForegroundColor Green; Write-Host $hit.FullName; Write-Host $hash; exit 0 }
  if ($hash -eq $expectedOriginal) { Write-Host 'BUILD 99 ORIGINAL - hotfix no instalado' -ForegroundColor Yellow; Write-Host $hit.FullName; Write-Host $hash; exit 1 }
}
Write-Host 'Se encontro Nexa, pero no coincide con Build 99 original ni con este hotfix.' -ForegroundColor Yellow
$hits | ForEach-Object { Write-Host $_.FullName }
exit 2

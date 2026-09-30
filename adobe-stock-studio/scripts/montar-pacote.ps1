# Stock Studio - monta o pacote dividido em partes (limite de 30 MB por download).
# Chamado pelo iniciar.bat. Procura as partes 2, 3 e 4 (zip ou ja extraidas) na pasta do
# sistema, na pasta acima, em Downloads e na Area de Trabalho; extrai o que falta, junta o
# Node.js portatil e confere a assinatura SHA-256 de cada arquivo grande.
# Compativel com Windows PowerShell 5.1. Somente caracteres ASCII.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$app = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = Split-Path -Parent $app

function Join-Rel([string]$root, [string]$rel) {
  return [System.IO.Path]::Combine([string[]](@($root) + $rel.Split('/')))
}

$parts = @(
  @{ Zip = 'StockStudio-parte-2.zip'; Files = @('runtime/node.exe.001') },
  @{ Zip = 'StockStudio-parte-3.zip'; Files = @('runtime/node.exe.002') },
  @{ Zip = 'StockStudio-parte-4.zip'; Files = @('tools/realesrgan/models/realesrgan-x4plus.bin') }
)

$homes = @($env:USERPROFILE, $HOME) | Where-Object { $_ } | Select-Object -Unique
$searchDirs = @($base, $app, (Split-Path -Parent $base))
foreach ($h in $homes) {
  $searchDirs += @((Join-Path $h 'Downloads'), (Join-Path $h 'Desktop'), (Join-Path $h 'OneDrive\Desktop'), (Join-Path $h 'OneDrive/Desktop'))
}
$searchDirs = $searchDirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$nodeExe = Join-Rel $app 'runtime/node.exe'
$missing = @()

foreach ($part in $parts) {
  $needed = @($part.Files | Where-Object {
      $target = Join-Rel $app $_
      $isNodePiece = $_ -like 'runtime/node.exe.*'
      -not ((Test-Path -LiteralPath $target) -or ($isNodePiece -and (Test-Path -LiteralPath $nodeExe)))
    })
  if ($needed.Count -eq 0) { continue }

  $stem = [System.IO.Path]::GetFileNameWithoutExtension($part.Zip)
  $zip = $null
  foreach ($d in $searchDirs) {
    $candidate = Join-Path $d $part.Zip
    if (Test-Path -LiteralPath $candidate) { $zip = $candidate; break }
  }

  if ($zip) {
    Write-Host "Extraindo $($part.Zip)..."
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
      foreach ($rel in $needed) {
        $entry = $archive.Entries | Where-Object { $_.FullName -eq ('StockStudio/' + $rel) } | Select-Object -First 1
        if (-not $entry) { throw "$($part.Zip) nao contem $rel (arquivo errado ou corrompido)" }
        $out = Join-Rel $app $rel
        [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($out))
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true)
      }
    } finally {
      $archive.Dispose()
    }
    continue
  }

  # Parte ja extraida em outra pasta (ex.: "Extrair tudo" cria Downloads\StockStudio-parte-2\StockStudio\...).
  $copied = $true
  foreach ($rel in $needed) {
    $found = $null
    foreach ($d in $searchDirs) {
      foreach ($candidate in @((Join-Rel (Join-Path (Join-Path $d $stem) 'StockStudio') $rel), (Join-Rel (Join-Path $d $stem) $rel))) {
        if (Test-Path -LiteralPath $candidate) { $found = $candidate; break }
      }
      if ($found) { break }
    }
    if ($found) {
      $out = Join-Rel $app $rel
      [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($out))
      Copy-Item -LiteralPath $found -Destination $out -Force
    } else {
      $copied = $false
    }
  }
  if (-not $copied) { $missing += $part.Zip }
}

if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host 'Faltam partes do pacote:' $($missing -join ', ')
  Write-Host 'Baixe todas as partes (StockStudio-parte-1.zip ate StockStudio-parte-4.zip) e deixe-as'
  Write-Host 'na pasta Downloads ou na mesma pasta onde voce extraiu a parte 1. Depois abra o iniciar.bat de novo.'
  exit 1
}

function Test-Sha256([string]$file) {
  $shaFile = "$file.sha256"
  if (-not (Test-Path -LiteralPath $shaFile)) { return $true }
  $expected = (Get-Content -LiteralPath $shaFile -Raw).Trim().ToLower()
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
  return $expected -eq $actual
}

if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Host 'Montando o Node.js portatil (so na primeira vez)...'
  $pieces = @(Get-ChildItem -LiteralPath (Join-Rel $app 'runtime') -Filter 'node.exe.0*' | Sort-Object Name)
  $out = [System.IO.File]::Create($nodeExe)
  try {
    foreach ($p in $pieces) {
      $in = [System.IO.File]::OpenRead($p.FullName)
      try { $in.CopyTo($out) } finally { $in.Dispose() }
    }
  } finally {
    $out.Dispose()
  }
  if (-not (Test-Sha256 $nodeExe)) {
    Remove-Item -LiteralPath $nodeExe -Force
    Write-Host 'O Node.js montado nao confere com a assinatura original (download incompleto?).'
    Write-Host 'Baixe de novo as partes 2 e 3 e abra o iniciar.bat outra vez.'
    exit 1
  }
  $pieces | Remove-Item -Force
}

$model = Join-Rel $app 'tools/realesrgan/models/realesrgan-x4plus.bin'
if (-not (Test-Sha256 $model)) {
  Remove-Item -LiteralPath $model -Force
  Write-Host 'O modelo do Real-ESRGAN nao confere com a assinatura original (download incompleto?).'
  Write-Host 'Baixe de novo a parte 4 e abra o iniciar.bat outra vez.'
  exit 1
}

exit 0

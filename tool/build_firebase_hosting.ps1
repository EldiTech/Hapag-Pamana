$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$adminSource = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "Admin"))
$existingSource = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "hosting"))
$output = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".firebase-hosting"))

if ((Split-Path -Parent $output) -ne $projectRoot -or
    (Split-Path -Leaf $output) -ne ".firebase-hosting") {
  throw "Refusing to replace unexpected output path: $output"
}
if (-not (Test-Path -LiteralPath $adminSource -PathType Container)) {
  throw "Admin source not found: $adminSource"
}
if (-not (Test-Path -LiteralPath $existingSource -PathType Container)) {
  throw "Existing Hosting source not found: $existingSource"
}

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output | Out-Null

# Admin owns the site root. Existing payment callbacks and layout-viewer are
# then merged into their unchanged subpaths.
Copy-Item -Path (Join-Path $adminSource "*") -Destination $output -Recurse -Force
Copy-Item -Path (Join-Path $existingSource "*") -Destination $output -Recurse -Force

$files = Get-ChildItem -LiteralPath $output -Recurse -File
Write-Output "Firebase Hosting bundle ready: $($files.Count) files at $output"

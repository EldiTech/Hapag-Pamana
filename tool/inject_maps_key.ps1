# Generates web/index.html from the committed web/index.template.html,
# substituting the real Google Maps API key from .env. Flutter web has no
# gradle/AppDelegate-style hook to read .env at build time, so this script
# stands in for that -- same key, same .env, same out-of-git pattern as
# android/app/build.gradle.kts and ios/Runner/AppDelegate.swift.
#
# web/index.html is gitignored -- only the template is tracked -- so the real
# key never lands in source control and there's nothing to restore afterward.
#
# Usage: run once before `flutter run -d chrome` / `flutter build web`.
#   powershell -File tool/inject_maps_key.ps1
#
# Restrict the key by HTTP referrer in Cloud Console once it's live -- an
# index.html key is visible to anyone who views source, same as any other
# client-side Maps JS key.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$templateFile = Join-Path $root 'web\index.template.html'
$indexFile = Join-Path $root 'web\index.html'

if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Warning ".env not found at $envFile -- copy .env.example to .env and fill in GOOGLE_MAPS_API_KEY first."
    exit 1
}

$key = ''
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*GOOGLE_MAPS_API_KEY\s*=\s*(.*)\s*$') {
        $key = $Matches[1].Trim().Trim('"', "'")
        break
    }
}

if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Warning "GOOGLE_MAPS_API_KEY is blank in .env -- the web map will fail to load."
    exit 1
}

$content = Get-Content -LiteralPath $templateFile -Raw
$escapedKey = $key -replace '\$', '$$$$'
$content = $content -replace [Regex]::Escape('$GOOGLE_MAPS_API_KEY'), $escapedKey

Set-Content -LiteralPath $indexFile -Value $content -NoNewline -Encoding utf8

Write-Host "Generated web/index.html from index.template.html with the Maps key."

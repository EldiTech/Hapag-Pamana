# Copies the freshly built release APK over the one the download page serves.
#
# Run by the PostToolUse hook in .claude/settings.json. The hook fires after
# EVERY shell command, so this script decides for itself whether the command
# was a release build -- the alternative (settings.json's `if` filter) keys off
# permission-rule syntax naming a specific tool, and the shell tool is called
# Bash on some hosts and PowerShell on others.
#
# The download page (Download Web/index.html) hands out the .apk beside it;
# without this the page keeps serving whatever build was there last.
#
# Both APKs are gitignored (*.apk), so this only affects what gets uploaded to
# hosting -- nothing here reaches source control.

$ErrorActionPreference = 'Stop'

# The hook payload arrives as JSON on stdin. An empty stdin means someone ran
# this by hand, which is a deliberate "copy it now" -- skip the command check.
# Emptiness is the test rather than IsInputRedirected, because a console host
# may hand us a redirected-but-empty stdin (the null device) either way.
$stdin = ''
if ([Console]::IsInputRedirected) { $stdin = [Console]::In.ReadToEnd() }

$isBuild = $true
if (-not [string]::IsNullOrWhiteSpace($stdin)) {
    $isBuild = $false
    try {
        $payload = $stdin | ConvertFrom-Json
        $cmd = [string]$payload.tool_input.command
        # Match the build however it was spelled: flag order varies, and the
        # command usually carries redirections or a pipe after it.
        if ($cmd -match 'flutter\s+build\s+apk\b' -and $cmd -match '--release\b') {
            $isBuild = $true
        }
    } catch {
        # Malformed payload is not this script's problem to report.
        exit 0
    }
}
if (-not $isBuild) { exit 0 }

# Resolve against the repo root rather than the caller's working directory, so
# the hook behaves the same wherever it is invoked from.
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'build\app\outputs\flutter-apk\app-release.apk'
$dst = Join-Path $root 'Download Web\hapag-pamana-release.apk'

# A failed or cancelled build leaves no APK. Say nothing and exit clean -- the
# build's own error is the message that matters, not a second one from here.
if (-not (Test-Path -LiteralPath $src)) { exit 0 }

Copy-Item -LiteralPath $src -Destination $dst -Force

$mb = [math]::Round((Get-Item -LiteralPath $dst).Length / 1MB, 1)
@{ systemMessage = "Download Web APK updated ($mb MB)" } | ConvertTo-Json -Compress

#!/usr/bin/env bash
# KlawOps installer
# Usage: curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/install.sh | bash
set -euo pipefail

REPO="TassanSaidi/KlawOps"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

# ── Colours ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; NC=''
fi

log()  { printf "${GREEN}[klawops]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[klawops]${NC} %s\n" "$*"; }
err()  { printf "${RED}[klawops]${NC} %s\n" "$*" >&2; }

# ── Preflight checks ──────────────────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  err "curl is required but not found. Please install curl and try again."
  exit 1
fi

if ! command -v code &>/dev/null; then
  err "'code' CLI not found. VS Code must be installed with the shell command in your PATH."
  err ""
  err "  macOS: open VS Code → Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
  err "  Linux: ensure /usr/share/code or your VS Code bin directory is in PATH"
  exit 1
fi

if ! command -v tar &>/dev/null; then
  err "tar is required but not found. Please install tar and try again."
  exit 1
fi

# ── Fetch latest release info ─────────────────────────────────────────────────
log "Fetching latest release from ${REPO}..."

RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "${API_URL}") || {
  err "Failed to fetch release information. Check your internet connection."
  err "Release URL: ${API_URL}"
  exit 1
}

# Extract fields without requiring jq
VSIX_URL=$(printf '%s' "$RELEASE_JSON" \
  | grep '"browser_download_url"' \
  | grep '\.vsix"' \
  | head -1 \
  | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

SKILLS_URL=$(printf '%s' "$RELEASE_JSON" \
  | grep '"browser_download_url"' \
  | grep 'skills\.tar\.gz"' \
  | head -1 \
  | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

VERSION=$(printf '%s' "$RELEASE_JSON" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [ -z "$VSIX_URL" ] || [ -z "$SKILLS_URL" ]; then
  err "No release artifacts found. Please check: https://github.com/${REPO}/releases"
  exit 1
fi

log "Found KlawOps ${VERSION}"

# ── Download to temp dir ──────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log "Downloading extension..."
curl -fsSL -o "${TMP_DIR}/klawops.vsix" "$VSIX_URL"

log "Downloading skills..."
curl -fsSL -o "${TMP_DIR}/skills.tar.gz" "$SKILLS_URL"

# ── Install VS Code extension ─────────────────────────────────────────────────
log "Installing VS Code extension..."
code --install-extension "${TMP_DIR}/klawops.vsix" --force

# ── Install skills (merge — never overwrite existing files) ───────────────────
mkdir -p "${HOME}/.claude/commands" "${HOME}/.claude/agents"

SKILLS_TMP="${TMP_DIR}/skills"
mkdir -p "$SKILLS_TMP"
tar -xzf "${TMP_DIR}/skills.tar.gz" -C "$SKILLS_TMP"

installed=0
skipped=0

install_skill() {
  local src="$1"
  local dst="$2"
  if [ -f "$dst" ]; then
    warn "[skip]    ${dst/$HOME/\~} (already exists)"
    skipped=$((skipped + 1))
  else
    cp "$src" "$dst"
    log "[install] ${dst/$HOME/\~}"
    installed=$((installed + 1))
  fi
}

if [ -d "${SKILLS_TMP}/commands" ]; then
  for f in "${SKILLS_TMP}/commands/"*.md; do
    [ -f "$f" ] || continue
    install_skill "$f" "${HOME}/.claude/commands/$(basename "$f")"
  done
fi

if [ -d "${SKILLS_TMP}/agents" ]; then
  for f in "${SKILLS_TMP}/agents/"*.md; do
    [ -f "$f" ] || continue
    install_skill "$f" "${HOME}/.claude/agents/$(basename "$f")"
  done
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n"
log "KlawOps ${VERSION} installed!"
log "  Extension : tonderaisaidi.klawops"
log "  Skills    : ${installed} installed, ${skipped} skipped (already existed)"
printf "\n"
log "Restart VS Code to activate KlawOps."
log "Then use /research_codebase_generic, /create_plan_generic, etc. in Claude Code."
printf "\n"
log "Terminal mode (no VS Code required):"
log "  npm run compile && npm run serve"
log "  Or: node out/server.js --port 3131 --claude-dir ~/.claude"

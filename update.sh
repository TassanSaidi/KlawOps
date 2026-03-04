#!/usr/bin/env bash
# KlawOps updater — upgrades an existing installation to the latest release
# Usage: curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/update.sh | bash
set -euo pipefail

REPO="TassanSaidi/KlawOps"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

# ── Colours ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; CYAN=''; NC=''
fi

log()  { printf "${GREEN}[klawops]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[klawops]${NC} %s\n" "$*"; }
err()  { printf "${RED}[klawops]${NC} %s\n" "$*" >&2; }
info() { printf "${CYAN}[klawops]${NC} %s\n" "$*"; }

# ── Preflight ─────────────────────────────────────────────────────────────────
for cmd in curl code tar; do
  if ! command -v "$cmd" &>/dev/null; then
    err "'$cmd' is required but not found."
    exit 1
  fi
done

# ── Check current version ─────────────────────────────────────────────────────
CURRENT_VERSION=""
if code --list-extensions --show-versions 2>/dev/null | grep -q "tonderaisaidi.klawops"; then
  CURRENT_VERSION=$(code --list-extensions --show-versions 2>/dev/null \
    | grep "tonderaisaidi.klawops" \
    | sed 's/.*@/v/')
  info "Current version: ${CURRENT_VERSION}"
else
  warn "KlawOps not currently installed. Running fresh install..."
fi

# ── Fetch latest release ──────────────────────────────────────────────────────
log "Checking for updates..."

RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "${API_URL}") || {
  err "Failed to fetch release info. Check your internet connection."
  exit 1
}

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

LATEST_VERSION=$(printf '%s' "$RELEASE_JSON" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [ -z "$VSIX_URL" ]; then
  err "No release artifacts found at: https://github.com/${REPO}/releases"
  exit 1
fi

# ── Compare versions ──────────────────────────────────────────────────────────
if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  log "Already up to date (${LATEST_VERSION}). Nothing to do."
  exit 0
fi

if [ -n "$CURRENT_VERSION" ]; then
  log "Upgrading ${CURRENT_VERSION} → ${LATEST_VERSION}"
else
  log "Installing ${LATEST_VERSION}"
fi

# ── Download & install ────────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log "Downloading extension..."
curl -fsSL -o "${TMP_DIR}/klawops.vsix" "$VSIX_URL"

log "Installing VS Code extension..."
code --install-extension "${TMP_DIR}/klawops.vsix" --force

# ── Update skills (only install NEW files, preserve customizations) ───────────
if [ -n "$SKILLS_URL" ]; then
  log "Checking skills for updates..."
  curl -fsSL -o "${TMP_DIR}/skills.tar.gz" "$SKILLS_URL"

  SKILLS_TMP="${TMP_DIR}/skills"
  mkdir -p "$SKILLS_TMP"
  tar -xzf "${TMP_DIR}/skills.tar.gz" -C "$SKILLS_TMP"

  updated=0
  skipped=0

  update_skill() {
    local src="$1" dst="$2"
    if [ -f "$dst" ]; then
      if ! cmp -s "$src" "$dst"; then
        warn "[update]  ${dst/$HOME/\~} (updated to latest)"
        cp "$src" "$dst"
        updated=$((updated + 1))
      else
        skipped=$((skipped + 1))
      fi
    else
      cp "$src" "$dst"
      log "[install] ${dst/$HOME/\~}"
      updated=$((updated + 1))
    fi
  }

  mkdir -p "${HOME}/.claude/commands" "${HOME}/.claude/agents"

  for subdir in commands agents; do
    if [ -d "${SKILLS_TMP}/${subdir}" ]; then
      for f in "${SKILLS_TMP}/${subdir}/"*.md; do
        [ -f "$f" ] || continue
        update_skill "$f" "${HOME}/.claude/${subdir}/$(basename "$f")"
      done
    fi
  done

  log "Skills: ${updated} updated, ${skipped} unchanged"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n"
log "KlawOps updated to ${LATEST_VERSION}!"
log "Restart VS Code to activate the new version."

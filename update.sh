#!/usr/bin/env bash
# KlawOps updater — upgrades an existing installation to the latest release
# Cleans up old VS Code extension versions and updates all components.
# Usage: curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/update.sh | bash
set -euo pipefail

REPO="TassanSaidi/KlawOps"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
EXT_ID="tonderaisaidi.klawops"
KLAWOPS_DIR="${HOME}/.klawops"
BIN_DIR="${HOME}/.local/bin"

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
if ! command -v curl &>/dev/null; then
  err "curl is required but not found."
  exit 1
fi

if ! command -v tar &>/dev/null; then
  err "tar is required but not found."
  exit 1
fi

HAS_CODE=true
HAS_NODE=true

if ! command -v code &>/dev/null; then
  warn "'code' CLI not found — VS Code extension update will be skipped."
  HAS_CODE=false
fi

if ! command -v node &>/dev/null; then
  warn "'node' not found — terminal server update will be skipped."
  HAS_NODE=false
fi

if [ "$HAS_CODE" = false ] && [ "$HAS_NODE" = false ]; then
  err "Neither 'code' nor 'node' found. Nothing to update."
  exit 1
fi

# ── Detect VS Code extensions directory ──────────────────────────────────────
find_vscode_ext_dir() {
  # Check common locations for VS Code extensions
  for dir in \
    "${HOME}/.vscode/extensions" \
    "${HOME}/.vscode-server/extensions" \
    "${HOME}/.vscode-insiders/extensions" \
    "${HOME}/.vscode-oss/extensions"; do
    if [ -d "$dir" ]; then
      echo "$dir"
      return
    fi
  done
  echo ""
}

# ── Clean up old extension versions ──────────────────────────────────────────
cleanup_old_extensions() {
  local ext_dir="$1"
  local keep_version="$2"  # version WITHOUT "v" prefix (e.g. "0.1.1")

  if [ -z "$ext_dir" ] || [ ! -d "$ext_dir" ]; then
    return
  fi

  local removed=0

  # Find all klawops extension directories (pattern: tonderaisaidi.klawops-*)
  for old_dir in "${ext_dir}/${EXT_ID}-"*; do
    [ -d "$old_dir" ] || continue

    local dir_name
    dir_name=$(basename "$old_dir")
    local dir_version="${dir_name#${EXT_ID}-}"

    # Remove any version that isn't the one we just installed
    if [ "$dir_version" != "$keep_version" ]; then
      rm -rf "$old_dir"
      log "[cleanup] Removed old extension: ${dir_name}"
      removed=$((removed + 1))
    fi
  done

  if [ "$removed" -gt 0 ]; then
    log "Cleaned up ${removed} old extension version(s)"
  fi
}

# ── Check current version ─────────────────────────────────────────────────────
CURRENT_VERSION=""
if [ "$HAS_CODE" = true ] && code --list-extensions --show-versions 2>/dev/null | grep -q "${EXT_ID}"; then
  CURRENT_VERSION=$(code --list-extensions --show-versions 2>/dev/null \
    | grep "${EXT_ID}" \
    | sed 's/.*@/v/')
  info "Current version: ${CURRENT_VERSION}"
else
  if [ "$HAS_CODE" = true ]; then
    warn "KlawOps extension not currently installed. Will perform fresh install..."
  fi
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

SERVER_URL=$(printf '%s' "$RELEASE_JSON" \
  | grep '"browser_download_url"' \
  | grep 'server\.tar\.gz"' \
  | head -1 \
  | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

LATEST_VERSION=$(printf '%s' "$RELEASE_JSON" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [ -z "$VSIX_URL" ] && [ -z "$SERVER_URL" ]; then
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

# Strip leading "v" from tag to get raw version number (e.g. "v0.1.1" → "0.1.1")
RAW_VERSION="${LATEST_VERSION#v}"

# ── Update VS Code extension ─────────────────────────────────────────────────
if [ "$HAS_CODE" = true ] && [ -n "$VSIX_URL" ]; then
  log "Downloading extension..."
  curl -fsSL -o "${TMP_DIR}/klawops.vsix" "$VSIX_URL"

  # Uninstall old extension first to ensure a clean slate
  if code --list-extensions 2>/dev/null | grep -q "^${EXT_ID}$"; then
    log "Removing old extension before installing new version..."
    code --uninstall-extension "${EXT_ID}" 2>/dev/null || true
  fi

  # Clean up leftover extension directories from all known VS Code locations
  VSCODE_EXT_DIR=$(find_vscode_ext_dir)
  if [ -n "$VSCODE_EXT_DIR" ]; then
    for old_dir in "${VSCODE_EXT_DIR}/${EXT_ID}-"*; do
      [ -d "$old_dir" ] || continue
      rm -rf "$old_dir"
      log "[cleanup] Removed leftover: $(basename "$old_dir")"
    done
  fi

  log "Installing VS Code extension ${LATEST_VERSION}..."
  code --install-extension "${TMP_DIR}/klawops.vsix" --force

  # Final cleanup: remove any stale versions that aren't the one we just installed
  if [ -n "$VSCODE_EXT_DIR" ]; then
    cleanup_old_extensions "$VSCODE_EXT_DIR" "$RAW_VERSION"
  fi
fi

# ── Update skills (install new files, update changed files) ──────────────────
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

# ── Update terminal server ───────────────────────────────────────────────────
TERMINAL_UPDATED=false
if [ "$HAS_NODE" = true ] && [ -n "$SERVER_URL" ]; then
  log "Updating terminal server..."
  curl -fsSL -o "${TMP_DIR}/server.tar.gz" "$SERVER_URL"

  mkdir -p "${KLAWOPS_DIR}"
  tar -xzf "${TMP_DIR}/server.tar.gz" -C "${KLAWOPS_DIR}"

  # Ensure klawops wrapper script exists
  mkdir -p "${BIN_DIR}"
  cat > "${BIN_DIR}/klawops" <<'WRAPPER'
#!/usr/bin/env bash
exec node "${HOME}/.klawops/server.js" "$@"
WRAPPER
  chmod +x "${BIN_DIR}/klawops"
  TERMINAL_UPDATED=true

  if ! echo "$PATH" | grep -q "${BIN_DIR}"; then
    warn "${BIN_DIR} is not in your PATH."
    warn "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
    warn "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n"
log "KlawOps updated to ${LATEST_VERSION}!"
if [ "$HAS_CODE" = true ] && [ -n "$VSIX_URL" ]; then
  log "  VS Code  : ${EXT_ID} (restart VS Code to activate)"
fi
if [ "$TERMINAL_UPDATED" = true ]; then
  log "  Terminal : klawops server updated at ${KLAWOPS_DIR}"
fi
log "Restart VS Code to activate the new version."

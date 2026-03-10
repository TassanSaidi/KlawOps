#!/usr/bin/env bash
# KlawOps installer
# Usage: curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/install.sh | bash
set -euo pipefail

REPO="TassanSaidi/KlawOps"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
REPO_URL="https://github.com/${REPO}.git"
KLAWOPS_DIR="${HOME}/.klawops"
BIN_DIR="${HOME}/.local/bin"

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

if ! command -v tar &>/dev/null; then
  err "tar is required but not found. Please install tar and try again."
  exit 1
fi

HAS_CODE=true
HAS_NODE=true
HAS_GIT=true

if ! command -v code &>/dev/null; then
  warn "'code' CLI not found — VS Code extension will be skipped."
  warn "To enable: open VS Code → Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
  HAS_CODE=false
fi

if ! command -v node &>/dev/null; then
  warn "'node' not found — terminal mode will be skipped."
  warn "Install Node.js from https://nodejs.org to enable 'klawops' terminal command."
  HAS_NODE=false
fi

if ! command -v git &>/dev/null; then
  HAS_GIT=false
fi

if [ "$HAS_CODE" = false ] && [ "$HAS_NODE" = false ]; then
  err "Neither 'code' nor 'node' found. Nothing to install."
  exit 1
fi

# ── Fetch latest release info ─────────────────────────────────────────────────
log "Fetching latest release from ${REPO}..."

VSIX_URL=""
SKILLS_URL=""
SERVER_URL=""
VERSION=""
HAS_RELEASE=false

RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "${API_URL}" 2>/dev/null) && HAS_RELEASE=true || true

if [ "$HAS_RELEASE" = true ] && [ -n "$RELEASE_JSON" ]; then
  # Extract fields without requiring jq
  VSIX_URL=$(printf '%s' "$RELEASE_JSON" \
    | grep '"browser_download_url"' \
    | grep '\.vsix"' \
    | head -1 \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/') || true

  SKILLS_URL=$(printf '%s' "$RELEASE_JSON" \
    | grep '"browser_download_url"' \
    | grep 'skills\.tar\.gz"' \
    | head -1 \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/') || true

  SERVER_URL=$(printf '%s' "$RELEASE_JSON" \
    | grep '"browser_download_url"' \
    | grep 'server\.tar\.gz"' \
    | head -1 \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/') || true

  VERSION=$(printf '%s' "$RELEASE_JSON" \
    | grep '"tag_name"' \
    | head -1 \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/') || true
fi

# ── Build from source if no release artifacts ────────────────────────────────
if [ -z "$VSIX_URL" ] && [ -z "$SERVER_URL" ]; then
  warn "No release artifacts found — building from source."

  if [ "$HAS_GIT" = false ]; then
    err "'git' is required to build from source but not found."
    exit 1
  fi
  if [ "$HAS_NODE" = false ]; then
    err "'node' is required to build from source but not found."
    exit 1
  fi
  if ! command -v npm &>/dev/null; then
    err "'npm' is required to build from source but not found."
    exit 1
  fi

  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  log "Cloning ${REPO}..."
  git clone --depth 1 "$REPO_URL" "${TMP_DIR}/repo"
  cd "${TMP_DIR}/repo"

  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "source")

  log "Installing dependencies..."
  npm install --ignore-scripts 2>&1 | tail -1

  log "Building..."
  node esbuild.js

  # ── Package VSIX if vsce and code are available ──
  if [ "$HAS_CODE" = true ]; then
    log "Packaging VS Code extension..."
    if npx @vscode/vsce package --no-git-tag-version --no-update-package-json -o "${TMP_DIR}/klawops.vsix" 2>/dev/null; then
      log "Installing VS Code extension..."
      code --install-extension "${TMP_DIR}/klawops.vsix" --force
    else
      warn "Could not package VSIX — skipping VS Code extension."
    fi
  fi

  # ── Install skills from source tree ──
  mkdir -p "${HOME}/.claude/commands" "${HOME}/.claude/agents"
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

  if [ -d "skills/commands" ]; then
    for f in skills/commands/*.md; do
      [ -f "$f" ] || continue
      install_skill "$f" "${HOME}/.claude/commands/$(basename "$f")"
    done
  fi

  if [ -d "skills/agents" ]; then
    for f in skills/agents/*.md; do
      [ -f "$f" ] || continue
      install_skill "$f" "${HOME}/.claude/agents/$(basename "$f")"
    done
  fi

  # ── Install terminal server from build output ──
  TERMINAL_INSTALLED=false
  if [ "$HAS_NODE" = true ] && [ -f "out/server.js" ]; then
    log "Installing terminal server to ${KLAWOPS_DIR}..."
    mkdir -p "${KLAWOPS_DIR}"
    cp out/server.js "${KLAWOPS_DIR}/server.js"
    if [ -d "out/webview" ]; then
      cp -r out/webview "${KLAWOPS_DIR}/webview"
    fi

    mkdir -p "${BIN_DIR}"
    cat > "${BIN_DIR}/klawops" <<'WRAPPER'
#!/usr/bin/env bash
exec node "${HOME}/.klawops/server.js" "$@"
WRAPPER
    chmod +x "${BIN_DIR}/klawops"
    TERMINAL_INSTALLED=true

    if ! echo "$PATH" | grep -q "${BIN_DIR}"; then
      warn "${BIN_DIR} is not in your PATH."
      warn "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
      warn "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
    fi
  fi

  # ── Summary ──
  printf "\n"
  log "KlawOps ${VERSION} installed (built from source)!"
  if [ "$HAS_CODE" = true ] && [ -f "${TMP_DIR}/klawops.vsix" ]; then
    log "  VS Code   : tonderaisaidi.klawops (restart VS Code to activate)"
  fi
  log "  Skills    : ${installed} installed, ${skipped} skipped (already existed)"
  if [ "$TERMINAL_INSTALLED" = true ]; then
    log "  Terminal  : klawops command installed to ${BIN_DIR}/klawops"
  fi
  printf "\n"
  if [ "$HAS_CODE" = true ]; then
    log "VS Code: use /research_codebase_generic, /create_plan_generic, etc. in Claude Code."
  fi
  if [ "$TERMINAL_INSTALLED" = true ]; then
    log "Terminal: run 'klawops' to open the dashboard in your browser."
    log "  Options: klawops --port 3131 --claude-dir ~/.claude --no-open"
  fi
  exit 0
fi

# ── Release-based install (existing path) ────────────────────────────────────
log "Found KlawOps ${VERSION}"

# ── Download to temp dir ──────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if [ "$HAS_CODE" = true ] && [ -n "$VSIX_URL" ]; then
  log "Downloading extension..."
  curl -fsSL -o "${TMP_DIR}/klawops.vsix" "$VSIX_URL"
fi

if [ -n "$SKILLS_URL" ]; then
  log "Downloading skills..."
  curl -fsSL -o "${TMP_DIR}/skills.tar.gz" "$SKILLS_URL"
fi

if [ "$HAS_NODE" = true ] && [ -n "$SERVER_URL" ]; then
  log "Downloading terminal server..."
  curl -fsSL -o "${TMP_DIR}/server.tar.gz" "$SERVER_URL"
fi

# ── Install VS Code extension ─────────────────────────────────────────────────
if [ "$HAS_CODE" = true ] && [ -f "${TMP_DIR}/klawops.vsix" ]; then
  log "Installing VS Code extension..."
  code --install-extension "${TMP_DIR}/klawops.vsix" --force
fi

# ── Install skills (merge — never overwrite existing files) ───────────────────
mkdir -p "${HOME}/.claude/commands" "${HOME}/.claude/agents"

installed=0
skipped=0

if [ ! -f "${TMP_DIR}/skills.tar.gz" ]; then
  log "No skills archive in this release — skipping."
fi

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

if [ -f "${TMP_DIR}/skills.tar.gz" ]; then
  SKILLS_TMP="${TMP_DIR}/skills"
  mkdir -p "$SKILLS_TMP"
  tar -xzf "${TMP_DIR}/skills.tar.gz" -C "$SKILLS_TMP"

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
fi

# ── Install terminal server ───────────────────────────────────────────────────
TERMINAL_INSTALLED=false
if [ "$HAS_NODE" = true ] && [ -f "${TMP_DIR}/server.tar.gz" ]; then
  log "Installing terminal server to ${KLAWOPS_DIR}..."
  mkdir -p "${KLAWOPS_DIR}"
  tar -xzf "${TMP_DIR}/server.tar.gz" -C "${KLAWOPS_DIR}"

  # Create klawops wrapper script
  mkdir -p "${BIN_DIR}"
  cat > "${BIN_DIR}/klawops" <<'EOF'
#!/usr/bin/env bash
exec node "${HOME}/.klawops/server.js" "$@"
EOF
  chmod +x "${BIN_DIR}/klawops"
  TERMINAL_INSTALLED=true

  # Remind about PATH if needed
  if ! echo "$PATH" | grep -q "${BIN_DIR}"; then
    warn "${BIN_DIR} is not in your PATH."
    warn "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
    warn "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n"
log "KlawOps ${VERSION} installed!"
if [ "$HAS_CODE" = true ] && [ -f "${TMP_DIR}/klawops.vsix" ]; then
  log "  VS Code   : tonderaisaidi.klawops (restart VS Code to activate)"
fi
log "  Skills    : ${installed} installed, ${skipped} skipped (already existed)"
if [ "$TERMINAL_INSTALLED" = true ]; then
  log "  Terminal  : klawops command installed to ${BIN_DIR}/klawops"
fi
printf "\n"
if [ "$HAS_CODE" = true ]; then
  log "VS Code: use /research_codebase_generic, /create_plan_generic, etc. in Claude Code."
fi
if [ "$TERMINAL_INSTALLED" = true ]; then
  log "Terminal: run 'klawops' to open the dashboard in your browser."
  log "  Options: klawops --port 3131 --claude-dir ~/.claude --no-open"
fi

#!/usr/bin/env bash
# KlawOps uninstaller
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/uninstall.sh)
#
# NOTE: Download and run directly — do not pipe through bash, as this script
#       prompts for input before removing skill files.
#   curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/uninstall.sh -o uninstall.sh
#   bash uninstall.sh
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; NC=''
fi

log()  { printf "${GREEN}[klawops]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[klawops]${NC} %s\n" "$*"; }
err()  { printf "${RED}[klawops]${NC} %s\n" "$*" >&2; }

echo ""
log "Uninstalling KlawOps..."
echo ""

# ── Remove VS Code extension ──────────────────────────────────────────────────
if command -v code &>/dev/null; then
  if code --list-extensions 2>/dev/null | grep -q "^tonderaisaidi\.klawops$"; then
    code --uninstall-extension tonderaisaidi.klawops
    log "[removed] VS Code extension tonderaisaidi.klawops"
  else
    warn "[skip]    VS Code extension not installed"
  fi
else
  warn "[skip]    'code' CLI not found — extension not removed"
fi

# ── Find installed skill files ────────────────────────────────────────────────
SKILL_COMMANDS=(
  "research_codebase_generic.md"
  "create_plan_generic.md"
  "implement_plan.md"
  "validate_plan.md"
)
SKILL_AGENTS=(
  "codebase-analyzer.md"
  "codebase-locator.md"
  "codebase-pattern-finder.md"
  "web-search-researcher.md"
)

found_skills=()

for f in "${SKILL_COMMANDS[@]}"; do
  target="${HOME}/.claude/commands/${f}"
  [ -f "$target" ] && found_skills+=("$target")
done

for f in "${SKILL_AGENTS[@]}"; do
  target="${HOME}/.claude/agents/${f}"
  [ -f "$target" ] && found_skills+=("$target")
done

if [ ${#found_skills[@]} -eq 0 ]; then
  warn "[skip]    No KlawOps skill files found in ~/.claude/"
  echo ""
  log "KlawOps uninstalled."
  exit 0
fi

# ── Prompt before removing skills ─────────────────────────────────────────────
echo ""
warn "The following KlawOps skill files will be removed:"
for f in "${found_skills[@]}"; do
  printf "  %s\n" "${f/$HOME/\~}"
done
echo ""

# Guard against being run non-interactively (e.g. piped from curl)
if [ ! -t 0 ]; then
  warn "Skill files were NOT removed (stdin is not a terminal)."
  warn "To remove skills, download and run this script directly:"
  warn "  curl -fsSL https://raw.githubusercontent.com/TassanSaidi/KlawOps/main/uninstall.sh -o uninstall.sh"
  warn "  bash uninstall.sh"
  echo ""
  log "KlawOps extension removed. Skill files remain."
  exit 0
fi

read -rp "Remove these skill files? [y/N] " confirm
echo ""

if [[ "$confirm" =~ ^[Yy]$ ]]; then
  for f in "${found_skills[@]}"; do
    rm -f "$f"
    log "[removed] ${f/$HOME/\~}"
  done
else
  warn "Skill files were not removed."
fi

echo ""
log "KlawOps uninstalled. Restart VS Code to complete removal."

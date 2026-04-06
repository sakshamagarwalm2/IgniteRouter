#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="igniterouter"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()     { echo -e "${GREEN}✓${RESET} $*"; }
info()   { echo -e "${CYAN}→${RESET} $*"; }
warn()   { echo -e "${YELLOW}⚠${RESET} $*"; }
fail()   { echo -e "${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }
header() { echo -e "\n${BOLD}$*${RESET}"; }

MODE="install"
case "${1:-}" in
  --reinstall) MODE="reinstall" ;;
  --update)    MODE="update" ;;
  --uninstall) MODE="uninstall" ;;
  --status)    MODE="status" ;;
  --help|-h)   echo "Usage: bash setup.sh [--reinstall|--update|--uninstall|--status]"; exit 0 ;;
esac

[[ -f "$SCRIPT_DIR/package.json" ]] || fail "Run from IgniteRouter repo root."
cd "$SCRIPT_DIR"

header "Checking Node.js..."
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [[ "$NODE_VERSION" -lt 22 ]]; then
  warn "Node $NODE_VERSION detected. Need 22+."
  if command -v nvm &>/dev/null; then
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm install 22 --no-progress
    nvm use 22
    nvm alias default 22
    ok "Node $(node -v) active"
  else
    fail "nvm not found. Install Node 22+ manually."
  fi
else
  ok "Node v$NODE_VERSION"
fi

header "Checking OpenClaw..."
command -v openclaw &>/dev/null || fail "openclaw not found. Run: npm install -g openclaw"
ok "OpenClaw: $(openclaw --version 2>/dev/null | head -1)"

if [[ "$MODE" == "status" ]]; then
  header "IgniteRouter Status"
  echo ""
  info "Plugin:"
  openclaw plugins list 2>/dev/null | grep -i "$PLUGIN_ID" || echo "  (not installed)"
  echo ""
  info "Default model:"
  openclaw config get agents.defaults.model 2>/dev/null || echo "  (unknown)"
  echo ""
  info "Provider baseUrl:"
  openclaw config get models.providers.ignite.baseUrl 2>/dev/null || echo "  (not configured)"
  echo ""
  info "Proxy port 8402:"
  curl -s --max-time 2 http://127.0.0.1:8402/v1/models > /dev/null 2>&1 \
    && echo "  running ✓" || echo "  not running (normal until gateway starts)"
  exit 0
fi

if [[ "$MODE" == "uninstall" || "$MODE" == "reinstall" ]]; then
  header "Uninstalling $PLUGIN_ID..."
  openclaw plugins uninstall "$PLUGIN_ID" 2>/dev/null || true
  rm -rf "$HOME/.openclaw/extensions/$PLUGIN_ID"
  ok "Removed"
  [[ "$MODE" == "uninstall" ]] && { ok "Done."; exit 0; }
fi

header "Building..."
info "npm install..."
npm install --silent
info "npm run build..."
npm run build 2>&1 | grep -E "Build success|error|Error" || true
ok "Build complete"

header "Installing plugin into OpenClaw..."
INSTALL_FLAGS="--dangerously-force-unsafe-install"
[[ "$MODE" == "update" || "$MODE" == "reinstall" ]] && INSTALL_FLAGS="$INSTALL_FLAGS --force"

openclaw plugins install . $INSTALL_FLAGS 2>&1 \
  | grep -E "Installed plugin|skill|model|smart routing|ERROR" \
  | grep -v "WARNING" \
  | sed 's/^/  /' || true

openclaw plugins list 2>/dev/null | grep -q "$PLUGIN_ID" \
  && ok "Plugin installed and loaded" \
  || fail "Plugin not found after install. Run: openclaw plugins list"

header "Setting default model to ignite/auto..."
openclaw models set ignite/auto 2>/dev/null | grep -i "model\|Default" | head -2 | sed 's/^/  /' || true
ok "Default model: ignite/auto"

header "Restarting gateway..."
openclaw gateway restart 2>&1 | grep -E "Restarted|Error" | sed 's/^/  /' || warn "Gateway restart skipped"
sleep 1

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  IgniteRouter ready!${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════${RESET}"
echo ""
echo -e "  Model : ${CYAN}ignite/auto${RESET}"
echo -e "  Proxy : ${CYAN}http://127.0.0.1:8402/v1${RESET}"
echo -e "  Models: ${CYAN}55+ via IgniteRouter${RESET}"
echo ""
echo -e "  ${BOLD}Commands:${RESET}"
echo -e "  bash setup.sh --status     check status"
echo -e "  bash setup.sh --update     rebuild + reinstall after code changes"
echo -e "  bash setup.sh --reinstall  clean reinstall"
echo -e "  openclaw dashboard         open UI"
echo ""

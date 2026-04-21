#!/usr/bin/env bash
# lean-ctx-light — setup script idempotent
#
# Installe le stack complet de token-optim pour pi :
#   1. Binaire lean-ctx (Rust, compression shell) dans ~/.local/bin/
#   2. Binaire cymbal (Go, code navigator) dans %LOCALAPPDATA%\cymbal\
#   3. Skill cymbal dans ~/.pi/agent/skills/cymbal/
#   4. Micro-extension lean-ctx-light dans ~/.pi/agent/extensions/
#   5. Fix PATH cymbal dans ~/.profile (pour sh -lc) et ~/.bashrc (pour bash interactif)
#
# Re-runnable : chaque étape vérifie si déjà fait.
# Portable : pas de paths hardcodés (utilise $USERPROFILE / $HOME).
#
# Usage :
#   bash ~/.pi/agent/extensions/lean-ctx-light/scripts/install.sh
#
# Windows-only pour l'instant (Git Bash / MINGW). Pour Linux/Mac, adapter les download URLs.

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────
readonly C_INFO='\033[0;36m'    # cyan
readonly C_OK='\033[0;32m'      # green
readonly C_WARN='\033[0;33m'    # yellow
readonly C_ERR='\033[0;31m'     # red
readonly C_OFF='\033[0m'

log()  { printf "${C_INFO}[ ]${C_OFF} %s\n" "$*"; }
ok()   { printf "${C_OK}[✓]${C_OFF} %s\n" "$*"; }
warn() { printf "${C_WARN}[!]${C_OFF} %s\n" "$*"; }
err()  { printf "${C_ERR}[✗]${C_OFF} %s\n" "$*" >&2; exit 1; }

# ── Paths (portable) ─────────────────────────────────────────
PI_EXT_DIR="$HOME/.pi/agent/extensions"
PI_SKILLS_DIR="$HOME/.pi/agent/skills"
LOCAL_BIN="$HOME/.local/bin"

# Windows-specific: cymbal installs to %LOCALAPPDATA%\cymbal (PowerShell installer default)
if [ -n "${USERPROFILE:-}" ]; then
  # Git Bash on Windows
  CYMBAL_DIR="$(cygpath -u "$USERPROFILE")/AppData/Local/cymbal"
else
  err "This installer currently targets Windows Git Bash. USERPROFILE not set — aborting."
fi

# ── Prerequisites ────────────────────────────────────────────
log "Checking prerequisites..."
command -v curl >/dev/null || err "curl not found — install Git for Windows or add curl to PATH"
command -v powershell >/dev/null || err "powershell not found — required for cymbal install"
command -v npm >/dev/null || warn "npm not found — ok if lean-ctx-light uses global pi-coding-agent only"
ok "prerequisites present"

# ── Step 1: lean-ctx binary ──────────────────────────────────
log "Step 1/5: lean-ctx binary"
if command -v lean-ctx >/dev/null && [ -x "$LOCAL_BIN/lean-ctx.exe" ]; then
  CURRENT=$(lean-ctx --version 2>/dev/null | awk '{print $2}' || echo "unknown")
  ok "lean-ctx already installed (v$CURRENT) at $LOCAL_BIN/lean-ctx.exe"
else
  log "  downloading lean-ctx latest release..."
  mkdir -p "$LOCAL_BIN"
  TMP_ZIP="$(mktemp -d)/lean-ctx.zip"
  curl -sL "https://github.com/yvgude/lean-ctx/releases/latest/download/lean-ctx-x86_64-pc-windows-msvc.zip" -o "$TMP_ZIP"
  TMP_ZIP_WIN="$(cygpath -w "$TMP_ZIP")"
  EXTRACT_DIR="$(mktemp -d)"
  EXTRACT_DIR_WIN="$(cygpath -w "$EXTRACT_DIR")"
  powershell -NoProfile -Command "Expand-Archive -Path '$TMP_ZIP_WIN' -DestinationPath '$EXTRACT_DIR_WIN' -Force" >/dev/null
  cp "$EXTRACT_DIR/lean-ctx.exe" "$LOCAL_BIN/"
  rm -rf "$TMP_ZIP" "$EXTRACT_DIR"
  NEW=$("$LOCAL_BIN/lean-ctx.exe" --version | awk '{print $2}')
  ok "lean-ctx installed (v$NEW) at $LOCAL_BIN/lean-ctx.exe"
fi

# ── Step 2: cymbal binary ────────────────────────────────────
log "Step 2/5: cymbal binary"
if [ -x "$CYMBAL_DIR/cymbal.exe" ]; then
  CURRENT=$("$CYMBAL_DIR/cymbal.exe" --version 2>/dev/null | awk '{print $2}' || echo "unknown")
  ok "cymbal already installed ($CURRENT) at $CYMBAL_DIR/cymbal.exe"
else
  log "  installing cymbal via official PowerShell installer..."
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/1broseidon/cymbal/main/install.ps1 | iex" >/dev/null
  if [ -x "$CYMBAL_DIR/cymbal.exe" ]; then
    NEW=$("$CYMBAL_DIR/cymbal.exe" --version | awk '{print $2}')
    ok "cymbal installed ($NEW) at $CYMBAL_DIR/cymbal.exe"
  else
    err "cymbal installation failed — check PowerShell output manually"
  fi
fi

# ── Step 3: cymbal skill ─────────────────────────────────────
log "Step 3/5: cymbal skill for pi"
SKILL_PATH="$PI_SKILLS_DIR/cymbal/SKILL.md"
if [ -f "$SKILL_PATH" ]; then
  ok "cymbal skill already at $SKILL_PATH"
else
  mkdir -p "$PI_SKILLS_DIR/cymbal"
  curl -sL "https://raw.githubusercontent.com/1broseidon/cymbal/main/examples/skills/cymbal/SKILL.md" -o "$SKILL_PATH"
  if [ -s "$SKILL_PATH" ]; then
    ok "cymbal skill installed at $SKILL_PATH"
  else
    rm -f "$SKILL_PATH"
    err "skill download failed (empty file)"
  fi
fi

# ── Step 4: lean-ctx-light micro-extension ───────────────────
log "Step 4/5: lean-ctx-light micro-extension"
EXT_DIR="$PI_EXT_DIR/lean-ctx-light"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"  # parent of scripts/

if [ -f "$EXT_DIR/index.ts" ] && [ -f "$EXT_DIR/core.ts" ]; then
  ok "lean-ctx-light already installed at $EXT_DIR"
else
  log "  copying from $SRC_DIR → $EXT_DIR"
  mkdir -p "$EXT_DIR"
  for f in index.ts core.ts core.test.ts package.json tsconfig.json; do
    if [ -f "$SRC_DIR/$f" ]; then
      cp "$SRC_DIR/$f" "$EXT_DIR/$f"
    fi
  done
  if [ -d "$SRC_DIR/scripts" ]; then
    mkdir -p "$EXT_DIR/scripts"
    cp "$SRC_DIR/scripts/"* "$EXT_DIR/scripts/"
  fi
  if [ -f "$EXT_DIR/package.json" ] && command -v npm >/dev/null; then
    (cd "$EXT_DIR" && npm install --silent >/dev/null 2>&1) && ok "  npm install OK" || warn "  npm install failed (non-fatal)"
  fi
  ok "lean-ctx-light installed at $EXT_DIR"
fi

# ── Step 5: PATH fix for cymbal in sh -lc ────────────────────
log "Step 5/5: PATH fix for cymbal (sh -lc needs ~/.profile)"
PROFILE="$HOME/.profile"
PROFILE_MARKER="# cymbal (code navigator) — PATH fix"

if [ -f "$PROFILE" ] && grep -q "$PROFILE_MARKER" "$PROFILE"; then
  ok "cymbal PATH fix already in $PROFILE"
else
  cat >> "$PROFILE" <<'PROFILE_EOF'

# cymbal (code navigator) — PATH fix for POSIX sh sessions (pi's bash tool uses sh -lc)
# Portable: resolves cymbal dir from USERPROFILE (Windows) via cygpath
if [ -n "$USERPROFILE" ]; then
  _cymbal_dir="$(cygpath -u "$USERPROFILE" 2>/dev/null)/AppData/Local/cymbal"
  if [ -d "$_cymbal_dir" ] && [ "${PATH#*"$_cymbal_dir"}" = "$PATH" ]; then
    export PATH="$_cymbal_dir:$PATH"
  fi
  unset _cymbal_dir
fi
PROFILE_EOF
  ok "cymbal PATH fix added to $PROFILE"
fi

BASHRC="$HOME/.bashrc"
BASHRC_MARKER="# cymbal (code navigator) — PATH fix for Git Bash"

if [ -f "$BASHRC" ] && grep -q "$BASHRC_MARKER" "$BASHRC"; then
  ok "cymbal PATH fix already in $BASHRC"
else
  cat >> "$BASHRC" <<'BASHRC_EOF'

# cymbal (code navigator) — PATH fix for Git Bash sessions (MSYS PATH inheritance quirk)
if [ -n "$USERPROFILE" ]; then
  _cymbal_dir="$(cygpath -u "$USERPROFILE" 2>/dev/null)/AppData/Local/cymbal"
  if [ -d "$_cymbal_dir" ] && [[ ":$PATH:" != *":$_cymbal_dir:"* ]]; then
    export PATH="$_cymbal_dir:$PATH"
  fi
  unset _cymbal_dir
fi
BASHRC_EOF
  ok "cymbal PATH fix added to $BASHRC"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
printf "${C_OK}━━━ Install complete ━━━${C_OFF}\n"
echo ""
echo "Next steps:"
echo "  1. Open a NEW Git Bash terminal (to reload ~/.profile and ~/.bashrc)"
echo "  2. Run: bash $SCRIPT_DIR/doctor.sh    # verify installation"
echo "  3. Launch pi — you'll see the extension active when you use bash commands"
echo ""
echo "Verification (in pi session):"
echo "  bash { command: \"git status\" }          # should have footer [lean-ctx: X→Y tok]"
echo "  bash { command: \"git diff HEAD~1\" }     # should be RAW (no footer)"
echo "  bash { command: \"cymbal structure\" }    # should be RAW and structured"
echo ""
echo "⚠️  IMPORTANT: never run 'lean-ctx update' — it re-modifies .bashrc silently."
echo "   To update: delete $LOCAL_BIN/lean-ctx.exe and re-run this script."

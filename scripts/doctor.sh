#!/usr/bin/env bash
# lean-ctx-light — diagnostic script
#
# Verifies the token-optim setup is correctly configured.
# Returns exit 0 if all checks pass, non-zero if any fail.
#
# Usage:
#   bash ~/.pi/agent/extensions/lean-ctx-light/scripts/doctor.sh

set -uo pipefail

readonly C_OK='\033[0;32m'
readonly C_WARN='\033[0;33m'
readonly C_ERR='\033[0;31m'
readonly C_OFF='\033[0m'

PASS=0
WARN=0
FAIL=0

pass() { printf "${C_OK}[✓]${C_OFF} %s\n" "$*"; PASS=$((PASS+1)); }
warn() { printf "${C_WARN}[!]${C_OFF} %s\n" "$*"; WARN=$((WARN+1)); }
fail() { printf "${C_ERR}[✗]${C_OFF} %s\n" "$*"; FAIL=$((FAIL+1)); }

echo "━━━ lean-ctx-light doctor ━━━"
echo ""

# ── Binaries ─────────────────────────────────────────────────
echo "[Binaries]"
if command -v lean-ctx >/dev/null; then
  V=$(lean-ctx --version 2>/dev/null | awk '{print $2}' || echo "?")
  pass "lean-ctx v$V in PATH"
else
  fail "lean-ctx NOT in PATH"
fi

if command -v cymbal >/dev/null; then
  V=$(cymbal --version 2>/dev/null | awk '{print $2}' || echo "?")
  pass "cymbal $V in PATH"
elif [ -n "${USERPROFILE:-}" ] && [ -x "$(cygpath -u "$USERPROFILE")/AppData/Local/cymbal/cymbal.exe" ]; then
  warn "cymbal binary exists but NOT in current PATH (open a new terminal)"
else
  fail "cymbal NOT found"
fi

# ── sh -lc inheritance (critical for the micro-extension) ───
echo ""
echo "[Shell inheritance]"
if sh -lc "command -v lean-ctx >/dev/null" 2>/dev/null; then
  pass "sh -lc can reach lean-ctx (micro-extension will work)"
else
  fail "sh -lc cannot reach lean-ctx — bash wrapping will fail"
fi

if sh -lc "command -v cymbal >/dev/null" 2>/dev/null; then
  pass "sh -lc can reach cymbal"
else
  fail "sh -lc cannot reach cymbal — check ~/.profile has the cymbal PATH fix"
fi

# ── Extension files ──────────────────────────────────────────
echo ""
echo "[pi extension files]"
EXT_DIR="$HOME/.pi/agent/extensions/lean-ctx-light"
for f in index.ts core.ts package.json; do
  if [ -f "$EXT_DIR/$f" ]; then
    pass "$EXT_DIR/$f"
  else
    fail "$EXT_DIR/$f MISSING"
  fi
done

if [ -d "$EXT_DIR/node_modules" ]; then
  pass "$EXT_DIR/node_modules/ (dependencies installed)"
else
  warn "$EXT_DIR/node_modules/ missing — run 'npm install' inside the extension dir"
fi

# ── Skill ────────────────────────────────────────────────────
echo ""
echo "[pi skills]"
SKILL="$HOME/.pi/agent/skills/cymbal/SKILL.md"
if [ -f "$SKILL" ] && [ -s "$SKILL" ]; then
  pass "cymbal skill at $SKILL"
else
  fail "cymbal skill MISSING at $SKILL"
fi

# ── Shell rc files ───────────────────────────────────────────
echo ""
echo "[Shell configuration]"
if [ -f "$HOME/.profile" ] && grep -q "cymbal (code navigator)" "$HOME/.profile"; then
  pass "~/.profile has cymbal PATH fix"
else
  fail "~/.profile missing cymbal PATH fix (sh -lc won't find cymbal)"
fi

if [ -f "$HOME/.bashrc" ] && grep -q "cymbal (code navigator)" "$HOME/.bashrc"; then
  pass "~/.bashrc has cymbal PATH fix"
else
  warn "~/.bashrc missing cymbal PATH fix (interactive terminal won't have cymbal)"
fi

# ── Hygiene: no lean-ctx shell hook pollution ────────────────
echo ""
echo "[Hygiene — no lean-ctx shell hook in .bashrc/.profile]"
if [ -f "$HOME/.bashrc" ] && grep -qi "lean-ctx shell hook\|lean-ctx agent aliases" "$HOME/.bashrc"; then
  warn "~/.bashrc has leftover lean-ctx shell hook — did 'lean-ctx update' run recently?"
  warn "  Restore from: $HOME/.bashrc.lean-ctx.bak (if present)"
  warn "  NEVER run 'lean-ctx update/setup/init/doctor --fix' — they mutate .bashrc"
else
  pass "~/.bashrc clean (no lean-ctx shell hook pollution)"
fi

if [ -f "$HOME/.bashenv" ] || [ -f "$HOME/.zshenv" ]; then
  warn "~/.bashenv or ~/.zshenv present (lean-ctx setup artifacts — can be deleted)"
else
  pass "no ~/.bashenv / ~/.zshenv parasites"
fi

# ── Test suite ───────────────────────────────────────────────
echo ""
echo "[Tests (optional)]"
if [ -f "$EXT_DIR/package.json" ] && command -v npm >/dev/null && [ -d "$EXT_DIR/node_modules" ]; then
  if (cd "$EXT_DIR" && npm test >/dev/null 2>&1); then
    pass "npm test passes (79 tests)"
  else
    fail "npm test failed — check output with: cd $EXT_DIR && npm test"
  fi
else
  warn "skipping test check (node_modules not installed)"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "━━━ Summary ━━━"
printf "${C_OK}%d passed${C_OFF}, ${C_WARN}%d warnings${C_OFF}, ${C_ERR}%d failed${C_OFF}\n" "$PASS" "$WARN" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Fix failures, then run doctor again."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo ""
  echo "Setup functional but has warnings. Review above."
  exit 0
else
  echo ""
  echo "Setup is clean."
  exit 0
fi

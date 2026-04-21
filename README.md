# lean-ctx-light

[![CI](https://github.com/zrmzur24/lean-ctx-light/actions/workflows/ci.yml/badge.svg)](https://github.com/zrmzur24/lean-ctx-light/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-7c3aed)](https://github.com/mariozechner/pi)

pi micro-extension that routes bash output through [lean-ctx](https://github.com/yvgude/lean-ctx) for 60-90% token compression, with hardcoded exclusions for content-critical commands. Pairs with [cymbal](https://github.com/1broseidon/cymbal) for semantic code navigation.

**Target audience**: AI agents (Claude, pi, etc.) operating on Windows with Git Bash. The entire file exists to save them tokens.

## Quick install

```bash
# Clone into pi extensions dir
git clone https://github.com/zrmzur24/lean-ctx-light.git ~/.pi/agent/extensions/lean-ctx-light

# Run the idempotent setup script (installs lean-ctx + cymbal binaries + skill + PATH)
bash ~/.pi/agent/extensions/lean-ctx-light/scripts/install.sh

# Open a new Git Bash terminal (reloads ~/.profile)
# Verify:
bash ~/.pi/agent/extensions/lean-ctx-light/scripts/doctor.sh
```

Or via pi's git package mechanism (once released):
```bash
pi install git:github.com/zrmzur24/lean-ctx-light
```

---

## Why this instead of `pi-lean-ctx`?

The official `pi-lean-ctx` npm package provides tool overrides AND an MCP bridge exposing 46 tools (`ctx_read`, `ctx_shell`, `ctx_diff`, ...). Those 46 tools add ~3000-4000 tokens to every system prompt.

For our use case (output compression only), the MCP bridge is redundant — the tool override alone achieves the goal. So this micro-extension does just one thing: override the `bash` tool with a `spawnHook` that wraps commands via `lean-ctx -c sh -lc "..."`.

Size comparison:
| Setup | Prompt tokens added | MCP tools | Maintenance |
|---|---|---|---|
| `pi-lean-ctx` (official) | ~3500 | 46 | npm package updates |
| `lean-ctx-light` (this) | ~0 | 0 | 3 local files |

---

## Hardcoded exclusions (kept RAW, no compression)

```ts
// core.ts
export const EXCLUDED = /^\s*(
  git\s+(diff|show|log)           // content-critical for review/audit
  |cymbal                          // already optimized, avoid double-processing
  |LEAN_CTX_DISABLED=              // explicit kill-switch
  |(npm\s+run\s+)?(vitest|tsc|eslint|lint|typecheck)\b   // test runners (FAIL detection)
  |(npx\s+)?(vitest|tsc|eslint)\b
)/
```

Chained commands (`cd X && cymbal Y`) are handled via `isExcluded()` which splits on `&&`, `;`, `|`, `||`, `\n` and excludes if **any** segment matches.

Rationale for each exclusion: see [rtk-test adversarial study](https://www.reddit.com/r/ClaudeCode/comments/1spiy8t/) — token optimizers can strip code content from diffs (reducing `git diff` to `file +1/-1`), making code review structurally impossible.

---

## Installation

```bash
bash ./scripts/install.sh
```

Idempotent. Installs:
1. `lean-ctx` binary v3+ into `~/.local/bin/`
2. `cymbal` binary v0.11+ into `%LOCALAPPDATA%\cymbal\`
3. cymbal skill into `~/.pi/agent/skills/cymbal/SKILL.md`
4. This extension into `~/.pi/agent/extensions/lean-ctx-light/`
5. PATH fix for cymbal in `~/.profile` (needed for `sh -lc`) and `~/.bashrc`

After install, **open a new Git Bash terminal** (to reload `~/.profile`) before launching pi.

Verify:
```bash
bash ./scripts/doctor.sh
```

---

## Architecture

```
lean-ctx-light/
├── index.ts         # pi extension entry (factory function, default export)
├── core.ts          # pure utilities: EXCLUDED regex, shellQuote, detectRuntime, isExcluded
├── core.test.ts     # 79 unit tests (node:test + tsx)
├── package.json     # pi.extensions config + tsx/typescript devDeps
├── tsconfig.json    # ES2022 NodeNext strict
├── node_modules/    # npm install output (pi auto-resolves)
└── scripts/
    ├── install.sh   # idempotent setup (binaries + ext + skill + PATH)
    └── doctor.sh    # diagnostic checks (binaries, PATH, files, tests)
```

Pi loads only `index.ts` (via `pi.extensions` in package.json). Other files are modules.

### Data flow

```
pi agent calls bash { command: "git status" }
          │
          ▼
  tool_call event  ──►  mcmg-workflow push-guard (if loaded)
          │                   │
          │                   └─► blocks critical nested wrappers
          ▼
  spawnHook (this extension)
          │
          ├─ isExcluded(cmd)?  ──► yes ──► pass-through, no compression
          │                    └─► no ──► wrap: lean-ctx -c sh -lc 'cmd'
          │
          ▼
   command executes
          │
          ▼
   output returned (with footer [lean-ctx: X→Y tok, -Z%] if compressed)
```

---

## Gotchas (learned the hard way)

### ⚠️ NEVER run `lean-ctx update` / `setup` / `init`

These commands **rewrite `~/.bashrc`** with ~100 lines of shell hook aliases (`git`, `npm`, `docker`, etc.) — **no opt-out flag**. They also create `~/.bashenv`, `~/.zshenv`, and `~/.lean-ctx/shell-hook.bash`.

Impact: your interactive terminal starts compressing output everywhere, which is NOT what we want (this extension handles pi-level wrapping only).

To update `lean-ctx`:
```bash
# Download latest binary manually from GitHub releases
curl -sL "https://github.com/yvgude/lean-ctx/releases/latest/download/lean-ctx-x86_64-pc-windows-msvc.zip" -o /tmp/lc.zip
powershell -Command "Expand-Archive -Path '$(cygpath -w /tmp/lc.zip)' -DestinationPath '$(cygpath -w /tmp/lc-extract)' -Force"
cp /tmp/lc-extract/lean-ctx.exe ~/.local/bin/
```

Or re-run `./scripts/install.sh` which does this automatically.

### ⚠️ Cymbal PATH quirk on Git Bash

PowerShell's `SetEnvironmentVariable("User")` modifies the Windows registry but **does not propagate** to already-open Git Bash sessions. Additionally, `sh -lc` (what this extension uses to wrap commands) sources `~/.profile`, **not** `~/.bashrc`.

The install script adds cymbal to both `~/.profile` (for `sh -lc`) and `~/.bashrc` (for interactive use). If you skip this, `cymbal` won't be found when pi runs bash commands.

### ⚠️ bash hash cache

After adding a binary to PATH, bash may still cache the old "not found" lookup. Run `hash -r` to reset, or open a new shell.

### ⚠️ Multi-file extensions in pi

Pi auto-loads every `*.ts` in `~/.pi/agent/extensions/` as an extension. Multi-file extensions MUST live in a subdirectory with `index.ts` as entry point, otherwise pi crashes trying to load `core.ts` / `core.test.ts` as extensions (they lack a default factory export).

That's why this extension lives at `extensions/lean-ctx-light/index.ts` (not `extensions/lean-ctx-light.ts`).

---

## Uninstall

```bash
# Remove extension
rm -rf ~/.pi/agent/extensions/lean-ctx-light

# Remove skill
rm -rf ~/.pi/agent/skills/cymbal

# Remove binaries
rm -f ~/.local/bin/lean-ctx.exe
powershell -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/1broseidon/cymbal/main/uninstall.ps1))) -Purge"

# Remove PATH entries (edit manually to delete the cymbal blocks)
# In ~/.profile and ~/.bashrc, delete the blocks starting with:
#   # cymbal (code navigator) — PATH fix

# Reload shell
source ~/.bashrc
```

---

## Testing

```bash
npm install  # once
npm test     # 79 tests: EXCLUDED regex, shellQuote, detectRuntime, isExcluded, buildWrappedCommand
npm run typecheck
```

Tests are autonomous (no dependency on external projects — only `tsx` + `typescript` + `@mariozechner/pi-coding-agent` as devDeps in this dir).

---

## Design doc

For the full rationale including the adversarial analysis of token optimizers, compatibility matrix, and mcmg-workflow integration, see:

`mcmg2/docs/plans/2026-04-20-token-optim-setup-design.md`

---

## Contract with `pi-coding-agent` API

- `createBashToolDefinition(cwd, { spawnHook })` — stable since pi v0.58.3
- `spawnHook: ({ command, cwd, env }) => { command, cwd, env }` — can modify any field

If pi changes this signature, the extension will fail at load time. `detectRuntime()` will still return a sensible state (can't distinguish API breakage from missing binary).

Minimum pi version: **0.58.3** (`^0.67.0` in package.json devDeps for type checking, but the runtime API is older).

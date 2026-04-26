# Changelog

All notable changes to `lean-ctx-light` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

Nothing yet.

## [1.0.5] — 2026-04-25

Re-adds pi's truncation note to the `bash` tool description — a regression
introduced when v1.0.2 first replaced the description.

### Background

pi's default `bash` tool description includes a sentence about output
truncation:

> Output is truncated to last 2000 lines or 50KB (whichever is hit first).
> If truncated, full output is saved to a temp file.

This is **not just visual**. pi applies `truncateTail()` to the output and
the LLM literally never sees the dropped portion (the temp log file is for
the human user only — the LLM doesn't receive its contents).

When this extension started overriding the `bash` description in v1.0.2 to
advertise the lean-ctx exception list, that truncation note got dropped —
so the LLM stopped seeing it and could be surprised when verbose commands
like `npm test` returned only the last ~2000 lines.

### Added

- Truncation note re-added to **both** the active and inactive description
  branches. Numbers are imported from `pi-coding-agent`'s
  `DEFAULT_MAX_LINES` / `DEFAULT_MAX_BYTES` constants — if pi ever changes
  them, this description follows automatically.

  The new active description now ends with:

  > Output is truncated to the last 2000 lines or 50KB (pi-native
  > truncateTail, applied AFTER any lean-ctx compression); the full output
  > is saved to a temp log file visible to the user only (the LLM does not
  > receive the temp file path's contents automatically). For very verbose
  > runs, filter explicitly via `| tail -N`, `| head -N`, `| grep PATTERN`,
  > `2>&1 | grep -E "FAIL|error"`, etc.

### Cost

+85 tokens in the system prompt per session (description goes from ~75
to ~160 tokens). Static cost, paid once per turn regardless of bash usage.
Worth it: the LLM now proactively filters very verbose commands instead
of being surprised by truncation.

### Tests

- 138 unit tests still pass (description content is a constant, not
  exercised by unit tests — string-only change).
- Typecheck green (new `DEFAULT_MAX_LINES` / `DEFAULT_MAX_BYTES` imports
  resolve cleanly from `pi-coding-agent`).

### Why this is its own release (not folded into v1.0.6 or similar)

Keeping the change focused makes it trivial to revert if the +85 tokens
turn out to be unwanted, or if pi changes its truncation defaults in a
breaking way. Diff is ~20 lines, contained to `index.ts`.

## [1.0.4] — 2026-04-24

Adds `grep`, `egrep`, `fgrep`, `rg` and `git grep` to the RAW exception list.
Data-driven decision: these tools accounted for **48 % of the remaining
kill-switches** and **39 % of the remaining destructive outputs** in sessions
run under v1.0.3.

### Added

- **5 new `EXCLUDED` patterns** — kept RAW:
  - `grep` / `egrep` / `fgrep` — all start-of-segment, with word boundary
    (`pgrep`, `grepme`, filenames containing "grep" still compress normally).
  - `rg` (ripgrep) — same rules.
  - `git grep` — folded into the existing `git (diff|show|log|grep)`
    alternative, for ergonomic consistency with other git exclusions.

### Rationale

Lean-ctx's default compression pass deduplicates consecutive identical /
similar lines and then shows only the **last 15 unique lines**. On `grep`
output of the form

```
src/a.ts:12:import { Foo } from '…';
src/a.ts:44:  const x = new Foo();
src/b.ts:7:import { Foo } from '…';
…
```

this pass is structurally wrong — every line is unique, yet the compressor
still drops the top-N and emits `40 lines → 40 unique / last 15 unique lines`.
The agent loses the leading matches and has to re-run with
`LEAN_CTX_DISABLED=1`. Empirically that's exactly what was happening.

### Measurement (12 sessions, 1023 bash commands, post-v1.0.3)

| Source              | Before v1.0.4 | Root cause                   |
| ------------------- | ------------- | ---------------------------- |
| `grep/rg` kill-switches (preemptive) | 24  | agents learnt to preempt     |
| `grep/rg` kill-switches (retry)      | 5   | agents didn't learn, retried |
| destructive grep outputs (no kill-switch) | 11 | agents kept broken output |
| **Total grep-related friction** | **40 / 60** | — |

After v1.0.4, every one of those 40 events happens automatically, zero
agent-side syntax needed.

### Edge cases

- `pgrep` (process grep, output is PIDs — compression fine) is NOT excluded.
- `rgrep` (synonym of `grep -r`, niche) is NOT excluded; users typically
  write `grep -r` which IS excluded. Documented in tests as an acceptable miss.
- `grep -c` (counts only, tiny output) IS excluded — chose consistency over
  micro-optimisation (word-boundary would be ugly and `grep -c` is rare).

### What this release explicitly does NOT do

Based on the same 12-session analysis:

- **`cat` / `head` / `tail` are NOT excluded.** Only 8 events (4 preemptive
  + 4 retries). Blanket exclusion would kill compression on legitimate
  `cat big.log`, and the right fix for reading source files is the pi `Read`
  tool, not `cat`.
- **No cymbal-nudge hook.** 0 cymbal uses across 22 sessions despite the
  global `~/.pi/agent/AGENTS.md` pointing at it — passive guidance has
  empirically failed. Active enforcement is a separate design question
  (being thought about after this release).
- **No upstream patch on `yvgude/lean-ctx` for `--no-dedup`.** Out of this
  repo's control; may be pursued separately if the remaining 17 non-grep
  destructive outputs become a problem.

### Tests

- 22 new unit tests in `core.test.ts` (17 positive, 5 edge-case negatives).
- 138 total, 0 failures. Typecheck green.
- TDD workflow: tests written first, confirmed 16 failures on v1.0.3 regex
  before `EXCLUDED` was updated.

### Changed

- `bash` tool description updated to list the new exceptions
  (`git diff/show/log/grep` + `grep/egrep/fgrep/rg`).
- Regex alternative `git\s+(diff|show|log)` extended to
  `git\s+(diff|show|log|grep)`.

## [1.0.3] — 2026-04-23

Trim the `session_start` reminder to a single line, migrate the cymbal
navigation guidance out to an opt-in rules file, and add a diagnostic script
for measuring friction over time.

### Changed

- **`session_start` reminder reduced from ~130 tokens to ~25 tokens.**
  The v1.0.2 reminder repeated the full list of RAW exceptions and the
  cymbal navigation rules. Both turned out to be redundant:
  - The RAW exception list is already in the `bash` tool description —
    no need to duplicate it in the conversation history.
  - The cymbal "prefer over grep" guidance is now owned by an opt-in
    `~/.pi/rules/cymbal.md` file (created by a sibling effort). Rules
    files live in the system prompt — they don't get compacted away
    on long sessions, unlike `CustomMessageEntry` payloads.

  The new reminder keeps only the **kill-switch discoverability helper**:

  ```
  [lean-ctx-light] To force RAW output on any bash command, prefix it
  with `LEAN_CTX_DISABLED=` (e.g. `LEAN_CTX_DISABLED=1 cat big.log`).
  ```

  Data from `scripts/analyze-sessions.py` (10 sessions, 1311 bash calls,
  pre-v1.0.2) showed **233 preemptive `LEAN_CTX_DISABLED=1` uses** —
  agents kept reinventing the syntax because the tool description alone
  mentioned it only as `LEAN_CTX_DISABLED=` without an example. A single
  example closes that discoverability gap cheaply.

- **`customType` kept stable (`lean-ctx-light/discipline-reminder`)** so
  that a session already holding a v1.0.2 verbose reminder does NOT get
  a duplicate injection on `/reload` — dedupe via
  `ctx.sessionManager.getEntries()` still works. The old verbose entry
  remains visible in that session's history (harmless historical
  artifact); fresh sessions get the short form.

### Added

- **`scripts/analyze-sessions.py`** — diagnostic that scans session JSONL
  files under `~/.pi/agent/sessions/*` and classifies bash commands into
  retry-after-silent-failure, preemptive kill-switch, destructive
  compression outputs, and grep-on-identifier (cymbal candidates). Used
  to produce the data cited above. Re-run after 1–2 weeks to measure the
  impact of v1.0.2 + v1.0.3 + the MCP server removal done in the same
  wave. Contributed by a sibling agent — see PR history.

### Rationale / context

This release is part of a three-pronged wave:

1. **Remove the `lean-ctx` MCP server** from `~/.pi/agent/mcp.json`
   (~6600 tokens of system-prompt pollution, 0 calls on 1311 bash
   commands). Not code in this repo — local config change.
2. **Create `~/.pi/rules/cymbal.md`** — cross-project, permanent guidance
   to prefer `cymbal` over `grep -rn` / `rg` for code navigation. Not
   code in this repo either.
3. **This release** — trim the now-redundant session-start reminder to
   a single actionable line.

Together the three changes should free ~6600 tokens/turn of system prompt
budget, eliminate the `ctx_read vs Read` tool-family confusion, and drop
the session reminder cost from ~150 to ~25 tokens per session.

### Tests

- 116 unit tests still pass (content of the reminder is a constant, not
  exercised by unit tests — the reminder behaviour is behavioural and
  was verified manually in a fresh pi session).
- Typecheck clean.
- Rollout plan: merge → tag → release → `git pull` in
  `~/.pi/agent/extensions/lean-ctx-light` → `/reload` pi.

## [1.0.2] — 2026-04-21

Closes 6 `EXCLUDED` gaps surfaced by reproducible testing against real agent
workflows, and adds a universal cymbal + lean-ctx discipline reminder at
`session_start` so the agent stops defaulting to grep/find for code navigation.

### Added

- **6 new `EXCLUDED` patterns** — commands that were compressed-in-error in
  v1.0.1 are now kept RAW:
  - `npm test` / `npm run test` / `npm run test:unit` — npm test shortcut
    and scoped variants (previously only `npm run vitest/tsc/eslint/…` matched).
  - `node --test` — native Node test runner, with `--test` flag detected
    anywhere in the arg list (e.g. `node --import tsx --test file.test.ts`).
  - `diff` — GNU/POSIX `diff` (content-critical like `git diff`).
  - `jq` / `yq` — JSON/YAML processors; structured output must not be reflowed.
  - Any command containing `--json` as a standalone flag (e.g.
    `gh pr view 123 --json number`, `curl --json '{…}'`). This is the first
    exclusion that is NOT start-of-segment anchored — see `EXCLUDED_CONTAINS`
    below.

- **`EXCLUDED_CONTAINS` regex (new export in `core.ts`)** — matches flags that
  force RAW output regardless of where they appear in the segment. Currently
  covers `--json`. `isExcluded()` now tests both `EXCLUDED` (prefix-anchored)
  and `EXCLUDED_CONTAINS` (anywhere) per segment.

- **Session-start discipline reminder (`index.ts`)** — when runtime is active,
  injects one `CustomMessageEntry` per session via `pi.sendMessage(…, {
  customType: "lean-ctx-light/discipline-reminder", display: true })`:
  - Reminds the agent to use `cymbal investigate|trace|impact|callers|callees`
    for symbol navigation instead of grep/find.
  - Lists the current RAW exceptions and the `LEAN_CTX_DISABLED=` escape.
  - Deduplicated by scanning `ctx.sessionManager.getEntries()` for prior
    entries with the same `customType`, so reload/resume/fork don't re-inject.
  - Gated on `detectRuntime()` — if lean-ctx isn't reachable, the pre-existing
    warning toast fires instead (no reminder noise when compression is off).
  - Root cause fixed: pi skills are lazy-loaded, so without an explicit nudge
    the LLM never discovers cymbal. Shipping the nudge with the compression
    extension keeps it universal — no project-specific AGENTS.md edits needed.

### Changed

- Updated `bash` tool description to list the full RAW exception set
  (v1.0.1 omitted `npm test`, `node --test`, `diff`, `jq`, `yq`, `--json`).
- `index.ts` rewritten with proper `ExtensionContext` typing (previous
  `as unknown` cast on the session_start handler removed).

### Tests

- 37 new tests in `core.test.ts` covering each gap (positive + negative
  + edge cases). 116 tests total, 0 failures. Typecheck green.
- TDD-for-bugs workflow: tests were written first and confirmed failing
  against v1.0.1 before `EXCLUDED`/`EXCLUDED_CONTAINS` were changed.

### Design decisions

- **`sendMessage` over `appendEntry` for the reminder** — `appendEntry`
  creates `CustomEntry` (state only, not visible, not in LLM context).
  `sendMessage(display: true)` creates `CustomMessageEntry` which is
  rendered in history AND injected into LLM context. The whole point of
  the reminder is for the LLM to see it, so `sendMessage` is the correct
  choice.
- **Dedupe by `customType` scan, not by `reason` gate** — a reason gate
  (`reason === "new" || "startup"`) is brittle because pi auto-resumes
  can fire `"startup"` on a session that already has the reminder.
  Scanning `getEntries()` is O(n) on the existing session length but
  completely accurate.
- **Rejected: per-project `.lean-ctx-ignore` config** — YAGNI. The 6 new
  patterns are universal (every Node project has `npm test`, every repo
  has `git diff`), so a config layer adds complexity with no gain.
- **Rejected: cymbal-nudge regex hook on every grep call** — too many
  false positives (legitimate grep for log patterns etc). One reminder
  per session is enough.

### Verified compatible with

- pi v0.68.0 (unchanged contract: `createBashToolDefinition` + `spawnHook`
  + `pi.sendMessage` + `ctx.sessionManager.getEntries`).

## [1.0.1] — 2026-04-21

Compatibility verification with pi v0.68.0 (released 2026-04-20). No code
changes — the existing implementation already uses the stable factory API.

### Verified compatible with

- pi v0.67.68 (current latest of 0.67.x line)
- pi v0.68.0 (new latest, breaking changes analyzed below)

### pi v0.68.0 breaking changes — impact analysis

The 0.68.0 release removed the cwd-bound prebuilt tool exports
(`readTool`, `bashTool`, `editTool`, etc.) in favor of the explicit
factory form (`createReadTool(cwd)`, `createBashTool(cwd)`). It also
changed the SDK `createAgentSession({ tools })` to accept `string[]`
names instead of `Tool[]` instances, and removed ambient `process.cwd()`
fallback from `DefaultResourceLoader` / `loadProjectContextFiles()` /
`loadSkills()`.

None of these affect this extension:
- `createBashToolDefinition(cwd, { spawnHook })` — still exported, API
  unchanged (the factory form this extension has always used).
- SDK `createAgentSession` — not used by this extension (Extension API
  `pi.registerTool()` used instead).
- Resource helpers — not used.

### Bug fixes in pi 0.67.68 / 0.68.0 that benefit us

- Shell-path resolution (#3452, 0.67.68) — shell commands now follow the
  active session cwd instead of the launcher cwd, improving behavior
  when pi runs long sessions or `/cd` is used.
- `tool_result` / `afterToolCall` error forwarding (#3051, 0.67.68) —
  `details` and `isError` overrides no longer silently dropped on error
  tool results. Benefits mcmg-workflow (which has `tool_result` hooks).
- `@sinclair/typebox` runtime dependency (#3434, 0.67.68) — strict pnpm
  installs no longer crash. Not relevant here (we don't use typebox) but
  good for the ecosystem.

### Changed

- `package.json` devDep constraint relaxed from `^0.67.0` to `>=0.58.3`
  to include v0.68.0 and future versions. The runtime contract we rely
  on (`createBashToolDefinition` + `spawnHook`) has been stable since
  v0.58.3 and is still current in v0.68.0.
- CI matrix will pick up the latest pi version on each run (via `npm ci`
  resolving the `>=0.58.3` range). This catches breakage early.

### Tests

- Re-ran 79 unit tests + typecheck against pi v0.68.0: all green.
- No test changes needed (we test pure functions, not the pi runtime).

## [1.0.0] — 2026-04-21

Initial public release. Extracted from a personal pi setup after being
validated on Windows MINGW/Git Bash with extensive adversarial testing.

### Added

- **pi extension `index.ts`** — overrides the `bash` tool via `spawnHook`
  to wrap commands in `lean-ctx -c sh -lc '<cmd>'` with hardcoded exclusions
  for content-critical commands.

- **Core utilities (`core.ts`)**:
  - `EXCLUDED` regex — hardcoded exclusions for `git diff/show/log`,
    `cymbal`, `LEAN_CTX_DISABLED=` prefix, and test runners
    (`vitest`, `tsc`, `eslint`, `lint`, `typecheck` — bare + `npm run`
    + `npx` variants).
  - `isExcluded(cmd)` — splits on `&&|;|||\|\|\n` and tests each
    segment. Handles chained commands like `cd /repo && cymbal investigate X`.
  - `shellQuote(str)` — POSIX single-quote escaping for embedding
    arbitrary commands in `sh -lc '...'`.
  - `detectRuntime()` — at-load check for `lean-ctx` and `sh` binaries.
    Returns `{ leanCtx, sh, reason }` for graceful degradation.
  - `buildWrappedCommand(cmd, active)` — composes the above into the
    final command string.

- **Test suite** (`core.test.ts`) — 79 unit tests via `node:test` + `tsx`:
  - 47 tests for `EXCLUDED` (positive, negative, edge cases)
  - 8 tests for `shellQuote` (quoting correctness, POSIX escaping)
  - 9 tests for `isExcluded` (multi-segment detection)
  - 3 tests for `detectRuntime` (smoke test)
  - 6 tests for `buildWrappedCommand` (integration)
  - Plus header/structural tests

- **Install/diagnostic scripts**:
  - `scripts/install.sh` — idempotent 5-step setup (binaries + extension
    + skill + PATH) with re-run detection.
  - `scripts/doctor.sh` — 14 diagnostic checks covering binaries, PATH,
    shell inheritance, extension files, skills, hygiene (no lean-ctx
    shell hook pollution), tests.

- **Documentation**:
  - `README.md` — rationale, install, architecture, 4 critical gotchas,
    uninstall, testing, API contract.
  - `CHANGELOG.md` — this file.
  - `LICENSE` — MIT.

- **Build configuration**:
  - `package.json` — declares `pi.extensions: ["./index.ts"]`, devDeps
    for autonomous testing (`tsx`, `typescript`, `@mariozechner/pi-coding-agent`).
  - `tsconfig.json` — ES2022 NodeNext strict.

### Design decisions

- **No MCP bridge** — rejected the official `pi-lean-ctx` package (46 MCP
  tools, ~3500 prompt tokens) in favor of a minimal bash-only override.
- **Hardcoded EXCLUDED list** — chose code over config for reliability
  (no config.toml parsing edge cases).
- **Multi-segment exclusion** — `isExcluded()` handles real-world chained
  commands that naive start-of-string matching would miss.
- **`sh -lc` wrapping** — portable across Git Bash, Linux, macOS. Sources
  `~/.profile` so PATH fixes propagate.

### Known limitations

- **Windows-only installer** — `scripts/install.sh` downloads Windows
  binaries and uses `powershell` for cymbal install. Linux/macOS support
  would require adapting the download URLs and install paths.
- **No auto-update for lean-ctx** — update is manual (see README).
  `lean-ctx update` command is explicitly forbidden because it rewrites
  `.bashrc` without opt-out.
- **Coupled to `sh -lc` availability** — graceful degradation via
  `detectRuntime()`, but no active bash-based fallback.

### Relationship to other projects

- Pairs with [cymbal](https://github.com/1broseidon/cymbal) for semantic
  code navigation (unchanged, external dependency).
- Pairs with [lean-ctx](https://github.com/yvgude/lean-ctx) for output
  compression (unchanged, external dependency).
- Pinned minimum `@mariozechner/pi-coding-agent` version: 0.58.3
  (when `spawnHook` option was introduced). Tested against 0.67.x.

### Adversarial-tested against

- The [TheDecipherist rtk-test](https://www.reddit.com/r/ClaudeCode/comments/1spiy8t/)
  findings: `git diff/show/log` excluded to prevent the "file +1/-1"
  compression bug. `docker ps`, `df`, `pytest xfail` not relevant for
  TypeScript/React/Hono stacks but excluded where applicable.

[Unreleased]: https://github.com/zrmzur24/lean-ctx-light/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.5
[1.0.4]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.4
[1.0.3]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.3
[1.0.2]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.2
[1.0.1]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.1
[1.0.0]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.0

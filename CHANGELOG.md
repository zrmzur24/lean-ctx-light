# Changelog

All notable changes to `lean-ctx-light` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/zrmzur24/lean-ctx-light/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.1
[1.0.0]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.0

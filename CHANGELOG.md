# Changelog

All notable changes to `lean-ctx-light` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/zrmzur24/lean-ctx-light/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zrmzur24/lean-ctx-light/releases/tag/v1.0.0

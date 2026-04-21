# Contributing

This project is primarily consumed by AI agents (and their humans). The
contribution style is pragmatic: small PRs, clear commit messages,
evidence over assertions.

## Development setup

```bash
git clone https://github.com/zrmzur24/lean-ctx-light.git
cd lean-ctx-light
npm install
npm run typecheck
npm test          # should show 79 tests passing
```

## Local install for testing

```bash
# Link this working copy into pi's extensions dir
ln -s "$(pwd)" ~/.pi/agent/extensions/lean-ctx-light

# Or copy (if symlink not supported):
cp -r . ~/.pi/agent/extensions/lean-ctx-light

# /reload in pi
```

Changes to `index.ts` / `core.ts` are hot-reloaded by pi's jiti loader.
No restart required for most changes.

## Testing changes

Two layers:

1. **Unit tests** (`core.test.ts`) — fast, pure logic:
   ```bash
   npm test
   ```

2. **Runtime validation** — launch pi, verify behavior:
   ```bash
   # Inside pi:
   bash { command: "git status" }          # expect compressed
   bash { command: "git diff HEAD~1" }     # expect RAW
   bash { command: "cymbal --version" }    # expect RAW
   bash { command: "cd /some/repo && cymbal investigate X" }  # expect RAW
   ```

Add unit tests for any regex change. The `EXCLUDED` and `isExcluded`
logic is load-bearing — a wrong match there means either the compression
is bypassed (lost token savings) or content-critical output is
destroyed (lost review data).

## Release process

This project uses [SemVer](https://semver.org/) and
[Keep a Changelog](https://keepachangelog.com/).

### For every change

1. Add an entry to `CHANGELOG.md` under the `[Unreleased]` section.
   Categorize under: `Added`, `Changed`, `Deprecated`, `Removed`,
   `Fixed`, `Security`.

2. Commit with a conventional message:
   - `feat:` — new feature → minor bump
   - `fix:` — bug fix → patch bump
   - `chore:` / `docs:` / `test:` / `refactor:` — no bump
   - `feat!:` / `BREAKING CHANGE:` footer → major bump

3. Push to a branch, open a PR against `main`. CI must pass
   (typecheck + tests on node 22 + node 24).

### Cutting a release

After a feature PR is merged and you want to publish:

```bash
# 1. Make sure you're on main and up to date
git checkout main
git pull

# 2. Decide the version bump (SemVer):
#    - Breaking change? → major (1.0.0 → 2.0.0)
#    - New feature?     → minor (1.0.0 → 1.1.0)
#    - Bug fix only?    → patch (1.0.0 → 1.0.1)
NEW_VERSION="1.1.0"   # example

# 3. Move [Unreleased] entries to [NEW_VERSION] — YYYY-MM-DD in CHANGELOG.md
$EDITOR CHANGELOG.md

# 4. Bump the version in package.json
npm version --no-git-tag-version "$NEW_VERSION"

# 5. Commit + tag + push
git add package.json CHANGELOG.md
git commit -m "chore(release): v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION — see CHANGELOG.md"
git push origin main --follow-tags

# 6. Create the GitHub release (copies the CHANGELOG section into release notes)
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes "See [CHANGELOG.md](https://github.com/zrmzur24/lean-ctx-light/blob/main/CHANGELOG.md#${NEW_VERSION//./}) for details."
```

## What NOT to change without a design discussion

- **The `EXCLUDED` regex scope** — adding/removing excluded commands has
  big impact (either lost token savings or lost content fidelity). File an
  issue first with rationale + example of the bad case you want to fix.

- **The `spawnHook` wrapping strategy** — the current `lean-ctx -c sh -lc '<cmd>'`
  is the result of many tradeoffs. See `README.md` §"Gotchas".

- **The subdirectory layout** — pi's auto-discovery requires this exact
  structure (`index.ts` as entry, other files hidden). See `README.md`
  §"Gotchas" → "Multi-file extensions in pi".

## Things PRs should always include

- [ ] Updated `CHANGELOG.md` under `[Unreleased]`
- [ ] Unit tests for any logic change in `core.ts`
- [ ] Updated `README.md` if user-visible behavior changes
- [ ] `npm test` passes (CI will enforce)
- [ ] `npm run typecheck` clean (CI will enforce)

## AI agent contribution guidelines

If you're an AI agent modifying this project:

- Read `README.md` entirely first (it's targeted at you)
- Run `npm test` before and after any change to `core.ts` — compare the
  pass count
- For any new pattern you add to `EXCLUDED` or `WRAPPER_PATTERNS`, add
  at least 2 positive cases and 2 negative cases to the test file
- Update `CHANGELOG.md` — that's how humans track what you did
- Commit messages: conventional commits, French or English, no emojis
  in the subject line
- Don't invoke `lean-ctx update` / `setup` / `init` / `doctor --fix` on
  the host machine — they mutate `.bashrc`. See `README.md` §"Gotchas".

## Questions / issues

Open a GitHub issue at
<https://github.com/zrmzur24/lean-ctx-light/issues>.

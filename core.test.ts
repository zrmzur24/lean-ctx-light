/**
 * Tests unitaires pour lean-ctx-light/core.ts
 *
 * Run: node --import tsx --test ~/.pi/agent/extensions/lean-ctx-light/core.test.ts
 *
 * Couvre (G7 gap du design doc token-optim) :
 *   - EXCLUDED regex : positive/negative cases + edge cases
 *   - shellQuote : quoting POSIX correct pour divers inputs
 *   - detectRuntime : smoke test (vérification runtime Git Bash présent)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXCLUDED, shellQuote, detectRuntime, buildWrappedCommand, isExcluded } from "./core.ts";

// ============================================================
// v1.0.2 gaps — 6 patterns that were compressed-in-error before
// (npm test, node --test, --json anywhere, diff, jq, yq)
// ============================================================

describe("v1.0.2 — npm test / node --test must stay RAW", () => {
  const mustBeExcluded = [
    // npm test (shortcut for `npm run test`)
    ["npm test", "npm test bare"],
    ["npm test -- --watch", "npm test with extra args"],
    ["npm run test", "npm run test explicit"],
    ["npm run test:unit", "npm run test:unit (scoped)"],

    // native node test runner (--test flag anywhere on node cmd)
    ["node --test", "node --test bare"],
    ["node --test test/foo.js", "node --test with file arg"],
    ["node --test --watch", "node --test with --watch"],
    ["node --import tsx --test file.test.ts", "node --import ... --test"],
  ];

  for (const [cmd, desc] of mustBeExcluded) {
    it(`RAW: ${desc} — "${cmd}"`, () => {
      assert.ok(isExcluded(cmd), `Expected excluded: ${cmd}`);
    });
  }

  it("npm install must still be COMPRESSED (npm-!=-test)", () => {
    assert.ok(!isExcluded("npm install"));
    assert.ok(!isExcluded("npm i foo"));
  });

  it("node script.js (no --test flag) must be COMPRESSED", () => {
    assert.ok(!isExcluded("node script.js"));
    assert.ok(!isExcluded("node build.mjs"));
  });

  it("`testing` / `tests` suffix does not trigger npm-test match", () => {
    assert.ok(!isExcluded("npm testing")); // not a real cmd, but word-boundary sanity
  });
});

describe("v1.0.2 — --json flag anywhere must stay RAW", () => {
  const mustBeExcluded = [
    ["gh pr view 123 --json number", "gh pr --json"],
    ["gh pr list --json number,title,state", "gh pr list --json fields"],
    ["gh run list --json databaseId", "gh run --json"],
    ["gh issue view 1 --json body", "gh issue --json"],
    ["curl --json '{\"foo\":1}' https://x", "curl --json"],
    ["some-cli cmd --json=compact", "--json=value form"],
  ];

  for (const [cmd, desc] of mustBeExcluded) {
    it(`RAW: ${desc} — "${cmd}"`, () => {
      assert.ok(isExcluded(cmd), `Expected excluded: ${cmd}`);
    });
  }

  it("commands WITHOUT --json are compressed", () => {
    assert.ok(!isExcluded("gh pr list"));
    assert.ok(!isExcluded("gh pr view 123"));
  });

  it("'--jsonfoo' (no word boundary) does not match", () => {
    assert.ok(!isExcluded("cmd --jsonfoo"));
  });

  it("filename containing 'json' is not a match", () => {
    assert.ok(!isExcluded("cat package.json"));
    assert.ok(!isExcluded("ls data.json"));
  });
});

describe("v1.0.2 — diff / jq / yq must stay RAW", () => {
  const mustBeExcluded = [
    // GNU diff (POSIX diff) — content-critical like git diff
    ["diff a.txt b.txt", "diff two files"],
    ["diff -u a.txt b.txt", "diff -u"],
    ["diff -r dir1 dir2", "diff -r recursive"],

    // jq / yq — JSON/YAML processors, structured output matters
    ["jq '.foo' data.json", "jq filter"],
    ["jq -r '.name' pkg.json", "jq raw"],
    ["jq . file.json", "jq identity"],
    ["yq '.foo' data.yaml", "yq filter"],
    ["yq -r '.version' pom.yaml", "yq raw"],
  ];

  for (const [cmd, desc] of mustBeExcluded) {
    it(`RAW: ${desc} — "${cmd}"`, () => {
      assert.ok(isExcluded(cmd), `Expected excluded: ${cmd}`);
    });
  }

  it("'diffstat' is NOT matched by diff\\b (word boundary required)", () => {
    // `diff\b` requires non-word char after `diff`; `diffstat` has `s` so no boundary.
    // diffstat output (summary) is safe to compress anyway.
    assert.ok(!isExcluded("diffstat file.patch"));
  });

  it("'difference' is NOT a word-boundary match", () => {
    // `diff\b` requires non-word char after `diff`; `difference` has `e` so no boundary.
    // But first we must ensure `difference` doesn't start a command and match.
    // Edge case: echo difference → not excluded
    assert.ok(!isExcluded("echo difference"));
  });

  it("'jqscript' (not a word) would match jq\\b edge — filename guard", () => {
    // `cat jqscript` — cat starts the segment, so jq substring doesn't trigger
    assert.ok(!isExcluded("cat jqscript.sh"));
  });

  it("chained: cd repo && diff a b → RAW", () => {
    assert.ok(isExcluded("cd repo && diff a.txt b.txt"));
    assert.ok(isExcluded("cd repo && jq '.foo' data.json"));
  });
});

describe("v1.0.2 — regression: existing exclusions still work", () => {
  it("git diff still excluded", () => assert.ok(isExcluded("git diff HEAD~1")));
  it("cymbal still excluded", () => assert.ok(isExcluded("cymbal investigate X")));
  it("vitest still excluded", () => assert.ok(isExcluded("vitest")));
  it("npm run build still compressed", () => assert.ok(!isExcluded("npm run build")));
  it("ls still compressed", () => assert.ok(!isExcluded("ls -la")));
});

// ============================================================
// EXCLUDED regex — must RAW (no compression wrap)
// ============================================================

describe("EXCLUDED regex — commands that must stay RAW", () => {
  const mustMatch = [
    // git content-critical
    ["git diff", "git diff plain"],
    ["git diff HEAD~1", "git diff with range"],
    ["git diff main...HEAD -- file.ts", "git diff with exclusion"],
    ["git show abc123", "git show commit"],
    ["git log --oneline -50", "git log"],
    ["  git diff", "with leading whitespace"],

    // cymbal (already optimized)
    ["cymbal investigate Foo", "cymbal investigate"],
    ["cymbal trace handler", "cymbal trace"],
    ["cymbal impact --json Bar", "cymbal impact with flags"],
    ["cymbal --version", "cymbal version"],
    ["cymbal", "cymbal alone"],

    // kill-switch
    ["LEAN_CTX_DISABLED=1 git status", "kill-switch with env prefix"],
    ["LEAN_CTX_DISABLED=1 anything", "kill-switch with any cmd"],

    // test runners — content critical (FAIL detection)
    ["npm run vitest", "npm run vitest"],
    ["npm run tsc", "npm run tsc"],
    ["npm run typecheck", "npm run typecheck"],
    ["npm run lint", "npm run lint"],
    ["npm run eslint", "npm run eslint"],
    ["npx vitest", "npx vitest"],
    ["npx tsc", "npx tsc"],
    ["npx eslint .", "npx eslint"],
    ["vitest", "bare vitest"],
    ["tsc --noEmit", "bare tsc"],
    ["eslint src/", "bare eslint"],
  ];

  for (const [cmd, desc] of mustMatch) {
    it(`RAW: ${desc} — "${cmd}"`, () => {
      assert.ok(EXCLUDED.test(cmd), `Expected EXCLUDED match: ${cmd}`);
    });
  }
});

describe("EXCLUDED regex — commands that must be COMPRESSED", () => {
  const mustNotMatch = [
    // bash basics
    ["echo hello", "echo"],
    ["ls -la", "ls"],
    ["cat file.log", "cat"],
    ["pwd", "pwd"],

    // git ops safe to compress
    ["git status", "git status"],
    ["git branch -a", "git branch"],
    ["git checkout main", "git checkout"],
    ["git push origin fix/42", "git push"],
    ["git commit -m 'msg'", "git commit"],
    ["git stash", "git stash"],
    ["git remote -v", "git remote"],

    // gh (not content-critical for review)
    ["gh pr list", "gh pr list"],
    ["gh issue view 42", "gh issue view"],
    ["gh run list", "gh run list"],

    // build ops (verbose, good compression candidates)
    ["npm install", "npm install"],
    ["npm run build", "npm run build"],
    ["docker build .", "docker build"],
    ["cargo build", "cargo build"],

    // commands MENTIONING excluded keywords but not starting with them
    ["echo 'use git diff'", "echo with diff in string"],
    ["cat file-vitest.log", "cat with vitest in filename"],
    ["ls cymbal_ref/", "ls with cymbal in dir name"],
    ["grep -r TODO .", "grep"],

    // commands with 'git' but not matching diff/show/log
    ["git add .", "git add"],
    ["git fetch", "git fetch"],
    ["git reset", "git reset"],
  ];

  for (const [cmd, desc] of mustNotMatch) {
    it(`COMPRESS: ${desc} — "${cmd}"`, () => {
      assert.ok(!EXCLUDED.test(cmd), `Expected NO EXCLUDED match: ${cmd}`);
    });
  }
});

describe("EXCLUDED regex — edge cases", () => {
  it("empty string does not match", () => {
    assert.ok(!EXCLUDED.test(""));
  });

  it("whitespace-only does not match", () => {
    assert.ok(!EXCLUDED.test("   "));
  });

  it("'git diffstat' is treated as 'git diff' (word boundary intentional)", () => {
    // `diff` matches without word boundary → git diffstat counts as diff
    // Acceptable since diffstat also produces diffs
    assert.ok(EXCLUDED.test("git diffstat HEAD~1"));
  });

  it("'eslintrc' does not trigger eslint match (requires word boundary)", () => {
    // \b at end of (eslint) enforces this
    assert.ok(!EXCLUDED.test("cat .eslintrc"));
  });

  it("'tsconfig' does not trigger tsc match", () => {
    assert.ok(!EXCLUDED.test("cat tsconfig.json"));
  });

  it("multiline command: only first line matters", () => {
    assert.ok(EXCLUDED.test("git diff HEAD~1\necho done"));
    assert.ok(!EXCLUDED.test("echo start\ngit diff"));
  });
});

// ============================================================
// shellQuote — POSIX single-quote escaping
// ============================================================

describe("shellQuote — POSIX quoting", () => {
  it("empty string returns ''", () => {
    assert.equal(shellQuote(""), "''");
  });

  it("simple alphanumeric passes through unquoted", () => {
    assert.equal(shellQuote("hello"), "hello");
    assert.equal(shellQuote("abc_123"), "abc_123");
    assert.equal(shellQuote("path/to/file.ts"), "path/to/file.ts");
  });

  it("allowed special chars pass through unquoted", () => {
    assert.equal(shellQuote("FOO=bar"), "FOO=bar");
    assert.equal(shellQuote("a,b"), "a,b");
    assert.equal(shellQuote("50%"), "50%");
    assert.equal(shellQuote("a+b"), "a+b");
    assert.equal(shellQuote("a@b:c"), "a@b:c");
  });

  it("space triggers single-quote wrapping", () => {
    assert.equal(shellQuote("hello world"), "'hello world'");
  });

  it("embedded single quote is escaped correctly", () => {
    // Standard POSIX trick: 'foo'\''bar' = foo'bar
    assert.equal(shellQuote("foo'bar"), "'foo'\\''bar'");
  });

  it("embedded double quote stays inside single quotes", () => {
    assert.equal(shellQuote('foo"bar'), '\'foo"bar\'');
  });

  it("newline triggers quoting", () => {
    assert.equal(shellQuote("a\nb"), "'a\nb'");
  });

  it("dangerous shell metachars trigger quoting", () => {
    assert.equal(shellQuote("a;rm -rf /"), "'a;rm -rf /'");
    assert.equal(shellQuote("$(evil)"), "'$(evil)'");
    assert.equal(shellQuote("`evil`"), "'`evil`'");
  });
});

// ============================================================
// detectRuntime — smoke test
// ============================================================

describe("buildWrappedCommand — integration", () => {
  it("returns command unchanged when active=false", () => {
    // v1.0.2: `npm test` is now EXCLUDED, so use `npm install` as the non-excluded sample.
    assert.equal(buildWrappedCommand("npm install", false), "npm install");
    assert.equal(buildWrappedCommand("git diff", false), "git diff");
  });

  it("wraps non-excluded command when active=true", () => {
    const r = buildWrappedCommand("npm install", true);
    assert.ok(r.startsWith("lean-ctx -c sh -lc"), `expected wrap, got: ${r}`);
    assert.ok(r.includes("'npm install'") || r.includes("npm install"));
  });

  it("does NOT wrap excluded command even when active=true", () => {
    assert.equal(buildWrappedCommand("git diff HEAD~1", true), "git diff HEAD~1");
    assert.equal(buildWrappedCommand("cymbal investigate X", true), "cymbal investigate X");
    assert.equal(buildWrappedCommand("vitest", true), "vitest");
  });

  it("handles commands with special chars via shellQuote", () => {
    const r = buildWrappedCommand("echo 'hello world'", true);
    // Must be wrapped + properly escaped
    assert.ok(r.startsWith("lean-ctx -c sh -lc"));
    // The inner single-quote should be escaped as '\''
    assert.ok(r.includes("'\\''"), `expected escape, got: ${r}`);
  });

  it("does NOT wrap chained command when any segment is excluded", () => {
    // Real-world pattern: cd X && cymbal Y
    assert.equal(
      buildWrappedCommand("cd /some/path && cymbal investigate X", true),
      "cd /some/path && cymbal investigate X",
    );
    assert.equal(
      buildWrappedCommand("cd repo && git diff HEAD~1", true),
      "cd repo && git diff HEAD~1",
    );
    assert.equal(
      buildWrappedCommand("echo start ; cymbal trace Foo", true),
      "echo start ; cymbal trace Foo",
    );
  });
});

describe("isExcluded — multi-segment detection", () => {
  it("single excluded command", () => {
    assert.ok(isExcluded("git diff HEAD~1"));
    assert.ok(isExcluded("cymbal investigate X"));
  });

  it("chained with cd", () => {
    assert.ok(isExcluded("cd /path && cymbal investigate X"));
    assert.ok(isExcluded("cd repo && git diff"));
  });

  it("chained with semicolon", () => {
    assert.ok(isExcluded("echo start ; cymbal trace Foo"));
  });

  it("chained with pipe", () => {
    assert.ok(isExcluded("echo input | cymbal something"));
  });

  it("chained with ||", () => {
    assert.ok(isExcluded("cmd1 || cymbal fallback"));
  });

  it("multiline", () => {
    assert.ok(isExcluded("cd /path\ncymbal investigate X"));
  });

  it("no excluded segment means not excluded", () => {
    assert.ok(!isExcluded("echo hello"));
    assert.ok(!isExcluded("cd /path && npm install")); // v1.0.2: npm test is now excluded
    assert.ok(!isExcluded("ls && cat file.log"));
  });

  it("excluded only in a string argument does NOT match", () => {
    // EXCLUDED has ^\s* prefix, so the word must START the segment
    // `echo 'use git diff'` → segment is `echo 'use git diff'` → doesn't start with git diff
    assert.ok(!isExcluded("echo 'use git diff'"));
    assert.ok(!isExcluded("cat file-with-cymbal-name.log"));
  });
});

describe("detectRuntime — smoke test", () => {
  it("returns an object with leanCtx, sh, reason fields", () => {
    const r = detectRuntime();
    assert.equal(typeof r.leanCtx, "boolean");
    assert.equal(typeof r.sh, "boolean");
    assert.equal(typeof r.reason, "string");
  });

  it("if both present, reason is empty string", () => {
    const r = detectRuntime();
    if (r.leanCtx && r.sh) {
      assert.equal(r.reason, "");
    } else {
      // If either missing, reason should explain why
      assert.ok(r.reason.length > 0);
    }
  });

  // Informational: show current environment state (not a hard assertion)
  it("informational: current environment", () => {
    const r = detectRuntime();
    console.log(`  [info] leanCtx=${r.leanCtx}, sh=${r.sh}, reason="${r.reason}"`);
    assert.ok(true);
  });
});

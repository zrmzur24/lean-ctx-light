/**
 * lean-ctx-light-core — utilitaires purs testables sans dépendance pi.
 *
 * Extrait de lean-ctx-light.ts pour permettre les tests unitaires isolés.
 * L'extension principale importe ces fonctions et les compose avec
 * l'API pi (createBashToolDefinition).
 */

import { spawnSync } from "node:child_process";

// Exclusions : commandes dont l'output doit rester RAW.
//
// Groupes :
//   - git\s+(diff|show|log)                  → contenu critique pour review/audit
//   - cymbal                                   → déjà optimisé, éviter double-processing
//   - LEAN_CTX_DISABLED=                       → kill-switch explicit de l'agent
//   - (npm run )?(vitest|tsc|eslint|lint|typecheck) → runners de tests/typecheck/lint
//   - (npx )?(vitest|tsc|eslint)              → même chose via npx
//
// Pour les test runners : leur sortie est déjà structurée et critique
// pour l'agent (détection FAIL, error TSxxxx, etc.). Compression risquée.
export const EXCLUDED = /^\s*(git\s+(diff|show|log)|cymbal|LEAN_CTX_DISABLED=|(npm\s+run\s+)?(vitest|tsc|eslint|lint|typecheck)\b|(npx\s+)?(vitest|tsc|eslint)\b)/;

/**
 * POSIX shell quoting pour embedder une commande dans `sh -lc '...'`.
 *
 * Passe-through pour les caractères "safe" (alphanum + quelques spéciaux),
 * wrap en single-quotes sinon avec escaping POSIX standard : 'foo'\''bar'
 * pour contenir un single quote dans la chaîne.
 */
export function shellQuote(value: string): string {
  if (!value) return "''";
  if (/^[A-Za-z0-9_./=:@,+%^-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Runtime check: are the required binaries reachable?
 *
 * Done once at extension load. If either is missing, the extension degrades
 * gracefully to pass-through (no compression wrapping) rather than breaking
 * every bash command.
 *
 * @returns object with booleans + diagnostic reason string
 */
export function detectRuntime(): { leanCtx: boolean; sh: boolean; reason: string } {
  let leanCtx = false;
  let sh = false;
  const problems: string[] = [];

  try {
    const r = spawnSync("lean-ctx", ["--version"], { encoding: "utf-8", timeout: 3_000 });
    leanCtx = r.status === 0;
    if (!leanCtx) problems.push("lean-ctx binary not reachable");
  } catch (e) {
    problems.push(`lean-ctx check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    // Test sh -lc works (Git Bash on Windows, native on macOS/Linux)
    const r = spawnSync("sh", ["-lc", "echo ok"], { encoding: "utf-8", timeout: 3_000 });
    sh = r.status === 0 && (r.stdout ?? "").trim() === "ok";
    if (!sh) problems.push("sh -lc not available (Git Bash missing on Windows?)");
  } catch (e) {
    problems.push(`sh check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { leanCtx, sh, reason: problems.join("; ") };
}

/**
 * Check if a command is EXCLUDED, considering pipeline segments.
 *
 * Handles chained commands like `cd dir && cymbal investigate X` by splitting
 * on `&&`, `;`, `|`, `\n` and testing each segment. If ANY segment matches
 * EXCLUDED, the whole command is excluded (pass-through).
 *
 * Rationale: `cd X && cymbal Y` has cymbal in the 2nd segment and we want
 * RAW output. Testing only the start would miss this common pattern.
 *
 * Trade-off: this is slightly over-inclusive (e.g. `echo done && git log`
 * would also be RAW because of git log), but that's safe-by-default.
 *
 * Exported for tests.
 */
export function isExcluded(command: string): boolean {
  const segments = command.split(/&&|\|\||;|\||\n/).map(s => s.trim()).filter(Boolean);
  return segments.some(seg => EXCLUDED.test(seg));
}

/**
 * Decide how to handle a bash command: wrap with lean-ctx or pass through.
 *
 * @param command - raw bash command
 * @param active - is the runtime ready (lean-ctx + sh available)?
 * @returns the command to actually execute
 */
export function buildWrappedCommand(command: string, active: boolean): string {
  if (!active) return command;
  if (isExcluded(command)) return command;
  return `lean-ctx -c sh -lc ${shellQuote(command)}`;
}

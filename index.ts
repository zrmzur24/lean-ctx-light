/**
 * lean-ctx-light — micro-extension pi qui route les commandes bash via lean-ctx
 * pour compression d'output, avec exclusions en dur pour les commandes critiques.
 *
 * Design doc: mcmg2/docs/plans/2026-04-20-token-optim-setup-design.md
 *
 * Philosophie:
 *   - Override UNIQUEMENT le tool bash (pas de MCP bridge, pas de pollution prompt)
 *   - Exclusions HARDCODED (plus fiable que config.toml) :
 *       * git diff/show/log → contenu critique, ne JAMAIS compresser (risque doc review)
 *       * cymbal            → output déjà optimisé, éviter double-processing
 *       * LEAN_CTX_DISABLED= → respect du kill-switch explicit
 *       * vitest / tsc / eslint / tsc --noEmit / npx tsc → sorties déjà structurées,
 *         risque de perdre des FAIL/error si lean-ctx ne connaît pas le pattern
 *   - Robustesse: si lean-ctx ou sh n'est pas disponible, pass-through (pas de wrap)
 *   - Robustesse: si le binaire plante (exit 127/126), fallback sur commande raw
 *     (géré en amont par lean-ctx lui-même via son check sh)
 *
 * Installation:
 *   1. Binaire lean-ctx doit être dans le PATH (ou ~/.local/bin/lean-ctx.exe)
 *   2. Ce fichier dans ~/.pi/agent/extensions/
 *   3. /reload dans pi
 *
 * Validation:
 *   bash { command: "echo hi" }              → compressé (footer [lean-ctx: X→Y tok])
 *   bash { command: "git diff HEAD~1" }      → RAW (pas de footer)
 *   bash { command: "cymbal investigate X" } → RAW (pas de footer)
 *   bash { command: "LEAN_CTX_DISABLED=1 git log" } → RAW
 *
 * Rollback: rm ce fichier + /reload
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";
import { detectRuntime, buildWrappedCommand } from "./core.ts";

export default function (pi: ExtensionAPI): void {
  const runtime = detectRuntime();
  const active = runtime.leanCtx && runtime.sh;

  const baseBash = createBashToolDefinition(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => {
      const wrapped = buildWrappedCommand(command, active);
      // Only set LEAN_CTX_COMPRESS when we actually wrapped
      const newEnv = wrapped === command ? env : { ...env, LEAN_CTX_COMPRESS: "1" };
      return { command: wrapped, cwd, env: newEnv };
    },
  });

  pi.registerTool({
    ...baseBash,
    description: active
      ? "Execute a bash command. Output compressed via lean-ctx (60-90% token savings). " +
        "Exceptions kept RAW : git diff/show/log, cymbal, vitest/tsc/eslint, " +
        "LEAN_CTX_DISABLED= prefix."
      : "Execute a bash command. lean-ctx wrapping DISABLED (runtime not ready: " +
        runtime.reason + "). Commands run natively without compression.",
  });

  // One-shot warning at load time if compression couldn't activate
  if (!active) {
    pi.on("session_start", async (_event: unknown, ctx: unknown) => {
      const c = ctx as { ui?: { notify?: (m: string, t: string) => void } };
      c.ui?.notify?.(
        `⚠️ lean-ctx-light: compression DISABLED — ${runtime.reason}. ` +
        `Commandes bash exécutées sans wrapping (pass-through).`,
        "warning",
      );
    });
  }
}

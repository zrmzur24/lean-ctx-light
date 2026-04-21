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
 *       * npm test / node --test → native test runners (ajouté v1.0.2)
 *       * diff / jq / yq / --json flag → outputs structurés (ajouté v1.0.2)
 *   - Robustesse: si lean-ctx ou sh n'est pas disponible, pass-through (pas de wrap)
 *   - Robustesse: si le binaire plante (exit 127/126), fallback sur commande raw
 *     (géré en amont par lean-ctx lui-même via son check sh)
 *   - Discipline: depuis v1.0.2, injecte un rappel cymbal + lean-ctx au session_start
 *     (1x par session, via CustomMessageEntry visible dans l'historique ET le LLM)
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
 *   bash { command: "npm test" }             → RAW (v1.0.2)
 *   bash { command: "gh pr view 42 --json number" } → RAW (v1.0.2)
 *   bash { command: "diff a.txt b.txt" }     → RAW (v1.0.2)
 *
 * Rollback: rm ce fichier + /reload
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";
import { detectRuntime, buildWrappedCommand } from "./core.ts";

/**
 * customType tag for the session_start discipline reminder.
 * Used to deduplicate: if a session already has an entry with this tag,
 * skip re-injection (avoids spam on reload/resume/fork).
 */
const REMINDER_CUSTOM_TYPE = "lean-ctx-light/discipline-reminder";

/**
 * The reminder text. Kept intentionally short (~130 tokens) since it will be
 * part of LLM context for every turn of this session.
 *
 * Rationale: pi skills are lazy-loaded (must be requested by the agent), so
 * without an explicit nudge the LLM defaults to grep/find and never discovers
 * cymbal. This reminder fixes the "cymbal non-utilisé" root cause universally,
 * without touching project-specific extensions (mcmg-workflow, AGENTS.md, …).
 */
const REMINDER_CONTENT =
	"[lean-ctx-light] Code navigation & bash compression discipline active for this session.\n" +
	"\n" +
	"• Symbol navigation — prefer `cymbal` over grep/find when tracing code:\n" +
	"    cymbal investigate|trace|impact|callers|callees <Symbol>\n" +
	"  Use it for: finding defs/refs, tracing handlers, impact analysis before refactors.\n" +
	"\n" +
	"• Bash output is auto-compressed via lean-ctx (60–90% token savings).\n" +
	"  RAW exceptions (never compressed):\n" +
	"    git diff/show/log · cymbal · vitest/tsc/eslint · npm test · node --test\n" +
	"    diff · jq · yq · any command with --json · LEAN_CTX_DISABLED= prefix\n" +
	"  To force RAW on any command, prefix with `LEAN_CTX_DISABLED=` (e.g. `LEAN_CTX_DISABLED=1 cat big.log`).";

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
				"Exceptions kept RAW : git diff/show/log, cymbal, vitest/tsc/eslint, npm test, " +
				"node --test, diff, jq, yq, any --json flag, LEAN_CTX_DISABLED= prefix."
			: "Execute a bash command. lean-ctx wrapping DISABLED (runtime not ready: " +
				runtime.reason +
				"). Commands run natively without compression.",
	});

	if (active) {
		// Discipline reminder — injected once per session, deduplicated on reload/resume/fork.
		// Uses sendMessage (CustomMessageEntry) so both the user AND the LLM see it.
		pi.on("session_start", async (_event, ctx) => {
			try {
				const entries = ctx.sessionManager.getEntries();
				const alreadyInjected = entries.some(
					(e) =>
						(e.type === "custom_message" || e.type === "custom") &&
						"customType" in e &&
						e.customType === REMINDER_CUSTOM_TYPE,
				);
				if (alreadyInjected) return;

				pi.sendMessage({
					customType: REMINDER_CUSTOM_TYPE,
					content: REMINDER_CONTENT,
					display: true,
				});
			} catch (err) {
				// Never break session startup because of the reminder; log and continue.
				if (ctx.hasUI) {
					ctx.ui.notify?.(
						`lean-ctx-light: failed to inject reminder — ${err instanceof Error ? err.message : String(err)}`,
						"warning",
					);
				}
			}
		});
	} else {
		// One-shot warning at load time if compression couldn't activate
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify?.(
					`⚠️ lean-ctx-light: compression DISABLED — ${runtime.reason}. ` +
						`Commandes bash exécutées sans wrapping (pass-through).`,
					"warning",
				);
			}
		});
	}
}

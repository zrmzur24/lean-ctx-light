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
 *   - Discipline: depuis v1.0.2, injecte un rappel au session_start (1x par session,
 *     via CustomMessageEntry visible dans l'historique ET le LLM).
 *     En v1.0.3 le rappel a été réduit à une ligne (escape-hatch
 *     `LEAN_CTX_DISABLED=`) — la partie navigation cymbal vit désormais
 *     dans `~/.pi/rules/cymbal.md`, et la liste d'exceptions est déjà
 *     dans la description du tool bash.
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
 * customType tag for the session_start escape-hatch reminder.
 * Used to deduplicate: if a session already has an entry with this tag,
 * skip re-injection (avoids spam on reload/resume/fork).
 *
 * Kept stable across v1.0.2 → v1.0.3 so that sessions already holding a
 * v1.0.2 reminder don't get a duplicate injection on /reload.
 */
const REMINDER_CUSTOM_TYPE = "lean-ctx-light/discipline-reminder";

/**
 * The reminder text — v1.0.3 trimmed edition (~25 tokens, down from ~130).
 *
 * Why it's so short now:
 *   - The bash tool description already lists every RAW exception, so the
 *     reminder doesn't need to repeat them.
 *   - Code-navigation guidance (prefer cymbal over grep) is handled by
 *     `~/.pi/rules/cymbal.md` (project-owned rules file, permanent in the
 *     system prompt, doesn't get compacted away).
 *   - The one thing the tool description does NOT teach well is the
 *     kill-switch SYNTAX. Empirical data (10 sessions, 1311 bash calls)
 *     showed 233 preemptive `LEAN_CTX_DISABLED=1` uses — agents keep
 *     reinventing the trick. A one-line example at session_start closes
 *     that discoverability gap cheaply.
 */
const REMINDER_CONTENT =
	"[lean-ctx-light] To force RAW output on any bash command, prefix it with " +
	"`LEAN_CTX_DISABLED=` (e.g. `LEAN_CTX_DISABLED=1 cat big.log`).";

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

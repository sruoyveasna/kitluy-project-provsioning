/**
 * Vertical registry and host — resolves the ONE POS Desktop shell into the
 * correct vertical experience from authoritative Store Hub configuration.
 *
 * Source authority: owner decision 2026-08-07 (POS unification) §3, §17, §18.
 *
 * The runtime relationship is:
 *
 *   device identity -> Store Hub -> Tenant -> Digital Store -> primary vertical
 *   -> Location -> terminal profile -> permissions -> vertical experience
 *
 * The local user can never turn a terminal into another business vertical:
 * every input arrives from the Hub-signed configuration envelope, and
 * `resolveStoreContext` refuses anything unknown, contradictory or inactive.
 *
 * STATUS: MIGRATED-NOT-YET-ACCEPTED. Creates no Booking, pricing, payment,
 * receipt or printing behaviour — it selects an experience, nothing more.
 */
import {
  resolveStoreContext,
  type AuthoritativeStoreAssignment,
  type ResolvedStoreContext,
} from "@kitluy/digital-store-context";
import type { KitluyErrorLike, Result, VerticalKey } from "@kitluy/shared-types";
import { err, ok } from "@kitluy/shared-types";

import {
  VERTICAL_HOST_REFUSALS,
  type VerticalHostRefusalCode,
  type VerticalModule,
  type VerticalTerminalExperience,
} from "./contract.js";

const refuse = (code: VerticalHostRefusalCode, message: string): KitluyErrorLike => ({
  code,
  message,
});

/** The loaded experience the shell renders. */
export interface LoadedVerticalExperience {
  readonly context: ResolvedStoreContext;
  readonly module: VerticalModule;
  readonly terminal: VerticalTerminalExperience;
}

/**
 * An immutable registry of vertical modules.
 *
 * Registration is explicit and internal — modules are compiled in, not
 * discovered at runtime, so a rogue local file cannot introduce an experience.
 */
export class VerticalRegistry {
  private readonly modules: ReadonlyMap<VerticalKey, VerticalModule>;

  constructor(modules: readonly VerticalModule[]) {
    const map = new Map<VerticalKey, VerticalModule>();
    for (const module of modules) {
      if (map.has(module.key)) {
        throw new Error(
          `Duplicate vertical module registration for '${module.key}'. ` +
            "Each vertical has exactly one module.",
        );
      }
      map.set(module.key, module);
    }
    this.modules = map;
  }

  /** Every registered module, including inactive future phases. */
  registered(): readonly VerticalModule[] {
    return [...this.modules.values()];
  }

  get(key: VerticalKey): VerticalModule | undefined {
    return this.modules.get(key);
  }

  /**
   * Resolve an authoritative assignment into a loadable experience.
   *
   * Refuses when: the assignment is incomplete, contradictory, unknown or its
   * phase gate is inactive (delegated to `resolveStoreContext`); no module is
   * registered; the module is not an active Phase 1 experience; or the module
   * has no experience for the assigned terminal profile.
   */
  resolve(assignment: AuthoritativeStoreAssignment): Result<LoadedVerticalExperience> {
    const resolved = resolveStoreContext(assignment);
    if (!resolved.ok) return resolved;
    const context = resolved.value;

    const module = this.modules.get(context.vertical);
    if (!module) {
      return err(
        refuse(
          VERTICAL_HOST_REFUSALS.NO_MODULE_REGISTERED,
          `No vertical module is registered for '${context.vertical}'.`,
        ),
      );
    }

    // Defence in depth: the phase gate already refused inactive verticals, so a
    // non-active module here means registry and gate disagree. Refuse loudly
    // rather than loading a Phase 2 experience as Phase 1.
    if (module.state !== "ACTIVE_PHASE1") {
      return err(
        refuse(
          VERTICAL_HOST_REFUSALS.MODULE_NOT_ACTIVE,
          `Vertical module '${context.vertical}' is '${module.state}' and must not load as Phase 1.`,
        ),
      );
    }

    const terminal = module.terminals.find(
      (t) => t.terminalProfileCode === context.terminalProfileCode,
    );
    if (!terminal) {
      return err(
        refuse(
          VERTICAL_HOST_REFUSALS.NO_TERMINAL_EXPERIENCE,
          `Vertical '${context.vertical}' has no experience for profile '${context.terminalProfileCode}'.`,
        ),
      );
    }

    return ok({ context, module, terminal });
  }
}

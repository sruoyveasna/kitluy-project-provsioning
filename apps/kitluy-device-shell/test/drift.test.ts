/**
 * Drift guard: the shell copies the firstboot agent's display-state semantics
 * (phase unions, the asset-tag derivation, the belongs-to checks, the state-file
 * paths) so a console can render between refreshes. If the agent changes any of
 * them, these checks fail — at compile time for the type unions, at run time for
 * the behaviour — rather than the two silently disagreeing on a real board.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetTagFromFingerprint as agentAssetTag,
  pairingBelongsTo as agentPairingBelongs,
  registrationBelongsTo as agentRegistrationBelongs,
  BOOTSTRAP_STATE_PATH,
  PAIRING_STATE_PATH,
  REGISTRATION_STATE_PATH,
  type PairingPhase as AgentPairingPhase,
  type RegistrationPhase as AgentRegistrationPhase,
} from "@kitluy-services/kitluy-device-firstboot-agent";
import {
  assetTagFromFingerprint,
  pairingBelongsTo,
  registrationBelongsTo,
  type PairingPhase as ShellPairingPhase,
  type RegistrationPhase as ShellRegistrationPhase,
} from "../src/model/shell-state.js";
import { DEFAULT_ROOTS } from "../electron/device-state-files.js";

// Compile-time: each direction only type-checks if the unions are mutually
// assignable, so an added/removed/renamed phase on either side is a build error.
const asShellReg = (phase: AgentRegistrationPhase): ShellRegistrationPhase => phase;
const asAgentReg = (phase: ShellRegistrationPhase): AgentRegistrationPhase => phase;
const asShellPair = (phase: AgentPairingPhase): ShellPairingPhase => phase;
const asAgentPair = (phase: ShellPairingPhase): AgentPairingPhase => phase;

describe("phase unions match the agent", () => {
  it("registration", () => {
    expect(asShellReg("APPROVED")).toBe("APPROVED");
    expect(asAgentReg("CONTAINED")).toBe("CONTAINED");
  });
  it("pairing", () => {
    expect(asShellPair("PAIRED")).toBe("PAIRED");
    expect(asAgentPair("ALREADY_ASSIGNED")).toBe("ALREADY_ASSIGNED");
  });
});

describe("behaviour matches the agent", () => {
  it("asset tag derivation is identical", () => {
    for (const fp of ["abcdef0123456789aaaa", "0000000000001111", "FEDCBA9876543210"]) {
      expect(assetTagFromFingerprint(fp)).toBe(agentAssetTag(fp));
    }
  });

  it("registrationBelongsTo agrees", () => {
    const now = "2026-09-04T00:00:00Z";
    expect(registrationBelongsTo({ phase: "APPROVED", keyFingerprint: "k1" }, "k1")).toBe(
      agentRegistrationBelongs({ phase: "APPROVED", keyFingerprint: "k1", updatedAt: now }, "k1"),
    );
    expect(registrationBelongsTo({ phase: "APPROVED", keyFingerprint: "k1" }, "k2")).toBe(
      agentRegistrationBelongs({ phase: "APPROVED", keyFingerprint: "k1", updatedAt: now }, "k2"),
    );
    expect(registrationBelongsTo(null, "k1")).toBe(agentRegistrationBelongs(null, "k1"));
  });

  it("pairingBelongsTo agrees", () => {
    const now = "2026-09-04T00:00:00Z";
    expect(pairingBelongsTo({ phase: "PAIRED", deviceRecordId: "d1" }, "d1")).toBe(
      agentPairingBelongs({ phase: "PAIRED", deviceRecordId: "d1", updatedAt: now }, "d1"),
    );
    expect(pairingBelongsTo({ phase: "PAIRED", deviceRecordId: "d1" }, "d2")).toBe(
      agentPairingBelongs({ phase: "PAIRED", deviceRecordId: "d1", updatedAt: now }, "d2"),
    );
  });
});

describe("the shell reads exactly where the agent writes", () => {
  it("state-file paths match the agent's constants", () => {
    expect(join(DEFAULT_ROOTS.stateDir, "registration-state.json")).toBe(REGISTRATION_STATE_PATH);
    expect(join(DEFAULT_ROOTS.stateDir, "pairing-state.json")).toBe(PAIRING_STATE_PATH);
    expect(join(DEFAULT_ROOTS.stateDir, "bootstrap-state.json")).toBe(BOOTSTRAP_STATE_PATH);
  });
});

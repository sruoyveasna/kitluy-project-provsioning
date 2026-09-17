/**
 * Staff sign-in over IPC — T1-STORE-OPERATIONS-001.
 *
 * Two NAMED operations, re-validated in the main process. The renderer supplies
 * a staff id and a passcode and nothing else: the profile is always T1 (set by
 * the main process), and the Hub remains the verifier (scrypt, scope, grants,
 * `pos.t1.use`). No new staff identity model (KLD-2026-08-06-WS12-T001-EDGE-
 * BOOTSTRAP-001 guardrails).
 */
export const STAFF_CHANNELS = {
  signIn: "kitluy:t1:staff:sign-in",
  signOut: "kitluy:t1:staff:sign-out",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// The Hub accepts 4-128 characters; control characters are refused here so a
// pasted newline never reaches the verifier.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

export interface StaffSignInInput {
  readonly actorId: string;
  readonly passcode: string;
}

export function validateSignIn(payload: unknown): StaffSignInInput | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "actorId" || keys[1] !== "passcode") return null;
  const actorId = record["actorId"];
  const passcode = record["passcode"];
  if (typeof actorId !== "string" || !UUID.test(actorId.trim())) return null;
  if (typeof passcode !== "string" || passcode.length < 4 || passcode.length > 128) return null;
  if (CONTROL.test(passcode)) return null;
  return { actorId: actorId.trim().toLowerCase(), passcode };
}

interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

export interface StaffRuntimeLike {
  signIn(
    input: StaffSignInInput,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string }
  >;
  signOut(): Promise<unknown>;
}

export function registerStaffIpc(ipc: IpcMainLike, runtime: StaffRuntimeLike): void {
  ipc.handle(STAFF_CHANNELS.signIn, async (_event, payload) => {
    const input = validateSignIn(payload);
    if (input === null) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        detail: "a staff id and a 4-128 character passcode are required",
      };
    }
    const result = await runtime.signIn(input);
    // Only the verdict crosses back: never the session id, never the passcode.
    return result.ok ? { ok: true } : { ok: false, code: result.code, detail: result.detail };
  });
  ipc.handle(STAFF_CHANNELS.signOut, async () => {
    await runtime.signOut();
    return { ok: true };
  });
}

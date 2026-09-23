/**
 * What a Pi Terminal checks about the seat it was granted, before recording it.
 * TERMINAL-APPLICATION-ASSIGNMENT-001 requirements 2, 10 and 12.
 *
 * The terminal CHOOSES nothing here: vertical, profiles, applications and
 * surfaces all arrive from the registry's server rows. What it does is REFUSE
 * to record a seat it cannot make sense of — an unknown vertical shape, a
 * profile or application from another vertical, an application list that is
 * empty (nothing to install), a malformed surface. A seat refused here is not
 * persisted, and the installer sees SEAT_NOT_INSTALLABLE rather than a board
 * that later boots into nothing.
 *
 * COUPLING NOTE (deliberate duplication, do not "fix" by importing): the
 * identifier shapes below mirror `@kitluy/terminal-seat-contracts`. The shell's
 * Electron main is tsc-compiled and shipped in the Pi image closure, and adding
 * a runtime package to that closure is an image change owned elsewhere. The
 * shapes are pinned to the contracts package by `test/seat-validation.drift.
 * test.ts` (a test-only dependency), the same discipline `@kitluy/edge-contracts`
 * uses for its profile identifiers.
 */
/** `<vertical>` — a registry key shape. Membership is the cloud's to decide. */
export const VERTICAL_KEY_SHAPE = /^[a-z][a-z0-9_]*$/;
/** `<vertical>.t<n>.<role>` — mirrors group 0213 and the contracts package. */
export const TERMINAL_PROFILE_CODE_SHAPE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
/** `<vertical>.<application>` — mirrors `APPLICATION_IDENTIFIER_PATTERN`. */
export const APPLICATION_IDENTIFIER_SHAPE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/** `<area>.<surface>` — mirrors `SURFACE_IDENTIFIER_PATTERN`. */
export const SURFACE_IDENTIFIER_SHAPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const stringList = (value) => Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
/**
 * Validate the granted seat. Every branch that returns `ok: false` is a
 * fail-closed outcome: the seat is NOT recorded on the board.
 */
export function validateGrantedSeat(seat) {
    const refuse = (refusal, detail) => ({ ok: false, refusal, detail });
    if (typeof seat.vertical !== "string" || seat.vertical.trim().length === 0) {
        return refuse("SEAT_VERTICAL_MISSING", "the seat named no business vertical");
    }
    const vertical = seat.vertical.trim();
    if (!VERTICAL_KEY_SHAPE.test(vertical)) {
        return refuse("SEAT_VERTICAL_MALFORMED", `'${vertical}' is not a vertical key`);
    }
    const profiles = stringList(seat.terminalProfileKeys);
    if (profiles === null || profiles.length === 0) {
        return refuse("SEAT_PROFILES_MISSING", "the seat carries no terminal profile");
    }
    for (const p of profiles) {
        if (!TERMINAL_PROFILE_CODE_SHAPE.test(p)) {
            return refuse("SEAT_PROFILE_MALFORMED", `'${p}' is not a terminal profile code`);
        }
        if (p.split(".")[0] !== vertical) {
            return refuse("SEAT_PROFILE_OTHER_VERTICAL", `profile '${p}' belongs to another vertical than '${vertical}'`);
        }
    }
    // The registry derives the applications server-side. A seat that arrives
    // without any is a seat nothing can be installed for; it is not recorded.
    const applications = stringList(seat.desiredApplications);
    if (applications === null || applications.length === 0) {
        return refuse("SEAT_APPLICATIONS_MISSING", "the seat names no application to install");
    }
    for (const a of applications) {
        if (!APPLICATION_IDENTIFIER_SHAPE.test(a)) {
            return refuse("SEAT_APPLICATION_MALFORMED", `'${a}' is not an application identifier`);
        }
        if (a.split(".")[0] !== vertical) {
            return refuse("SEAT_APPLICATION_OTHER_VERTICAL", `application '${a}' belongs to another vertical than '${vertical}'`);
        }
    }
    const surfaces = stringList(seat.allowedSurfaces);
    if (surfaces === null) {
        return refuse("SEAT_SURFACES_MALFORMED", "the allowed surfaces were not a list");
    }
    for (const s of surfaces) {
        if (!SURFACE_IDENTIFIER_SHAPE.test(s)) {
            return refuse("SEAT_SURFACES_MALFORMED", `'${s}' is not a surface identifier`);
        }
    }
    return {
        ok: true,
        seat: { primaryVertical: vertical, terminalProfileKeys: profiles, desiredApplications: applications, allowedSurfaces: surfaces },
    };
}
//# sourceMappingURL=seat-validation.js.map
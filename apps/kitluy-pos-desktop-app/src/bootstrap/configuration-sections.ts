/**
 * The sections of a VERIFIED configuration delivery — T1-REAL-OPERATIONS-001
 * (slice 1).
 *
 * The Store Hub delivers its active snapshot as one `payloadJson` string whose
 * digest the runtime has already checked against the signed envelope
 * (`edge-machine.ts`, `sha256(payloadJson) == payloadSha256`). Until today
 * nothing on the terminal READ that string. This parses it into its sections
 * (`{ section_code: content }`, as `readCurrentConfigurationDelivery` builds
 * it on the Hub) — and nothing more: which sections mean what is the
 * vertical's business (`src/vertical/laundry/catalog-section.ts`).
 *
 * Neutral by construction: no section name, no Laundry word, no default.
 */
export type ConfigurationSections = Readonly<Record<string, unknown>>;

/**
 * Parse the verified payload into sections. Returns `null` for anything that
 * is not a JSON object of sections — a delivery whose payload the terminal
 * cannot read is one it must not act on.
 */
export function parseConfigurationSections(payloadJson: string): ConfigurationSections | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const sections: Record<string, unknown> = {};
  for (const [code, content] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(code)) return null;
    if (content === null || typeof content !== "object" || Array.isArray(content)) return null;
    sections[code] = content;
  }
  return sections;
}

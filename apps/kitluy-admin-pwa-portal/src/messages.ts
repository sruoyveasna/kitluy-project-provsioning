/**
 * Bilingual message bundle. Khmer and English are both first-class
 * (@kitluy/localization); Khmer is the default locale.
 *
 * Every operator-facing string lives here so a reviewer can read the whole
 * vocabulary of the portal in one place — including, importantly, the strings
 * that describe an ABNORMAL device. Those are the ones that must not be
 * softened into reassurance.
 */
import type { KitluyLocale } from "@kitluy/localization";

export type MessageKey = keyof (typeof MESSAGES)["en-US"];

export const MESSAGES = {
  "km-KH": {
    boundary:
      "ផ្ទាំងគ្រប់គ្រងផ្ទៃក្នុងសម្រាប់ HET តែប៉ុណ្ណោះ។ មិនត្រូវបានបើកជាកម្មវិធីសម្រាប់ដៃគូ ខ្សែសង្វាក់ បុគ្គលិកហាង ឬអតិថិជនឡើយ។",
    signedOut: "សូមចូលគណនីដើម្បីបន្ត។",
    scaffold: "ទិន្នន័យប្រតិបត្តិការពិតពីមូលដ្ឋានទិន្នន័យកណ្តាល។",
    signIn: "ចូលគណនី",
    signingIn: "កំពុងចូល…",
    signOut: "ចេញពីគណនី",
    email: "អ៊ីមែល",
    password: "ពាក្យសម្ងាត់",
    missingEmail: "សូមបញ្ចូលអ៊ីមែល។",
    missingPassword: "សូមបញ្ចូលពាក្យសម្ងាត់។",
    invalidCredentials: "អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។",
    networkError: "មិនអាចភ្ជាប់បានទេ។ សូមពិនិត្យបណ្តាញ រួចព្យាយាមម្តងទៀត។",
    unexpectedError: "មានបញ្ហាដែលមិនបានរំពឹងទុក។ មិនបានចូលគណនីទេ។",
    restoring: "កំពុងពិនិត្យវគ្គចូលប្រើ…",
    checkingAccess: "កំពុងផ្ទៀងផ្ទាត់សិទ្ធិ…",
    notAdmin: "គណនីនេះមិនមែនជាគណនីអ្នកគ្រប់គ្រងទេ។",
    accountDisabled: "គណនីអ្នកគ្រប់គ្រងនេះត្រូវបានបិទ។",
    accountInactive: "គណនីអ្នកគ្រប់គ្រងនេះមិនសកម្មទេ។",
    sessionExpired: "វគ្គចូលប្រើលែងមានសុពលភាព។ សូមចូលគណនីម្តងទៀត។",
    accessRefused: "គណនីនេះគ្មានសិទ្ធិសម្រាប់ទិដ្ឋភាពនេះទេ។",
    serviceUnavailable: "មិនអាចទាក់ទងសេវាគ្រប់គ្រងបានទេ។",
    notConfigured: "ការដំឡើងនេះមិនទាន់បានកំណត់រចនាសម្ព័ន្ធទេ។",
    devices: "ឧបករណ៍",
    deviceCount: "ចំនួនឧបករណ៍",
    noDevices: "គ្មានឧបករណ៍ទេ។",
    back: "ត្រឡប់ក្រោយ",
    retry: "ព្យាយាមម្តងទៀត",
    lifecycle: "ស្ថានភាពជីវិត",
    lastSeen: "ឃើញចុងក្រោយ",
    neverSeen: "មិនធ្លាប់ឃើញ",
    freshnessUnknown: "មិនដឹង — មិនទាន់មានលក្ខណៈវិនិច្ឆ័យ",
    freshnessUnruled:
      "លក្ខណៈវិនិច្ឆ័យស្ថានភាពតភ្ជាប់មិនទាន់សម្រេច។ ដូច្នេះមិនអាចបញ្ជាក់ថាឧបករណ៍កំពុងដំណើរការទេ។",
    freshnessDevelopmentDefault:
      "ស្ថានភាពតភ្ជាប់ប្រើតម្លៃលំនាំដើមសម្រាប់ការអភិវឌ្ឍន៍ ដែលត្រូវពិនិត្យឡើងវិញមុនដំណាក់កាល Pilot។",
    abnormal: "មិនប្រក្រតី",
    attention: "ត្រូវការការយកចិត្តទុកដាក់",
    normal: "ប្រក្រតី",
    openIncidents: "ឧប្បត្តិហេតុកំពុងបើក",
    provisioningEligible: "អាចចេញកូដដំឡើងបាន",
    provisioningRefused: "មិនអាចចេញកូដដំឡើងបានទេ",
    provisioningNotHere: "ការចេញកូដមិនទាន់មាននៅក្នុងផ្ទាំងនេះទេ។",
    truncated: "បញ្ជីនេះមិនពេញលេញទេ — បានឈានដល់កម្រិតកំណត់។",
    permissions: "សិទ្ធិ",
  },
  "en-US": {
    boundary:
      "HET-internal privileged control plane. Never exposed as a Partner, Chain, Store staff or customer application (RB v4 §8.1).",
    signedOut: "Sign in to continue.",
    scaffold: "Live operational data from the canonical database.",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
    email: "Email",
    password: "Password",
    missingEmail: "Enter your email.",
    missingPassword: "Enter your password.",
    invalidCredentials: "That email and password combination is not correct.",
    networkError: "Could not reach the sign-in service. Check the connection and try again.",
    unexpectedError: "Something unexpected went wrong. You were not signed in.",
    restoring: "Checking your session…",
    checkingAccess: "Checking your access…",
    notAdmin: "This account is not an Admin account.",
    accountDisabled: "This Admin account is disabled.",
    accountInactive: "This Admin account is not active.",
    sessionExpired: "This session is no longer valid. Sign in again.",
    accessRefused: "This account does not hold the access required for this view.",
    serviceUnavailable: "The management service could not be reached.",
    notConfigured: "This deployment is not configured.",
    devices: "Devices",
    deviceCount: "Devices",
    noDevices: "No devices.",
    back: "Back",
    retry: "Try again",
    lifecycle: "Lifecycle",
    lastSeen: "Last seen",
    neverSeen: "Never seen",
    freshnessUnknown: "Unknown — no ruled threshold",
    freshnessUnruled:
      "The liveness threshold is an unruled owner value, so this portal cannot claim a device is online.",
    freshnessDevelopmentDefault:
      "Liveness uses owner-approved DEVELOPMENT defaults, pending review against real heartbeat cadence before Pilot.",
    abnormal: "Abnormal",
    attention: "Needs attention",
    normal: "Normal",
    openIncidents: "Open incidents",
    provisioningEligible: "A provisioning code may be issued",
    provisioningRefused: "A provisioning code may not be issued",
    provisioningNotHere: "Issuing a provisioning code is not available in this view.",
    truncated: "This list is incomplete — the page cap was reached.",
    permissions: "Permissions",
  },
} as const;

export function t(locale: KitluyLocale, key: MessageKey): string {
  return MESSAGES[locale][key];
}

/**
 * Every string the Device Shell paints, in Khmer (the default) and English.
 *
 * Khmer is the default locale of the KitLuy edge (`DEFAULT_LOCALE`), and this is
 * the screen an installer reads standing in a shop — so km-KH is authored first
 * and the smoke/screen tests assert both languages exist for every key.
 *
 * The wording mirrors the firstboot agent's `registrationHeadline()` /
 * `registrationPhaseLabel()` in intent (say what is true, and whether to wait or
 * act) but is written for a touch screen rather than a serial console.
 */
import type { KitluyLocale } from "@kitluy/localization";

export interface ShellMessages {
  readonly deviceLabelPrefix: string;
  readonly noDeviceLabel: string;
  readonly booting: string;

  readonly waitingTitle: string;
  readonly subNotRegistered: string;
  readonly subRegistering: string;
  readonly subAwaitingApproval: string;
  readonly subUnreachable: string;
  readonly noNetwork: string;

  readonly haltedTrustTitle: string;
  readonly haltedTrustBody: string;
  readonly haltedContainedTitle: string;
  readonly haltedContainedBody: string;

  readonly approvedTitle: string;
  readonly approvedIntro: string;
  readonly enterCode: string;
  readonly keyBackspace: string;
  readonly keyClear: string;
  readonly keyContinue: string;
  readonly pairingNotAvailable: string;

  readonly assignedTitle: string;
  readonly assignedBody: string;

  readonly switchLanguage: string;
}

export type MessageKey = keyof ShellMessages;

const km: ShellMessages = {
  deviceLabelPrefix: "ឧបករណ៍",
  noDeviceLabel: "កំពុងរៀបចំលេខសម្គាល់ឧបករណ៍…",
  booting: "កំពុងចាប់ផ្ដើម…",

  waitingTitle: "កំពុងរង់ចាំការអនុម័ត",
  subNotRegistered: "ឧបករណ៍នេះមិនទាន់បានទាក់ទង KitLuy នៅឡើយទេ។",
  subRegistering: "កំពុងទាក់ទង KitLuy…",
  subAwaitingApproval:
    "ឧបករណ៍នេះបានបង្ហាញទៅ KitLuy ហើយកំពុងរង់ចាំបុគ្គលិក HET អនុម័ត។ មិនចាំបាច់ធ្វើអ្វីនៅទីនេះទេ។",
  subUnreachable: "ឧបករណ៍នេះមិនអាចទាក់ទង KitLuy បានទេ។ សូមពិនិត្យបណ្ដាញ; វានឹងព្យាយាមម្ដងទៀត។",
  noNetwork: "គ្មានបណ្ដាញ — សូមភ្ជាប់ខ្សែ Ethernet។",

  haltedTrustTitle: "តម្រូវឲ្យត្រួតពិនិត្យទំនុកចិត្ត",
  haltedTrustBody: "KitLuy ត្រូវពិនិត្យឧបករណ៍នេះដោយផ្ទាល់មុនពេលបន្ត។ សូមទាក់ទងផ្នែកជំនួយ HET។",
  haltedContainedTitle: "បានបញ្ឈប់ដោយ KitLuy",
  haltedContainedBody:
    "ឧបករណ៍នេះត្រូវបានដាក់ឲ្យនៅដាច់ដោយឡែក លុបចេញ ឬជំនួស ហើយមិនអាចប្រើបានទេ។ សូមទាក់ទងផ្នែកជំនួយ HET។",

  approvedTitle: "បានអនុម័ត",
  approvedIntro:
    "ម៉ាស៊ីននេះត្រូវបានអនុម័ត ប៉ុន្តែមិនទាន់បានកំណត់ទៅហាងណាមួយទេ។ សូមបញ្ចូលលេខកូដផ្គូផ្គងពី Partner Portal។",
  enterCode: "បញ្ចូលលេខកូដផ្គូផ្គង",
  keyBackspace: "លុប",
  keyClear: "សម្អាត",
  keyContinue: "បន្ត",
  pairingNotAvailable: "ការផ្គូផ្គងមិនទាន់អាចប្រើបានក្នុងកំណែនេះនៅឡើយទេ។",

  assignedTitle: "បានកំណត់ទៅហាង",
  assignedBody: "ម៉ាស៊ីននេះត្រូវបានកំណត់ទៅហាងមួយ។ វានឹងបញ្ចប់ការរៀបចំដោយខ្លួនឯង។",

  switchLanguage: "English",
};

const en: ShellMessages = {
  deviceLabelPrefix: "Device",
  noDeviceLabel: "Preparing device id…",
  booting: "Starting…",

  waitingTitle: "Waiting for approval",
  subNotRegistered: "This device has not yet contacted KitLuy.",
  subRegistering: "Contacting KitLuy…",
  subAwaitingApproval:
    "This device is visible to KitLuy and is waiting for a person at HET to approve it. No action is needed here.",
  subUnreachable: "This device cannot reach KitLuy. Check the network; it will keep trying.",
  noNetwork: "No network — connect the Ethernet cable.",

  haltedTrustTitle: "Trust review required",
  haltedTrustBody:
    "KitLuy must check this device by hand before it can continue. Contact HET support.",
  haltedContainedTitle: "Stopped by KitLuy",
  haltedContainedBody:
    "This device has been quarantined, retired or replaced and cannot be used. Contact HET support.",

  approvedTitle: "Approved",
  approvedIntro:
    "This terminal is approved but not yet assigned to a Store. Enter the pairing code from the Partner Portal.",
  enterCode: "Enter pairing code",
  keyBackspace: "Backspace",
  keyClear: "Clear",
  keyContinue: "Continue",
  pairingNotAvailable: "Pairing is not available in this build yet.",

  assignedTitle: "Assigned to a Store",
  assignedBody: "This terminal is assigned to a Store. It will finish setting up on its own.",

  switchLanguage: "ខ្មែរ",
};

export const MESSAGES: Readonly<Record<KitluyLocale, ShellMessages>> = {
  "km-KH": km,
  "en-US": en,
};

export function messagesFor(locale: KitluyLocale): ShellMessages {
  return MESSAGES[locale];
}

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
  readonly pairingPaired: string;
  readonly pairingRefused: string;
  readonly pairingLocked: string;
  readonly pairingAlreadyAssigned: string;
  readonly pairingNotRegistered: string;
  readonly pairingUnreachable: string;
  readonly pairingFailed: string;

  readonly assignedTitle: string;
  readonly assignedBody: string;
  // T1-FIRST-BOOT-PIN-001
  readonly pinCreateTitle: string;
  readonly pinCreateIntro: string;
  readonly pinConfirmTitle: string;
  readonly pinConfirmIntro: string;
  readonly pinMismatch: string;
  readonly pinRefused: string;
  readonly pinStarting: string;
  readonly installingTitle: string;
  readonly installingWaiting: string;
  readonly installingActivating: string;
  readonly installingHealth: string;
  readonly installingFailed: string;

  readonly switchLanguage: string;

  // --- Settings -------------------------------------------------------------
  readonly settings: string;
  readonly settingsClose: string;
  readonly tabNetwork: string;
  readonly tabPrinter: string;
  readonly tabDevice: string;
  readonly tabDisplay: string;

  readonly netConnectedWired: string;
  readonly netConnectedWireless: string;
  readonly netDisconnected: string;
  readonly netScan: string;
  readonly netScanning: string;
  readonly netNoneFound: string;
  readonly netSecured: string;
  readonly netOpen: string;
  readonly netPassword: string;
  readonly netJoin: string;
  readonly netJoining: string;
  readonly netJoined: string;
  readonly netForget: string;
  readonly netSaved: string;

  readonly printerHost: string;
  readonly printerPort: string;
  readonly printerLabel: string;
  readonly printerSave: string;
  readonly printerSaved: string;
  readonly printerTest: string;
  readonly printerTesting: string;
  readonly printerTestOk: string;
  readonly printerNone: string;
  readonly printerBadHost: string;
  readonly printerBadPort: string;
  readonly printerUsbNote: string;

  readonly devHostname: string;
  readonly devSerial: string;
  readonly devClass: string;
  readonly devImage: string;
  readonly devEnvironment: string;

  readonly dispBrightness: string;
  readonly dispNoBacklight: string;
  readonly dispLanguage: string;

  readonly configUnavailable: string;
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
  pairingPaired: "បានផ្គូផ្គងដោយជោគជ័យ។ ឧបករណ៍នេះឥឡូវជាកម្មសិទ្ធិរបស់ហាង។",
  pairingRefused: "លេខកូដនេះមិនត្រឹមត្រូវទេ។ សូមពិនិត្យម្ដងទៀត ឬបង្កើតលេខកូដថ្មីនៅ Partner Portal។",
  pairingLocked: "បានព្យាយាមច្រើនដងពេក។ សូមបង្កើតលេខកូដថ្មីនៅ Partner Portal។",
  pairingAlreadyAssigned: "ឧបករណ៍នេះត្រូវបានកំណត់ទៅហាងណាមួយរួចហើយ។",
  pairingNotRegistered: "ឧបករណ៍នេះមិនទាន់បានចុះឈ្មោះជាមួយ KitLuy ទេ។",
  pairingUnreachable: "មិនអាចទាក់ទង KitLuy បានទេ។ សូមពិនិត្យបណ្ដាញ។",
  pairingFailed: "ការផ្គូផ្គងមិនបានសម្រេច។",

  assignedTitle: "បានកំណត់ទៅហាង",
  assignedBody: "ម៉ាស៊ីននេះត្រូវបានកំណត់ទៅហាងមួយ។ វានឹងបញ្ចប់ការរៀបចំដោយខ្លួនឯង។",
  pinCreateTitle: "បង្កើត PIN របស់ Terminal",
  pinCreateIntro: "បញ្ចូលលេខ ៤ ខ្ទង់។ PIN នេះរក្សាទុកនៅ Store Hub ហើយនឹងដោះសោ Terminal នេះ។",
  pinConfirmTitle: "បញ្ជាក់ PIN",
  pinConfirmIntro: "បញ្ចូលលេខ ៤ ខ្ទង់ដដែលម្ដងទៀត។",
  pinMismatch: "លេខទាំងពីរមិនដូចគ្នាទេ។ សូមព្យាយាមម្ដងទៀត។",
  pinRefused: "Store Hub មិនបានទទួល PIN ទេ",
  pinStarting: "Store Hub មិនទាន់ភ្ជាប់ទេ… សូមព្យាយាមម្ដងទៀតក្នុងពេលបន្តិចទៀត។",
  installingTitle: "កំពុងដំឡើងកម្មវិធី KitLuy",
  installingWaiting: "កំពុងស្នើសុំកម្មវិធីពី Store…",
  installingActivating: "កំពុងដំឡើង…",
  installingHealth: "កំពុងពិនិត្យ…",
  installingFailed: "ការដំឡើងបានបរាជ័យ។ ឧបករណ៍នឹងព្យាយាមម្ដងទៀតជាមួយកំណែថ្មី។",

  switchLanguage: "English",

  settings: "ការកំណត់",
  settingsClose: "បិទ",
  tabNetwork: "បណ្ដាញ",
  tabPrinter: "ម៉ាស៊ីនបោះពុម្ព",
  tabDevice: "ឧបករណ៍",
  tabDisplay: "អេក្រង់",

  netConnectedWired: "បានភ្ជាប់តាមខ្សែ Ethernet",
  netConnectedWireless: "បានភ្ជាប់តាម Wi-Fi",
  netDisconnected: "គ្មានការភ្ជាប់បណ្ដាញ",
  netScan: "ស្វែងរកបណ្ដាញ",
  netScanning: "កំពុងស្វែងរក…",
  netNoneFound: "រកមិនឃើញបណ្ដាញណាមួយទេ។",
  netSecured: "មានពាក្យសម្ងាត់",
  netOpen: "បើកចំហ",
  netPassword: "ពាក្យសម្ងាត់ Wi-Fi",
  netJoin: "ភ្ជាប់",
  netJoining: "កំពុងភ្ជាប់…",
  netJoined: "បានភ្ជាប់ដោយជោគជ័យ។",
  netForget: "លុបបណ្ដាញនេះ",
  netSaved: "បានរក្សាទុកបណ្ដាញនេះរួចហើយ",

  printerHost: "អាសយដ្ឋានម៉ាស៊ីនបោះពុម្ព",
  printerPort: "ច្រក (លំនាំដើម 9100)",
  printerLabel: "ឈ្មោះ (ស្រេចចិត្ត)",
  printerSave: "រក្សាទុក",
  printerSaved: "បានរក្សាទុក។",
  printerTest: "សាកល្បងបោះពុម្ព",
  printerTesting: "កំពុងបោះពុម្ព…",
  printerTestOk: "បានផ្ញើទៅម៉ាស៊ីនបោះពុម្ព។",
  printerNone: "មិនទាន់មានម៉ាស៊ីនបោះពុម្ពទេ។",
  printerBadHost: "អាសយដ្ឋាននេះមិនត្រឹមត្រូវទេ។",
  printerBadPort: "ច្រកនេះមិនត្រឹមត្រូវទេ។",
  printerUsbNote: "ម៉ាស៊ីនបោះពុម្ព USB មិនទាន់ត្រូវបានគាំទ្រនៅអេក្រង់នេះទេ។",

  devHostname: "ឈ្មោះម៉ាស៊ីន",
  devSerial: "លេខសៀរៀល",
  devClass: "ប្រភេទឧបករណ៍",
  devImage: "កំណែរូបភាព",
  devEnvironment: "បរិស្ថាន",

  dispBrightness: "ពន្លឺអេក្រង់",
  dispNoBacklight: "អេក្រង់នេះមិនអាចកែពន្លឺបានទេ។",
  dispLanguage: "ភាសា",

  configUnavailable: "មិនអាចកំណត់ឧបករណ៍នេះពីទីនេះបានទេ។",
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
  pairingPaired: "Paired. This terminal now belongs to the shop.",
  pairingRefused: "That code was not accepted. Check it, or make a new one in the Partner Portal.",
  pairingLocked: "Too many attempts. Make a new code in the Partner Portal.",
  pairingAlreadyAssigned: "This terminal is already assigned to a shop.",
  pairingNotRegistered: "This terminal has not registered with KitLuy yet.",
  pairingUnreachable: "Could not reach KitLuy. Check the network.",
  pairingFailed: "Pairing could not be completed.",

  assignedTitle: "Assigned to a Store",
  assignedBody: "This terminal is assigned to a Store. It will finish setting up on its own.",
  pinCreateTitle: "Create the terminal PIN",
  pinCreateIntro: "Enter 4 digits. The Store Hub keeps this PIN; it unlocks this terminal.",
  pinConfirmTitle: "Confirm the PIN",
  pinConfirmIntro: "Enter the same 4 digits again.",
  pinMismatch: "The two entries differ. Try again.",
  pinRefused: "The Store Hub did not accept the PIN",
  pinStarting: "The Store Hub is not connected yet — try again in a moment.",
  installingTitle: "Installing KitLuy",
  installingWaiting: "Asking the Store for the application…",
  installingActivating: "Installing…",
  installingHealth: "Checking the installation…",
  installingFailed: "The installation failed. The device retries with a newer version.",

  switchLanguage: "ខ្មែរ",

  settings: "Settings",
  settingsClose: "Close",
  tabNetwork: "Network",
  tabPrinter: "Printer",
  tabDevice: "Device",
  tabDisplay: "Display",

  netConnectedWired: "Connected by Ethernet",
  netConnectedWireless: "Connected by Wi-Fi",
  netDisconnected: "No network connection",
  netScan: "Scan for networks",
  netScanning: "Scanning…",
  netNoneFound: "No networks found.",
  netSecured: "Password required",
  netOpen: "Open",
  netPassword: "Wi-Fi password",
  netJoin: "Join",
  netJoining: "Joining…",
  netJoined: "Connected.",
  netForget: "Forget this network",
  netSaved: "A network is already saved",

  printerHost: "Printer address",
  printerPort: "Port (default 9100)",
  printerLabel: "Name (optional)",
  printerSave: "Save",
  printerSaved: "Saved.",
  printerTest: "Test print",
  printerTesting: "Printing…",
  printerTestOk: "Sent to the printer.",
  printerNone: "No printer has been set up yet.",
  printerBadHost: "That address is not valid.",
  printerBadPort: "That port is not valid.",
  printerUsbNote: "USB printers are not supported from this screen yet.",

  devHostname: "Hostname",
  devSerial: "Serial",
  devClass: "Device class",
  devImage: "Image version",
  devEnvironment: "Environment",

  dispBrightness: "Screen brightness",
  dispNoBacklight: "This screen's brightness cannot be adjusted.",
  dispLanguage: "Language",

  configUnavailable: "This device cannot be configured from here.",
};

export const MESSAGES: Readonly<Record<KitluyLocale, ShellMessages>> = {
  "km-KH": km,
  "en-US": en,
};

export function messagesFor(locale: KitluyLocale): ShellMessages {
  return MESSAGES[locale];
}

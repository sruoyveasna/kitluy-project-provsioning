/**
 * T1 intake localization — WS-12-T002-P02 §7. Governed km-KH/en-US keys;
 * workflow logic renders THESE, never embedded operational English.
 *
 * VOCABULARY DISCIPLINE (§6/§7): the artifact is a "Laundry Booking DRAFT"
 * (ព្រាងការកក់បោកគក់) — never a confirmed or completed Booking, and no
 * payment or final-price wording exists anywhere in this table.
 */
import type { KitluyLocale } from "@kitluy/localization";

export type IntakeStringKey =
  | "search_title"
  | "search_placeholder"
  | "search_no_result"
  | "search_ambiguous"
  | "search_offline"
  | "search_unavailable"
  | "phone_unverified"
  | "phone_verified"
  | "customer_local_created"
  | "customer_pending_sync"
  | "customer_stale_projection"
  | "customer_conflict"
  | "consent_privacy_ack"
  | "consent_operational"
  | "consent_sms_marketing"
  | "consent_telegram_marketing"
  | "consent_email_marketing"
  | "consent_staff_assisted"
  | "consent_withdrawn"
  | "draft_title"
  | "draft_ready"
  | "draft_pending_sync"
  | "draft_conflict"
  | "draft_save"
  | "draft_cancel"
  | "draft_customer_notes"
  | "draft_staff_notes"
  | "walk_in";

export const INTAKE_STRINGS: Record<IntakeStringKey, Record<KitluyLocale, string>> = {
  search_title: { "km-KH": "ស្វែងរកអតិថិជន", "en-US": "Customer search" },
  search_placeholder: { "km-KH": "លេខទូរស័ព្ទ", "en-US": "Phone number" },
  search_no_result: { "km-KH": "រកមិនឃើញអតិថិជនទេ", "en-US": "No customer found" },
  search_ambiguous: {
    "km-KH": "មានអតិថិជនច្រើននាក់ត្រូវគ្នា — សូមជ្រើសរើសដោយផ្ទាល់",
    "en-US": "Multiple customers match — choose one explicitly",
  },
  search_offline: {
    "km-KH": "ការស្វែងរកមិនអាចប្រើបានទេឥឡូវនេះ (ក្រៅបណ្ដាញ)",
    "en-US": "Search is unavailable right now (offline)",
  },
  search_unavailable: {
    "km-KH": "ការស្វែងរកមិនអាចប្រើបានទេឥឡូវនេះ",
    "en-US": "Search is unavailable right now",
  },
  phone_unverified: { "km-KH": "លេខទូរស័ព្ទមិនទាន់ផ្ទៀងផ្ទាត់", "en-US": "Phone not verified" },
  phone_verified: { "km-KH": "លេខទូរស័ព្ទបានផ្ទៀងផ្ទាត់", "en-US": "Phone verified" },
  customer_local_created: {
    "km-KH": "បង្កើតនៅក្នុងហាង (មិនទាន់បញ្ជូន)",
    "en-US": "Created in store (locally)",
  },
  customer_pending_sync: {
    "km-KH": "កំពុងរង់ចាំការធ្វើសមកាលកម្ម",
    "en-US": "Pending synchronization",
  },
  customer_stale_projection: {
    "km-KH": "ទិន្នន័យអតិថិជនអាចមិនទាន់សម័យ",
    "en-US": "Customer data may be out of date",
  },
  customer_conflict: {
    "km-KH": "មានទំនាស់ទិន្នន័យ — ត្រូវការការដោះស្រាយ",
    "en-US": "Data conflict — needs resolution",
  },
  consent_privacy_ack: {
    "km-KH": "ការទទួលស្គាល់សេចក្ដីជូនដំណឹងឯកជនភាព",
    "en-US": "Privacy notice acknowledgement",
  },
  consent_operational: {
    "km-KH": "ការទាក់ទងប្រតិបត្តិការ",
    "en-US": "Operational communication",
  },
  consent_sms_marketing: { "km-KH": "ទីផ្សារតាម SMS", "en-US": "SMS marketing" },
  consent_telegram_marketing: { "km-KH": "ទីផ្សារតាម Telegram", "en-US": "Telegram marketing" },
  consent_email_marketing: { "km-KH": "ទីផ្សារតាមអ៊ីមែល", "en-US": "Email marketing" },
  consent_staff_assisted: {
    "km-KH": "កត់ត្រាដោយបុគ្គលិកជួយ",
    "en-US": "Recorded with staff assistance",
  },
  consent_withdrawn: { "km-KH": "បានដកការយល់ព្រម", "en-US": "Consent withdrawn" },
  draft_title: { "km-KH": "ព្រាងការកក់បោកគក់", "en-US": "Laundry Booking Draft" },
  draft_ready: { "km-KH": "ព្រាងរួចរាល់", "en-US": "Draft ready" },
  draft_pending_sync: {
    "km-KH": "ព្រាង — កំពុងរង់ចាំការធ្វើសមកាលកម្ម",
    "en-US": "Draft — pending synchronization",
  },
  draft_conflict: { "km-KH": "ព្រាង — មានទំនាស់", "en-US": "Draft — conflict" },
  draft_save: { "km-KH": "រក្សាទុក", "en-US": "Save" },
  draft_cancel: { "km-KH": "បោះបង់ព្រាង", "en-US": "Cancel draft" },
  draft_customer_notes: { "km-KH": "កំណត់ចំណាំអតិថិជន", "en-US": "Customer notes" },
  draft_staff_notes: {
    "km-KH": "កំណត់ចំណាំបុគ្គលិក (ផ្ទៃក្នុង)",
    "en-US": "Staff notes (internal)",
  },
  walk_in: { "km-KH": "អតិថិជនមិនចុះឈ្មោះ", "en-US": "Walk-in customer" },
};

export function intakeString(key: IntakeStringKey, locale: KitluyLocale): string {
  return INTAKE_STRINGS[key][locale];
}

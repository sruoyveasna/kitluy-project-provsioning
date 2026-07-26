/** Pure localization module — safe to import without React Native. */
export const PRODUCT_NAME = "kitluy-partner-app" as const;

export const MESSAGES = {
  "km-KH": {
    title: "Partner App",
    signedOut: "ការផ្ទៀងផ្ទាត់មិនទាន់ដំណើរការទេ — កិច្ចសន្យាកំពុងរង់ចាំ។",
    scaffold: "គ្រោងសាងតែប៉ុណ្ណោះ — គ្មានទិន្នន័យប្រតិបត្តិការពិតទេ។",
  },
  "en-US": {
    title: "Partner App",
    signedOut: "Sign-in is not yet available — the authentication contract is pending.",
    scaffold: "Scaffold only — no real operational data exists.",
  },
} as const;

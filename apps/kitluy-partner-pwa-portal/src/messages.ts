/**
 * Operator-facing text, in both supported locales.
 *
 * Khmer is FIRST because it is the default locale of this portal — the people
 * opening a shop's Store Hub read Khmer, and a Khmer string added as an
 * afterthought is the one that ends up missing.
 *
 * Nothing here names a permission, a role, a table or a refusal code. A Partner
 * cannot act on "KLUY-AUTH-SCOPE-DENIED"; they can act on "this account is not
 * set up for that shop".
 */
export const MESSAGES = {
  "km-KH": {
    title: "ការភ្ជាប់ Store Hub",
    intro:
      "បង្កើតលេខកូដ រួចវាយវាចូលក្នុង Store Hub នៅហាងរបស់អ្នក។ លេខកូដមានសុពលភាព ១៥ នាទី ហើយប្រើបានតែម្តងគត់។",
    signIn: "ចូលគណនី",
    email: "អ៊ីមែល",
    password: "ពាក្យសម្ងាត់",
    signingIn: "កំពុងចូល…",
    signOut: "ចាកចេញ",
    store: "ហាង",
    location: "ទីតាំង",
    generate: "បង្កើតលេខកូដ",
    generating: "កំពុងបង្កើត…",
    codeHeading: "វាយលេខកូដនេះចូល Store Hub",
    expiresIn: "ផុតកំណត់ក្នុងរយៈពេល",
    expired: "លេខកូដផុតកំណត់ហើយ។ សូមបង្កើតលេខកូដថ្មី។",
    shownOnce: "លេខកូដនេះបង្ហាញតែម្តងគត់។ វាមិនអាចមើលឡើងវិញបានទេ។",
    replaced: "លេខកូដចាស់សម្រាប់ហាងនេះលែងដំណើរការហើយ។",
    pairedHeading: "ភ្ជាប់ជោគជ័យ",
    pairedDetail:
      "Store Hub បានភ្ជាប់ជាមួយហាងនេះហើយ។ វាកំពុងរង់ចាំការផ្តល់វិញ្ញាបនបត្រ មុនពេលអាចបម្រើម៉ាស៊ីនលក់បាន។",
    pairedDevice: "ឧបករណ៍",
    waitingForHub: "កំពុងរង់ចាំ Store Hub វាយលេខកូដនេះ…",
    attemptsFailed: "ការព្យាយាមខុស",
    lockedOut: "លេខកូដនេះត្រូវបានចាក់សោដោយសារព្យាយាមខុសច្រើនដង។ សូមបង្កើតលេខកូដថ្មី។",
    noStores: "គណនីនេះមិនទាន់ភ្ជាប់ជាមួយហាងណាមួយទេ។",
    noLocation: "ហាងនេះមិនទាន់មានទីតាំងទេ។ សូមបន្ថែមទីតាំងជាមុនសិន។",
    // Failures
    missingEmail: "សូមបញ្ចូលអ៊ីមែល។",
    missingPassword: "សូមបញ្ចូលពាក្យសម្ងាត់។",
    invalidCredentials: "អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។",
    networkError: "មិនអាចទាក់ទងសេវាបានទេ។ សូមពិនិត្យបណ្តាញ។",
    unexpectedError: "មានបញ្ហាមិនរំពឹងទុក។",
    sessionExpired: "វគ្គរបស់អ្នកផុតកំណត់។ សូមចូលម្តងទៀត។",
    denied: "គណនីនេះមិនមានសិទ្ធិសម្រាប់ហាងនេះទេ។",
    unavailable: "សេវាភ្ជាប់មិនអាចប្រើបានទេ។",
  },
  "en-US": {
    title: "Store Hub pairing",
    intro:
      "Generate a code, then type it into the Store Hub at your shop. It is valid for 15 minutes and can be used once.",
    signIn: "Sign in",
    email: "Email",
    password: "Password",
    signingIn: "Signing in…",
    signOut: "Sign out",
    store: "Shop",
    location: "Location",
    generate: "Generate code",
    generating: "Generating…",
    codeHeading: "Type this code into the Store Hub",
    expiresIn: "Expires in",
    expired: "This code has expired. Generate a new one.",
    shownOnce: "This code is shown once. It cannot be retrieved again.",
    replaced: "Any code issued earlier for this shop has stopped working.",
    pairedHeading: "Paired",
    pairedDetail:
      "The Store Hub is now assigned to this shop. It is waiting on a certificate before it can serve tills.",
    pairedDevice: "Device",
    waitingForHub: "Waiting for a Store Hub to type this code…",
    attemptsFailed: "Failed attempts",
    lockedOut: "This code is locked after too many wrong attempts. Generate a new one.",
    noStores: "This account is not linked to any shop yet.",
    noLocation: "This shop has no Location yet. Add one before pairing a Store Hub.",
    // Failures
    missingEmail: "Enter your email.",
    missingPassword: "Enter your password.",
    invalidCredentials: "That email or password is not correct.",
    networkError: "The service could not be reached. Check your connection.",
    unexpectedError: "Something unexpected went wrong.",
    sessionExpired: "Your session has expired. Sign in again.",
    denied: "This account does not have access to that shop.",
    unavailable: "The pairing service is unavailable.",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en-US"];

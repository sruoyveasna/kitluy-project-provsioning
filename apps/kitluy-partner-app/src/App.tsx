/**
 * Partner App — React Native shell (SCAFFOLDED, typecheck-only).
 *
 * The approved target stack is React Native + Expo + Expo Router (engineering
 * default; see ADR-0002). Generating the full Expo application is the next
 * app milestone — this scaffold pins the product boundary, localization and
 * fail-closed rules so the Expo app starts from the correct contracts.
 * Source spec: kitluy-partner-app-phase1-spec-v2.0.0.md.
 */
import { SafeAreaView, Text, View } from "react-native";
import { useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";

export { MESSAGES, PRODUCT_NAME } from "./messages.js";
import { MESSAGES } from "./messages.js";

export default function App() {
  const [locale] = useState<KitluyLocale>("km-KH");
  // Fail closed: no authenticated area is reachable until the auth and data
  // contracts exist. No synthetic operational values.
  return (
    <SafeAreaView>
      <View accessibilityLabel="signed-out">
        <Text accessibilityRole="header">{MESSAGES[locale].title}</Text>
        <Text>{MESSAGES[locale].signedOut}</Text>
        <Text>{MESSAGES[locale].scaffold}</Text>
      </View>
    </SafeAreaView>
  );
}

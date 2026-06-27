// The accounting plugin's OWN vue-i18n instance — fully self-contained, sharing
// no i18n resources with the host. Components call `useAccountingI18n()` instead
// of vue-i18n's `useI18n()`, so the keys (`pluginAccounting.*`) stay identical —
// only the source changes.
//
// The active locale is fed through the AccountingHostContext binding
// (`hostLocaleTag()`), not gui-chat-protocol's PLUGIN_RUNTIME_KEY: the host
// injects it once at startup (the same DI seam as `apiCall` / `subscribe`), and
// one detached, app-lifetime effect keeps this instance's locale in step with
// the host's.

import { createI18n } from "vue-i18n";
import { effectScope, watchEffect } from "vue";
import { hostLocaleTag } from "../hostContext";
import enMessages, { type AccountingMessages } from "./en";
import jaMessages from "./ja";
import zhMessages from "./zh";
import koMessages from "./ko";
import esMessages from "./es";
import ptBRMessages from "./ptBR";
import frMessages from "./fr";
import deMessages from "./de";

const i18n = createI18n<[AccountingMessages], string, false>({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: enMessages,
    ja: jaMessages,
    zh: zhMessages,
    ko: koMessages,
    es: esMessages,
    "pt-BR": ptBRMessages,
    fr: frMessages,
    de: deMessages,
  },
});

const syncScope = effectScope(true);
let syncing = false;

/** Mirror the host's active locale onto this instance exactly once, in a detached
 *  effect so it lives for the app's lifetime rather than a single component's.
 *  Called lazily on the first `useAccountingI18n()` — by then the host has called
 *  `configureAccountingHost(...)`, so `hostLocaleTag()` resolves. */
function ensureLocaleSync(): void {
  if (syncing) return;
  // Flip the flag only after the effect is wired — if the first locale read
  // throws (e.g. the binding isn't configured yet), a later call can retry
  // rather than being locked out forever.
  syncScope.run(() => {
    watchEffect(() => {
      i18n.global.locale.value = hostLocaleTag();
    });
  });
  syncing = true;
}

/** The plugin's i18n composable — a drop-in for vue-i18n's `useI18n()` over the
 *  plugin's own self-contained instance. Returns `{ t, locale }` (destructured at
 *  the call site, exactly like `useI18n()`), with `t` reading the plugin's keys
 *  and `locale` the reactive tag for date/number formatting. */
export function useAccountingI18n(): { t: (typeof i18n.global)["t"]; locale: (typeof i18n.global)["locale"] } {
  ensureLocaleSync();
  return { t: i18n.global.t, locale: i18n.global.locale };
}

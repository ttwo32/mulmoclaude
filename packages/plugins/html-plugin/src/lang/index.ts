import { computed, inject, ref, type ComputedRef, type Ref } from "vue";
import { PLUGIN_RUNTIME_KEY } from "gui-chat-protocol/vue";
import type { Messages } from "./messages";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import ptBR from "./ptBR";
import zh from "./zh";

const MESSAGES = { de, en, es, fr, ja, ko, "pt-BR": ptBR, zh } as const;

type SupportedLocale = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is SupportedLocale {
  return value in MESSAGES;
}

/** Reactive message bundle for the active host locale. The plugin carries its
 *  own translations (no host i18n dependency); it reads the locale off the
 *  injected `BrowserPluginRuntime.locale` ref and falls back to English. */
export function useT(): ComputedRef<Messages> {
  const runtime = inject(PLUGIN_RUNTIME_KEY, undefined);
  const locale: Ref<string> = runtime?.locale ?? ref("en");
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}

export type { Messages };

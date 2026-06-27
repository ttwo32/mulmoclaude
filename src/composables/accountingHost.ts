// Wire @mulmoclaude/accounting-plugin/vue to this host's network client
// and raw pub/sub transport. Side-effect module: imported once from
// main.ts before app.mount(), so the seams are set before any accounting
// View mounts. Mirrors composables/collections/uiHost.ts.
//
// The package ships its own Tailwind utilities (the host's content scan
// doesn't reach node_modules), so we import its stylesheet here too.

import "@mulmoclaude/accounting-plugin/style.css";
import { configureAccountingHost } from "@mulmoclaude/accounting-plugin/vue";
import { unref } from "vue";
import { apiCall } from "../utils/api";
import { usePubSub } from "./usePubSub";
import hostI18n from "../lib/vue-i18n";

const { subscribe } = usePubSub();

configureAccountingHost({
  apiCall,
  subscribe,
  // `i18n.global.locale` is typed as a string but is actually a Ref at runtime
  // (the host runs vue-i18n in composition mode); `unref` returns the tag either way.
  localeTag: () => unref(hostI18n.global.locale),
});

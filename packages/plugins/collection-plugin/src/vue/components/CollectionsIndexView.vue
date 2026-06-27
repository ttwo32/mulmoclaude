<template>
  <div class="h-full overflow-y-auto bg-slate-50/50 px-6 py-6" data-testid="collections-view-root">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-semibold text-slate-800">
            {{ t("collectionsView.title") }}
          </h1>
          <div class="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              class="px-3 h-7 rounded-md text-xs font-semibold transition-colors"
              :class="tab === 'installed' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
              data-testid="collections-tab-installed"
              @click="tab = 'installed'"
            >
              {{ t("collectionsView.discover.installedTab") }}
            </button>
            <button
              type="button"
              class="px-3 h-7 rounded-md text-xs font-semibold transition-colors"
              :class="tab === 'discover' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
              data-testid="collections-tab-discover"
              @click="tab = 'discover'"
            >
              {{ t("collectionsView.discover.tab") }}
            </button>
          </div>
        </div>
        <button
          v-if="tab === 'installed'"
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-sm"
          data-testid="collections-add-collection"
          @click="startCreateCollectionChat"
        >
          <span class="material-icons text-sm">add</span>
          <span>{{ t("collectionsView.addCollectionLabel") }}</span>
        </button>
      </div>

      <DiscoverPanel v-if="tab === 'discover'" @imported="loadCollections" />
      <template v-else>
        <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-sm text-slate-500 gap-3">
          <div class="h-8 w-8 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
          <span>{{ t("common.loading") }}</span>
        </div>

        <div v-else-if="loadError" class="rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3">
          <span class="material-icons text-red-600">error</span>
          <span>{{ t("collectionsView.loadFailed") }}: {{ loadError }}</span>
        </div>

        <div v-else-if="collections.length === 0" class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
          <span class="material-icons text-4xl text-slate-300 mb-2">dashboard_customize</span>
          <p class="font-medium text-slate-700">{{ t("collectionsView.indexEmpty") }}</p>
        </div>

        <div v-else class="grid gap-4 sm:grid-cols-2">
          <div
            v-for="collection in collections"
            :key="collection.slug"
            class="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-300 cursor-pointer flex items-center gap-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            role="button"
            tabindex="0"
            :aria-label="t('collectionsView.openCollection', { title: collection.title })"
            :data-testid="`collections-index-card-${collection.slug}`"
            @click="openCollection(collection.slug)"
            @keydown.enter.self="openCollection(collection.slug)"
            @keydown.space.self.prevent="openCollection(collection.slug)"
          >
            <!-- Left border color line showing source -->
            <div
              class="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-all duration-300 group-hover:w-1.5"
              :class="collection.source === 'project' ? 'bg-indigo-600' : 'bg-violet-600'"
            ></div>

            <!-- Styled icon badge -->
            <div
              class="h-12 w-12 flex items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-105 shadow-sm"
              :class="
                collection.source === 'project'
                  ? 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/80 border border-indigo-100/50'
                  : 'bg-violet-50 text-violet-600 group-hover:bg-violet-100/80 border border-violet-100/50'
              "
            >
              <span class="material-symbols-outlined text-2xl">{{ collection.icon }}</span>
            </div>

            <div class="flex-1 min-w-0">
              <span class="block font-semibold text-slate-800 text-[15px] group-hover:text-indigo-950 transition-colors truncate">
                {{ collection.title }}
              </span>
              <span class="block text-[10px] text-slate-400 mt-1 tracking-wider font-semibold uppercase flex items-center gap-1.5">
                <span class="h-1.5 w-1.5 rounded-full" :class="collection.source === 'project' ? 'bg-indigo-500' : 'bg-violet-500'"></span>
                {{ t(`collectionsView.source.${collection.source}`) }} ·
                <code class="text-[10px] bg-slate-100 px-1 rounded lowercase text-slate-500 font-mono font-normal">{{ collection.slug }}</code>
              </span>
            </div>

            <component :is="pinToggle" kind="collection" :slug="collection.slug" :title="collection.title" :icon="collection.icon" />

            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all duration-300"
              :title="t('collectionsView.contribute')"
              :aria-label="t('collectionsView.contribute')"
              :data-testid="`collections-contribute-${collection.slug}`"
              @click.stop="startContributeChat(collection)"
            >
              <span class="material-icons text-lg">ios_share</span>
            </button>

            <div
              class="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-50 group-hover:bg-indigo-50 text-slate-400 group-hover:text-indigo-600 transition-all duration-300"
            >
              <span class="material-icons text-lg transition-transform duration-300 group-hover:translate-x-0.5">chevron_right</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useCollectionI18n } from "../lang";
import { collectionUi } from "../uiContext";
import DiscoverPanel from "./DiscoverPanel.vue";
import type { CollectionSummary } from "@mulmoclaude/core/collection";

const { t } = useCollectionI18n();
// Host couplings (list/navigate/chat/shortcuts/pin) via the injected binding.
const cui = collectionUi();
const { pinToggle, reconcileShortcuts } = cui;

const tab = ref<"installed" | "discover">("installed");
const collections = ref<CollectionSummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadCollections(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const result = await cui.listCollections();
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  // Feeds (source "feed") have their own /feeds surface — keep the
  // Collections index to skill-backed collections so they don't double-list.
  collections.value = result.data.collections.filter((collection) => collection.source !== "feed");
  // Bulk-reconcile pinned collection shortcuts against this authoritative
  // list (free — we already fetched it): prune dead slugs, refresh stale
  // titles/icons, self-heal the file. Feed shortcuts are left to FeedsView.
  void reconcileShortcuts(
    "collection",
    collections.value.map((collection) => ({ slug: collection.slug, title: collection.title, icon: collection.icon })),
  );
}

function openCollection(slug: string): void {
  cui.gotoDetail("collection", slug);
}

function startCreateCollectionChat(): void {
  cui.startChat(t("collectionsView.addCollectionPrompt"), cui.generalRoleId);
}

// Defence against prompt injection via collection metadata. CodeRabbit
// flagged title + slug as untrusted data interpolated straight into an
// agent instruction that can drive git / gh. The slug is already
// constrained to [a-z0-9-]+ at the schema layer, but title is free-
// form and a crafted value (newlines, angle brackets, Unicode line
// separators) could plausibly steer the agent off the contribute path
// into something unintended. Strip the structural attack surface
// before the values reach the prompt template; plain text still
// travels through, but without markers it can use to fabricate the
// appearance of a new instruction line or escape the surrounding
// context. Applied to the AGENT prompt only — the confirm dialog
// below renders the untouched title so the user sees what they're
// about to share.
/* eslint-disable no-control-regex -- intentional: we strip ASCII control chars from untrusted user input */
function sanitizeForPrompt(value: string): string {
  return (
    value
      // ASCII control chars (incl. CR / LF / tab) → space.
      .replace(/[\x00-\x1f\x7f]/g, " ")
      // Unicode line / paragraph separators (U+2028 / U+2029). Some
      // string-rendering paths and LLM tokenizers treat these as real
      // line breaks, so a crafted title containing one could visually
      // smuggle a new "line" of instruction past a reader scanning the
      // prompt (Codex follow-up on the ASCII-only first pass).
      .replace(/[\u2028\u2029]/g, " ")
      // Angle brackets — can't open or close a wrapper tag.
      .replace(/[<>]/g, "")
      .trim()
  );
}
/* eslint-enable no-control-regex */

// Contributing runs an agent that exports the collection and opens a GitHub PR —
// confirm before launching so a stray click doesn't start a share unprompted.
async function startContributeChat(collection: CollectionSummary): Promise<void> {
  const confirmed = await cui.confirm({
    message: t("collectionsView.contributeConfirm", { title: collection.title }),
    confirmText: t("collectionsView.contribute"),
    variant: "primary",
  });
  if (!confirmed) return;
  const title = sanitizeForPrompt(collection.title);
  const slug = sanitizeForPrompt(collection.slug);
  cui.startChat(t("collectionsView.contributePrompt", { title, slug }), cui.generalRoleId);
}

onMounted(loadCollections);
</script>

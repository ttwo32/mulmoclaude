<template>
  <div class="p-3">
    <div class="text-sm font-bold text-slate-700 mb-2">{{ t("collectionsView.feedsTitle") }}</div>
    <div v-if="feeds.length === 0" class="text-sm text-slate-500" data-testid="feeds-empty">{{ t("collectionsView.feedsEmpty") }}</div>
    <ul v-else class="space-y-1" data-testid="feeds-list">
      <li v-for="feed in feeds" :key="feed.slug">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-left transition-colors"
          :data-testid="`feeds-row-${feed.slug}`"
          @click="open(feed.slug)"
        >
          <span class="material-icons text-base text-indigo-600">{{ feed.icon || "rss_feed" }}</span>
          <span class="font-medium text-slate-800 truncate">{{ feed.title }}</span>
          <span class="text-[11px] text-slate-500 whitespace-nowrap">{{ feed.kind }} · {{ feed.schedule }}</span>
          <span v-if="feed.lastFetchedAt" class="ml-auto text-[11px] text-slate-400 whitespace-nowrap">{{ formatTime(feed.lastFetchedAt) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { PAGE_ROUTES } from "../../router/pageRoutes";
import type { FeedSummary, ManageFeedData } from "./index";

const props = defineProps<{ selectedResult: ToolResultComplete<ManageFeedData> }>();
const { t } = useI18n();
const router = useRouter();

const feeds = computed<FeedSummary[]>(() => props.selectedResult.data?.feeds ?? []);

function open(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
</script>

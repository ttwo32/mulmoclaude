<template>
  <div class="p-2 text-sm">
    <div class="font-medium text-gray-700 truncate mb-1">
      {{ title }}
    </div>
    <div v-if="hint" class="text-xs text-gray-500 leading-relaxed truncate">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { FeedSummary, ManageFeedData } from "./index";

const props = defineProps<{ result: ToolResultComplete<ManageFeedData> }>();

const data = computed(() => props.result.data);
const title = computed(() => "Data-source feeds");

const hint = computed(() => {
  const feeds = data.value?.feeds ?? [];
  if (feeds.length === 0) return "No feeds registered yet.";
  const names = feeds
    .slice(0, 3)
    .map((feed: FeedSummary) => feed.slug)
    .join(", ");
  const tail = feeds.length > 3 ? ", …" : "";
  const plural = feeds.length === 1 ? "" : "s";
  return `${feeds.length} feed${plural}: ${names}${tail}`;
});
</script>

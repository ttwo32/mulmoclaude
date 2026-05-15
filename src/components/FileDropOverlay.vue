<template>
  <!-- pointer-events-none so the overlay never absorbs the drop —
       the real handler stays on the parent element. -->
  <div
    class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-blue-50/40"
    data-testid="chat-drop-overlay"
  >
    <span class="rounded bg-white/90 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm">
      {{ t("chatInput.dropHint") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

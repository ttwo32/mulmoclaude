<template>
  <!-- Centered modal shell for a collection record's open/edit panel. Used
       by every non-calendar view mode (table / kanban / dashboard) and the
       calendar's undated tray, so opening an item is a consistent popup
       everywhere. Calendar's dated records keep their own day-view modal
       (CollectionDayView), which embeds the same panel on its right. Teleported
       to <body> so an embedded card's transformed ancestor can't trap the
       fixed overlay. Backdrop click / Escape both emit `close`; the host
       decides whether that cancels an edit or closes the detail. -->
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" data-testid="collections-record-modal" @click.self="emit('close')">
      <div
        ref="dialogEl"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

const emit = defineEmits<{ close: [] }>();

const dialogEl = ref<HTMLDivElement | null>(null);

// Focus the dialog on open so Escape (bound on the dialog) fires even
// before the user clicks into a field, and focus leaves the row behind it.
onMounted(async () => {
  await nextTick();
  dialogEl.value?.focus();
});
</script>

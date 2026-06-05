<template>
  <div class="border-t border-gray-200 shrink-0 bg-gray-50">
    <SuggestionsPanel
      v-model:expanded="suggestionsExpanded"
      :queries="suggestions"
      :trigger-ref="suggestionsBtnRef"
      @send="onSuggestionSend"
      @edit="onSuggestionEdit"
    />
    <div class="px-4 py-3 flex gap-2 relative">
      <SlashCommandMenu
        v-if="slashMenuOpen"
        :items="slashItems"
        :highlighted-index="slashHighlightedIndex"
        @select="selectSlashSkill"
        @hover="slashMenu.setHighlight($event)"
      />
      <textarea
        ref="textareaRef"
        v-model="draft"
        :data-testid="`${testIdPrefix}-input`"
        :placeholder="placeholder"
        rows="2"
        class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none"
        @compositionstart="imeEnter.onCompositionStart"
        @compositionend="imeEnter.onCompositionEnd"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <div class="flex flex-col gap-1 shrink-0">
        <button
          ref="suggestionsBtnRef"
          :data-testid="`${testIdPrefix}-suggestions`"
          class="rounded w-8 h-8 flex items-center justify-center"
          :class="suggestionsExpanded ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'"
          :title="t('suggestionsPanel.tooltip')"
          :aria-label="t('suggestionsPanel.tooltip')"
          @click="suggestionsExpanded = !suggestionsExpanded"
        >
          <span class="material-icons text-base leading-none">lightbulb</span>
        </button>
        <button
          :data-testid="`${testIdPrefix}-send`"
          class="bg-blue-600 hover:bg-blue-700 text-white rounded w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          :title="t('common.sendChat')"
          :aria-label="t('common.sendChat')"
          :disabled="!canSend"
          @click="submit"
        >
          <span class="material-icons text-base leading-none">send</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppApi } from "../composables/useAppApi";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";
import { useSkillsList, type SkillSummary } from "../composables/useSkillsList";
import { useSlashCommandMenu } from "../composables/useSlashCommandMenu";
import SlashCommandMenu from "./SlashCommandMenu.vue";
import SuggestionsPanel from "./SuggestionsPanel.vue";

const props = withDefaults(
  defineProps<{
    placeholder: string;
    prependText: string;
    disabled?: boolean;
    testIdPrefix?: string;
    allowEmpty?: boolean;
    suggestions?: string[];
  }>(),
  { disabled: false, testIdPrefix: "page-chat", allowEmpty: false, suggestions: () => [] },
);

const { t } = useI18n();
const appApi = useAppApi();
const draft = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const suggestionsExpanded = ref(false);
const suggestionsBtnRef = ref<HTMLButtonElement | null>(null);

const canSend = computed(() => !props.disabled && (props.allowEmpty || draft.value.trim().length > 0));

function submitText(text: string) {
  const trimmed = text.trim();
  if (!trimmed && !props.allowEmpty) return;
  const prompt = trimmed ? `${props.prependText}\n\n${trimmed}` : props.prependText;
  draft.value = "";
  appApi.startNewChat(prompt);
}

function submit() {
  if (props.disabled) return;
  submitText(draft.value);
}

function onSuggestionSend(query: string) {
  if (props.disabled) return;
  submitText(query);
}

function onSuggestionEdit(query: string) {
  draft.value = query;
  nextTick(() => textareaRef.value?.focus());
}

const imeEnter = useImeAwareEnter(submit);

// Inline "/" command palette — same behaviour as ChatInput, sharing the
// lightbulb Skills data store; keyboard interception runs ahead of `imeEnter`
// so Enter selects instead of sending.
const { skills, refresh: refreshSkills } = useSkillsList();
const slashMenu = useSlashCommandMenu(draft, () => skills.value);
const slashMenuOpen = slashMenu.isOpen;
const slashItems = slashMenu.items;
const slashHighlightedIndex = slashMenu.highlightedIndex;

watch(
  () => slashMenu.query.value,
  (query, prev) => {
    if (query !== null && prev === null) void refreshSkills();
  },
);
watch(slashMenuOpen, (open) => {
  if (open) suggestionsExpanded.value = false;
});

function onKeydown(event: KeyboardEvent): void {
  if (slashMenuOpen.value && handleSlashKeydown(event)) return;
  imeEnter.onKeydown(event);
}

function handleSlashKeydown(event: KeyboardEvent): boolean {
  if (event.isComposing) return false; // let IME own the keys mid-composition
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      slashMenu.moveHighlight(1);
      return true;
    case "ArrowUp":
      event.preventDefault();
      slashMenu.moveHighlight(-1);
      return true;
    case "Enter":
    case "Tab": {
      if (event.shiftKey) return false; // Shift+Enter = newline, Shift+Tab = focus out
      const skill = slashMenu.highlightedSkill.value;
      if (!skill) return false;
      event.preventDefault();
      selectSlashSkill(skill);
      return true;
    }
    case "Escape":
      event.preventDefault();
      slashMenu.dismiss();
      return true;
    default:
      return false;
  }
}

// Selection populates `/<name> ` (never sends); the trailing space closes the
// menu and lets the user type arguments.
function selectSlashSkill(skill: SkillSummary): void {
  draft.value = `/${skill.name} `;
  nextTick(() => {
    const field = textareaRef.value;
    field?.focus();
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  });
}

function onBlur(): void {
  imeEnter.onBlur();
  slashMenu.dismiss();
}
</script>

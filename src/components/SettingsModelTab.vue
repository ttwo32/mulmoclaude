<template>
  <div class="space-y-3" data-testid="settings-model-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.modelTab.description") }}</p>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-model-effort">{{ t("settingsModal.modelTab.effortLabel") }}</label>
      <select
        id="settings-model-effort"
        v-model="effortDraft"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="settings-model-effort-select"
        @change="save"
      >
        <option value="">{{ t("settingsModal.modelTab.effortUnset") }}</option>
        <option v-for="level in EFFORT_LEVELS" :key="level" :value="level">{{ level }}</option>
      </select>
      <p class="text-xs text-gray-500">{{ t("settingsModal.modelTab.helperText") }}</p>
    </div>

    <div v-if="loaded && !errorMessage" class="flex items-center gap-3 text-xs">
      <span :class="statusColour" data-testid="settings-model-status">
        {{ statusText }}
      </span>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-model-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

const { t } = useI18n();

const props = defineProps<{
  reloadToken: number;
}>();

const emit = defineEmits<{
  saved: [];
}>();

interface SettingsResponse {
  settings: { extraAllowedTools: string[]; effortLevel?: EffortLevel };
}

const effortDraft = ref<EffortLevel | "">("");
const storedEffort = ref<EffortLevel | "">("");
const loaded = ref(false);
const saving = ref(false);
const errorMessage = ref("");

// statusText / statusColour are only consumed when there is no
// errorMessage (the template hides the strip in that case), so the
// error branches don't need to be repeated here.
const statusText = computed(() => {
  if (saving.value) return t("common.saving");
  return storedEffort.value ? t("settingsModal.modelTab.configured", { level: storedEffort.value }) : t("settingsModal.modelTab.notConfigured");
});

const statusColour = computed(() => {
  if (saving.value) return "text-gray-500";
  return storedEffort.value ? "text-green-600" : "text-gray-500";
});

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.modelTab.loadError");
    return;
  }
  storedEffort.value = response.data.settings.effortLevel ?? "";
  effortDraft.value = storedEffort.value;
  loaded.value = true;
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (effortDraft.value === storedEffort.value) return;
  // Capture the submitted value before awaiting — if the user changes
  // the select again while this PUT is in flight, the second save()
  // would early-return on `saving=true`, and a naive
  // `storedEffort = effortDraft` assignment after await would store
  // the newer (unsaved) draft, masking later saves (codex review).
  const requested = effortDraft.value;
  saving.value = true;
  errorMessage.value = "";
  // Empty selection clears the field. The server merges patches over
  // on-disk state, so omitting effortLevel keeps the previous value —
  // we must send `null` to clear. Use undefined→omitted, "" → null.
  const payload: Record<string, unknown> = requested === "" ? { effortLevel: null } : { effortLevel: requested };
  const response = await apiPut<unknown>(API_ROUTES.config.settings, payload);
  saving.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.modelTab.saveError");
    return;
  }
  storedEffort.value = requested;
  emit("saved");
  // If the draft moved while we were in flight, re-trigger save so
  // the latest value reaches the server.
  if (effortDraft.value !== requested) {
    void save();
  }
}

watch(
  () => props.reloadToken,
  () => {
    void load();
  },
  { immediate: true },
);
</script>

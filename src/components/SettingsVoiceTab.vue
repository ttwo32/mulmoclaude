<template>
  <div class="space-y-3" data-testid="settings-voice-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.voiceTab.description") }}</p>
    <p class="text-xs text-gray-500" data-testid="settings-voice-requirements">{{ t("settingsModal.voiceTab.requirements") }}</p>

    <!-- Not a Mac / whisper binary missing: feature can't be enabled.
         Only shown once a status fetch succeeded (statusOk), so a fetch
         failure surfaces the load error below instead of this. -->
    <div
      v-if="statusOk && !status.capable"
      class="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-600"
      data-testid="settings-voice-unsupported"
    >
      {{ t("settingsModal.voiceTab.unsupported") }}
    </div>

    <template v-else-if="statusOk">
      <div class="flex items-start gap-3">
        <input
          id="settings-voice-enabled"
          v-model="enabled"
          type="checkbox"
          class="mt-1 h-4 w-4"
          :disabled="saving"
          data-testid="settings-voice-enabled-input"
          @change="onToggle"
        />
        <label for="settings-voice-enabled" class="flex-1">
          <span class="block text-sm font-medium text-gray-800">{{ t("settingsModal.voiceTab.enableLabel") }}</span>
          <span class="block text-xs text-gray-500 mt-0.5">{{ t("settingsModal.voiceTab.enableHint") }}</span>
        </label>
      </div>

      <label class="block">
        <span class="text-xs font-semibold text-gray-700">{{ t("settingsModal.voiceTab.modelLabel") }}</span>
        <select
          v-model="model"
          class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400 disabled:opacity-50"
          :disabled="saving"
          data-testid="settings-voice-model-select"
          @change="onModelChange"
        >
          <option v-for="name in MODEL_NAMES" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>

      <!-- Download progress / readiness -->
      <div v-if="enabled" class="flex items-center gap-2 text-xs" data-testid="settings-voice-status">
        <span v-if="status.model.state === 'downloading'" class="text-blue-600">
          {{ t("settingsModal.voiceTab.downloading", { percent: progressPercent }) }}
        </span>
        <span v-else-if="status.model.state === 'ready'" class="text-green-600">{{ t("settingsModal.voiceTab.ready") }}</span>
        <span v-else-if="status.model.state === 'error'" class="text-red-600">{{ t("settingsModal.voiceTab.downloadError") }}</span>
        <button
          v-if="status.model.state === 'error'"
          class="px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600"
          data-testid="settings-voice-retry-btn"
          @click="startDownload"
        >
          {{ t("settingsModal.voiceTab.retry") }}
        </button>
      </div>
    </template>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-voice-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import type { VoiceInputStatusResponse } from "../composables/useVoiceInput";

const { t } = useI18n();

const props = defineProps<{ reloadToken: number }>();

const MODEL_NAMES = ["large-v3-turbo", "small", "base"] as const;
const POLL_INTERVAL_MS = 1500;

const EMPTY_STATUS: VoiceInputStatusResponse = { capable: false, enabled: false, model: { name: "large-v3-turbo", state: "idle" } };

const status = ref<VoiceInputStatusResponse>(EMPTY_STATUS);
const enabled = ref(false);
const model = ref<string>("large-v3-turbo");
// True only once a status fetch SUCCEEDS — so a failed fetch shows the
// load error, not a misleading "unsupported on this machine".
const statusOk = ref(false);
const saving = ref(false);
const errorMessage = ref("");
let pollHandle: number | null = null;

const progressPercent = computed(() => Math.round((status.value.model.progress ?? 0) * 100));

function stopPolling(): void {
  if (pollHandle !== null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function refreshStatus(): Promise<void> {
  const response = await apiGet<VoiceInputStatusResponse>(API_ROUTES.transcribe.model);
  if (!response.ok) {
    statusOk.value = false;
    errorMessage.value = response.error || t("settingsModal.voiceTab.loadError");
    return;
  }
  statusOk.value = true;
  status.value = response.data;
  if (response.data.model.state !== "downloading") stopPolling();
}

function startPolling(): void {
  if (pollHandle !== null) return;
  pollHandle = window.setInterval(() => {
    void refreshStatus();
  }, POLL_INTERVAL_MS);
}

async function load(): Promise<void> {
  errorMessage.value = "";
  const configResponse = await apiGet<{ settings: { voiceInput?: { enabled: boolean; model?: string } } }>(API_ROUTES.config.base);
  if (!configResponse.ok) {
    errorMessage.value = t("settingsModal.voiceTab.loadError");
    return;
  }
  enabled.value = configResponse.data.settings.voiceInput?.enabled ?? false;
  model.value = configResponse.data.settings.voiceInput?.model ?? "large-v3-turbo";
  await refreshStatus();
  if (status.value.model.state === "downloading") startPolling();
}

async function persist(): Promise<boolean> {
  saving.value = true;
  errorMessage.value = "";
  const response = await apiPut<unknown>(API_ROUTES.config.settings, {
    voiceInput: { enabled: enabled.value, model: model.value },
  });
  saving.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.voiceTab.saveError");
    return false;
  }
  return true;
}

async function startDownload(): Promise<void> {
  const response = await apiPost<VoiceInputStatusResponse>(API_ROUTES.transcribe.modelDownload);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.voiceTab.downloadError");
    return;
  }
  status.value = response.data;
  if (response.data.model.state === "downloading") startPolling();
}

async function onToggle(): Promise<void> {
  if (!(await persist())) {
    enabled.value = !enabled.value;
    return;
  }
  if (enabled.value && status.value.model.state !== "ready") await startDownload();
}

async function onModelChange(): Promise<void> {
  if (!(await persist())) return;
  await refreshStatus();
  if (enabled.value && status.value.model.state !== "ready") await startDownload();
}

watch(
  () => props.reloadToken,
  () => {
    void load();
  },
  { immediate: true },
);

onUnmounted(stopPolling);
</script>

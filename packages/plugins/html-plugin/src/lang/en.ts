import type { Messages } from "./messages";

const en: Messages = {
  saveAsPdf: "Save as PDF (opens print dialog)",
  pdf: "PDF",
  untitled: "HTML Page",
  editSource: "Edit HTML Source",
  cancel: "Cancel",
  applyChanges: "Apply Changes",
  saving: "Saving...",
  saveError: (error) => `⚠ Save failed: ${error}`,
  loadingSource: "Loading source…",
  sourceError: (error) => `Failed to load source: ${error}`,
};

export default en;

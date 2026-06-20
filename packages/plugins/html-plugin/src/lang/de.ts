import type { Messages } from "./messages";

const de: Messages = {
  saveAsPdf: "Als PDF speichern (öffnet Druckdialog)",
  pdf: "PDF",
  untitled: "HTML-Seite",
  editSource: "HTML-Quelltext bearbeiten",
  cancel: "Abbrechen",
  applyChanges: "Änderungen anwenden",
  saving: "Wird gespeichert...",
  saveError: (error) => `⚠ Speichern fehlgeschlagen: ${error}`,
  loadingSource: "Quelltext wird geladen…",
  sourceError: (error) => `Quelltext konnte nicht geladen werden: ${error}`,
};

export default de;

import type { Messages } from "./messages";

const fr: Messages = {
  saveAsPdf: "Enregistrer en PDF (ouvre la boîte de dialogue d'impression)",
  pdf: "PDF",
  untitled: "Page HTML",
  editSource: "Modifier la source HTML",
  cancel: "Annuler",
  applyChanges: "Appliquer les modifications",
  saving: "Enregistrement...",
  saveError: (error) => `⚠ Échec de l'enregistrement : ${error}`,
  loadingSource: "Chargement de la source…",
  sourceError: (error) => `Échec du chargement de la source : ${error}`,
};

export default fr;

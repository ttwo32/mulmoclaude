import type { Messages } from "./messages";

const ptBR: Messages = {
  saveAsPdf: "Salvar como PDF (abre o diálogo de impressão)",
  pdf: "PDF",
  untitled: "Página HTML",
  editSource: "Editar fonte HTML",
  cancel: "Cancelar",
  applyChanges: "Aplicar alterações",
  saving: "Salvando...",
  saveError: (error) => `⚠ Falha ao salvar: ${error}`,
  loadingSource: "Carregando fonte…",
  sourceError: (error) => `Falha ao carregar a fonte: ${error}`,
};

export default ptBR;

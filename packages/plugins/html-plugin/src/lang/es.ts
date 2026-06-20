import type { Messages } from "./messages";

const es: Messages = {
  saveAsPdf: "Guardar como PDF (abre el diálogo de impresión)",
  pdf: "PDF",
  untitled: "Página HTML",
  editSource: "Editar código HTML",
  cancel: "Cancelar",
  applyChanges: "Aplicar cambios",
  saving: "Guardando...",
  saveError: (error) => `⚠ Error al guardar: ${error}`,
  loadingSource: "Cargando código…",
  sourceError: (error) => `Error al cargar el código: ${error}`,
};

export default es;

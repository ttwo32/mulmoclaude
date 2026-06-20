export interface Messages {
  saveAsPdf: string;
  pdf: string;
  untitled: string;
  editSource: string;
  cancel: string;
  applyChanges: string;
  saving: string;
  saveError(error: string): string;
  loadingSource: string;
  sourceError(error: string): string;
}

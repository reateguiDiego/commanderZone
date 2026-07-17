export type LibrarySelectionBatchAction =
  | 'hand'
  | 'battlefield-face-up'
  | 'battlefield-face-down'
  | 'graveyard'
  | 'exile'
  | 'library-top'
  | 'library-bottom';

export interface LibrarySelectionBatchRequest {
  action: LibrarySelectionBatchAction;
  orderedInstanceIds: readonly string[];
}

export interface LibraryTopFaceDownRequest {
  count: number;
}

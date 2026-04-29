import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
import { Card } from '../../../core/models/card.model';
import { Deck, DeckFolder, DeckFolderVisibility, DeckFormat, DeckVisibility } from '../../../core/models/deck.model';
import { DeckImportExportService, DecklistEntry } from '../services/deck-import-export.service';
import { DeckFolderSection } from '../models/deck-list.models';

@Injectable()
export class DeckListStore {
  private readonly decksApi = inject(DecksApi);
  private readonly deckFoldersApi = inject(DeckFoldersApi);
  private readonly deckFormatsApi = inject(DeckFormatsApi);
  private readonly router = inject(Router);
  private readonly importExport = inject(DeckImportExportService);

  readonly decks = signal<Deck[]>([]);
  readonly folders = signal<DeckFolder[]>([]);
  readonly folderOptions = signal<DeckFolder[]>([]);
  readonly formats = signal<DeckFormat[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly createModalOpen = signal(false);
  readonly folderCreateModalOpen = signal(false);
  readonly folderRenameModalOpen = signal(false);
  readonly folderDeleteModalOpen = signal(false);
  readonly deckEditModalOpen = signal(false);
  readonly importModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly deleteTarget = signal<Deck | null>(null);
  readonly deckEditTarget = signal<Deck | null>(null);
  readonly folderTarget = signal<DeckFolder | null>(null);
  readonly createdDeck = signal<Deck | null>(null);
  readonly createdMissing = signal<string[]>([]);
  readonly createdImportMessage = signal<string | null>(null);
  readonly selectedCommander = signal<Card | null>(null);
  readonly currentFolderId = signal<string | null>(null);
  readonly draggedDeckId = signal<string | null>(null);
  readonly dragTargetId = signal<string | null>(null);
  readonly editingDeckId = signal<string | null>(null);
  readonly folderSections = computed<DeckFolderSection[]>(() => {
    const sections: DeckFolderSection[] = this.folders().map((folder) => ({
      id: folder.id,
      name: folder.name,
      decks: this.decks().filter((deck) => deck.folderId === folder.id),
      isUnfiled: false,
    }));

    sections.push({
      id: null,
      name: 'No folder',
      decks: this.decks().filter((deck) => deck.folderId === null),
      isUnfiled: true,
    });

    return sections;
  });
  readonly currentFolder = computed(() => this.folders().find((folder) => folder.id === this.currentFolderId()) ?? null);
  readonly currentFolderSection = computed<DeckFolderSection>(() => (
    this.folderSections().find((section) => section.id === this.currentFolderId())
    ?? { id: this.currentFolderId(), name: 'Unknown folder', decks: [], isUnfiled: false }
  ));
  readonly unfiledSection = computed<DeckFolderSection>(() => (
    this.folderSections().find((section) => section.isUnfiled)
    ?? { id: null, name: 'No folder', decks: [], isUnfiled: true }
  ));
  readonly selectedFormat = computed(() => this.formats().find((format) => format.id === this.newDeckFormatId) ?? null);
  readonly hasDeckListContent = computed(() => this.decks().length > 0 || this.folders().length > 0);

  newDeckName = '';
  newDeckFormatId = 'commander';
  newDeckFolderId = '';
  newDeckVisibility: DeckVisibility = 'private';
  newFolderName = '';
  newFolderVisibility: DeckVisibility = 'private';
  renameFolderName = '';
  renameFolderVisibility: DeckFolderVisibility = 'private';
  renameDeckName = '';
  editDeckName = '';
  editDeckVisibility: DeckVisibility = 'private';
  commanderQuery = '';
  createdDecklist = '';

  constructor() {
    void this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [decksResponse, foldersResponse, folderNamesResponse, formatsResponse] = await Promise.all([
        firstValueFrom(this.decksApi.list()),
        firstValueFrom(this.deckFoldersApi.list()),
        firstValueFrom(this.deckFoldersApi.names()),
        firstValueFrom(this.deckFormatsApi.list()),
      ]);
      this.decks.set(decksResponse.data);
      this.folders.set(foldersResponse.data);
      this.folderOptions.set(folderNamesResponse.data);
      this.formats.set(formatsResponse.data);
      if (!this.formats().some((format) => format.id === this.newDeckFormatId) && this.formats().length > 0) {
        this.newDeckFormatId = this.formats()[0].id;
      }
    } catch {
      this.error.set('Could not load decks.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal(): void {
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.newDeckName = '';
    this.newDeckFormatId = this.formats()[0]?.id ?? 'commander';
    this.newDeckFolderId = '';
    this.newDeckVisibility = 'private';
    this.commanderQuery = '';
    this.selectedCommander.set(null);
    this.createModalOpen.set(false);
  }

  onFormatChange(): void {
    if (!this.selectedFormat()?.hasCommander) {
      this.commanderQuery = '';
      this.selectedCommander.set(null);
    }
  }

  setCommanderQuery(query: string): void {
    this.commanderQuery = query;
    if (this.selectedCommander()?.name !== query.trim()) {
      this.selectedCommander.set(null);
    }
  }

  selectCommander(card: Card): void {
    this.selectedCommander.set(card);
    this.commanderQuery = card.name;
  }

  openFolderCreateModal(): void {
    this.newFolderName = '';
    this.newFolderVisibility = 'private';
    this.folderCreateModalOpen.set(true);
  }

  closeFolderCreateModal(): void {
    this.newFolderName = '';
    this.newFolderVisibility = 'private';
    this.folderCreateModalOpen.set(false);
  }

  async createFolder(): Promise<void> {
    const name = this.newFolderName.trim();
    if (!name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.create(name, this.newFolderVisibility));
      this.folders.set([response.folder, ...this.folders()]);
      this.folderOptions.set([response.folder, ...this.folderOptions()]);
      this.closeFolderCreateModal();
    } catch {
      this.error.set('Could not create folder.');
    }
  }

  openRenameFolderModal(folder: DeckFolder): void {
    this.folderTarget.set(folder);
    this.renameFolderName = folder.name;
    this.renameFolderVisibility = folder.visibility ?? 'private';
    this.folderRenameModalOpen.set(true);
  }

  closeFolderRenameModal(): void {
    this.folderRenameModalOpen.set(false);
    this.folderTarget.set(null);
    this.renameFolderName = '';
    this.renameFolderVisibility = 'private';
  }

  async renameFolder(): Promise<void> {
    const folder = this.folderTarget();
    const name = this.renameFolderName.trim();
    if (!folder || !name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.rename(folder.id, name, this.renameFolderVisibility));
      this.folders.set(this.folders().map((candidate) => candidate.id === folder.id ? response.folder : candidate));
      this.folderOptions.set(this.folderOptions().map((candidate) => candidate.id === folder.id ? response.folder : candidate));
      this.closeFolderRenameModal();
    } catch {
      this.error.set('Could not rename folder.');
    }
  }

  deleteFolder(folder: DeckFolder): void {
    this.folderTarget.set(folder);
    this.folderDeleteModalOpen.set(true);
  }

  async confirmDeleteFolder(): Promise<void> {
    const folder = this.folderTarget();
    if (!folder) {
      return;
    }

    try {
      await firstValueFrom(this.deckFoldersApi.delete(folder.id));
      this.folders.set(this.folders().filter((candidate) => candidate.id !== folder.id));
      this.folderOptions.set(this.folderOptions().filter((candidate) => candidate.id !== folder.id));
      this.decks.set(this.decks().map((deck) => deck.folderId === folder.id ? { ...deck, folderId: null } : deck));
      if (this.currentFolderId() === folder.id) {
        this.currentFolderId.set(null);
      }
      if (this.newDeckFolderId === folder.id) {
        this.newDeckFolderId = '';
      }
      this.folderDeleteModalOpen.set(false);
      this.folderTarget.set(null);
    } catch {
      this.error.set('Could not delete folder.');
    }
  }

  async create(): Promise<void> {
    const name = this.newDeckName.trim();
    if (!name) {
      return;
    }

    try {
      const cards = this.selectedCommander() && this.selectedFormat()?.hasCommander
        ? [{ scryfallId: this.selectedCommander()!.scryfallId, section: 'commander' as const }]
        : undefined;
      const response = await firstValueFrom(this.decksApi.quickBuild({
        name,
        folderId: this.newDeckFolderId || null,
        visibility: this.newDeckVisibility,
        cards,
      }));
      const deck = response.deck;
      this.createdDeck.set(deck);
      this.createdDecklist = '';
      this.createdMissing.set(response.missing);
      this.createdImportMessage.set(response.missing.length > 0 ? `${response.missing.length} missing during creation.` : null);
      this.decks.set([deck, ...this.decks()]);
      this.closeCreateModal();
      this.importModalOpen.set(true);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not create deck.'));
    }
  }

  closeImportModal(): void {
    const deck = this.createdDeck();
    this.importModalOpen.set(false);
    if (deck) {
      void this.router.navigate(['/decks', deck.id]);
    }
  }

  async importCreatedDeck(): Promise<void> {
    const deck = this.createdDeck();
    if (!deck || !this.createdDecklist.trim()) {
      return;
    }

    const entries: DecklistEntry[] = this.importExport.parse(this.createdDecklist, 'plain');

    try {
      const response = await firstValueFrom(this.decksApi.importDecklist(deck.id, this.importExport.toBackendDecklist(entries)));
      const importedCards = response.summary?.importedCards
        ?? (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0);
      const parsedCards = response.summary?.parsedCards
        ?? entries.reduce((total, entry) => total + entry.quantity, 0);
      this.createdDeck.set(response.deck);
      this.createdMissing.set(response.missing);
      this.createdImportMessage.set(`${parsedCards} parsed cards, ${importedCards} imported, ${response.missing.length} missing.`);
      this.decks.set(this.decks().map((candidate) => candidate.id === response.deck.id ? response.deck : candidate));
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not import deck.'));
    }
  }

  deleteDeck(deck: Deck): void {
    this.deleteTarget.set(deck);
    this.deleteModalOpen.set(true);
  }

  enterFolder(folderId: string): void {
    this.currentFolderId.set(folderId);
  }

  leaveFolder(): void {
    this.currentFolderId.set(null);
  }

  openDeck(id: string): void {
    void this.router.navigate(['/decks', id]);
  }

  folderDeckCount(folderId: string): number {
    return this.decks().filter((deck) => deck.folderId === folderId).length;
  }

  shouldWarnNewDeckPublicInPrivateFolder(): boolean {
    return this.newDeckVisibility === 'public' && this.folderIsPrivate(this.newDeckFolderId);
  }

  shouldWarnEditDeckPublicInPrivateFolder(): boolean {
    const deck = this.deckEditTarget();

    return this.editDeckVisibility === 'public' && this.folderIsPrivate(deck?.folderId ?? '');
  }

  openDeckEditModal(deck: Deck): void {
    this.deckEditTarget.set(deck);
    this.editDeckName = deck.name;
    this.editDeckVisibility = deck.visibility ?? 'private';
    this.deckEditModalOpen.set(true);
  }

  closeDeckEditModal(): void {
    this.deckEditModalOpen.set(false);
    this.deckEditTarget.set(null);
    this.editDeckName = '';
    this.editDeckVisibility = 'private';
  }

  cancelDeckRename(): void {
    this.editingDeckId.set(null);
    this.renameDeckName = '';
  }

  async saveDeckRename(deck: Deck): Promise<void> {
    if (this.editingDeckId() !== deck.id) {
      return;
    }

    const name = this.renameDeckName.trim();
    if (!name || name === deck.name) {
      this.cancelDeckRename();
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.rename(deck.id, name));
      this.decks.set(this.decks().map((candidate) => candidate.id === deck.id ? response.deck : candidate));
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not rename deck.'));
    } finally {
      this.cancelDeckRename();
    }
  }

  async saveDeckEdit(): Promise<void> {
    const deck = this.deckEditTarget();
    const name = this.editDeckName.trim();
    if (!deck || !name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.update(deck.id, { name, visibility: this.editDeckVisibility }));
      this.decks.set(this.decks().map((candidate) => candidate.id === deck.id ? response.deck : candidate));
      this.closeDeckEditModal();
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not update deck.'));
    }
  }

  beginDeckDrag(event: DragEvent, deck: Deck): void {
    event.stopPropagation();
    this.draggedDeckId.set(deck.id);
    event.dataTransfer?.setData('text/plain', deck.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  endDeckDrag(): void {
    this.draggedDeckId.set(null);
    this.dragTargetId.set(null);
  }

  allowDeckDrop(event: DragEvent, targetId: string): void {
    if (!this.draggedDeckId()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragTargetId.set(targetId);
  }

  clearDeckDrop(targetId: string): void {
    if (this.dragTargetId() === targetId) {
      this.dragTargetId.set(null);
    }
  }

  async dropDeckOnFolder(event: DragEvent, folderId: string | null): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const deckId = this.draggedDeckId() ?? event.dataTransfer?.getData('text/plain') ?? null;
    this.dragTargetId.set(null);

    if (!deckId) {
      return;
    }

    const deck = this.decks().find((candidate) => candidate.id === deckId);
    if (!deck) {
      this.endDeckDrag();
      return;
    }

    await this.moveDeck(deck, folderId ?? '');
    this.endDeckDrag();
  }

  async moveDeck(deck: Deck, folderId: string): Promise<void> {
    const nextFolderId = folderId || null;
    if (deck.folderId === nextFolderId) {
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.moveToFolder(deck.id, nextFolderId));
      this.decks.set(this.decks().map((candidate) => candidate.id === deck.id ? response.deck : candidate));
    } catch {
      this.error.set('Could not move deck.');
    }
  }

  async confirmDeleteDeck(): Promise<void> {
    const deck = this.deleteTarget();
    if (!deck) {
      return;
    }

    try {
      await firstValueFrom(this.decksApi.delete(deck.id));
      this.decks.set(this.decks().filter((candidate) => candidate.id !== deck.id));
      this.deleteModalOpen.set(false);
      this.deleteTarget.set(null);
    } catch {
      this.error.set('Could not delete deck.');
    }
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string' && error.error.error.trim()) {
      return error.error.error;
    }

    return fallback;
  }

  private folderIsPrivate(folderId: string | null): boolean {
    if (!folderId) {
      return false;
    }

    return this.folders().some((folder) => folder.id === folderId && (folder.visibility ?? 'private') === 'private');
  }
}

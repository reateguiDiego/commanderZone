import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckFoldersApi } from '../../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { DecksApi } from '../../../core/api/decks.api';
import { ApiError } from '../../../core/models/api-responses.model';
import { Card } from '../../../core/models/card.model';
import { Deck, DeckFolder, DeckFolderVisibility, DeckFormat, DeckVisibility } from '../../../core/models/deck.model';
import { bestCardArtImage, bestCardImage } from '../../../shared/utils/card-image';
import { commanderColorIdentityUnion, primaryCommander, secondaryCommander } from '../../../shared/utils/deck-commander';
import { DeckFolderSection } from '../models/deck-list.models';

export type DeckListColorFilter = 'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type DeckListSortMode = 'name-asc' | 'name-desc';

export interface DeckColorFilterOption {
  value: DeckListColorFilter;
  labelKey: string;
}

export interface DeckManaColorStat {
  readonly color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
  readonly percentage: number;
}

export type DeckListRootItem =
  | { readonly kind: 'folder'; readonly id: string; readonly name: string; readonly folder: DeckFolder }
  | { readonly kind: 'deck'; readonly id: string; readonly name: string; readonly deck: Deck };

const DECK_MANA_COLOR_ORDER: readonly DeckManaColorStat['color'][] = ['W', 'U', 'B', 'R', 'G', 'C'];

@Injectable()
export class DeckListStore {
  readonly maxDeckNameLength = 20;
  readonly maxFolderNameLength = 20;
  readonly maxDeckSearchLength = 20;
  readonly colorFilterOptions: readonly DeckColorFilterOption[] = [
    { value: 'all', labelKey: 'deckBuilder.deckList.colorFilter.any' },
    { value: 'W', labelKey: 'deckBuilder.deckList.colorFilter.white' },
    { value: 'U', labelKey: 'deckBuilder.deckList.colorFilter.blue' },
    { value: 'B', labelKey: 'deckBuilder.deckList.colorFilter.black' },
    { value: 'R', labelKey: 'deckBuilder.deckList.colorFilter.red' },
    { value: 'G', labelKey: 'deckBuilder.deckList.colorFilter.green' },
    { value: 'C', labelKey: 'deckBuilder.deckList.colorFilter.colorless' },
  ];

  private readonly decksApi = inject(DecksApi);
  private readonly deckFoldersApi = inject(DeckFoldersApi);
  private readonly deckFormatsApi = inject(DeckFormatsApi);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  readonly decks = signal<Deck[]>([]);
  readonly folders = signal<DeckFolder[]>([]);
  readonly formats = signal<DeckFormat[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly createModalOpen = signal(false);
  readonly folderCreateModalOpen = signal(false);
  readonly folderRenameModalOpen = signal(false);
  readonly folderDeleteModalOpen = signal(false);
  readonly deckEditModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly deleteTarget = signal<Deck | null>(null);
  readonly deleteBlockedMessage = signal<string | null>(null);
  readonly createSuccessModalOpen = signal(false);
  readonly createSuccessDeck = signal<Deck | null>(null);
  readonly createSuccessPrimaryLabel = signal('deckBuilder.deckList.openDeck');
  readonly deckEditTarget = signal<Deck | null>(null);
  readonly folderTarget = signal<DeckFolder | null>(null);
  readonly createdDeck = signal<Deck | null>(null);
  readonly createdMissing = signal<string[]>([]);
  readonly createdImportMessage = signal<string | null>(null);
  readonly createSubmitting = signal(false);
  readonly createdDeckFileLoading = signal(false);
  readonly createFormLocked = signal(false);
  readonly selectedCommanders = signal<Card[]>([]);
  readonly currentFolderId = signal<string | null>(null);
  readonly editingDeckId = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly colorFilter = signal<DeckListColorFilter>('all');
  readonly sortMode = signal<DeckListSortMode>('name-asc');
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
  readonly totalDeckCount = computed(() => this.decks().length);
  readonly publicDeckCount = computed(() => this.decks().filter((deck) => deck.visibility === 'public').length);
  readonly privateDeckCount = computed(() => this.decks().filter((deck) => (deck.visibility ?? 'private') === 'private').length);
  readonly manaColorStats = computed<readonly DeckManaColorStat[]>(() => this.buildManaColorStats());
  readonly visibleFolders = computed(() => this.filteredFolders());
  readonly visibleUnfiledDecks = computed(() => this.filterAndSortDecks(this.unfiledSection().decks));
  readonly visibleRootItems = computed<DeckListRootItem[]>(() => (
    [
      ...this.visibleFolders().map((folder): DeckListRootItem => ({
        kind: 'folder',
        id: `folder:${folder.id}`,
        name: folder.name,
        folder,
      })),
      ...this.visibleUnfiledDecks().map((deck): DeckListRootItem => ({
        kind: 'deck',
        id: `deck:${deck.id}`,
        name: deck.name,
        deck,
      })),
    ].sort((firstItem, secondItem) => this.compareRootItems(firstItem, secondItem))
  ));
  readonly visibleCurrentFolderDecks = computed(() => this.filterAndSortDecks(this.currentFolderSection().decks));
  readonly visibleActiveDecks = computed(() => (
    this.currentFolder() ? this.visibleCurrentFolderDecks() : this.visibleUnfiledDecks()
  ));
  readonly hasVisibleRootContent = computed(() => this.visibleRootItems().length > 0);
  readonly hasVisibleActiveDecks = computed(() => this.visibleActiveDecks().length > 0);
  readonly folderDeleteModalTitle = computed(() => {
    const folder = this.folderTarget();

    return folder ? `Delete ${folder.name}?` : 'Delete folder';
  });
  readonly deleteModalTitle = computed(() => {
    if (this.deleteBlockedMessage()) {
      return 'Deck in use';
    }

    const deck = this.deleteTarget();

    return deck ? `Delete ${deck.name}?` : 'Delete deck';
  });
  readonly deleteModalMessage = computed(() => {
    const blockedMessage = this.deleteBlockedMessage();
    if (blockedMessage) {
      return blockedMessage;
    }

    return '';
  });
  readonly deleteModalPrimaryLabel = computed(() => this.deleteBlockedMessage() ? 'OK' : 'Delete');
  readonly deleteModalShowsSecondary = computed(() => this.deleteBlockedMessage() === null);
  readonly deleteModalIsDanger = computed(() => this.deleteBlockedMessage() === null);
  readonly createSuccessMessage = computed(() => 'deckBuilder.deckList.createSuccessMessage');

  newDeckName = '';
  newDeckFormatId = 'commander';
  newDeckFolderId = '';
  newDeckVisibility: DeckVisibility = 'private';
  newDeckCreateEmpty = false;
  newFolderName = '';
  newFolderVisibility: DeckVisibility = 'private';
  renameFolderName = '';
  renameFolderVisibility: DeckFolderVisibility = 'private';
  renameDeckName = '';
  editDeckName = '';
  editDeckVisibility: DeckVisibility = 'private';
  editDeckFolderId = '';
  commanderQuery = '';
  createdDecklist = '';
  private createSuccessRedirectUrl: string | null = null;

  constructor() {
    void this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [decksResponse, foldersResponse, formatsResponse] = await Promise.all([
        firstValueFrom(this.decksApi.list()),
        firstValueFrom(this.deckFoldersApi.list()),
        firstValueFrom(this.deckFormatsApi.list()),
      ]);
      this.decks.set(decksResponse.data);
      this.folders.set(foldersResponse.data);
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
    this.newDeckFolderId = this.currentFolderId() ?? '';
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.newDeckName = '';
    this.newDeckFormatId = this.formats()[0]?.id ?? 'commander';
    this.newDeckFolderId = '';
    this.newDeckVisibility = 'private';
    this.newDeckCreateEmpty = false;
    this.commanderQuery = '';
    this.createdDecklist = '';
    this.createdDeck.set(null);
    this.createdMissing.set([]);
    this.createdImportMessage.set(null);
    this.createSubmitting.set(false);
    this.createdDeckFileLoading.set(false);
    this.createFormLocked.set(false);
    this.selectedCommanders.set([]);
    this.createModalOpen.set(false);
  }

  closeCreateFlow(): void {
    const deck = this.createdDeck();
    this.closeCreateModal();
    if (deck) {
      this.createSuccessDeck.set(deck);
      this.createSuccessModalOpen.set(true);
    }
  }

  closeCreateSuccessModal(): void {
    this.createSuccessModalOpen.set(false);
    this.createSuccessDeck.set(null);
  }

  async returnToDeckListFromSuccess(): Promise<void> {
    this.closeCreateSuccessModal();
    await this.reloadAll();
  }

  openCreatedDeckFromSuccess(): void {
    const deck = this.createSuccessDeck();
    const redirectUrl = this.createSuccessRedirectUrl;
    this.closeCreateSuccessModal();
    if (redirectUrl) {
      void this.router.navigateByUrl(redirectUrl);
      return;
    }

    if (deck) {
      void this.router.navigate(['/decks', deck.id]);
    }
  }

  configureCreateSuccessRedirect(redirectUrl: string | null): void {
    this.createSuccessRedirectUrl = redirectUrl;
    this.createSuccessPrimaryLabel.set(redirectUrl ? 'deckBuilder.deckList.continueToRooms' : 'deckBuilder.deckList.openDeck');
  }

  async cancelCreateFlow(): Promise<void> {
    const deck = this.createdDeck();
    if (!deck) {
      this.closeCreateModal();
      return;
    }

    try {
      await firstValueFrom(this.decksApi.delete(deck.id));
      this.decks.set(this.decks().filter((candidate) => candidate.id !== deck.id));
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not delete the created deck.'));
    } finally {
      this.closeCreateModal();
    }
  }

  submitCreateModal(): void {
    if (this.createFormLocked()) {
      this.closeCreateFlow();
      return;
    }

    if (this.createSubmitting()) {
      return;
    }

    void this.create();
  }

  createPrimaryLabel(): string {
    if (this.createFormLocked()) {
      return 'Accept';
    }

    return this.createSubmitting() ? 'Creating...' : 'Create deck';
  }

  createModalTitle(): string {
    return this.createFormLocked() ? 'Warning' : 'Create deck';
  }

  isCreateFormDisabled(): boolean {
    return this.createSubmitting() || this.createdDeckFileLoading() || this.createFormLocked();
  }

  isCreatePrimaryDisabled(): boolean {
    return this.createSubmitting()
      || this.createdDeckFileLoading()
      || (!this.createFormLocked() && !this.isCreateFormReady());
  }

  isNewDeckNameTooLong(): boolean {
    return this.newDeckName.trim().length > this.maxDeckNameLength;
  }

  newDeckNameHelp(): string {
    return this.nameLengthHelp(this.newDeckName, this.maxDeckNameLength);
  }

  isEditDeckNameTooLong(): boolean {
    return this.editDeckName.trim().length > this.maxDeckNameLength;
  }

  editDeckNameHelp(): string {
    return this.nameLengthHelp(this.editDeckName, this.maxDeckNameLength);
  }

  isNewFolderNameTooLong(): boolean {
    return this.newFolderName.trim().length > this.maxFolderNameLength;
  }

  newFolderNameHelp(): string {
    return this.nameLengthHelp(this.newFolderName, this.maxFolderNameLength);
  }

  isRenameFolderNameTooLong(): boolean {
    return this.renameFolderName.trim().length > this.maxFolderNameLength;
  }

  renameFolderNameHelp(): string {
    return this.nameLengthHelp(this.renameFolderName, this.maxFolderNameLength);
  }

  canSaveFolderRename(): boolean {
    const folder = this.folderTarget();
    const name = this.renameFolderName.trim();
    if (!folder || name === '' || name.length > this.maxFolderNameLength) {
      return false;
    }

    return name !== folder.name.trim()
      || this.renameFolderVisibility !== (folder.visibility ?? 'private');
  }

  hasCreateImportError(): boolean {
    return this.createFormLocked() && this.createdMissing().length === 0 && this.createdImportMessage() !== null;
  }

  onFormatChange(): void {
    if (!this.selectedFormat()?.hasCommander) {
      this.commanderQuery = '';
      this.selectedCommanders.set([]);
    }
  }

  loadCreatedDeckFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) {
      return;
    }

    this.createdDeckFileLoading.set(true);
    this.readDecklistFile(
      event,
      (content) => {
        this.createdDecklist = content;
      },
      () => {
        this.createdDeckFileLoading.set(false);
      },
      () => {
        this.error.set('Could not load deck file.');
      },
    );
  }

  setNewDeckCreateEmpty(createEmpty: boolean): void {
    this.newDeckCreateEmpty = createEmpty;
    if (!createEmpty) {
      return;
    }

    this.commanderQuery = '';
    this.createdDecklist = '';
    this.selectedCommanders.set([]);
  }

  setCommanderQuery(query: string): void {
    this.commanderQuery = query;
  }

  selectCommander(card: Card): void {
    if (this.selectedCommanders().some((selected) => selected.scryfallId === card.scryfallId)) {
      this.commanderQuery = '';
      return;
    }
    if (this.selectedCommanders().length >= 2) {
      return;
    }

    this.selectedCommanders.set([...this.selectedCommanders(), card]);
    this.commanderQuery = '';
  }

  removeCommander(scryfallId: string): void {
    this.selectedCommanders.set(this.selectedCommanders().filter((card) => card.scryfallId !== scryfallId));
  }

  selectedCommanderImage(card: Card): string | null {
    return bestCardImage(card);
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query.slice(0, this.maxDeckSearchLength));
  }

  setColorFilter(filter: DeckListColorFilter): void {
    this.colorFilter.set(filter);
  }

  setSortMode(sortMode: DeckListSortMode): void {
    this.sortMode.set(sortMode);
  }

  hasSelectedCommanderSlots(): boolean {
    return this.selectedCommanders().length > 0;
  }

  canSelectAnotherCommander(): boolean {
    return this.selectedCommanders().length < 2;
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
    if (!name || name.length > this.maxFolderNameLength) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.create(name, this.newFolderVisibility));
      this.folders.set([response.folder, ...this.folders()]);
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
    if (!folder || !this.canSaveFolderRename()) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.rename(folder.id, name, this.renameFolderVisibility));
      this.folders.set(this.folders().map((candidate) => candidate.id === folder.id ? response.folder : candidate));
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
    const commanderScryfallIds = this.newDeckCreateEmpty
      ? []
      : this.selectedCommanders().map((card) => card.scryfallId);
    if (!this.isCreateFormReady()) {
      return;
    }

    this.createSubmitting.set(true);
    this.createdMissing.set([]);
    this.createdImportMessage.set(null);
    this.createFormLocked.set(false);

    try {
      const response = await firstValueFrom(this.decksApi.create(
        name,
        this.newDeckFolderId || null,
        this.newDeckVisibility,
        this.newDeckFormatId,
      ));
      const deck = response.deck;
      this.createdDeck.set(deck);
      this.createdMissing.set([]);
      this.createdImportMessage.set(null);
      this.decks.set([deck, ...this.decks()]);

      if (this.newDeckCreateEmpty) {
        this.closeCreateModal();
        void this.router.navigate(['/decks', deck.id]);
        return;
      }

      const imported = await this.importCreatedDeck(commanderScryfallIds);
      if (!imported) {
        return;
      }
      if (this.createdMissing().length > 0) {
        this.createFormLocked.set(true);
        return;
      }

      this.closeCreateFlow();
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not create deck.'));
    } finally {
      this.createSubmitting.set(false);
    }
  }

  async importCreatedDeck(commanderScryfallIds: string[] = []): Promise<boolean> {
    const deck = this.createdDeck();
    if (!deck || !this.createdDecklist.trim()) {
      return true;
    }

    try {
      const response = await firstValueFrom(this.decksApi.importDecklist(
        deck.id,
        this.createdDecklist,
        commanderScryfallIds.length > 0 ? { commanderScryfallIds } : {},
      ));
      const importedCards = response.summary?.importedCards
        ?? (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0);
      const parsedCards = response.summary?.parsedCards ?? 0;
      this.createdDeck.set(response.deck);
      this.createdMissing.set(response.missing);
      this.createdImportMessage.set(`${parsedCards} parsed cards, ${importedCards} imported, ${response.missing.length} missing.`);
      this.decks.set(this.decks().map((candidate) => candidate.id === response.deck.id ? response.deck : candidate));
      return true;
    } catch (error) {
      this.createdImportMessage.set(this.apiErrorMessage(error, 'Could not import deck.'));
      this.createFormLocked.set(true);
      return false;
    }
  }

  deleteDeck(deck: Deck): void {
    this.deleteTarget.set(deck);
    this.deleteBlockedMessage.set(null);
    this.deleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    this.deleteModalOpen.set(false);
    this.deleteTarget.set(null);
    this.deleteBlockedMessage.set(null);
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

  deckHasIssues(deck: Deck): boolean {
    return deck.valid === false;
  }

  deckIssueTooltip(deck: Deck): string {
    return deck.valid === false ? 'Deck is not valid for its current format.' : '';
  }

  folderDeckCount(folderId: string): number {
    return this.decks().filter((deck) => deck.folderId === folderId).length;
  }

  deckCommanderImage(deck: Deck): string | null {
    return bestCardArtImage(primaryCommander(deck));
  }

  deckCommanderBackground(deck: Deck): string | null {
    const imageUrl = this.deckCommanderImage(deck);
    return imageUrl ? `url("${imageUrl}")` : null;
  }

  deckSecondaryCommanderImage(deck: Deck): string | null {
    return bestCardArtImage(secondaryCommander(deck));
  }

  deckSecondaryCommanderBackground(deck: Deck): string | null {
    const imageUrl = this.deckSecondaryCommanderImage(deck);
    return imageUrl ? `url("${imageUrl}")` : null;
  }

  hasDualCommanderArt(deck: Deck): boolean {
    return this.deckCommanderImage(deck) !== null && this.deckSecondaryCommanderImage(deck) !== null;
  }

  commanderColorIdentity(deck: Deck): string[] | null {
    if (!primaryCommander(deck)) {
      return null;
    }

    const colors = commanderColorIdentityUnion(deck);

    return colors.length > 0 ? colors : ['C'];
  }

  shouldWarnNewDeckPublicInPrivateFolder(): boolean {
    return this.newDeckVisibility === 'public' && this.folderIsPrivate(this.newDeckFolderId);
  }

  shouldWarnEditDeckPublicInPrivateFolder(): boolean {
    return this.editDeckVisibility === 'public' && this.folderIsPrivate(this.editDeckFolderId);
  }

  canSaveDeckEdit(): boolean {
    const deck = this.deckEditTarget();
    const name = this.editDeckName.trim();
    if (!deck || name === '' || name.length > this.maxDeckNameLength) {
      return false;
    }

    return name !== deck.name.trim()
      || this.editDeckVisibility !== (deck.visibility ?? 'private')
      || (this.editDeckFolderId || null) !== (deck.folderId ?? null);
  }

  openDeckEditModal(deck: Deck): void {
    this.deckEditTarget.set(deck);
    this.editDeckName = deck.name;
    this.editDeckVisibility = deck.visibility ?? 'private';
    this.editDeckFolderId = deck.folderId ?? '';
    this.deckEditModalOpen.set(true);
  }

  closeDeckEditModal(): void {
    this.deckEditModalOpen.set(false);
    this.deckEditTarget.set(null);
    this.editDeckName = '';
    this.editDeckVisibility = 'private';
    this.editDeckFolderId = '';
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
    if (!deck || !this.canSaveDeckEdit()) {
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.update(deck.id, {
        name,
        visibility: this.editDeckVisibility,
        folderId: this.editDeckFolderId || null,
      }));
      this.decks.set(this.decks().map((candidate) => candidate.id === deck.id ? response.deck : candidate));
      this.closeDeckEditModal();
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not update deck.'));
    }
  }

  async confirmDeleteDeck(): Promise<void> {
    if (this.deleteBlockedMessage()) {
      this.closeDeleteModal();
      return;
    }

    const deck = this.deleteTarget();
    if (!deck) {
      return;
    }

    try {
      await firstValueFrom(this.decksApi.delete(deck.id));
      this.decks.set(this.decks().filter((candidate) => candidate.id !== deck.id));
      this.closeDeleteModal();
    } catch (error) {
      if (this.apiErrorCode(error) === 'deck.in_use') {
        this.deleteBlockedMessage.set(this.apiErrorMessage(error, 'This deck cannot be deleted because it is being used in a game.'));
        return;
      }

      this.error.set(this.apiErrorMessage(error, 'Could not delete deck.'));
    }
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    const response = this.apiError(error);
    if (response && response.error.trim()) {
      return response.error;
    }

    return fallback;
  }

  private apiErrorCode(error: unknown): string | null {
    return this.apiError(error)?.code ?? null;
  }

  private apiError(error: unknown): ApiError | null {
    if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object') {
      return null;
    }

    const response = error.error as Partial<ApiError>;
    if (typeof response.error !== 'string') {
      return null;
    }

    return typeof response.code === 'string'
      ? { error: response.error, code: response.code }
      : { error: response.error };
  }

  private isCreateFormReady(): boolean {
    const deckName = this.newDeckName.trim();

    return deckName !== ''
      && deckName.length <= this.maxDeckNameLength
      && this.newDeckFormatId.trim() !== ''
      && (this.newDeckCreateEmpty || this.createdDecklist.trim() !== '');
  }

  private nameLengthHelp(name: string, maxLength: number): string {
    return `${name.trim().length}/${maxLength} characters`;
  }

  private folderIsPrivate(folderId: string | null): boolean {
    if (!folderId) {
      return false;
    }

    return this.folders().some((folder) => folder.id === folderId && (folder.visibility ?? 'private') === 'private');
  }

  private filteredFolders(): DeckFolder[] {
    if (this.colorFilter() !== 'all') {
      return [];
    }

    const normalizedSearch = this.normalizedSearch();

    return [...this.folders()]
      .filter((folder) => normalizedSearch === '' || folder.name.toLocaleLowerCase().includes(normalizedSearch))
      .sort((firstFolder, secondFolder) => this.compareByName(firstFolder.name, secondFolder.name));
  }

  private filterAndSortDecks(decks: Deck[]): Deck[] {
    return decks
      .filter((deck) => this.matchesDeckSearch(deck) && this.matchesDeckColor(deck))
      .sort((firstDeck, secondDeck) => this.compareByName(firstDeck.name, secondDeck.name));
  }

  private matchesDeckSearch(deck: Deck): boolean {
    const normalizedSearch = this.normalizedSearch();
    if (normalizedSearch === '') {
      return true;
    }

    return deck.name.toLocaleLowerCase().includes(normalizedSearch);
  }

  private matchesDeckColor(deck: Deck): boolean {
    const colorFilter = this.colorFilter();
    if (colorFilter === 'all') {
      return true;
    }

    const colors = this.commanderColorIdentity(deck) ?? [];

    return colorFilter === 'C'
      ? colors.length === 0 || colors.includes('C')
      : colors.includes(colorFilter);
  }

  private compareByName(firstName: string, secondName: string): number {
    const direction = this.sortMode() === 'name-desc' ? -1 : 1;

    return firstName.localeCompare(secondName, undefined, { sensitivity: 'base' }) * direction;
  }

  private compareRootItems(firstItem: DeckListRootItem, secondItem: DeckListRootItem): number {
    const nameComparison = this.compareByName(firstItem.name, secondItem.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return firstItem.kind.localeCompare(secondItem.kind);
  }

  private buildManaColorStats(): readonly DeckManaColorStat[] {
    const deckColorIdentities = this.decks()
      .map((deck) => this.commanderColorIdentity(deck)?.filter((color) => this.isManaColor(color)) ?? null)
      .filter((colors): colors is DeckManaColorStat['color'][] => colors !== null && colors.length > 0);

    if (deckColorIdentities.length <= 1) {
      return [];
    }

    const counts = new Map<DeckManaColorStat['color'], number>(DECK_MANA_COLOR_ORDER.map((color) => [color, 0]));
    let totalSymbols = 0;

    for (const colors of deckColorIdentities) {
      for (const color of colors) {
        counts.set(color, (counts.get(color) ?? 0) + 1);
        totalSymbols += 1;
      }
    }

    if (totalSymbols === 0) {
      return [];
    }

    return DECK_MANA_COLOR_ORDER
      .map((color) => ({
        color,
        percentage: Math.round(((counts.get(color) ?? 0) / totalSymbols) * 100),
      }));
  }

  private isManaColor(value: string): value is DeckManaColorStat['color'] {
    return DECK_MANA_COLOR_ORDER.includes(value as DeckManaColorStat['color']);
  }

  private normalizedSearch(): string {
    return this.searchQuery().trim().toLocaleLowerCase();
  }

  private readDecklistFile(
    event: Event,
    onLoaded: (content: string) => void,
    onSettled: () => void = () => {},
    onError: () => void = () => {},
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.zone.run(() => {
        onLoaded(String(reader.result ?? ''));
        input.value = '';
        onSettled();
      });
    };
    reader.onerror = () => {
      this.zone.run(() => {
        input.value = '';
        onError();
        onSettled();
      });
    };
    try {
      reader.readAsText(file);
    } catch {
      this.zone.run(() => {
        input.value = '';
        onError();
        onSettled();
      });
    }
  }
}

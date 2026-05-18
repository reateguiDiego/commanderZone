import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu } from '../state/game-table-ui.state';
import { PlayerView } from '../game-table.store';
import { ContextSubmenuComponent, ContextSubmenuItem } from './context-submenu/context-submenu.component';

export type ContextMenuAction =
  | { type: 'drawMine' }
  | { type: 'draw7Mine' }
  | { type: 'revealTopMine' }
  | { type: 'shuffleMine' }
  | { type: 'copyGameId' }
  | { type: 'refreshSnapshot' }
  | { type: 'focusCurrentPlayer' }
  | { type: 'openChat' }
  | { type: 'openLog' }
  | { type: 'leaveTable' }
  | { type: 'concedeGame' }
  | { type: 'closeGame' }
  | { type: 'focusPlayer' }
  | { type: 'openZone'; zone: GameZoneName }
  | { type: 'changeLife'; delta: number }
  | { type: 'drawCard' }
  | { type: 'drawPrompt' }
  | { type: 'moveTop'; zone: GameZoneName; targetPlayerId?: string; position?: 'top' | 'bottom' }
  | { type: 'shuffle' }
  | { type: 'revealTop'; target?: string }
  | { type: 'revealLibrary'; targetPlayerId: string }
  | { type: 'playTopRevealed'; enabled: boolean }
  | { type: 'openLibraryView'; mode: 'all' | 'top' }
  | { type: 'moveAll'; zone: GameZoneName; targetPlayerId?: string }
  | { type: 'selectRandomCard' }
  | { type: 'tapCard' }
  | { type: 'faceDown' }
  | { type: 'playFaceDown' }
  | { type: 'flipCardFace' }
  | { type: 'revealCard'; target: string }
  | { type: 'createToken' }
  | { type: 'tokenCopy' }
  | { type: 'drawArrow' }
  | { type: 'addToStack' }
  | { type: 'setPowerToughness' }
  | { type: 'clearPowerToughness' }
  | { type: 'changeCounter'; counter: string }
  | { type: 'removeCounter'; counter: string }
  | { type: 'removeAllCounters' }
  | { type: 'giveToPlayer'; targetPlayerId: string }
  | { type: 'moveCard'; zone: GameZoneName; position?: 'top' | 'bottom' }
  | { type: 'deleteArrow' }
  | { type: 'deleteArrows' }
  | { type: 'deleteCounter' }
  | { type: 'previewCard' };

type ContextSubmenu =
  | 'counters'
  | 'giveToPlayer'
  | 'moveTo'
  | 'moveAllTo'
  | 'revealTo'
  | 'libraryMoveTop'
  | 'libraryRevealTop'
  | 'libraryReveal'
  | 'libraryView';

@Component({
  selector: 'app-context-menu',
  imports: [ContextSubmenuComponent, LucideAngularModule],
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly menu = input.required<GameContextMenu>();
  readonly currentPlayer = input<PlayerView | null>(null);
  readonly players = input.required<readonly PlayerView[]>();
  readonly isGameOwner = input(false);
  readonly counterPresets = input.required<readonly string[]>();
  readonly moveZones = input.required<readonly GameZoneName[]>();
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly canControlPlayer = input.required<(playerId: string) => boolean>();
  readonly zoneCardCount = input.required<(playerId: string, zone: GameZoneName) => number>();
  readonly shouldShowPowerToughness = input.required<(card: GameCardInstance) => boolean>();
  readonly zoneTitle = input.required<(zone: GameZoneName) => string>();
  readonly ownedArrowCount = input(0);

  readonly actionSelected = output<ContextMenuAction>();
  readonly close = output<void>();
  readonly expandedSubmenu = signal<ContextSubmenu | null>(null);
  readonly counterMenuItems = computed<readonly ContextSubmenuItem[]>(() => this.buildCounterMenuItems());
  readonly giveToPlayerMenuItems = computed<readonly ContextSubmenuItem[]>(() =>
    this.sortedItems(this.giveToPlayerTargets().map((player) => ({ value: player.id, label: this.playerLabel(player) }))),
  );
  readonly moveToMenuItems = computed<readonly ContextSubmenuItem[]>(() => this.buildMoveToMenuItems());
  readonly moveAllToMenuItems = computed<readonly ContextSubmenuItem[]>(() => this.buildMoveAllToMenuItems());
  readonly revealToMenuItems = computed<readonly ContextSubmenuItem[]>(() => [
    { value: 'all', label: 'Todos' },
    ...this.sortedItems(this.players().map((player) => ({ value: player.id, label: this.playerLabel(player) }))),
  ]);
  readonly libraryMoveTopMenuItems = computed<readonly ContextSubmenuItem[]>(() => this.buildLibraryMoveTopMenuItems());
  readonly libraryRevealTopMenuItems = computed<readonly ContextSubmenuItem[]>(() => this.buildVisibilityTargetMenuItems());
  readonly libraryRevealMenuItems = computed<readonly ContextSubmenuItem[]>(() =>
    this.sortedItems(this.giveToPlayerTargets().map((player) => ({
      value: player.id,
      label: this.playerLabel(player),
    }))),
  );
  readonly libraryViewMenuItems = computed<readonly ContextSubmenuItem[]>(() => [
    { value: 'all', label: 'View all library' },
    { value: 'top', label: 'View X top cards' },
  ]);

  isArrowMenu(): boolean {
    return this.menu().kind === 'arrow';
  }

  isCompactDeleteMenu(): boolean {
    const kind = this.menu().kind;
    return kind === 'arrow' || kind === 'counter';
  }

  isLibraryMenu(): boolean {
    const currentMenu = this.menu();
    return currentMenu.zone === 'library' && !currentMenu.card;
  }

  isZoneOnlyMenu(): boolean {
    const currentMenu = this.menu();
    return !currentMenu.card && currentMenu.zone !== 'library';
  }

  isLibraryCardMenu(): boolean {
    const currentMenu = this.menu();
    return currentMenu.kind === 'card' && currentMenu.zone === 'library';
  }

  isHandCardMenu(): boolean {
    const currentMenu = this.menu();
    return currentMenu.kind === 'card' && currentMenu.zone === 'hand';
  }

  isCurrentPlayerActive(): boolean {
    const current = this.currentPlayer();

    return current !== null && current.state.status !== 'conceded';
  }

  canControlActivePlayer(): boolean {
    return this.canControlPlayer()(this.menu().playerId);
  }

  canMoveActiveZoneCards(): boolean {
    const currentMenu = this.menu();
    return this.canControlActivePlayer() && this.zoneCardCount()(currentMenu.playerId, currentMenu.zone) > 0;
  }

  canSelectRandomFromActiveZone(): boolean {
    const currentMenu = this.menu();
    return currentMenu.suppressRandomSelect !== true
      && !this.isLibraryCardMenu()
      && this.canControlActivePlayer()
      && this.isRandomSelectableZone(currentMenu.zone)
      && this.zoneCardCount()(currentMenu.playerId, currentMenu.zone) > 0;
  }

  activeCardMoveTargets(): readonly GameZoneName[] {
    const currentZone = this.menu().zone;
    return this.moveZones().filter((zone) => zone !== currentZone && (zone !== 'command' || this.isActiveCardCommander()));
  }

  showsBattlefieldCardActions(): boolean {
    return this.menu().zone === 'battlefield';
  }

  canAddPowerToughness(): boolean {
    const card = this.menu().card;
    return this.showsBattlefieldCardActions() && !!card && !card.faceDown && !this.shouldShowPowerToughness()(card);
  }

  canRemovePowerToughness(): boolean {
    const card = this.menu().card;
    if (!this.showsBattlefieldCardActions() || !card || card.faceDown) {
      return false;
    }

    return this.hasPowerToughness(card) && !this.hasDefaultPowerToughness(card);
  }

  powerToughnessLabel(): string {
    return this.canRemovePowerToughness() ? 'Remove Power/Toughness' : 'Power/Toughness';
  }

  powerToughnessAction(): ContextMenuAction {
    return this.canRemovePowerToughness() ? { type: 'clearPowerToughness' } : { type: 'setPowerToughness' };
  }

  canDeleteOwnedArrows(): boolean {
    return this.ownedArrowCount() > 1;
  }

  usesLeftSubmenus(): boolean {
    const currentMenu = this.menu();
    return !currentMenu.card && (currentMenu.zone === 'graveyard' || currentMenu.zone === 'exile');
  }

  isPlayTopLibraryRevealed(): boolean {
    const player = this.players().find((candidate) => candidate.id === this.menu().playerId);

    return player?.state.playTopLibraryRevealed === true;
  }

  tapLabel(): string {
    return this.menu().card?.tapped ? 'Untap' : 'Tap';
  }

  faceDownLabel(): string {
    return this.menu().card?.faceDown ? 'Turn Face Up' : 'Turn Face Down';
  }

  canFlipCardFace(): boolean {
    return (this.menu().card?.cardFaces?.length ?? 0) > 1;
  }

  giveToPlayerTargets(): readonly PlayerView[] {
    const activePlayerId = this.menu().playerId;
    return this.players().filter((player) => player.id !== activePlayerId && player.state.status !== 'conceded');
  }

  playerLabel(player: PlayerView): string {
    return player.state.user.displayName || player.id;
  }

  isSubmenuExpanded(submenu: ContextSubmenu): boolean {
    return this.expandedSubmenu() === submenu;
  }

  toggleSubmenu(event: MouseEvent, submenu: ContextSubmenu): void {
    event.preventDefault();
    event.stopPropagation();
    this.expandedSubmenu.update((current) => current === submenu ? null : submenu);
  }

  selectCounter(counter: string): void {
    const [action, key] = counter.split(':', 2);
    if (action === 'removeAll') {
      this.actionSelected.emit({ type: 'removeAllCounters' });
      return;
    }
    if (action === 'remove' && key) {
      this.actionSelected.emit({ type: 'removeCounter', counter: key });
      return;
    }

    this.actionSelected.emit({ type: 'changeCounter', counter });
  }

  selectGiveToPlayer(targetPlayerId: string): void {
    this.actionSelected.emit({ type: 'giveToPlayer', targetPlayerId });
  }

  selectMoveTo(zone: string): void {
    if (zone === 'library:bottom') {
      this.actionSelected.emit({ type: 'moveCard', zone: 'library', position: 'bottom' });
      return;
    }

    this.actionSelected.emit({ type: 'moveCard', zone: zone as GameZoneName });
  }

  selectMoveAllTo(target: string): void {
    const [kind, value] = target.split(':', 2);
    if (kind === 'battlefield' && value) {
      this.actionSelected.emit({ type: 'moveAll', zone: 'battlefield', targetPlayerId: value });
      return;
    }
    if (kind === 'zone' && this.isGameZone(value)) {
      this.actionSelected.emit({ type: 'moveAll', zone: value });
    }
  }

  selectRevealTarget(target: string): void {
    this.actionSelected.emit({ type: 'revealCard', target });
  }

  selectLibraryMoveTop(target: string): void {
    const [kind, value] = target.split(':', 2);
    if (kind === 'zone' && this.isGameZone(value)) {
      this.actionSelected.emit({
        type: 'moveTop',
        zone: value,
        ...(value === 'library' ? { position: 'bottom' as const } : {}),
      });
      return;
    }

    if (kind === 'hand' && value) {
      this.actionSelected.emit({ type: 'moveTop', zone: 'hand', targetPlayerId: value });
      return;
    }

    if (kind === 'battlefield' && value) {
      this.actionSelected.emit({ type: 'moveTop', zone: 'battlefield', targetPlayerId: value });
    }
  }

  selectLibraryRevealTopTarget(target: string): void {
    this.actionSelected.emit({ type: 'revealTop', target });
  }

  selectLibraryRevealTarget(targetPlayerId: string): void {
    this.actionSelected.emit({ type: 'revealLibrary', targetPlayerId });
  }

  selectLibraryView(mode: string): void {
    if (mode === 'all' || mode === 'top') {
      this.actionSelected.emit({ type: 'openLibraryView', mode });
    }
  }

  private isActiveCardCommander(): boolean {
    const currentMenu = this.menu();
    return currentMenu.zone === 'command' || currentMenu.card?.isCommander === true;
  }

  private isRandomSelectableZone(zone: GameZoneName): boolean {
    return zone === 'library' || zone === 'hand' || zone === 'graveyard' || zone === 'exile';
  }

  private hasPowerToughness(card: GameCardInstance): boolean {
    return card.power !== null && card.power !== undefined && card.toughness !== null && card.toughness !== undefined;
  }

  private hasDefaultPowerToughness(card: GameCardInstance): boolean {
    return card.defaultPower !== null
      && card.defaultPower !== undefined
      && card.defaultToughness !== null
      && card.defaultToughness !== undefined;
  }

  private sortedItems(items: readonly ContextSubmenuItem[]): readonly ContextSubmenuItem[] {
    return [...items].sort((left, right) => left.label.localeCompare(right.label));
  }

  private buildMoveAllToMenuItems(): readonly ContextSubmenuItem[] {
    const currentZone = this.menu().zone;
    if (currentZone !== 'graveyard' && currentZone !== 'exile') {
      return [];
    }

    const oppositeZone: GameZoneName = currentZone === 'graveyard' ? 'exile' : 'graveyard';
    return [
      { value: `zone:${oppositeZone}`, label: this.zoneTitle()(oppositeZone) },
      { value: 'zone:library', label: this.zoneTitle()('library') },
      {
        value: 'battlefield',
        label: this.zoneTitle()('battlefield'),
        children: this.sortedItems(this.players().map((player) => ({
          value: `battlefield:${player.id}`,
          label: this.playerLabel(player),
        }))),
      },
    ];
  }

  private buildMoveToMenuItems(): readonly ContextSubmenuItem[] {
    const items = this.sortedItems(this.activeCardMoveTargets().map((zone) => ({ value: zone, label: this.zoneTitle()(zone) })));
    if (!this.isLibraryCardMenu()) {
      return items;
    }

    return [
      ...items,
      { value: 'library:bottom', label: 'Bottom Library' },
    ];
  }

  private buildLibraryMoveTopMenuItems(): readonly ContextSubmenuItem[] {
    const targetPlayers = this.sortedItems(this.giveToPlayerTargets().map((player) => ({
      value: player.id,
      label: this.playerLabel(player),
    })));

    return [
      { value: 'zone:library', label: 'X to bottom library' },
      { value: 'zone:graveyard', label: 'X to graveyard' },
      { value: 'zone:exile', label: 'X to exile' },
      {
        value: 'hand',
        label: 'X to hand player',
        disabled: targetPlayers.length === 0,
        children: targetPlayers.map((player) => ({ ...player, value: `hand:${player.value}` })),
      },
      {
        value: 'battlefield',
        label: 'X to battlefield player',
        disabled: targetPlayers.length === 0,
        children: targetPlayers.map((player) => ({ ...player, value: `battlefield:${player.value}` })),
      },
    ];
  }

  private buildVisibilityTargetMenuItems(): readonly ContextSubmenuItem[] {
    return [
      { value: 'all', label: 'Todos' },
      ...this.sortedItems(this.players().map((player) => ({ value: player.id, label: this.playerLabel(player) }))),
    ];
  }

  private buildCounterMenuItems(): readonly ContextSubmenuItem[] {
    const card = this.menu().card;
    const cardCounters = card?.counters ?? {};
    const items = this.counterPresets()
      .filter((counter) => this.shouldShowCounterPreset(counter, card))
      .map((counter) => {
        const hasCounter = Object.prototype.hasOwnProperty.call(cardCounters, counter);
        const label = hasCounter ? `Remove ${this.titleCaseCounter(counter)}` : this.titleCaseCounter(counter);
        const value = hasCounter ? `remove:${counter}` : counter;

        return { value, label };
      });

    if (Object.keys(cardCounters).length > 1) {
      return this.sortedItems([
        ...items,
        { value: 'removeAll', label: 'Remove All Counters' },
      ]);
    }

    return this.sortedItems(items);
  }

  private shouldShowCounterPreset(counter: string, card: GameCardInstance | undefined): boolean {
    if ((counter === '+1/+1' || counter === '-1/-1') && (!card || !this.shouldShowPowerToughness()(card))) {
      return false;
    }

    return true;
  }

  private titleCaseCounter(counter: string): string {
    if (counter.startsWith('+') || counter.startsWith('-')) {
      return counter;
    }

    return counter.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private isGameZone(value: string | undefined): value is GameZoneName {
    return value === 'library'
      || value === 'hand'
      || value === 'battlefield'
      || value === 'graveyard'
      || value === 'exile'
      || value === 'command';
  }

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  @HostListener('document:mousedown', ['$event'])
  closeFromOutsidePointer(event: MouseEvent): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.close.emit();
  }
}

import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
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
  | { type: 'moveTop'; zone: GameZoneName }
  | { type: 'shuffle' }
  | { type: 'revealTop' }
  | { type: 'moveAll'; zone: GameZoneName }
  | { type: 'tapCard' }
  | { type: 'faceDown' }
  | { type: 'flipCardFace' }
  | { type: 'revealCard' }
  | { type: 'tokenCopy' }
  | { type: 'drawArrow' }
  | { type: 'addToStack' }
  | { type: 'setPowerToughness' }
  | { type: 'clearPowerToughness' }
  | { type: 'changeCounter'; counter: string }
  | { type: 'removeCounter'; counter: string }
  | { type: 'removeAllCounters' }
  | { type: 'giveToPlayer'; targetPlayerId: string }
  | { type: 'moveCard'; zone: GameZoneName }
  | { type: 'deleteArrow' }
  | { type: 'deleteArrows' }
  | { type: 'deleteCounter' }
  | { type: 'previewCard' };

type ContextSubmenu = 'counters' | 'giveToPlayer' | 'moveTo';

@Component({
  selector: 'app-context-menu',
  imports: [ContextSubmenuComponent],
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
  readonly moveToMenuItems = computed<readonly ContextSubmenuItem[]>(() =>
    this.sortedItems(this.activeCardMoveTargets().map((zone) => ({ value: zone, label: this.zoneTitle()(zone) }))),
  );

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

  activeZoneMoveTargets(): readonly GameZoneName[] {
    const currentZone = this.menu().zone;
    return (['graveyard', 'exile'] satisfies readonly GameZoneName[])
      .filter((zone) => zone !== currentZone)
      .sort((left, right) => this.zoneTitle()(left).localeCompare(this.zoneTitle()(right)));
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
    this.actionSelected.emit({ type: 'moveCard', zone: zone as GameZoneName });
  }

  private isActiveCardCommander(): boolean {
    const currentMenu = this.menu();
    return currentMenu.zone === 'command' || currentMenu.card?.isCommander === true;
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

  private buildCounterMenuItems(): readonly ContextSubmenuItem[] {
    const cardCounters = this.menu().card?.counters ?? {};
    const items = this.counterPresets().map((counter) => {
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

  private titleCaseCounter(counter: string): string {
    if (counter.startsWith('+') || counter.startsWith('-')) {
      return counter;
    }

    return counter.replace(/\b\w/g, (letter) => letter.toUpperCase());
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

import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameZoneName } from '../../../core/models/game.model';
import { GameContextMenu, GameTableStore } from './game-table.store';

@Component({
  selector: 'app-game-table',
  imports: [FormsModule, LucideAngularModule],
  providers: [GameTableStore],
  templateUrl: './game-table.component.html',
  styleUrl: './game-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableComponent {
  readonly store = inject(GameTableStore);
  readonly counterPresets = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
  readonly moveZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'];

  @HostListener('document:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    const current = this.store.currentPlayer();
    const selected = this.store.activeKeyboardCard();
    switch (event.key.toLowerCase()) {
      case 'escape':
        this.store.closeContextMenu();
        this.store.closeZoneModal();
        this.store.clearSelection();
        break;
      case 'd':
        if (current) {
          event.preventDefault();
          void this.store.draw(current.id);
        }
        break;
      case 's':
        if (current) {
          event.preventDefault();
          void this.store.shuffle(current.id);
        }
        break;
      case 't':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('card.tapped', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
            tapped: !selected.card.tapped,
          });
        }
        break;
      case 'z':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('card.face_down.changed', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
            faceDown: !selected.card.faceDown,
          });
        }
        break;
      case 'k':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('stack.card_added', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
          });
        }
        break;
      case 'w':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.moveActiveCard('graveyard');
        }
        break;
    }
  }

  @HostListener('window:pointermove', ['$event'])
  handlePointerMove(event: PointerEvent): void {
    this.store.moveFloatingPanel(event);
    this.store.moveCardPointerDrag(event);
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent): void {
    this.store.endFloatingDrag();
    void this.store.endCardPointerDrag(event);
  }

  @HostListener('window:pointercancel', ['$event'])
  handlePointerCancel(event: PointerEvent): void {
    this.store.endFloatingDrag();
    void this.store.cancelCardPointerDrag(event);
  }

  isLibraryMenu(menu: GameContextMenu): boolean {
    return menu.zone === 'library' && !menu.card;
  }

  isZoneOnlyMenu(menu: GameContextMenu): boolean {
    return !menu.card && menu.zone !== 'library';
  }
}

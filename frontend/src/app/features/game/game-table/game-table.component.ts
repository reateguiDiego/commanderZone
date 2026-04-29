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

    const focused = this.store.focusedPlayer();
    const selected = this.store.selectedCards()[0];
    switch (event.key.toLowerCase()) {
      case 'escape':
        this.store.closeContextMenu();
        this.store.closeZoneModal();
        break;
      case 'd':
        if (focused) {
          event.preventDefault();
          void this.store.draw(focused.id);
        }
        break;
      case 's':
        if (focused) {
          event.preventDefault();
          void this.store.shuffle(focused.id);
        }
        break;
      case 't':
        if (selected) {
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
        if (selected) {
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
        if (selected) {
          event.preventDefault();
          void this.store.command('stack.card_added', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
          });
        }
        break;
    }
  }

  isLibraryMenu(menu: GameContextMenu): boolean {
    return menu.zone === 'library' && !menu.card;
  }

  isZoneOnlyMenu(menu: GameContextMenu): boolean {
    return !menu.card && menu.zone !== 'library';
  }
}

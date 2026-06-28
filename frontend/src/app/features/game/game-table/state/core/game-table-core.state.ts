import { computed, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';

@Injectable()
export class GameTableCoreState {
  private readonly route = inject(ActivatedRoute);

  readonly zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  readonly dockZones: GameZoneName[] = ['library', 'command', 'graveyard', 'exile'];
  readonly publicZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'command'];
  readonly phases = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];

  readonly gameId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly snapshot = signal<GameSnapshot | null>(null);
  readonly viewerCanControlTable = signal(true);
  readonly currentRoomId = signal<string | null>(null);
  readonly currentDeckId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly targetToast = signal<string | null>(null);
  readonly tableToast = computed(() => this.error() ?? this.targetToast());
  readonly pending = signal(false);
}

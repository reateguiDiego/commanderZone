import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameplayGamePatchMessage } from '../../../../core/models/game-realtime.model';

export interface GameTableRealtimePatchAnimationEvent {
  readonly previousSnapshot: GameSnapshot;
  readonly nextSnapshot: GameSnapshot;
  readonly patch: GameplayGamePatchMessage;
  readonly isLocalPatch: boolean;
}

@Injectable()
export class GameTableRealtimeAnimationBusService {
  private readonly patchAnimationSubject = new Subject<GameTableRealtimePatchAnimationEvent>();

  readonly patchAnimation$ = this.patchAnimationSubject.asObservable();

  emitPatchAnimation(event: GameTableRealtimePatchAnimationEvent): void {
    this.patchAnimationSubject.next(event);
  }
}

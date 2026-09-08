import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { normalizeUserGamePreferences, UserGamePreferences } from '../../../../../core/models/user.model';

/**
 * Immutable UI preferences for one mounted game table.
 *
 * They deliberately live outside GameSnapshot: preferences are private to the
 * viewer and must not travel through game HTTP or realtime payloads.
 */
export type GameTableSessionPreferences = Readonly<UserGamePreferences>;

@Injectable()
export class GameTableSessionPreferencesStore {
  private readonly authStore = inject(AuthStore);

  /**
   * Reads the already-hydrated user cache once while the game-table injector
   * is created. There is intentionally no signal, effect, or later refresh.
   */
  readonly preferences: GameTableSessionPreferences = Object.freeze(
    normalizeUserGamePreferences(this.authStore.user()?.preferences?.game),
  );
}

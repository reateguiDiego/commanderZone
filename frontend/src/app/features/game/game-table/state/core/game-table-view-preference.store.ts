import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import type { BattlefieldViewLayout } from '../../game-table-layout/game-table-grid-seat.model';
import { GameTableSessionPreferencesStore } from './game-table-session-preferences.store';

/**
 * Persists the battlefield view selected by the local player.
 *
 * The selected view remains private account data: it is intentionally not
 * added to the game snapshot or broadcast to the other players at the table.
 */
@Injectable()
export class GameTableViewPreferenceStore {
  private readonly authStore = inject(AuthStore);
  private readonly sessionPreferences = inject(GameTableSessionPreferencesStore);
  private lastPersistedMode = this.sessionPreferences.preferences.chosenModeView;
  private pendingMode: BattlefieldViewLayout | null = null;
  private saveInFlight: Promise<void> | null = null;

  save(mode: BattlefieldViewLayout): Promise<void> {
    if (mode === this.lastPersistedMode && this.saveInFlight === null) {
      return Promise.resolve();
    }

    this.pendingMode = mode;
    if (this.saveInFlight === null) {
      this.saveInFlight = this.flush();
    }

    return this.saveInFlight;
  }

  private async flush(): Promise<void> {
    try {
      while (this.pendingMode !== null) {
        const mode = this.pendingMode;
        this.pendingMode = null;

        if (mode === this.lastPersistedMode) {
          continue;
        }

        try {
          await this.authStore.updateGamePreferences({ chosenModeView: mode });
          this.lastPersistedMode = mode;
        } catch {
          // Keep the selected UI mode. A later user selection retries saving it.
        }
      }
    } finally {
      this.saveInFlight = null;
    }
  }
}

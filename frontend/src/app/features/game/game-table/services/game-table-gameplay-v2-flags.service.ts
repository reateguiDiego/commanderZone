import { Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GameTableGameplayV2FlagsService {
  enabled(): boolean {
    if (environment.gameplayV2FrontendEnabled) {
      return true;
    }

    try {
      return typeof globalThis !== 'undefined'
        && 'localStorage' in globalThis
        && globalThis.localStorage.getItem('commanderzone.gameplayV2FrontendEnabled') === '1';
    } catch {
      return false;
    }
  }
}

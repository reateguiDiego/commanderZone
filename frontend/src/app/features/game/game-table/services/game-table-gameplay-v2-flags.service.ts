import { Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GameTableGameplayV2FlagsService {
  enabled(): boolean {
    return environment.gameplayV2FrontendEnabled;
  }
}

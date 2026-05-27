import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import { AuthStore } from '../auth/auth.store';
import { normalizeLanguageCode, SupportedLanguageCode } from './language-preferences';

@Injectable({ providedIn: 'root' })
export class LanguagePreferencesService {
  private readonly authStore = inject(AuthStore);
  private readonly authApi = inject(AuthApi);

  readonly cardLanguage = computed<SupportedLanguageCode>(() =>
    normalizeLanguageCode(this.authStore.user()?.preferences?.cardLanguage),
  );

  readonly appLanguage = computed<SupportedLanguageCode>(() =>
    normalizeLanguageCode(this.authStore.user()?.preferences?.appLanguage),
  );

  async updateCardLanguage(cardLanguage: SupportedLanguageCode): Promise<void> {
    await this.updatePreferences({ cardLanguage });
  }

  async updateAppLanguage(appLanguage: SupportedLanguageCode): Promise<void> {
    await this.updatePreferences({ appLanguage });
  }

  async updatePreferences(preferences: { cardLanguage?: SupportedLanguageCode; appLanguage?: SupportedLanguageCode }): Promise<void> {
    if (preferences.cardLanguage === undefined && preferences.appLanguage === undefined) {
      return;
    }

    await firstValueFrom(this.authApi.updateMe(preferences));
    await this.authStore.loadMe();
  }
}

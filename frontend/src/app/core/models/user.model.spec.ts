import { UserGamePreferences, normalizeUserGamePreferences } from './user.model';

describe('normalizeUserGamePreferences', () => {
  it('keeps only supported boolean preferences from persisted user data', () => {
    const persistedPreferences = {
      enableManaRow: false,
      enableStackMana: false,
    } as Partial<UserGamePreferences> & { readonly enableStackMana: boolean };

    expect(normalizeUserGamePreferences(persistedPreferences)).toEqual({
      showManaHelperOnStartup: false,
      enableManaRow: false,
      autoApplyCommanderDamageToLife: true,
      gameAnimations: true,
      chatNotificationSounds: true,
      combineChatAndGameLog: false,
    });
  });

  it('uses defaults for malformed persisted values', () => {
    const persistedPreferences = {
      gameAnimations: 'false',
    } as unknown as Partial<UserGamePreferences>;

    expect(normalizeUserGamePreferences(persistedPreferences).gameAnimations).toBe(true);
  });
});

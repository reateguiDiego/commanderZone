import { UserGamePreferences, normalizeUserGamePreferences } from './user.model';

describe('normalizeUserGamePreferences', () => {
  it('keeps only supported boolean preferences from persisted user data', () => {
    const persistedPreferences = {
      enableManaRow: false,
      enableStackMana: false,
    } as Partial<UserGamePreferences> & { readonly enableStackMana: boolean };

    expect(normalizeUserGamePreferences(persistedPreferences)).toEqual({
      defaultBattlefieldLayout: 'square',
      showCardAlignmentHelper: true,
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

  it('keeps only supported default battlefield layouts from persisted user data', () => {
    expect(normalizeUserGamePreferences({ defaultBattlefieldLayout: 'grid' }).defaultBattlefieldLayout).toBe('grid');
    expect(normalizeUserGamePreferences({ defaultBattlefieldLayout: 'list' } as unknown as Partial<UserGamePreferences>).defaultBattlefieldLayout)
      .toBe('square');
  });

  it('uses false when the card alignment helper is explicitly disabled', () => {
    expect(normalizeUserGamePreferences({ showCardAlignmentHelper: false }).showCardAlignmentHelper).toBe(false);
  });
});

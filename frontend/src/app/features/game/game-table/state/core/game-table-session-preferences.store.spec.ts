import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { User, UserGamePreferences } from '../../../../../core/models/user.model';
import { GameTableSessionPreferencesStore } from './game-table-session-preferences.store';

describe('GameTableSessionPreferencesStore', () => {
  const authStore = {
    user: vi.fn(),
  };

  beforeEach(() => {
    authStore.user.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableSessionPreferencesStore,
        { provide: AuthStore, useValue: authStore },
      ],
    });
  });

  it('captures the currently hydrated game preferences once and never observes later account changes', () => {
    authStore.user.mockReturnValue(userWithGamePreferences({
      enableManaRow: false,
      combineChatAndGameLog: true,
      gameAnimations: false,
    }));

    const store = TestBed.inject(GameTableSessionPreferencesStore);
    authStore.user.mockReturnValue(userWithGamePreferences({
      enableManaRow: true,
      combineChatAndGameLog: false,
      gameAnimations: true,
    }));

    expect(authStore.user).toHaveBeenCalledOnce();
    expect(store.preferences).toMatchObject({
      enableManaRow: false,
      combineChatAndGameLog: true,
      gameAnimations: false,
      showManaHelperOnStartup: false,
      autoApplyCommanderDamageToLife: true,
      chatNotificationSounds: true,
    });
    expect(Object.isFrozen(store.preferences)).toBe(true);
  });

  it('uses compatibility defaults when the persisted user has no game preferences yet', () => {
    authStore.user.mockReturnValue({
      id: 'user-1',
      email: 'user@example.test',
      displayName: 'Player',
      roles: [],
    } satisfies User);

    const store = TestBed.inject(GameTableSessionPreferencesStore);

    expect(store.preferences).toEqual({
      showManaHelperOnStartup: false,
      enableManaRow: true,
      autoApplyCommanderDamageToLife: true,
      gameAnimations: true,
      chatNotificationSounds: true,
      combineChatAndGameLog: false,
    });
  });
});

function userWithGamePreferences(game: Partial<UserGamePreferences>): User {
  return {
    id: 'user-1',
    email: 'user@example.test',
    displayName: 'Player',
    roles: [],
    preferences: {
      cardLanguage: 'en',
      appLanguage: 'en',
      themeId: 'sunrise',
      game: {
        showManaHelperOnStartup: false,
        enableManaRow: true,
        autoApplyCommanderDamageToLife: true,
        gameAnimations: true,
        chatNotificationSounds: true,
        combineChatAndGameLog: false,
        ...game,
      },
    },
  };
}

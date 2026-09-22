import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { GameTableSessionPreferencesStore } from './game-table-session-preferences.store';
import { GameTableViewPreferenceStore } from './game-table-view-preference.store';

describe('GameTableViewPreferenceStore', () => {
  const authStore = {
    updateGamePreferences: vi.fn(),
  };

  beforeEach(() => {
    authStore.updateGamePreferences.mockReset();
    authStore.updateGamePreferences.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        GameTableViewPreferenceStore,
        { provide: AuthStore, useValue: authStore },
        {
          provide: GameTableSessionPreferencesStore,
          useValue: { preferences: { chosenModeView: 'square' } },
        },
      ],
    });
  });

  it('persists a changed view and avoids writing the already saved mode', async () => {
    const store = TestBed.inject(GameTableViewPreferenceStore);

    await store.save('grid');
    await store.save('grid');

    expect(authStore.updateGamePreferences).toHaveBeenCalledTimes(1);
    expect(authStore.updateGamePreferences).toHaveBeenCalledWith({ chosenModeView: 'grid' });
  });
});

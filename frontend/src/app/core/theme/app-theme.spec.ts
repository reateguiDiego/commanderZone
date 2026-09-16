import { APP_THEMES } from './app-theme';
import { APP_THEME_IDS } from './theme-id';

describe('app theme metadata', () => {
  it('keeps the selectable metadata aligned with the valid theme ids', () => {
    expect(APP_THEMES.map((theme) => theme.id)).toEqual(APP_THEME_IDS);
  });
});

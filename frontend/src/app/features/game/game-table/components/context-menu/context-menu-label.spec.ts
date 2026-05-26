import { contextMenuDisplayLabel } from './context-menu-label';

describe('contextMenuDisplayLabel', () => {
  it('uses sentence case without title-casing every word and keeps standalone X uppercase', () => {
    expect(contextMenuDisplayLabel('MAKE A TOKEN COPY')).toBe('Make a token copy');
    expect(contextMenuDisplayLabel('View X top cards')).toBe('View X top cards');
    expect(contextMenuDisplayLabel('X to bottom of library')).toBe('X to bottom of library');
  });
});

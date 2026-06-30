import { contextMenuDisplayLabel } from './context-menu-label';

describe('contextMenuDisplayLabel', () => {
  it('uses sentence case without title-casing every word and keeps standalone X uppercase', () => {
    expect(contextMenuDisplayLabel("CREATE A TOKEN THAT'S A COPY")).toBe("Create a token that's a copy");
    expect(contextMenuDisplayLabel('Look at Top X Cards')).toBe('Look at top X cards');
    expect(contextMenuDisplayLabel('Put X on Bottom of Library')).toBe('Put X on bottom of library');
  });
});

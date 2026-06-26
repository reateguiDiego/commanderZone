import { resolveCardPreviewTypeIcon } from './card-preview-item';

describe('resolveCardPreviewTypeIcon', () => {
  it('uses the first real card type token from the primary type line before a stale explicit icon', () => {
    expect(resolveCardPreviewTypeIcon({
      cardType: 'Artifact Creature - Golem',
      cardTypeIcon: 'creature',
    })).toBe('artifact');
  });

  it('falls back to the explicit icon when the localized type line does not expose canonical english tokens', () => {
    expect(resolveCardPreviewTypeIcon({
      cardType: 'Artefacto',
      cardTypeIcon: 'artifact',
    })).toBe('artifact');
  });

  it('returns the first type token for battle cards', () => {
    expect(resolveCardPreviewTypeIcon({
      cardType: 'Battle - Siege',
      cardTypeIcon: 'multiple',
    })).toBe('battle');
  });
});

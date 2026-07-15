import { resolveManaHelperColors } from './effective-mana-identity';

describe('resolveManaHelperColors', () => {
  it.each([
    { identity: ['W'], expected: ['W', 'C'] },
    { identity: ['U', 'R'], expected: ['U', 'R', 'C'] },
    { identity: ['W', 'U', 'B', 'R', 'G'], expected: ['W', 'U', 'B', 'R', 'G', 'C'] },
    { identity: [], expected: ['C'] },
    { identity: null, expected: ['C'] },
    { identity: ['invalid', 'C'], expected: ['C'] },
    { identity: ['g', 'W', 'u', 'W'], expected: ['W', 'U', 'G', 'C'] },
  ])('canonicalizes $identity to $expected', ({ identity, expected }) => {
    expect(resolveManaHelperColors(identity)).toEqual(expected);
  });

  it('uses the already-combined partner/background/DFC identity without deriving from a visual face', () => {
    const frozenCombinedIdentity = ['R', 'W', 'B'];

    expect(resolveManaHelperColors(frozenCombinedIdentity)).toEqual(['W', 'B', 'R', 'C']);
  });
});

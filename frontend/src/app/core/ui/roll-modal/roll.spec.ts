import { randomRollIterationCount, rollOption } from './roll';

describe('roll', () => {
  it('uses a random 1 to 20 value as the internal roll count', () => {
    expect(randomRollIterationCount(vi.fn(() => 0))).toBe(1);
    expect(randomRollIterationCount(vi.fn(() => 0.999999))).toBe(20);
  });

  it('uses crypto random values for roll counts by default', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array)[0] = 19;
      return array;
    });

    try {
      expect(randomRollIterationCount()).toBe(20);
      expect(getRandomValues).toHaveBeenCalled();
    } finally {
      getRandomValues.mockRestore();
    }
  });

  it('rolls internally several times and exposes only the final die result', () => {
    const random = vi.fn()
      .mockReturnValueOnce(0.65)
      .mockReturnValue(0.99);

    const result = rollOption('d20', random);

    expect(result).toEqual({
      kind: 'd20',
      label: 'Dado de 20 caras',
      iterationCount: 14,
      finalResult: '20',
    });
    expect(random).toHaveBeenCalledTimes(15);
  });

  it('supports coin results', () => {
    const result = rollOption('coin', vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.51));

    expect(result.finalResult).toBe('Cruz');
  });
});

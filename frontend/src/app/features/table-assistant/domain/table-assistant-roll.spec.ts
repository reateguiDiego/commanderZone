import { rollTableAssistantOption } from './table-assistant-roll';

describe('table assistant roll', () => {
  it('rolls internally several times and exposes only the final die result', () => {
    const randomValues = [
      0.65,
      0.00,
      0.05,
      0.10,
      0.15,
      0.20,
      0.25,
      0.99,
    ];
    const random = vi.fn(() => randomValues.shift() ?? 0);

    const result = rollTableAssistantOption('d20', random);

    expect(result).toEqual({
      kind: 'd20',
      label: 'Dado de 20 caras',
      iterationCount: 7,
      finalResult: '20',
    });
    expect(random).toHaveBeenCalledTimes(8);
  });

  it('supports coin results', () => {
    const result = rollTableAssistantOption('coin', vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.51));

    expect(result.finalResult).toBe('Cruz');
  });
});

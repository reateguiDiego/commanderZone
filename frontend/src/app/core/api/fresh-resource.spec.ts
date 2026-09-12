import { FreshResource } from './fresh-resource';

describe('FreshResource', () => {
  it('does not apply old account responses or clear a newer pending request after reset', async () => {
    const resource = new FreshResource();
    let finishOld!: (value: number) => void;
    let finishNew!: (value: number) => void;
    const apply = vi.fn();
    const old = resource.load(() => new Promise<number>((resolve) => { finishOld = resolve; }), apply);
    await Promise.resolve();
    resource.reset();
    const current = resource.load(() => new Promise<number>((resolve) => { finishNew = resolve; }), apply);
    await Promise.resolve();
    finishOld(1);
    await old;
    expect(apply).not.toHaveBeenCalled();
    expect(resource.load(vi.fn(), apply)).toBe(current);
    finishNew(2);
    await current;
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('shares the exact pending promise and discards a response invalidated in flight', async () => {
    const resource = new FreshResource();
    let finish!: (value: number) => void;
    const read = vi.fn().mockReturnValueOnce(new Promise<number>((resolve) => { finish = resolve; })).mockResolvedValue(2);
    const apply = vi.fn();
    expect(resource.state()).toBe('idle');
    const first = resource.load(read, apply);
    expect(resource.load(read, apply)).toBe(first);
    await Promise.resolve();
    resource.invalidate();
    finish(1);
    await first;
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
    expect(resource.state()).toBe('loaded');
    expect(resource.loadedAt()).not.toBeNull();
  });
});

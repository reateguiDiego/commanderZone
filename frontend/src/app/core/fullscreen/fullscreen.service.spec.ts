import { TestBed } from '@angular/core/testing';
import { FullscreenService } from './fullscreen.service';

describe('FullscreenService', () => {
  it('requests fullscreen on the document element when inactive', async () => {
    const service = TestBed.inject(FullscreenService);
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });

    const fullscreen = await service.toggleFullscreen();

    expect(fullscreen).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });
});

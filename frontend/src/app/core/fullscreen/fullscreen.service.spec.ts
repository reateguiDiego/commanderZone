import { TestBed } from '@angular/core/testing';
import { FullscreenService } from './fullscreen.service';

describe('FullscreenService', () => {
  afterEach(() => {
    document.documentElement.classList.remove('app-pseudo-fullscreen');
    document.body.classList.remove('app-pseudo-fullscreen');
    document.body.style.top = '';
  });

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

  it('falls back to pseudo fullscreen when native fullscreen fails', async () => {
    const service = TestBed.inject(FullscreenService);
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('not supported'));

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
    expect(document.documentElement.classList.contains('app-pseudo-fullscreen')).toBe(true);
    expect(document.body.classList.contains('app-pseudo-fullscreen')).toBe(true);
  });

  it('disables pseudo fullscreen when toggled off', async () => {
    const service = TestBed.inject(FullscreenService);
    document.documentElement.classList.add('app-pseudo-fullscreen');
    document.body.classList.add('app-pseudo-fullscreen');
    document.body.style.top = '-120px';
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    const fullscreen = await service.toggleFullscreen();

    expect(fullscreen).toBe(false);
    expect(document.documentElement.classList.contains('app-pseudo-fullscreen')).toBe(false);
    expect(document.body.classList.contains('app-pseudo-fullscreen')).toBe(false);
    expect(document.body.style.top).toBe('');
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });
});

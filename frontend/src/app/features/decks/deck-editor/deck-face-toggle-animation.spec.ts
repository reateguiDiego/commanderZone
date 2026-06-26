import { gsap } from 'gsap';
import { runDeckFaceToggleAnimation } from './deck-face-toggle-animation';

describe('runDeckFaceToggleAnimation', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('skips GSAP on compact layouts', () => {
    mockMatchMedia((query) => query === '(max-width: 1180px)');
    const gsapFromToSpy = vi.spyOn(gsap, 'fromTo');
    const gsapSetSpy = vi.spyOn(gsap, 'set');
    vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);

    const trigger = appendTrigger();

    runDeckFaceToggleAnimation(trigger, 'card-image');

    expect(gsapFromToSpy).not.toHaveBeenCalled();
    expect(gsapSetSpy).not.toHaveBeenCalled();
  });

  it('runs GSAP on desktop hover layouts', () => {
    mockMatchMedia(() => false);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const gsapFromToSpy = vi.spyOn(gsap, 'fromTo').mockImplementation(() => null as never);
    const gsapSetSpy = vi.spyOn(gsap, 'set').mockImplementation(() => undefined as never);
    vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);

    const trigger = appendTrigger();

    runDeckFaceToggleAnimation(trigger, 'card-image');

    expect(gsapFromToSpy).toHaveBeenCalled();
    expect(gsapSetSpy).toHaveBeenCalled();
  });
});

function appendTrigger(): HTMLElement {
  document.body.innerHTML = `
    <article class="deck-card-row">
      <button class="face-toggle-button" type="button">
        <span class="spoiler-image-frame">
          <img src="https://img.test/card.jpg" alt="card" />
        </span>
      </button>
    </article>
  `;

  return document.querySelector('.face-toggle-button') as HTMLElement;
}

function mockMatchMedia(matches: (query: string) => boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

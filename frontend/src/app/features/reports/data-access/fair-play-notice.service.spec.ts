import { TestBed } from '@angular/core/testing';
import { FairPlayNoticeService } from './fair-play-notice.service';

describe('FairPlayNoticeService', () => {
  let service: FairPlayNoticeService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [FairPlayNoticeService] });
    service = TestBed.inject(FairPlayNoticeService);
  });

  it('persists the first display once for each user and game pair', () => {
    service.showIfNeeded('user-1', 'game-1');
    expect(service.activeKey()).toContain('user-1.game-1');
    const gameOneKey = service.activeKey()!;
    expect(localStorage.getItem(gameOneKey)).toBe('1');

    service.acknowledge();
    service.showIfNeeded('user-1', 'game-1');
    expect(service.activeKey()).toBeNull();

    service.showIfNeeded('user-1', 'game-2');
    expect(service.activeKey()).toContain('user-1.game-2');

    const reloadedService = new FairPlayNoticeService();
    reloadedService.showIfNeeded('user-1', 'game-1');
    expect(reloadedService.activeKey()).toBeNull();
    reloadedService.showIfNeeded('user-1', 'game-2');
    expect(reloadedService.activeKey()).toBeNull();
  });

  it('keeps a memory display marker when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    service.showIfNeeded('user-1', 'game-1');
    expect(service.activeKey()).toContain('user-1.game-1');
    service.acknowledge();
    service.showIfNeeded('user-1', 'game-1');

    expect(service.activeKey()).toBeNull();
    setItem.mockRestore();
  });

  it('clears an old active modal when switching to an already shown game', () => {
    service.showIfNeeded('user-1', 'game-1');
    service.showIfNeeded('user-1', 'game-2');
    expect(service.activeKey()).toContain('game-2');

    service.showIfNeeded('user-1', 'game-1');

    expect(service.activeKey()).toBeNull();
  });
});

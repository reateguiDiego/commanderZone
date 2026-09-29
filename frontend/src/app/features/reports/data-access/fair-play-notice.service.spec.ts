import { TestBed } from '@angular/core/testing';
import { FairPlayNoticeService } from './fair-play-notice.service';

describe('FairPlayNoticeService', () => {
  let service: FairPlayNoticeService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [FairPlayNoticeService] });
    service = TestBed.inject(FairPlayNoticeService);
  });

  it('shows once for each user and game pair and persists acknowledgement', () => {
    service.showIfNeeded('user-1', 'game-1');
    expect(service.activeKey()).toContain('user-1.game-1');

    service.acknowledge();
    service.showIfNeeded('user-1', 'game-1');
    expect(service.activeKey()).toBeNull();

    service.showIfNeeded('user-1', 'game-2');
    expect(service.activeKey()).toContain('user-1.game-2');
  });

  it('keeps a memory acknowledgement when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    service.showIfNeeded('user-1', 'game-1');
    service.acknowledge();
    service.showIfNeeded('user-1', 'game-1');

    expect(service.activeKey()).toBeNull();
    setItem.mockRestore();
  });
});

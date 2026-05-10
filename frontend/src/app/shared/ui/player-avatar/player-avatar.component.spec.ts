import { TestBed } from '@angular/core/testing';
import { PlayerAvatarComponent } from './player-avatar.component';

describe('PlayerAvatarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerAvatarComponent],
    }).compileComponents();
  });

  it('renders initials when no image avatar is configured', () => {
    const fixture = TestBed.createComponent(PlayerAvatarComponent);
    fixture.componentRef.setInput('displayName', 'Commander Zone');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('C');
  });

  it('resolves uploaded avatar URLs against the API base URL', () => {
    const fixture = TestBed.createComponent(PlayerAvatarComponent);
    fixture.componentRef.setInput('displayName', 'Player');
    fixture.componentRef.setInput('avatar', { type: 'upload', imageUrl: '/users/user-1/avatar' });
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toContain('/users/user-1/avatar');
  });

  it('resolves preset avatar URLs as public assets', () => {
    const fixture = TestBed.createComponent(PlayerAvatarComponent);
    fixture.componentRef.setInput('displayName', 'Player');
    fixture.componentRef.setInput('avatar', { type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('/assets/images/avatars/storm-seer.png');
  });
});

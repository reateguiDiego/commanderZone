import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { DashboardHomeComponent } from './dashboard-home.component';

describe('DashboardHomeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardHomeComponent],
      providers: [
        {
          provide: AuthStore,
          useValue: {
            user: signal({ displayName: 'Aaguilera21' }),
            displayName: signal('Aaguilera21'),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders a personal welcome instead of duplicated sidebar actions', () => {
    const fixture = TestBed.createComponent(DashboardHomeComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Qué bueno verte de nuevo, Aaguilera21.');
    expect(fixture.nativeElement.textContent).not.toContain('Join a room');
  });
});

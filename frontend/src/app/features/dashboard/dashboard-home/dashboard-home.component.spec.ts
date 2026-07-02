import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronRight, LucideAngularModule, Trophy } from 'lucide-angular';
import { AuthStore } from '../../../core/auth/auth.store';
import { DashboardHomeComponent } from './dashboard-home.component';

describe('DashboardHomeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardHomeComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronRight, Trophy })),
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

    const element = fixture.nativeElement as HTMLElement;
    const titleLabel = element.querySelector('.welcome-title-label');
    const titleUser = element.querySelector('.welcome-title-user');

    expect(titleLabel?.textContent?.trim()).toBe('Welcome');
    expect(titleUser?.textContent?.trim()).toBe('Aaguilera21');
    expect(element.textContent).toContain('Your commanders thirst for blood');
    expect(element.textContent).not.toContain('La mesa te estaba esperando');
    expect(fixture.nativeElement.textContent).toContain('The Ur-Dragon');
    expect(fixture.nativeElement.textContent).not.toContain('Join a room');
  });
});

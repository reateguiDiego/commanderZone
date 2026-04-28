import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DoorOpen, Layers3, LucideAngularModule } from 'lucide-angular';
import { DashboardHomeComponent } from './dashboard-home.component';

describe('DashboardHomeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardHomeComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ DoorOpen, Layers3 })),
      ],
    }).compileComponents();
  });

  it('renders dashboard actions', () => {
    const fixture = TestBed.createComponent(DashboardHomeComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Decks');
    expect(fixture.nativeElement.textContent).toContain('Join a room');
  });
});

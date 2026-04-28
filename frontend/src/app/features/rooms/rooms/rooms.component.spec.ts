import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DoorOpen, LogOut, LucideAngularModule, Play, Plus, RefreshCcw } from 'lucide-angular';
import { of } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { RoomsComponent } from './rooms.component';

describe('RoomsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomsComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ DoorOpen, LogOut, Play, Plus, RefreshCcw })),
        { provide: DecksApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: RoomsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
      ],
    }).compileComponents();
  });

  it('renders the rooms page', () => {
    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Rooms');
  });
});

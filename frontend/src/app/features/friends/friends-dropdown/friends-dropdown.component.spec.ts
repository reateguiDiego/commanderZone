import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Check, LucideAngularModule, Search, X } from 'lucide-angular';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { FriendsStore } from '../data-access/friends.store';
import { FriendsDropdownComponent } from './friends-dropdown.component';

describe('FriendsDropdownComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendsDropdownComponent],
      providers: [
        FriendsStore,
        importProvidersFrom(LucideAngularModule.pick({ Check, Search, X })),
        {
          provide: FriendsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            incoming: vi.fn().mockReturnValue(of({ data: [] })),
            outgoing: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the compact friend list', () => {
    const fixture = TestBed.createComponent(FriendsDropdownComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Friend list');
  });
});

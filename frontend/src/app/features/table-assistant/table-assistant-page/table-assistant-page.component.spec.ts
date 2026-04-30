import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { TableAssistantPageComponent } from './table-assistant-page.component';

describe('TableAssistantPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableAssistantPageComponent],
      providers: [
        provideRouter([]),
        { provide: TableAssistantApi, useValue: { create: vi.fn() } },
        { provide: RoomsApi, useValue: { invite: vi.fn() } },
        { provide: FriendsApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) } },
      ],
    }).compileComponents();
  });

  it('renders intro copy and opens setup from CTA', () => {
    const fixture = TestBed.createComponent(TableAssistantPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Asistente de Mesa');
    expect(fixture.nativeElement.textContent).toContain('Empezar partida');

    fixture.nativeElement.querySelector('.primary-button').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Configura lo justo para empezar');
    expect(fixture.nativeElement.textContent).toContain('Un dispositivo en la mesa');
  });
});


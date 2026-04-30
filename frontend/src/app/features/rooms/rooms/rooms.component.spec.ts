import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DoorOpen, LogOut, LucideAngularModule, Play, Plus, RefreshCcw, Trash2 } from 'lucide-angular';
import { of } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { RoomsComponent } from './rooms.component';

describe('RoomsComponent', () => {
  const roomsApi = {
    list: vi.fn(),
    show: vi.fn(),
    delete: vi.fn(),
    incomingInvites: vi.fn(),
  };

  beforeEach(async () => {
    roomsApi.list.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.show.mockReset().mockReturnValue(of({ room: null }));
    roomsApi.delete.mockReset().mockReturnValue(of(undefined));
    roomsApi.incomingInvites.mockReset().mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [RoomsComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ DoorOpen, LogOut, Play, Plus, RefreshCcw, Trash2 })),
        { provide: DecksApi, useValue: { list: vi.fn().mockReturnValue(of({ data: [] })) } },
        { provide: RoomsApi, useValue: roomsApi },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) } },
      ],
    }).compileComponents();
  });

  it('renders the rooms page', () => {
    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Rooms');
  });

  it('deletes owned waiting rooms after modal confirmation', async () => {
    const room = {
      id: 'room-1',
      owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
      status: 'waiting' as const,
      visibility: 'private' as const,
      players: [],
      gameId: null,
    };
    roomsApi.list.mockReturnValue(of({ data: [room] }));

    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.requestDeleteRoom(room);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Borrar sala');

    await fixture.componentInstance.confirmDeleteRoom();

    expect(roomsApi.delete).toHaveBeenCalledWith('room-1');
    expect(fixture.componentInstance.roomPendingDelete()).toBeNull();
  });
});

import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Building2, DoorOpen, Globe, Lock, LogOut, LucideAngularModule, Play, Plus, RefreshCcw, Search, Swords, Trash2, Users } from 'lucide-angular';
import { of } from 'rxjs';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { RoomsComponent } from './rooms.component';

describe('RoomsComponent', () => {
  const roomsApi = {
    list: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    incomingInvites: vi.fn(),
    invites: vi.fn(),
  };

  beforeEach(async () => {
    roomsApi.list.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.delete.mockReset().mockReturnValue(of(undefined));
    roomsApi.archive.mockReset().mockReturnValue(of({ room: null }));
    roomsApi.incomingInvites.mockReset().mockReturnValue(of({ data: [] }));
    roomsApi.invites.mockReset().mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [RoomsComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Building2, DoorOpen, Globe, Lock, LogOut, Play, Plus, RefreshCcw, Search, Swords, Trash2, Users })),
        { provide: RoomsApi, useValue: roomsApi },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1', email: 'owner@test', displayName: 'Owner' }) } },
      ],
    }).compileComponents();
  });

  it('renders the rooms page', () => {
    const fixture = TestBed.createComponent(RoomsComponent);
    fixture.detectChanges();

    const header = TestBed.inject(PageHeaderStore).state();
    expect(header?.title).toBe('Rooms');
    expect(header?.stats?.map((stat) => stat.label)).toEqual([
      'Active rooms',
      'Open rooms',
      'Private rooms',
      'Started games',
    ]);
  });

  it('deletes owned waiting rooms after modal confirmation', async () => {
    const room = {
      id: 'room-1',
      name: 'Mesa del Bosque',
      owner: { id: 'user-1', email: 'owner@test', displayName: 'Owner', roles: [] },
      status: 'waiting' as const,
      visibility: 'private' as const,
      format: 'commander' as const,
      maxPlayers: 4,
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

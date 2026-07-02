import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronLeft, ChevronRight, DoorOpen, LogOut, LucideAngularModule, Trash2 } from 'lucide-angular';
import { Room } from '../../../../../core/models/room.model';
import { User } from '../../../../../core/models/user.model';
import { RoomBrowserComponent } from './room-browser.component';

describe('RoomBrowserComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomBrowserComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronLeft, ChevronRight, DoorOpen, LogOut, Trash2 })),
      ],
    }).compileComponents();
  });

  it('hides pagination when rooms fit on one page', () => {
    const fixture = TestBed.createComponent(RoomBrowserComponent);
    fixture.componentRef.setInput('rooms', rooms(20));

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-pagination')).toBeNull();
    expect(renderedRoomNames(fixture.nativeElement)).toHaveLength(20);
  });

  it('paginates rooms and resets to first page when filters change', () => {
    const fixture = TestBed.createComponent(RoomBrowserComponent);
    fixture.componentRef.setInput('rooms', rooms(21));

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-pagination')).not.toBeNull();
    expect(renderedRoomNames(fixture.nativeElement)).toHaveLength(20);
    expect(fixture.nativeElement.textContent).toContain('/ 2');
    expect(fixture.nativeElement.textContent).not.toContain('Room 21');

    fixture.componentInstance.nextPage();
    fixture.detectChanges();

    expect(renderedRoomNames(fixture.nativeElement)).toEqual(['Room 21']);
    expect(fixture.componentInstance.currentPage()).toBe(2);

    fixture.componentInstance.setRoomNameFilter('Room 01');
    fixture.detectChanges();

    expect(fixture.componentInstance.currentPage()).toBe(1);
    expect(fixture.nativeElement.querySelector('app-pagination')).toBeNull();
    expect(renderedRoomNames(fixture.nativeElement)).toEqual(['Room 01']);
  });
});

function renderedRoomNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.room-col-main strong'))
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
}

function rooms(count: number): Room[] {
  return Array.from({ length: count }, (_, index) => room(index + 1));
}

function room(number: number): Room {
  return {
    id: `room-${number}`,
    name: `Room ${String(number).padStart(2, '0')}`,
    owner: user(`owner-${number}`),
    status: 'waiting',
    visibility: 'public',
    format: 'commander',
    maxPlayers: 4,
    startingLife: 40,
    timerMode: 'none',
    timerDurationSeconds: 0,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
    players: [],
    gameId: null,
  };
}

function user(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    displayName: `Owner ${id}`,
    roles: ['ROLE_USER'],
  };
}

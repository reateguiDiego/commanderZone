import { Injectable } from '@angular/core';

export interface DemoRoom {
  id: string;
  name: string;
  link: string;
}

@Injectable({ providedIn: 'root' })
export class DemoRoomService {
  create(roomName?: string): DemoRoom {
    const id = `demo-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name: roomName?.trim() || 'Commander demo room',
      link: `/room/${id}`,
    };
  }
}

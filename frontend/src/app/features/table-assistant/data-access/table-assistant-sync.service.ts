import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { MercureService } from '../../../core/realtime/mercure.service';
import { TableAssistantApi, TableAssistantRealtimeEvent, TableAssistantRoomResource } from './table-assistant.api';

export type TableAssistantSyncStatus = 'idle' | 'connected' | 'reconnecting' | 'offline';

@Injectable()
export class TableAssistantSyncService implements OnDestroy {
  private readonly mercure = inject(MercureService);
  private readonly api = inject(TableAssistantApi);
  private subscription?: Subscription;

  readonly status = signal<TableAssistantSyncStatus>('idle');

  connect(roomId: string, applyRoom: (room: TableAssistantRoomResource) => void): void {
    this.disconnect();
    this.status.set('connected');
    this.subscription = this.mercure.tableAssistantEvents<TableAssistantRealtimeEvent>(roomId).subscribe({
      next: (event) => {
        this.status.set('connected');
        void this.refresh(roomId, applyRoom, event.version);
      },
      error: () => {
        this.status.set('reconnecting');
        void this.refresh(roomId, applyRoom);
      },
    });
  }

  disconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private async refresh(roomId: string, applyRoom: (room: TableAssistantRoomResource) => void, incomingVersion?: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.get(roomId));
      if (incomingVersion === undefined || response.tableAssistantRoom.version >= incomingVersion) {
        applyRoom(response.tableAssistantRoom);
      }
      this.status.set('connected');
    } catch {
      this.status.set('offline');
    }
  }
}

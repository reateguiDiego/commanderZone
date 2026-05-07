import { Injectable, signal } from '@angular/core';

export type PageHeaderActionVariant = 'primary' | 'secondary';

export interface PageHeaderAction {
  id: string;
  label: string;
  icon?: string;
  iconOnly?: boolean;
  tooltip?: string;
  disabled?: boolean;
  variant: PageHeaderActionVariant;
  execute: () => void;
}

export type PageHeaderStatTone = 'neutral' | 'success' | 'private' | 'started';

export interface PageHeaderStat {
  id: string;
  label: string;
  value: number | string;
  icon?: string;
  tone?: PageHeaderStatTone;
}

export interface PageHeaderTitleWarning {
  icon: string;
  label: string;
  tooltip: string;
  tone: 'danger';
}

export interface PageHeaderState {
  title: string;
  eyebrow?: string;
  titleWarning?: PageHeaderTitleWarning;
  actions?: readonly PageHeaderAction[];
  stats?: readonly PageHeaderStat[];
}

@Injectable({ providedIn: 'root' })
export class PageHeaderStore {
  readonly state = signal<PageHeaderState | null>(null);

  set(header: PageHeaderState): void {
    this.state.set(header);
  }

  clear(): void {
    this.state.set(null);
  }
}

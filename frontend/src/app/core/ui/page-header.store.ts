import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { runtimeTranslationFallback } from '../localization/runtime-translate.pipe';

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

export type PageHeaderStatTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger';

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

export interface PageHeaderActionFeedback {
  message: string;
  tone: 'success';
}

export interface PageHeaderState {
  title: string;
  eyebrow?: string;
  description?: string;
  context?: string;
  heroRule?: boolean;
  titleWarning?: PageHeaderTitleWarning;
  titleActions?: readonly PageHeaderAction[];
  actions?: readonly PageHeaderAction[];
  actionFeedback?: PageHeaderActionFeedback | null;
  stats?: readonly PageHeaderStat[];
}

@Injectable({ providedIn: 'root' })
export class PageHeaderStore {
  private readonly translate = inject(TranslateService, { optional: true });

  readonly state = signal<PageHeaderState | null>(null);

  set(header: PageHeaderState): void {
    this.state.set({
      ...header,
      title: this.translateText(header.title),
      eyebrow: header.eyebrow ? this.translateText(header.eyebrow) : undefined,
      description: header.description ? this.translateText(header.description) : undefined,
      titleWarning: header.titleWarning
        ? {
            ...header.titleWarning,
            label: this.translateText(header.titleWarning.label),
            tooltip: this.translateText(header.titleWarning.tooltip),
          }
        : undefined,
      titleActions: header.titleActions?.map((action) => ({
        ...action,
        label: this.translateText(action.label),
        tooltip: action.tooltip ? this.translateText(action.tooltip) : undefined,
      })),
      actions: header.actions?.map((action) => ({
        ...action,
        label: this.translateText(action.label),
        tooltip: action.tooltip ? this.translateText(action.tooltip) : undefined,
      })),
      actionFeedback: header.actionFeedback
        ? {
            ...header.actionFeedback,
            message: this.translateText(header.actionFeedback.message),
          }
        : header.actionFeedback,
      stats: header.stats?.map((stat) => ({
        ...stat,
        label: this.translateText(stat.label),
      })),
    });
  }

  clear(): void {
    this.state.set(null);
  }

  private translateText(value: string): string {
    const translated = this.translate?.instant(value);
    return typeof translated === 'string' && translated !== value ? translated : runtimeTranslationFallback(value);
  }
}

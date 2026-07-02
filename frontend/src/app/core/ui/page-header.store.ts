import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { runtimeTranslationFallback } from '../localization/runtime-translate.pipe';
import { UserAvatar, UserDisplayNameStyle } from '../models/user.model';

export type PageHeaderOwner = object;
export type PageHeaderActionVariant = 'primary' | 'secondary';
export type PageHeaderActionTooltipTriggerMode = 'hover' | 'click';
export type PageHeaderActionTooltipPlacement = 'top' | 'bottom';
export type PageHeaderActionTooltipAlign = 'center' | 'end';

export interface PageHeaderAction {
  id: string;
  label: string;
  isBack?: boolean;
  icon?: string;
  iconOnly?: boolean;
  tooltip?: string;
  tooltipTriggerMode?: PageHeaderActionTooltipTriggerMode;
  tooltipPlacement?: PageHeaderActionTooltipPlacement;
  tooltipAlign?: PageHeaderActionTooltipAlign;
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

export interface PageHeaderPlayerInfo {
  displayName: string;
  avatar?: UserAvatar | null;
  nameStyle?: UserDisplayNameStyle | null;
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
  sharedBy?: PageHeaderPlayerInfo | null;
  stats?: readonly PageHeaderStat[];
}

@Injectable({ providedIn: 'root' })
export class PageHeaderStore {
  private readonly translate = inject(TranslateService, { optional: true });
  private readonly destroyedOwners = new WeakSet<PageHeaderOwner>();
  private activeOwner: PageHeaderOwner | null = null;

  readonly state = signal<PageHeaderState | null>(null);

  set(header: PageHeaderState, owner?: PageHeaderOwner): void {
    if (owner && this.destroyedOwners.has(owner)) {
      return;
    }

    this.activeOwner = owner ?? null;
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
      sharedBy: header.sharedBy ? { ...header.sharedBy } : header.sharedBy,
      stats: header.stats?.map((stat) => ({
        ...stat,
        label: this.translateText(stat.label),
      })),
    });
  }

  clear(owner?: PageHeaderOwner): void {
    if (owner) {
      this.destroyedOwners.add(owner);
      if (this.activeOwner !== owner) {
        return;
      }
    }

    this.activeOwner = null;
    this.state.set(null);
  }

  private translateText(value: string): string {
    const translated = this.translate?.instant(value);
    return typeof translated === 'string' && translated !== value ? translated : runtimeTranslationFallback(value);
  }
}

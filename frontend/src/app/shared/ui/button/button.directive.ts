import { booleanAttribute, Directive, HostBinding, Input } from '@angular/core';
import { TextFitDirective } from '../text-fit/text-fit.directive';

export type CzButtonVariant = 'primary' | 'secondary' | 'ghost' | 'text' | 'icon' | 'menu';
export type CzButtonSize = 'sm' | 'md' | 'lg';
export type CzButtonTone = 'default' | 'danger' | 'success' | 'warning';

@Directive({
  selector: '[czButton]',
  standalone: true,
  hostDirectives: [TextFitDirective],
})
export class CzButtonDirective {
  @Input('czButton') variant: CzButtonVariant = 'secondary';
  @Input() czButtonSize: CzButtonSize = 'md';
  @Input() czButtonTone: CzButtonTone = 'default';
  @Input({ transform: booleanAttribute }) czButtonActive = false;

  @HostBinding('class.cz-button') readonly buttonClass = true;

  @HostBinding('class.cz-button--primary')
  get primary(): boolean {
    return this.variant === 'primary';
  }

  @HostBinding('class.cz-button--secondary')
  get secondary(): boolean {
    return this.variant === 'secondary';
  }

  @HostBinding('class.cz-button--ghost')
  get ghost(): boolean {
    return this.variant === 'ghost';
  }

  @HostBinding('class.cz-button--text')
  get text(): boolean {
    return this.variant === 'text';
  }

  @HostBinding('class.cz-button--icon')
  get icon(): boolean {
    return this.variant === 'icon';
  }

  @HostBinding('class.cz-button--menu')
  get menu(): boolean {
    return this.variant === 'menu';
  }

  @HostBinding('class.cz-button--sm')
  get small(): boolean {
    return this.czButtonSize === 'sm';
  }

  @HostBinding('class.cz-button--md')
  get medium(): boolean {
    return this.czButtonSize === 'md';
  }

  @HostBinding('class.cz-button--lg')
  get large(): boolean {
    return this.czButtonSize === 'lg';
  }

  @HostBinding('class.cz-button--tone-danger')
  get dangerTone(): boolean {
    return this.czButtonTone === 'danger';
  }

  @HostBinding('class.cz-button--tone-success')
  get successTone(): boolean {
    return this.czButtonTone === 'success';
  }

  @HostBinding('class.cz-button--tone-warning')
  get warningTone(): boolean {
    return this.czButtonTone === 'warning';
  }

  @HostBinding('class.cz-button--active')
  get active(): boolean {
    return this.czButtonActive;
  }
}

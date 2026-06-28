import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Renderer2,
  effect,
  inject,
  input,
} from '@angular/core';
import { ManaStylesService } from '../mana-styles.service';

export type ManaIconKind = 'plain' | 'cost' | 'mechanic';

@Component({
  selector: 'i[appManaIcon], span[appManaIcon]',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaIconComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly manaStyles = inject(ManaStylesService);
  private readonly appliedClasses = new Set<string>();

  readonly appManaIcon = input.required<string>();
  readonly manaIconKind = input<ManaIconKind>('plain');

  constructor() {
    this.manaStyles.load();

    effect(() => {
      this.syncClasses(this.appManaIcon(), this.manaIconKind());
    });
  }

  private syncClasses(icon: string, kind: ManaIconKind): void {
    for (const className of this.appliedClasses) {
      this.renderer.removeClass(this.element.nativeElement, className);
    }
    this.appliedClasses.clear();

    for (const className of this.iconClasses(icon, kind)) {
      this.renderer.addClass(this.element.nativeElement, className);
      this.appliedClasses.add(className);
    }
  }

  private iconClasses(icon: string, kind: ManaIconKind): readonly string[] {
    const classes = ['ms'];
    if (kind === 'cost') {
      classes.push('ms-cost');
    } else if (kind === 'mechanic') {
      classes.push('ms-mechanic');
    }

    classes.push(...icon.trim().split(/\s+/).filter(Boolean).map((className) => (
      className.startsWith('ms-') ? className : `ms-${className}`
    )));

    return classes;
  }
}

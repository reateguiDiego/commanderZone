import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Renderer2,
  effect,
  inject,
  input,
} from '@angular/core';
import { ManaStylesService } from '../../mana/mana-styles.service';

export type MTGIconKind = 'plain' | 'cost' | 'mechanic';

@Component({
  selector: 'i[appMtgIcon], span[appMtgIcon]',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MTGIconComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly manaStyles = inject(ManaStylesService);
  private readonly appliedClasses = new Set<string>();

  readonly appMtgIcon = input.required<string>();
  readonly mtgIconKind = input<MTGIconKind>('plain');

  constructor() {
    this.manaStyles.load();

    effect(() => {
      this.syncClasses(this.appMtgIcon(), this.mtgIconKind());
    });
  }

  private syncClasses(icon: string, kind: MTGIconKind): void {
    for (const className of this.appliedClasses) {
      this.renderer.removeClass(this.element.nativeElement, className);
    }
    this.appliedClasses.clear();

    for (const className of this.iconClasses(icon, kind)) {
      this.renderer.addClass(this.element.nativeElement, className);
      this.appliedClasses.add(className);
    }
  }

  private iconClasses(icon: string, kind: MTGIconKind): readonly string[] {
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

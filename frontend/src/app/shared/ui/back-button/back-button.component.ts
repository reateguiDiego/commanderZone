import { ChangeDetectionStrategy, Component, HostListener, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../button/button.directive';

type BackButtonLink = string | readonly (string | number)[] | null;

@Component({
  selector: 'app-back-button',
  imports: [RouterLink, RuntimeTranslatePipe, CzButtonDirective],
  templateUrl: './back-button.component.html',
  styleUrl: './back-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackButtonComponent {
  readonly link = input<BackButtonLink>(null);
  readonly disabled = input(false);
  readonly pressed = output<void>();
  readonly hasLink = computed(() => this.link() !== null && !this.disabled());

  @HostListener('click', ['$event'])
  handleHostClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.hasLink()) {
      return;
    }

    this.handlePress();
  }

  handlePress(): void {
    if (this.disabled()) {
      return;
    }

    this.pressed.emit();
  }
}

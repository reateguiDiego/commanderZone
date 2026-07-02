import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

@Component({
  selector: 'app-demo-room-page',
  imports: [RouterLink, CzButtonDirective, BackButtonComponent, RuntimeTranslatePipe],
  templateUrl: './demo-room-page.component.html',
  styleUrl: './demo-room-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoRoomPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly roomId = computed(() => this.route.snapshot.paramMap.get('id') ?? 'demo-room');
}

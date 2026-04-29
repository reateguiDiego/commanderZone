import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-demo-room-page',
  imports: [RouterLink],
  templateUrl: './demo-room-page.component.html',
  styleUrl: './demo-room-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoRoomPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly roomId = computed(() => this.route.snapshot.paramMap.get('id') ?? 'demo-room');
}

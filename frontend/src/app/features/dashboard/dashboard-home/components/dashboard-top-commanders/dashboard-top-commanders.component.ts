import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import type { ManaColor } from '../../../../../shared/mana/mana-symbol.service';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';

interface TopCommander {
  readonly rank: number;
  readonly name: string;
  readonly playedLabel: string;
  readonly imageUrl: string;
  readonly colors: readonly ManaColor[];
}

const TOP_COMMANDERS: readonly TopCommander[] = [
  {
    rank: 1,
    name: 'The Ur-Dragon',
    playedLabel: '47.928 played',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/1/0/10d42b35-844f-4a64-9981-c6118d45e826.jpg?1689999317',
    colors: ['W', 'U', 'B', 'R', 'G'],
  },
  {
    rank: 2,
    name: 'Edgar Markov',
    playedLabel: '47.211 played',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/a/5/a577ba08-0aa8-45be-aa83-d5078770127c.jpg?1736468492',
    colors: ['W', 'B', 'R'],
  },
  {
    rank: 3,
    name: 'Atraxa, Grand Unifier',
    playedLabel: '43.917 played',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/4/a/4a1f905f-1d55-4d02-9d24-e58070793d3f.jpg?1717951088',
    colors: ['W', 'U', 'B', 'G'],
  },
];

@Component({
  selector: 'app-dashboard-top-commanders',
  imports: [RouterLink, LucideAngularModule, RuntimeTranslatePipe, ManaSymbolsComponent],
  templateUrl: './dashboard-top-commanders.component.html',
  styleUrl: './dashboard-top-commanders.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardTopCommandersComponent {
  readonly commanders = TOP_COMMANDERS;
}

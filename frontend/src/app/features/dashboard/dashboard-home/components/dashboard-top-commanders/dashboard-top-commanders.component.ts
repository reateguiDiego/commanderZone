import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CardPreviewItem } from '../../../../../shared/components/card-preview-section/card-preview-section.models';
import { CardPreviewSectionComponent } from '../../../../../shared/components/card-preview-section/card-preview-section.component';

const TOP_COMMANDERS: readonly CardPreviewItem[] = [
  {
    id: 'the-ur-dragon',
    scryfallId: '10d42b35-844f-4a64-9981-c6118d45e826',
    rank: 1,
    name: 'The Ur-Dragon',
    label: 'community.dashboardTopCommanders.theUrDragonPlayed',
    cropImage: 'https://cards.scryfall.io/art_crop/front/1/0/10d42b35-844f-4a64-9981-c6118d45e826.jpg?1689999317',
    colors: ['W', 'U', 'B', 'R', 'G'],
  },
  {
    id: 'edgar-markov',
    scryfallId: 'a577ba08-0aa8-45be-aa83-d5078770127c',
    rank: 2,
    name: 'Edgar Markov',
    label: 'community.dashboardTopCommanders.edgarMarkovPlayed',
    cropImage: 'https://cards.scryfall.io/art_crop/front/a/5/a577ba08-0aa8-45be-aa83-d5078770127c.jpg?1736468492',
    colors: ['W', 'B', 'R'],
  },
  {
    id: 'atraxa-grand-unifier',
    scryfallId: '4a1f905f-1d55-4d02-9d24-e58070793d3f',
    rank: 3,
    name: 'Atraxa, Grand Unifier',
    label: 'community.dashboardTopCommanders.atraxaPlayed',
    cropImage: 'https://cards.scryfall.io/art_crop/front/4/a/4a1f905f-1d55-4d02-9d24-e58070793d3f.jpg?1717951088',
    colors: ['W', 'U', 'B', 'G'],
  },
];

@Component({
  selector: 'app-dashboard-top-commanders',
  imports: [RuntimeTranslatePipe, CardPreviewSectionComponent],
  templateUrl: './dashboard-top-commanders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardTopCommandersComponent {
  readonly commanders = TOP_COMMANDERS;
}

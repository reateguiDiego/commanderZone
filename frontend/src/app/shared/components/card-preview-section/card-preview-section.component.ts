import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ManaIconComponent } from '../../mana/mana-icon/mana-icon.component';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { CardPreviewItem } from './card-preview-section.models';
import { primaryCardPreviewTypeLabel, resolveCardPreviewTypeIcon } from '../../utils/card-preview-item';

@Component({
  selector: 'app-card-preview-section',
  imports: [RouterLink, LucideAngularModule, RuntimeTranslatePipe, ManaSymbolsComponent, ManaIconComponent],
  templateUrl: './card-preview-section.component.html',
  styleUrl: './card-preview-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.compact]': 'compact()',
    '[class.small-screen-text-mode]': 'smallScreenTextMode()',
    '[class.mobile-header-only]': 'mobileHeaderOnly()',
  },
})
export class CardPreviewSectionComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly viewMoreLabel = input('shared.cardPreview.viewMore');
  readonly viewMoreLink = input<string | readonly unknown[] | null>(null);
  readonly footerNote = input<string | null>(null);
  readonly items = input<readonly CardPreviewItem[]>([]);
  readonly showRank = input(false);
  readonly icon = input('trophy');
  readonly ariaLabel = input<string | null>(null);
  readonly compact = input(false);
  readonly smallScreenTextMode = input(false);
  readonly mobileHeaderOnly = input(false);
  readonly typeDisplayMode = input<'full' | 'primary'>('full');

  resolveTypeIcon(item: CardPreviewItem): string | null {
    return resolveCardPreviewTypeIcon(item);
  }

  formatTimesPlayed(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat().format(Math.trunc(value))
      : '';
  }

  displayCardType(item: CardPreviewItem): string | null {
    return this.typeDisplayMode() === 'primary'
      ? primaryCardPreviewTypeLabel(item)
      : (item.cardType?.trim() || null);
  }
}

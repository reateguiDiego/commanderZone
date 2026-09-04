import { ChangeDetectionStrategy, Component, HostListener, computed, input, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { DeckBracketEstimate, DeckBracketNumber, DeckBracketOfficialCriterion } from '../../../core/models/deck-analysis.model';
import { AppModalComponent } from '../app-modal/app-modal.component';
import { TooltipComponent } from '../tooltip/tooltip.component';

interface BracketSignalRow {
  readonly labelKey: string;
  readonly value: string;
}

interface BracketCriterionCard {
  readonly criterion: DeckBracketOfficialCriterion;
  readonly imageSrc: string;
  readonly active: boolean;
}

@Component({
  selector: 'app-bracket-pill',
  imports: [RuntimeTranslatePipe, AppModalComponent, TooltipComponent],
  templateUrl: './bracket-pill.component.html',
  styleUrl: './bracket-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BracketPillComponent {
  readonly bracket = input<DeckBracketEstimate | null | undefined>(null);
  readonly explanationOpen = signal(false);
  private readonly hiddenFrontendSignalPattern = /mana[-_\s]*efficiency|manaEfficiency/i;

  readonly bracketImageSrc = computed<string | null>(() => {
    const estimate = this.bracket();

    return estimate ? this.imageSrcForBracket(estimate.bracket) : null;
  });

  readonly officialCriterionCards = computed<readonly BracketCriterionCard[]>(() => {
    const estimate = this.bracket();
    if (!estimate) {
      return [];
    }

    return estimate.explanation.officialCriteria.map((criterion) => ({
      criterion,
      imageSrc: this.imageSrcForBracket(criterion.bracket),
      active: criterion.bracket === estimate.bracket,
    }));
  });

  readonly shortExplanation = computed<string | null>(() => {
    const short = this.bracket()?.explanation.short?.trim();
    if (!short || this.hiddenFrontendSignalPattern.test(short)) {
      return null;
    }

    return short;
  });

  readonly visibleReasons = computed<readonly string[]>(() => {
    const estimate = this.bracket();
    if (!estimate) {
      return [];
    }

    return estimate.reasons.filter((reason) => !this.hiddenFrontendSignalPattern.test(reason));
  });

  readonly officialSignalRows = computed<readonly BracketSignalRow[]>(() => {
    const estimate = this.bracket();
    if (!estimate) {
      return [];
    }

    return [
      {
        labelKey: 'bracket.signals.gameChangers',
        value: String(estimate.officialSignals.gameChangers.count),
      },
      {
        labelKey: 'bracket.signals.massLandDenial',
        value: estimate.officialSignals.massLandDenial.detected
          ? 'shared.text.yesLabel'
          : 'shared.text.noLabel',
      },
      {
        labelKey: 'bracket.signals.extraTurns',
        value: String(estimate.officialSignals.extraTurns.count),
      },
      {
        labelKey: 'bracket.signals.twoCardCombos',
        value: String(estimate.officialSignals.twoCardCombos.count),
      },
      {
        labelKey: 'shared.text.tutors',
        value: String(estimate.officialSignals.nonLandTutors.count),
      },
    ];
  });

  readonly differenceSignalRows = computed<readonly BracketSignalRow[]>(() => {
    const estimate = this.bracket();
    if (!estimate) {
      return [];
    }

    return [
      {
        labelKey: 'bracket.signals.staples',
        value: String(estimate.differences.staplesScore),
      },
      {
        labelKey: 'bracket.signals.speed',
        value: String(estimate.differences.speedScore),
      },
      {
        labelKey: 'bracket.signals.metagame',
        value: String(estimate.differences.metagameScore),
      },
    ];
  });

  openExplanation(): void {
    if (this.bracket()) {
      this.explanationOpen.set(true);
    }
  }

  closeExplanation(): void {
    this.explanationOpen.set(false);
  }

  private imageSrcForBracket(bracket: DeckBracketNumber): string {
    return `assets/icons/brackets/bracket_${bracket}.webp`;
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeExplanation();
  }
}

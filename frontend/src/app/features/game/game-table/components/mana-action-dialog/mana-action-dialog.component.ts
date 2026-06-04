import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ManaAbilityOption, ManaAddition, ManaPoolColor, ManaProductionPart, ManaSourceSuggestion } from '../../utils/mana-source-detector';
import { GameXQuantityStepperComponent } from '../game-x-quantity-stepper/game-x-quantity-stepper.component';

type ManaActionChoice = Pick<ManaSourceSuggestion, 'additions' | 'colors' | 'amount' | 'summary' | 'restriction'>;

type ManaActionSummaryPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'mana'; readonly value: string };

interface ManaAbilityOptionView {
  readonly option: ManaAbilityOption;
  readonly labelParts: readonly ManaActionSummaryPart[];
}

export interface ManaActionDialogValueChange {
  readonly color?: ManaPoolColor;
  readonly amount?: number;
}

export interface ManaActionDialogPosition {
  readonly x: number;
  readonly y: number;
}

interface ManaActionDialogViewport {
  readonly width: number;
  readonly height: number;
}

interface ManaActionPopoverLayout {
  readonly left: number;
  readonly width: number;
  readonly arrowLeft: number;
  readonly maxHeight: number;
  readonly placement: 'above' | 'below';
  readonly top: number | null;
  readonly bottom: number | null;
}

const POPOVER_MAX_WIDTH = 344;
const POPOVER_VIEWPORT_MARGIN = 12;
const POPOVER_ANCHOR_GAP = 8;
const POPOVER_COMFORTABLE_HEIGHT = 320;
const POPOVER_ARROW_MARGIN = 14;
const MANA_COLOR_ORDER: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

@Component({
  selector: 'app-mana-action-dialog',
  imports: [RuntimeTranslatePipe, NgTemplateOutlet, AppModalComponent, LucideAngularModule, ManaSymbolsComponent, GameXQuantityStepperComponent],
  templateUrl: './mana-action-dialog.component.html',
  styleUrl: './mana-action-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaActionDialogComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewportSize = signal<ManaActionDialogViewport>(this.currentViewportSize());

  readonly suggestion = input.required<ManaSourceSuggestion>();
  readonly selectedColor = input<ManaPoolColor | null>(null);
  readonly amount = input(1);
  readonly position = input<ManaActionDialogPosition | null>(null);

  readonly valueChanged = output<ManaActionDialogValueChange>();
  readonly confirmed = output<readonly ManaAddition[]>();
  readonly cancelled = output<void>();

  private readonly productionColorSelections = signal<Readonly<Record<string, ManaPoolColor>>>({});
  private readonly productionAmounts = signal<Readonly<Record<string, number>>>({});
  private readonly selectedAbilityId = signal<string | null>(null);

  readonly canAddMana = computed(() => !this.suggestion().manualOnly);
  readonly confirmLabel = computed(() => this.canAddMana() ? 'Add mana' : 'Close');
  readonly abilityOptions = computed(() => this.suggestion().abilityOptions ?? []);
  readonly abilityOptionViews = computed<readonly ManaAbilityOptionView[]>(() =>
    this.abilityOptions().map((option) => ({
      option,
      labelParts: this.renderManaTextParts(option.label),
    })),
  );
  readonly hasAbilityOptions = computed(() => this.abilityOptions().length > 0);
  readonly selectedAbility = computed(() => {
    const options = this.abilityOptions();
    return options.find((option) => option.id === this.selectedAbilityId()) ?? options[0] ?? null;
  });
  readonly selectedAbilityIdForView = computed(() => this.selectedAbility()?.id ?? null);
  readonly activeChoice = computed<ManaActionChoice>(() => this.selectedAbility() ?? this.suggestion());
  readonly activeRestriction = computed(() => this.activeChoice().restriction);
  readonly selectedColorForActiveChoice = computed(() => this.selectedColorForChoice(this.activeChoice()));
  readonly summaryParts = computed(() => this.renderSummaryParts(this.activeChoice()));
  readonly showSummary = computed(() => this.summaryParts().length > 0);
  readonly productionParts = computed(() => this.hasAbilityOptions() ? [] : this.suggestion().productionParts ?? []);
  readonly hasProductionParts = computed(() => this.productionParts().length > 0);
  readonly hasFixedAdditions = computed(() => this.activeChoice().additions.length > 0);
  readonly isSingleFixedMana = computed(() => {
    const additions = this.activeChoice().additions;

    return additions.length === 1 && additions[0]?.amount === 1;
  });
  readonly showFixedPreview = computed(() => this.hasFixedAdditions() && !this.isSingleFixedMana());
  readonly showColorSelector = computed(() => (
    this.canAddMana()
    && !this.hasProductionParts()
    && !this.hasFixedAdditions()
    && this.activeChoice().colors.length > 1
  ));
  readonly showAmountSelector = computed(() => (
    this.canAddMana()
    && !this.hasProductionParts()
    && !this.hasFixedAdditions()
    && (this.suggestion().kind === 'variable' || this.activeChoice().amount > 1)
  ));
  readonly showSelectionPanel = computed(() => (
    this.canAddMana()
    && !this.hasProductionParts()
    && (this.showFixedPreview() || this.showColorSelector() || this.showAmountSelector())
  ));
  readonly confirmationAdditions = computed(() => this.hasProductionParts() ? this.productionAdditions() : this.standardAdditions());
  readonly primaryDisabled = computed(() => this.canAddMana() && this.confirmationAdditions().length === 0);
  readonly popoverLayout = computed(() => {
    const position = this.position();

    return position ? this.resolvePopoverLayout(position, this.viewportSize()) : null;
  });

  updateAmount(amount: number): void {
    this.valueChanged.emit({ amount });
  }

  updateColor(color: ManaPoolColor): void {
    this.valueChanged.emit({ color });
  }

  selectAbility(option: ManaAbilityOption): void {
    this.selectedAbilityId.set(option.id);
    this.valueChanged.emit({
      color: this.selectedColorForChoice(option) ?? undefined,
      amount: Math.max(1, option.amount || 1),
    });
  }

  updateProductionColor(part: ManaProductionPart, color: ManaPoolColor): void {
    if (part.kind === 'fixed') {
      return;
    }

    this.productionColorSelections.update((current) => ({
      ...current,
      [part.id]: color,
    }));
  }

  updateProductionAmount(part: ManaProductionPart, amount: number): void {
    if (part.kind !== 'variable') {
      return;
    }

    this.productionAmounts.update((current) => ({
      ...current,
      [part.id]: amount,
    }));
  }

  selectedProductionColor(part: ManaProductionPart): ManaPoolColor | null {
    if (part.kind === 'fixed') {
      return null;
    }

    return this.productionColorSelections()[part.id] ?? part.colors[0] ?? null;
  }

  selectedProductionAmount(part: ManaProductionPart): number {
    if (part.kind === 'fixed') {
      return 0;
    }

    return this.productionAmounts()[part.id] ?? Math.max(1, part.amount);
  }

  confirm(): void {
    this.confirmed.emit(this.confirmationAdditions());
  }

  stopPopoverPointer(event: MouseEvent): void {
    event.stopPropagation();
  }

  @HostListener('document:mousedown', ['$event'])
  closePopoverFromOutsidePointer(event: MouseEvent): void {
    if (this.position() === null) {
      return;
    }

    const target = event.target instanceof Node ? event.target : null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.cancelled.emit();
  }

  @HostListener('window:resize')
  updateViewportSize(): void {
    this.viewportSize.set(this.currentViewportSize());
  }

  private renderSummaryParts(suggestion: ManaActionChoice): readonly ManaActionSummaryPart[] {
    const visibleSummary = this.normalizeSummary(suggestion);
    return this.renderManaTextParts(visibleSummary);
  }

  private renderManaTextParts(value: string): readonly ManaActionSummaryPart[] {
    const parts: ManaActionSummaryPart[] = [];
    if (!value.trim()) {
      return [];
    }

    const manaTokenPattern = /\{([WUBRGC])\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = manaTokenPattern.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ kind: 'text', value: value.slice(lastIndex, match.index) });
      }

      parts.push({ kind: 'mana', value: match[1] ?? '' });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
      parts.push({ kind: 'text', value: value.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ kind: 'text', value }];
  }

  private normalizeSummary(suggestion: ManaActionChoice): string {
    if (!this.hasAbilityOptions() && ((this.suggestion().productionParts?.length ?? 0) > 0)) {
      return '';
    }

    if (
      suggestion.additions.length === 0
      && suggestion.colors.length === 1
      && suggestion.colors[0]
    ) {
      return `Add {${suggestion.colors[0]}}`;
    }

    return suggestion.summary
      .replace(/^(Add (?:\{[WUBRGC]\})+)\.$/, '$1');
  }

  private standardAdditions(): readonly ManaAddition[] {
    if (this.suggestion().manualOnly) {
      return [];
    }

    const choice = this.activeChoice();
    if (choice.additions.length > 0) {
      return choice.additions;
    }

    const selectedColor = this.selectedColorForChoice(choice);
    return selectedColor
      ? [{ color: selectedColor, amount: this.amount() }]
      : [];
  }

  private selectedColorForChoice(choice: ManaActionChoice): ManaPoolColor | null {
    const selectedColor = this.selectedColor();
    if (selectedColor && choice.colors.includes(selectedColor)) {
      return selectedColor;
    }

    return choice.colors[0] ?? null;
  }

  private productionAdditions(): readonly ManaAddition[] {
    if (this.suggestion().manualOnly) {
      return [];
    }

    return mergeAdditions(this.productionParts().flatMap((part) => {
      if (part.kind === 'fixed') {
        return part.additions;
      }

      const selectedColor = this.selectedProductionColor(part);
      return selectedColor
        ? [{ color: selectedColor, amount: this.selectedProductionAmount(part) }]
        : [];
    }));
  }

  private resolvePopoverLayout(position: ManaActionDialogPosition, viewport: ManaActionDialogViewport): ManaActionPopoverLayout {
    const width = Math.min(POPOVER_MAX_WIDTH, Math.max(0, viewport.width - POPOVER_VIEWPORT_MARGIN * 2));
    const left = this.clamp(position.x - width / 2, POPOVER_VIEWPORT_MARGIN, Math.max(POPOVER_VIEWPORT_MARGIN, viewport.width - width - POPOVER_VIEWPORT_MARGIN));
    const spaceAbove = position.y - POPOVER_ANCHOR_GAP - POPOVER_VIEWPORT_MARGIN;
    const spaceBelow = viewport.height - position.y - POPOVER_ANCHOR_GAP - POPOVER_VIEWPORT_MARGIN;
    const placement = this.resolvePopoverPlacement(spaceAbove, spaceBelow);
    const maxHeight = Math.max(0, placement === 'above' ? spaceAbove : spaceBelow);
    const arrowLeft = this.clamp(position.x - left, POPOVER_ARROW_MARGIN, Math.max(POPOVER_ARROW_MARGIN, width - POPOVER_ARROW_MARGIN));

    return {
      left,
      width,
      arrowLeft,
      maxHeight,
      placement,
      top: placement === 'below' ? Math.min(viewport.height - POPOVER_VIEWPORT_MARGIN, position.y + POPOVER_ANCHOR_GAP) : null,
      bottom: placement === 'above' ? Math.min(viewport.height - POPOVER_VIEWPORT_MARGIN, viewport.height - position.y + POPOVER_ANCHOR_GAP) : null,
    };
  }

  private resolvePopoverPlacement(spaceAbove: number, spaceBelow: number): ManaActionPopoverLayout['placement'] {
    if (spaceAbove >= POPOVER_COMFORTABLE_HEIGHT) {
      return 'above';
    }

    if (spaceBelow >= POPOVER_COMFORTABLE_HEIGHT) {
      return 'below';
    }

    return spaceAbove >= spaceBelow ? 'above' : 'below';
  }

  private currentViewportSize(): ManaActionDialogViewport {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

function mergeAdditions(additions: readonly ManaAddition[]): readonly ManaAddition[] {
  const counts = new Map<ManaPoolColor, number>();
  for (const addition of additions) {
    counts.set(addition.color, Math.min(99, (counts.get(addition.color) ?? 0) + addition.amount));
  }

  return MANA_COLOR_ORDER
    .map((color) => ({ color, amount: counts.get(color) ?? 0 }))
    .filter((addition) => addition.amount > 0);
}

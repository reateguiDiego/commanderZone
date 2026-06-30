import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, input, output, signal, viewChild } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

const SLEEVE_BASE_PATH = '/assets/images/sleeves/';
const DEFAULT_SLEEVE_FILE = 'facedown_card.jpg';

type SleeveColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
type SleeveCategory = 'default' | 'mono' | 'colorless' | 'combination';

interface SleeveDefinition {
  readonly fileName: string;
  readonly colors: readonly SleeveColor[];
  readonly category: SleeveCategory;
  readonly combinationName?: string;
}

interface SleeveHoverPreview {
  readonly sleeve: SleeveOption;
  readonly left: number;
  readonly top: number;
}

interface PendingSleeveHoverPreview {
  readonly sleeve: SleeveOption;
  readonly clientX: number;
  readonly clientY: number;
}

const HOVER_PREVIEW_WIDTH_PX = 360;
const HOVER_PREVIEW_HEIGHT_PX = 502;
const HOVER_PREVIEW_DELAY_MS = 180;

const MONO_COLOR_SLEEVE_FILES: Readonly<Record<Exclude<SleeveColor, 'C'>, readonly string[]>> = {
  W: ['w_0.webp', 'w_1.webp', 'w_2.webp', 'w_3.webp', 'w_4.webp', 'w_5.webp', 'w_6.webp', 'w_7.webp', 'w_8.webp', 'w_9.webp', 'w_10.webp', 'w_11.webp'],
  U: ['u_0.webp', 'u_1.webp', 'u_2.webp', 'u_3.webp', 'u_4.webp', 'u_5.webp', 'u_6.webp', 'u_7.webp', 'u_8.webp', 'u_9.webp', 'u_10.webp', 'u_11.webp'],
  B: ['b_0.webp', 'b_1.webp', 'b_2.webp', 'b_3.webp', 'b_4.webp', 'b_5.webp', 'b_6.webp', 'b_7.webp', 'b_8.webp', 'b_9.webp', 'b_10.webp', 'b_11.webp'],
  R: ['r_0.webp', 'r_1.webp', 'r_2.webp', 'r_3.webp', 'r_4.webp', 'r_5.webp', 'r_6.webp', 'r_7.webp', 'r_8.webp', 'r_9.webp', 'r_10.webp', 'r_11.webp'],
  G: ['g_0.webp', 'g_1.webp', 'g_2.webp', 'g_3.webp', 'g_4.webp', 'g_5.webp', 'g_6.webp', 'g_7.webp', 'g_8.webp', 'g_9.webp', 'g_10.webp', 'g_11.webp'],
};

const COLORLESS_SLEEVE_FILES = [
  'n_0.webp',
  'n_1.webp',
  'n_2.webp',
  'n_3.webp',
  'n_4.webp',
  'n_5.webp',
  'n_6.webp',
  'n_7.webp',
  'n_8.webp',
  'n_9.webp',
  'n_10.webp',
  'n_11.webp',
  'n_12.webp',
  'o_0.webp',
  'o_1.webp',
  'o_2.webp',
  'o_3.webp',
  'o_4.webp',
  'o_5.webp',
  'o_6.webp',
  'o_7.webp',
  'o_8.webp',
  'o_9.webp',
  'o_10.webp',
  'o_11.webp',
  'o_12.webp',
] as const;

const COMBINATION_SLEEVE_DEFINITIONS: readonly SleeveDefinition[] = [
  combinationSleeve('azorius_1.webp', ['W', 'U'], 'Azorius'),
  combinationSleeve('dimir_1.webp', ['U', 'B'], 'Dimir'),
  combinationSleeve('rakdos_1.webp', ['B', 'R'], 'Rakdos'),
  combinationSleeve('gruul_1.webp', ['R', 'G'], 'Gruul'),
  combinationSleeve('selesnya_1.webp', ['G', 'W'], 'Selesnya'),
  combinationSleeve('orzhov_1.webp', ['W', 'B'], 'Orzhov'),
  combinationSleeve('izzet_1.webp', ['U', 'R'], 'Izzet'),
  combinationSleeve('golgari_1.webp', ['B', 'G'], 'Golgari'),
  combinationSleeve('boros_1.webp', ['R', 'W'], 'Boros'),
  combinationSleeve('simic_1.webp', ['G', 'U'], 'Simic'),
  combinationSleeve('bant_1.webp', ['G', 'W', 'U'], 'Bant'),
  combinationSleeve('esper_1.webp', ['W', 'U', 'B'], 'Esper'),
  combinationSleeve('grixis_1.webp', ['U', 'B', 'R'], 'Grixis'),
  combinationSleeve('jund_1.webp', ['B', 'R', 'G'], 'Jund'),
  combinationSleeve('naya_1.webp', ['R', 'G', 'W'], 'Naya'),
  combinationSleeve('abzan_1.webp', ['W', 'B', 'G'], 'Abzan'),
  combinationSleeve('jeskai_1.webp', ['U', 'R', 'W'], 'Jeskai'),
  combinationSleeve('sultai_1.webp', ['B', 'G', 'U'], 'Sultai'),
  combinationSleeve('mardu_1.webp', ['R', 'W', 'B'], 'Mardu'),
  combinationSleeve('temur_1.webp', ['G', 'U', 'R'], 'Temur'),
  combinationSleeve('dune_1.webp', ['W', 'B', 'R', 'G'], 'Dune'),
  combinationSleeve('glint_1.webp', ['U', 'B', 'R', 'G'], 'Glint'),
  combinationSleeve('ink_1.webp', ['W', 'U', 'R', 'G'], 'Ink'),
  combinationSleeve('witch_1.webp', ['W', 'U', 'B', 'G'], 'Witch'),
  combinationSleeve('yore_1.webp', ['W', 'U', 'B', 'R'], 'Yore'),
  combinationSleeve('yore_2.webp', ['W', 'U', 'B', 'R'], 'Yore'),
  combinationSleeve('penta_1.webp', ['W', 'U', 'B', 'R', 'G'], 'Penta'),
  combinationSleeve('penta_2.webp', ['W', 'U', 'B', 'R', 'G'], 'Penta'),
];

const SLEEVE_DEFINITIONS: readonly SleeveDefinition[] = [
  { fileName: DEFAULT_SLEEVE_FILE, colors: ['C'], category: 'default' },
  ...monoColorSleeves('W'),
  ...monoColorSleeves('U'),
  ...monoColorSleeves('B'),
  ...monoColorSleeves('R'),
  ...monoColorSleeves('G'),
  ...COLORLESS_SLEEVE_FILES.map((fileName): SleeveDefinition => ({ fileName, colors: ['C'], category: 'colorless' })),
  ...COMBINATION_SLEEVE_DEFINITIONS,
];

export interface SleeveOption {
  readonly fileName: string;
  readonly path: string;
  readonly label: string;
  readonly premium: boolean;
  readonly colors: readonly SleeveColor[];
  readonly category: SleeveCategory;
  readonly combinationName?: string;
}

export const DEFAULT_SLEEVE_PATH = `${SLEEVE_BASE_PATH}${DEFAULT_SLEEVE_FILE}`;
export const SLEEVE_OPTIONS: readonly SleeveOption[] = SLEEVE_DEFINITIONS.map((definition) => ({
  fileName: definition.fileName,
  path: `${SLEEVE_BASE_PATH}${definition.fileName}`,
  label: labelFromFileName(definition.fileName),
  premium: definition.fileName !== DEFAULT_SLEEVE_FILE,
  colors: definition.colors,
  category: definition.category,
  combinationName: definition.combinationName,
}));

@Component({
  selector: 'app-create-sleeve-spoiler',
  imports: [CzButtonDirective, PrettyScrollDirective, RuntimeTranslatePipe],
  templateUrl: './create-sleeve-spoiler.component.html',
  styleUrl: './create-sleeve-spoiler.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateSleeveSpoilerComponent implements AfterViewInit, OnDestroy {
  readonly selectedSleevePath = input.required<string>();
  readonly initialSleevePath = input.required<string>();
  readonly sleeveSelected = output<string>();
  readonly save = output<void>();
  readonly sleeveGrid = viewChild<ElementRef<HTMLElement>>('sleeveGrid');
  readonly hoverPreview = signal<SleeveHoverPreview | null>(null);
  readonly sleeves = SLEEVE_OPTIONS;
  readonly canSave = computed(() => this.selectedSleevePath() !== this.initialSleevePath());
  private hoverPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHoverPreview: PendingSleeveHoverPreview | null = null;

  ngAfterViewInit(): void {
    this.scrollSleeveGridToTop();
  }

  ngOnDestroy(): void {
    this.clearHoverPreviewTimer();
  }

  selectSleeve(path: string): void {
    this.hideHoverPreview();
    this.sleeveSelected.emit(path);
  }

  saveSelection(): void {
    if (!this.canSave()) {
      return;
    }

    this.save.emit();
  }

  showHoverPreview(event: MouseEvent, sleeve: SleeveOption): void {
    this.pendingHoverPreview = this.pendingPreviewFromEvent(event, sleeve);
    this.clearHoverPreviewTimer();
    this.hoverPreviewTimer = setTimeout(() => {
      const pending = this.pendingHoverPreview;
      this.hoverPreviewTimer = null;
      if (!pending) {
        return;
      }

      this.updateHoverPreview(pending.clientX, pending.clientY, pending.sleeve);
    }, HOVER_PREVIEW_DELAY_MS);
  }

  moveHoverPreview(event: MouseEvent, sleeve: SleeveOption): void {
    if (this.hoverPreview()) {
      this.updateHoverPreview(event.clientX, event.clientY, sleeve);
      return;
    }

    if (this.pendingHoverPreview?.sleeve.path === sleeve.path) {
      this.pendingHoverPreview = this.pendingPreviewFromEvent(event, sleeve);
    }
  }

  hideHoverPreview(): void {
    this.clearHoverPreviewTimer();
    this.pendingHoverPreview = null;
    this.hoverPreview.set(null);
  }

  @HostListener('document:pointerdown')
  hideHoverPreviewFromPointerDown(): void {
    this.hideHoverPreview();
  }

  @HostListener('window:scroll')
  @HostListener('document:scroll')
  hideHoverPreviewFromScroll(): void {
    this.hideHoverPreview();
  }

  private scrollSleeveGridToTop(): void {
    setTimeout(() => {
      const grid = this.sleeveGrid()?.nativeElement;
      if (grid) {
        grid.scrollTop = 0;
      }
    }, 0);
  }

  private updateHoverPreview(clientX: number, clientY: number, sleeve: SleeveOption): void {
    const margin = 12;
    const gap = 18;
    const preferRight = clientX + gap + HOVER_PREVIEW_WIDTH_PX <= window.innerWidth - margin;
    const left = preferRight
      ? clientX + gap
      : clientX - HOVER_PREVIEW_WIDTH_PX - gap;
    const top = clientY - (HOVER_PREVIEW_HEIGHT_PX / 2);

    this.hoverPreview.set({
      sleeve,
      left: Math.max(margin, Math.min(left, window.innerWidth - HOVER_PREVIEW_WIDTH_PX - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - HOVER_PREVIEW_HEIGHT_PX - margin)),
    });
  }

  private pendingPreviewFromEvent(event: MouseEvent, sleeve: SleeveOption): PendingSleeveHoverPreview {
    return {
      sleeve,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  private clearHoverPreviewTimer(): void {
    if (this.hoverPreviewTimer === null) {
      return;
    }

    clearTimeout(this.hoverPreviewTimer);
    this.hoverPreviewTimer = null;
  }
}

function monoColorSleeves(color: Exclude<SleeveColor, 'C'>): readonly SleeveDefinition[] {
  return MONO_COLOR_SLEEVE_FILES[color].map((fileName) => ({
    fileName,
    colors: [color],
    category: 'mono',
  }));
}

function combinationSleeve(fileName: string, colors: readonly SleeveColor[], combinationName: string): SleeveDefinition {
  return {
    fileName,
    colors,
    category: 'combination',
    combinationName,
  };
}

function labelFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

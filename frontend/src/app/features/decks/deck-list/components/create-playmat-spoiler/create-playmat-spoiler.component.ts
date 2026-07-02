import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, input, output, signal, viewChild } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { TabListComponent, type TabListItem } from '../../../../../shared/ui/tab-list/tab-list.component';

const PLAYMAT_BASE_PATH = '/assets/images/playmat/';
const DEFAULT_PLAYMAT_FILE = 'free_0.png';
type PlaymatTierTab = 'free' | 'premium';

interface PlaymatHoverPreview {
  readonly playmat: PlaymatOption;
  readonly left: number;
  readonly top: number;
}

interface PendingPlaymatHoverPreview {
  readonly playmat: PlaymatOption;
  readonly clientX: number;
  readonly clientY: number;
}

const HOVER_PREVIEW_WIDTH_PX = 520;
const HOVER_PREVIEW_HEIGHT_PX = 292;
const HOVER_PREVIEW_DELAY_MS = 180;

const PLAYMAT_FILES = [
  DEFAULT_PLAYMAT_FILE,
  'free_1.png',
  'free_2.png',
  'free_3.png',
  'free_4.png',
  'free_5.png',
  'free_w_1.png',
  'free_w_2.png',
  'free_w_3.png',
  'free_u_1.png',
  'free_u_2.png',
  'free_u_3.png',
  'free_b_1.png',
  'free_b_2.png',
  'free_b_3.png',
  'free_r_1.png',
  'free_r_2.png',
  'free_r_3.png',
  'free_g_1.png',
  'free_g_2.png',
  'free_g_3.png',
  'free_n_1.png',
  'free_n_2.png',
  'free_n_3.png',
  'w_1.png',
  'w_2.png',
  'w_3.png',
  'w_4.png',
  'w_5.png',
  'w_6.png',
  'w_7.png',
  'w_8.png',
  'w_9.png',
  'w_10.png',
  'u_1.png',
  'u_2.png',
  'u_3.png',
  'u_4.png',
  'u_5.png',
  'u_6.png',
  'u_7.png',
  'u_8.png',
  'u_9.png',
  'u_10.png',
  'b_1.png',
  'b_2.png',
  'b_3.png',
  'b_4.png',
  'b_5.png',
  'b_6.png',
  'b_7.png',
  'b_8.png',
  'b_9.png',
  'b_10.png',
  'r_1.png',
  'r_2.png',
  'r_3.png',
  'r_4.png',
  'r_5.png',
  'r_6.png',
  'r_7.png',
  'r_8.png',
  'r_9.png',
  'r_10.png',
  'g_1.png',
  'g_2.png',
  'g_3.png',
  'g_4.png',
  'g_5.png',
  'g_6.png',
  'g_7.png',
  'g_8.png',
  'g_9.png',
  'g_10.png',
  'n_1.png',
  'n_2.png',
  'n_3.png',
  'n_4.png',
  'n_5.png',
  'n_6.png',
  'n_7.png',
  'n_8.png',
  'n_9.png',
  'n_10.png',
  'n_11.png',
  'o_1.png',
  'o_2.png',
  'o_3.png',
  'o_4.png',
  'o_5.png',
  'o_6.png',
  'o_7.png',
  'o_8.png',
  'o_9.png',
  'o_10.png',
  'o_11.png',
  'azorius_1.png',
  'dimir_1.png',
  'rakdos_1.png',
  'gruul_1.png',
  'selesnya_1.png',
  'orzhov_1.png',
  'izzet_1.png',
  'golgari_1.png',
  'boros_1.png',
  'simic_1.png',
  'bant_1.png',
  'esper_1.png',
  'grixis_1.png',
  'jund_1.png',
  'naya_1.png',
  'abzan_1.png',
  'jeskai_1.png',
  'sultai_1.png',
  'mardu_1.png',
  'temur_1.png',
  'dune_1.png',
  'glint_1.png',
  'ink_1.png',
  'witch_1.png',
  'yore_1.png',
  'yore_2.png',
  'penta_1.png',
  'penta_2.png',
] as const;

const PLAYMAT_COMBINATION_LABELS: Readonly<Record<string, string>> = {
  azorius: 'Azorius',
  dimir: 'Dimir',
  rakdos: 'Rakdos',
  gruul: 'Gruul',
  selesnya: 'Selesnya',
  orzhov: 'Orzhov',
  izzet: 'Izzet',
  golgari: 'Golgari',
  boros: 'Boros',
  simic: 'Simic',
  bant: 'Bant',
  esper: 'Esper',
  grixis: 'Grixis',
  jund: 'Jund',
  naya: 'Naya',
  abzan: 'Abzan',
  jeskai: 'Jeskai',
  sultai: 'Sultai',
  mardu: 'Mardu',
  temur: 'Temur',
  penta: 'Five-color',
  dune: 'Dune',
  glint: 'Glint',
  ink: 'Ink',
  witch: 'Witch',
  yore: 'Yore',
};

export interface PlaymatOption {
  readonly fileName: string;
  readonly path: string;
  readonly label: string;
  readonly combinationLabel: string | null;
  readonly premium: boolean;
}

export const DEFAULT_PLAYMAT_PATH = `${PLAYMAT_BASE_PATH}${webpFileName(DEFAULT_PLAYMAT_FILE)}`;
export const PLAYMAT_OPTIONS: readonly PlaymatOption[] = PLAYMAT_FILES.map((fileName) => ({
  fileName,
  path: `${PLAYMAT_BASE_PATH}${webpFileName(fileName)}`,
  label: labelFromFileName(fileName),
  combinationLabel: combinationLabelFromFileName(fileName),
  premium: !isFreePlaymatFile(fileName),
}));

@Component({
  selector: 'app-create-playmat-spoiler',
  imports: [CzButtonDirective, PrettyScrollDirective, RuntimeTranslatePipe, TabListComponent],
  templateUrl: './create-playmat-spoiler.component.html',
  styleUrl: './create-playmat-spoiler.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatePlaymatSpoilerComponent implements AfterViewInit, OnDestroy {
  readonly selectedPlaymatPath = input.required<string>();
  readonly initialPlaymatPath = input.required<string>();
  readonly playmatSelected = output<string>();
  readonly save = output<void>();
  readonly playmatGrid = viewChild<ElementRef<HTMLElement>>('playmatGrid');
  readonly activeTier = signal<PlaymatTierTab>('free');
  readonly tierTabItems: readonly TabListItem[] = [
    { id: 'free', label: 'deckBuilder.deckList.cosmetics.free' },
    { id: 'premium', label: 'deckBuilder.deckList.cosmetics.premium' },
  ];
  readonly hoverPreview = signal<PlaymatHoverPreview | null>(null);
  readonly playmats = computed(() => {
    const premium = this.activeTier() === 'premium';

    return PLAYMAT_OPTIONS.filter((playmat) => playmat.premium === premium);
  });
  readonly canSave = computed(() => this.selectedPlaymatPath() !== this.initialPlaymatPath());
  private hoverPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHoverPreview: PendingPlaymatHoverPreview | null = null;

  ngAfterViewInit(): void {
    this.scrollPlaymatGridToTop();
  }

  ngOnDestroy(): void {
    this.clearHoverPreviewTimer();
  }

  selectPlaymat(path: string): void {
    this.hideHoverPreview();
    this.playmatSelected.emit(path);
  }

  switchTierFromList(tier: string): void {
    if (tier === 'free' || tier === 'premium') {
      this.activeTier.set(tier);
      this.hideHoverPreview();
      this.scrollPlaymatGridToTop();
    }
  }

  saveSelection(): void {
    if (!this.canSave()) {
      return;
    }

    this.save.emit();
  }

  showHoverPreview(event: MouseEvent, playmat: PlaymatOption): void {
    this.pendingHoverPreview = this.pendingPreviewFromEvent(event, playmat);
    this.clearHoverPreviewTimer();
    this.hoverPreviewTimer = setTimeout(() => {
      const pending = this.pendingHoverPreview;
      this.hoverPreviewTimer = null;
      if (!pending) {
        return;
      }

      this.updateHoverPreview(pending.clientX, pending.clientY, pending.playmat);
    }, HOVER_PREVIEW_DELAY_MS);
  }

  moveHoverPreview(event: MouseEvent, playmat: PlaymatOption): void {
    if (this.hoverPreview()) {
      this.updateHoverPreview(event.clientX, event.clientY, playmat);
      return;
    }

    if (this.pendingHoverPreview?.playmat.path === playmat.path) {
      this.pendingHoverPreview = this.pendingPreviewFromEvent(event, playmat);
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

  private scrollPlaymatGridToTop(): void {
    setTimeout(() => {
      const grid = this.playmatGrid()?.nativeElement;
      if (grid) {
        grid.scrollTop = 0;
      }
    }, 0);
  }

  private updateHoverPreview(clientX: number, clientY: number, playmat: PlaymatOption): void {
    const margin = 12;
    const gap = 18;
    const preferRight = clientX + gap + HOVER_PREVIEW_WIDTH_PX <= window.innerWidth - margin;
    const left = preferRight
      ? clientX + gap
      : clientX - HOVER_PREVIEW_WIDTH_PX - gap;
    const top = clientY - (HOVER_PREVIEW_HEIGHT_PX / 2);

    this.hoverPreview.set({
      playmat,
      left: Math.max(margin, Math.min(left, window.innerWidth - HOVER_PREVIEW_WIDTH_PX - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - HOVER_PREVIEW_HEIGHT_PX - margin)),
    });
  }

  private pendingPreviewFromEvent(event: MouseEvent, playmat: PlaymatOption): PendingPlaymatHoverPreview {
    return {
      playmat,
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

function labelFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isFreePlaymatFile(fileName: string): boolean {
  return fileName.startsWith('free_');
}

function webpFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '.webp');
}

function combinationLabelFromFileName(fileName: string): string | null {
  const normalizedName = fileName.replace(/\.[^.]+$/, '');
  const parts = normalizedName.split('_');
  if (parts[0] === 'free') {
    return null;
  }

  const combinationKey = parts[0];

  return PLAYMAT_COMBINATION_LABELS[combinationKey] ?? null;
}

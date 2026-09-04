import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, input, output, signal, viewChild } from '@angular/core';
import { DEFAULT_PLAYMAT_NAME, PLAYMAT_NAMES, playmatImageUrl } from '../../../../../core/assets/playmat-assets';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { TabListComponent, type TabListItem } from '../../../../../shared/ui/tab-list/tab-list.component';

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

export const DEFAULT_PLAYMAT_PATH = playmatImageUrl(DEFAULT_PLAYMAT_NAME);
export const PLAYMAT_OPTIONS: readonly PlaymatOption[] = PLAYMAT_NAMES.map((name) => ({
  fileName: `${name}.webp`,
  path: playmatImageUrl(name),
  label: labelFromFileName(name),
  combinationLabel: combinationLabelFromFileName(name),
  premium: !isFreePlaymatFile(name),
}));

export function playmatNameFromPath(path: string): string {
  return PLAYMAT_OPTIONS.find((playmat) => playmat.path === path)?.fileName.replace(/\.[^.]+$/, '') ?? DEFAULT_PLAYMAT_NAME;
}

export function playmatPathFromName(name: string | null | undefined): string {
  const normalizedName = name?.trim().replace(/\.[^.]+$/, '');

  return PLAYMAT_OPTIONS.find((playmat) => playmat.fileName.replace(/\.[^.]+$/, '') === normalizedName)?.path ?? DEFAULT_PLAYMAT_PATH;
}

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
    { id: 'free', label: 'shared.text.free' },
    { id: 'premium', label: 'shared.text.premium' },
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

function combinationLabelFromFileName(fileName: string): string | null {
  const normalizedName = fileName.replace(/\.[^.]+$/, '');
  const parts = normalizedName.split('_');
  if (parts[0] === 'free') {
    return null;
  }

  const combinationKey = parts[0];

  return PLAYMAT_COMBINATION_LABELS[combinationKey] ?? null;
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { LandingApi } from '../../../core/api/landing.api';
import { AppBackgroundService } from '../../../core/ui/app-background.service';
import { DemoRoom, DemoRoomService } from '../services/demo-room.service';
import { OnboardingStep } from '../models/onboarding-step.model';

@Component({
  selector: 'app-onboarding-page',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  templateUrl: './onboarding-page.component.html',
  styleUrl: './onboarding-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingPageComponent {
  private readonly demoRoomService = inject(DemoRoomService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly landingApi = inject(LandingApi);
  private readonly appBackground = inject(AppBackgroundService);

  readonly decklist = signal('');
  readonly roomName = signal('');
  readonly room = signal<DemoRoom | null>(null);
  readonly previewCardName = signal('Sol Ring');
  readonly previewDisplayName = signal('Guest player');
  readonly importError = signal<string | null>(null);
  readonly copied = signal(false);
  readonly importedCardCount = computed(() => this.decklist()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length);
  readonly deckImported = computed(() => this.importedCardCount() > 0 && this.importError() === null);
  readonly steps = computed<OnboardingStep[]>(() => {
    const imported = this.deckImported();
    const room = this.room();
    const linkCopied = this.copied();

    return [
      step('import', 1, 'Import decklist', 'Paste your list and import it.', imported ? 'complete' : 'active'),
      step('room', 2, 'Create room', 'Generate a room for the table.', room ? 'complete' : imported ? 'active' : 'upcoming'),
      step('share', 3, 'Share link', 'Copy the room link and send it.', linkCopied ? 'complete' : room ? 'active' : 'upcoming'),
      step('play', 4, 'Play', 'Open the room and start the game.', room ? 'active' : 'upcoming'),
    ];
  });

  constructor() {
    this.appBackground.setDashboardMode(false);
    this.title.setTitle('CommanderZone');
    this.meta.updateTag({
      name: 'description',
      content: 'Import your deck, create a room, share the link and start playing. No downloads required.',
    });
    void this.loadLandingPreview();
  }

  scrollToFlow(): void {
    document.getElementById('onboarding-flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  importDeck(): void {
    if (!this.decklist().trim()) {
      this.importError.set('Paste a decklist before importing.');
      return;
    }

    this.importError.set(null);
  }

  createRoom(): void {
    if (!this.deckImported()) {
      this.importError.set('Import a decklist first.');
      return;
    }

    this.room.set(this.demoRoomService.create(this.roomName()));
    this.copied.set(false);
  }

  async copyLink(): Promise<void> {
    const room = this.room();
    if (!room) {
      return;
    }

    await navigator.clipboard?.writeText(`${window.location.origin}${room.link}`);
    this.copied.set(true);
  }

  async enterRoom(): Promise<void> {
    const room = this.room();
    if (!room) {
      return;
    }

    await this.router.navigate(['/room', room.id]);
  }

  private async loadLandingPreview(): Promise<void> {
    try {
      const preview = await firstValueFrom(this.landingApi.preview());
      this.previewCardName.set(preview.cardName);
      this.previewDisplayName.set(preview.displayName);
    } catch {
      this.previewCardName.set('Sol Ring');
      this.previewDisplayName.set('Guest player');
    }
  }
}

function step(
  id: OnboardingStep['id'],
  number: number,
  title: string,
  description: string,
  state: OnboardingStep['state'],
): OnboardingStep {
  return { id, number, title, description, state };
}

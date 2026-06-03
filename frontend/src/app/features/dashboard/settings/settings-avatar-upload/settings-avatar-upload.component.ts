import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { AvatarUpdatePayload } from '../../../../core/api/auth.api';
import { appImageUrl } from '../../../../core/assets/app-image-url';
import { UserAvatar } from '../../../../core/models/user.model';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const AVATAR_SIZE = 512;

@Component({
  selector: 'app-settings-avatar-upload',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './settings-avatar-upload.component.html',
  styleUrl: './settings-avatar-upload.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsAvatarUploadComponent {
  readonly displayName = input('');
  readonly avatar = input<UserAvatar | undefined>(undefined);
  readonly saving = input(false);

  readonly cancelRequested = output<void>();
  readonly saveRequested = output<AvatarUpdatePayload>();

  readonly uploadedImageUrl = signal<string | null>(null);
  readonly cropX = signal(50);
  readonly cropY = signal(50);
  readonly zoom = signal(1.15);
  readonly errorMessage = signal<string | null>(null);

  readonly initial = computed(() => this.displayName().trim().slice(0, 1).toUpperCase() || 'P');
  readonly previewImageUrl = computed(() => this.uploadedImageUrl() ?? appImageUrl(this.avatar()?.imageUrl ?? null));
  readonly previewImageSize = computed(() => `${this.zoom() * 100}%`);
  readonly previewImageOffsetX = computed(() => `${(100 - this.zoom() * 100) * (this.cropX() / 100)}%`);
  readonly previewImageOffsetY = computed(() => `${(100 - this.zoom() * 100) * (this.cropY() / 100)}%`);
  readonly canSave = computed(() => !this.saving() && this.uploadedImageUrl() !== null);

  openFilePicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  onFileSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0];
    inputElement.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage.set('El archivo debe ser una imagen.');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      this.errorMessage.set('La imagen no puede superar 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!imageUrl) {
        this.errorMessage.set('No se pudo leer la imagen.');
        return;
      }

      this.errorMessage.set(null);
      this.uploadedImageUrl.set(imageUrl);
    };
    reader.onerror = () => this.errorMessage.set('No se pudo leer la imagen.');
    reader.readAsDataURL(file);
  }

  setCropX(event: Event): void {
    this.cropX.set(valueFromRange(event));
  }

  setCropY(event: Event): void {
    this.cropY.set(valueFromRange(event));
  }

  setZoom(event: Event): void {
    this.zoom.set(valueFromRange(event) / 100);
  }

  async save(): Promise<void> {
    const imageUrl = this.uploadedImageUrl();
    if (!imageUrl) {
      this.errorMessage.set('Selecciona una imagen antes de guardar.');
      return;
    }

    try {
      this.errorMessage.set(null);
      this.saveRequested.emit({ type: 'upload', imageData: await this.renderCroppedAvatar(imageUrl) });
    } catch {
      this.errorMessage.set('No se pudo preparar el avatar.');
    }
  }

  private async renderCroppedAvatar(imageUrl: string): Promise<string> {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas is not available.');
    }

    const scale = Math.max(AVATAR_SIZE / image.width, AVATAR_SIZE / image.height) * this.zoom();
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = (AVATAR_SIZE - drawWidth) * (this.cropX() / 100);
    const drawY = (AVATAR_SIZE - drawHeight) * (this.cropY() / 100);

    context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    return canvas.toDataURL('image/png');
  }
}

function valueFromRange(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = imageUrl;
  });
}

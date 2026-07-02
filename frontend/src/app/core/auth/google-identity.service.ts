import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { GOOGLE_CLIENT_ID } from './google-client-id.token';

interface GoogleCredentialResponse {
  readonly credential?: string;
}

interface GoogleInitializeOptions {
  readonly client_id: string;
  readonly callback: (response: GoogleCredentialResponse) => void;
}

interface GoogleButtonOptions {
  readonly theme: 'outline';
  readonly size: 'large';
  readonly type: 'standard' | 'icon';
  readonly shape: 'rectangular' | 'circle';
  readonly width?: number;
}

interface GoogleIdentityApi {
  initialize(options: GoogleInitializeOptions): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

interface GoogleIdentityNamespace {
  readonly accounts?: {
    readonly id?: GoogleIdentityApi;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityNamespace;
  }
}

@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly clientId = inject(GOOGLE_CLIENT_ID);
  private scriptLoad: Promise<void> | null = null;

  constructor(@Inject(DOCUMENT) private readonly document: Document) {
  }

  isConfigured(): boolean {
    return this.clientId.trim() !== '';
  }

  async renderButton(host: HTMLElement, credentialReceived: (credential: string) => void): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.isConfigured()) {
      return;
    }

    const googleIdentity = await this.initialize(credentialReceived);
    const hostWidth = Math.round(host.getBoundingClientRect().width);

    googleIdentity.renderButton(host, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      shape: 'rectangular',
      width: hostWidth > 0 ? hostWidth : 320,
    });
  }

  private async initialize(credentialReceived: (credential: string) => void): Promise<GoogleIdentityApi> {
    await this.loadScript();
    const googleIdentity = window.google?.accounts?.id;
    if (!googleIdentity) {
      throw new Error('Google Identity Services did not initialize.');
    }

    googleIdentity.initialize({
      client_id: this.clientId.trim(),
      callback: (response) => {
        const credential = response.credential?.trim();
        if (credential) {
          credentialReceived(credential);
        }
      },
    });

    return googleIdentity;
  }

  private loadScript(): Promise<void> {
    if (this.scriptLoad) {
      return this.scriptLoad;
    }

    this.scriptLoad = new Promise((resolve, reject) => {
      const existingScript = this.document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript?.dataset['loaded'] === 'true' || window.google?.accounts?.id) {
        resolve();
        return;
      }

      const script = existingScript ?? this.document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        script.dataset['loaded'] = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('Could not load Google Identity Services.'));

      if (!existingScript) {
        this.document.head.appendChild(script);
      }
    });

    return this.scriptLoad;
  }
}

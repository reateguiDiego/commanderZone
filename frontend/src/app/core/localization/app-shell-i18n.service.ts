import { Injectable, computed, inject } from '@angular/core';
import { normalizeLanguageCode, SupportedLanguageCode } from './language-preferences';
import { LanguagePreferencesService } from './language-preferences.service';

type AppShellLocale = 'en' | 'es';

type AppShellTextKey =
  | 'menu'
  | 'headerMenu'
  | 'userMenu'
  | 'settings'
  | 'fullscreen'
  | 'language'
  | 'languageOptions'
  | 'publicFaq'
  | 'logOff'
  | 'flagAltPrefix'
  | 'settingsTitle'
  | 'cancel'
  | 'save'
  | 'backToSettings'
  | 'predefinedAvatars'
  | 'uploadImage'
  | 'generalTab'
  | 'gameTab'
  | 'settingsSections'
  | 'cardLanguage'
  | 'appLanguage'
  | 'cardLanguageFallbackDisclaimer'
  | 'visualTheme'
  | 'visualThemeHelp';

const APP_SHELL_TEXTS: Record<AppShellLocale, Record<AppShellTextKey, string>> = {
  en: {
    menu: 'Menu',
    headerMenu: 'Header menu',
    userMenu: 'User menu',
    settings: 'Settings',
    fullscreen: 'Fullscreen',
    language: 'Language',
    languageOptions: 'Language options',
    publicFaq: 'FAQ',
    logOff: 'Log off',
    flagAltPrefix: 'Flag of ',
    settingsTitle: 'Settings',
    cancel: 'Cancel',
    save: 'Save',
    backToSettings: 'Back to settings',
    predefinedAvatars: 'Predefined avatars',
    uploadImage: 'Upload image',
    generalTab: 'General',
    gameTab: 'Game',
    settingsSections: 'Settings sections',
    cardLanguage: 'Card language',
    appLanguage: 'App language',
    cardLanguageFallbackDisclaimer: '{percentage}% of cards are available in {language}. Cards we cannot serve in that language will be shown in English.',
    visualTheme: 'Visual theme',
    visualThemeHelp: 'Stored locally in this browser.',
  },
  es: {
    menu: 'Menu',
    headerMenu: 'Menu superior',
    userMenu: 'Menu de usuario',
    settings: 'Configuracion',
    fullscreen: 'Pantalla completa',
    language: 'Idioma',
    languageOptions: 'Opciones de idioma',
    publicFaq: 'FAQ',
    logOff: 'Cerrar sesion',
    flagAltPrefix: 'Bandera de ',
    settingsTitle: 'Configuracion',
    cancel: 'Cancelar',
    save: 'Guardar',
    backToSettings: 'Volver a configuracion',
    predefinedAvatars: 'Avatares predefinidos',
    uploadImage: 'Subir imagen',
    generalTab: 'General',
    gameTab: 'Juego',
    settingsSections: 'Secciones de configuracion',
    cardLanguage: 'Idioma de cartas',
    appLanguage: 'Idioma de la app',
    cardLanguageFallbackDisclaimer: 'El {percentage}% de las cartas esta disponible en {language}. Las cartas que no podamos servir en ese idioma se mostraran en ingles.',
    visualTheme: 'Tema visual',
    visualThemeHelp: 'Se guarda localmente en este navegador.',
  },
};

const LANGUAGE_NAMES_BY_LOCALE: Record<AppShellLocale, Record<string, string>> = {
  en: {
    en: 'English',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    es: 'Spanish',
    ja: 'Japanese',
    zhs: 'Chinese (Simplified)',
    pt: 'Portuguese',
    ru: 'Russian',
    ko: 'Korean',
    zht: 'Chinese (Traditional)',
    nl: 'Dutch',
    ca: 'Catalan',
  },
  es: {
    en: 'Ingles',
    fr: 'Frances',
    de: 'Aleman',
    it: 'Italiano',
    es: 'Espanol',
    ja: 'Japones',
    zhs: 'Chino (S)',
    pt: 'Portugues',
    ru: 'Ruso',
    ko: 'Coreano',
    zht: 'Chino (T)',
    nl: 'Holandes',
    ca: 'Catalan',
  },
};

@Injectable({ providedIn: 'root' })
export class AppShellI18nService {
  private readonly languagePreferences = inject(LanguagePreferencesService);

  readonly appLanguage = this.languagePreferences.appLanguage;
  readonly locale = computed<AppShellLocale>(() => this.resolveLocale(this.appLanguage()));

  text(key: AppShellTextKey): string {
    return APP_SHELL_TEXTS[this.locale()][key];
  }

  languageName(code: string): string {
    return LANGUAGE_NAMES_BY_LOCALE[this.locale()][code] ?? code;
  }

  cardLanguageFallbackDisclaimer(percentage: number, languageName: string): string {
    return this.text('cardLanguageFallbackDisclaimer')
      .replace('{percentage}', this.formatPercentage(percentage))
      .replace('{language}', languageName);
  }

  private resolveLocale(language: SupportedLanguageCode): AppShellLocale {
    return normalizeLanguageCode(language) === 'es' ? 'es' : 'en';
  }

  private formatPercentage(value: number): string {
    return new Intl.NumberFormat(this.locale(), {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  }
}

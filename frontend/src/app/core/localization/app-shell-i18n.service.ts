import { Injectable, computed, inject } from '@angular/core';
import { normalizeLanguageCode, SupportedLanguageCode } from './language-preferences';
import { LanguagePreferencesService } from './language-preferences.service';

type AppShellTextKey =
  | 'menu'
  | 'headerMenu'
  | 'userMenu'
  | 'settings'
  | 'admin'
  | 'fullscreen'
  | 'language'
  | 'languageOptions'
  | 'publicFaq'
  | 'logOff'
  | 'flagAltPrefix'
  | 'settingsTitle'
  | 'cancel'
  | 'save'
  | 'predefinedAvatars'
  | 'uploadImage'
  | 'generalTab'
  | 'gameTab'
  | 'settingsSections'
  | 'cardLanguage'
  | 'appLanguage'
  | 'cardLanguageFallbackDisclaimer'
  | 'visualTheme'
  | 'settingsSaveDisclaimer'
  | 'premiumComingSoon';

const APP_SHELL_TEXTS = {
  en: {
    menu: 'Menu',
    headerMenu: 'Header menu',
    userMenu: 'User menu',
    settings: 'Settings',
    admin: 'Admin',
    fullscreen: 'Fullscreen',
    language: 'Language',
    languageOptions: 'Language options',
    publicFaq: 'FAQ',
    logOff: 'Log off',
    flagAltPrefix: 'Flag of ',
    settingsTitle: 'Settings',
    cancel: 'Cancel',
    save: 'Save',
    predefinedAvatars: 'Predefined avatars',
    uploadImage: 'Upload image',
    generalTab: 'General',
    gameTab: 'Game',
    settingsSections: 'Settings sections',
    cardLanguage: 'Card language',
    appLanguage: 'App language',
    cardLanguageFallbackDisclaimer: '{percentage}% of cards are available in {language}. Cards we cannot serve in that language will be shown in English.',
    visualTheme: 'Visual theme',
    settingsSaveDisclaimer: 'You have unsaved changes. Save to keep them.',
    premiumComingSoon: 'Premium is coming soon.',
  },
  es: {
    menu: 'Menú',
    headerMenu: 'Menú superior',
    userMenu: 'Menú de usuario',
    settings: 'Configuración',
    admin: 'Admin',
    fullscreen: 'Pantalla completa',
    language: 'Idioma',
    languageOptions: 'Opciones de idioma',
    publicFaq: 'FAQ',
    logOff: 'Cerrar sesión',
    flagAltPrefix: 'Bandera de ',
    settingsTitle: 'Configuración',
    cancel: 'Cancelar',
    save: 'Guardar',
    predefinedAvatars: 'Avatares predefinidos',
    uploadImage: 'Subir imagen',
    generalTab: 'General',
    gameTab: 'Juego',
    settingsSections: 'Secciones de configuración',
    cardLanguage: 'Idioma de cartas',
    appLanguage: 'Idioma de la app',
    cardLanguageFallbackDisclaimer: 'El {percentage}% de las cartas está disponible en {language}. Las cartas que no podamos servir en ese idioma se mostrarán en inglés.',
    visualTheme: 'Tema visual',
    settingsSaveDisclaimer: 'Tienes cambios sin guardar. Guarda para conservarlos.',
    premiumComingSoon: 'Premium llegará pronto.',
  },
  de: {
    menu: 'Menü',
    headerMenu: 'Kopfzeilenmenü',
    userMenu: 'Benutzermenü',
    settings: 'Einstellungen',
    admin: 'Admin',
    fullscreen: 'Vollbild',
    language: 'Sprache',
    languageOptions: 'Sprachoptionen',
    publicFaq: 'FAQ',
    logOff: 'Abmelden',
    flagAltPrefix: 'Flagge von ',
    settingsTitle: 'Einstellungen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    predefinedAvatars: 'Vordefinierte Avatare',
    uploadImage: 'Bild hochladen',
    generalTab: 'Allgemein',
    gameTab: 'Spiel',
    settingsSections: 'Einstellungsbereiche',
    cardLanguage: 'Kartensprache',
    appLanguage: 'App-Sprache',
    cardLanguageFallbackDisclaimer: '{percentage}% der Karten sind auf {language} verfügbar. Karten, die wir nicht in dieser Sprache bereitstellen können, werden auf Englisch angezeigt.',
    visualTheme: 'Visuelles Design',
    settingsSaveDisclaimer: 'Du hast ungespeicherte Änderungen. Speichere, um sie zu behalten.',
    premiumComingSoon: 'Premium kommt bald.',
  },
  fr: {
    menu: 'Menu',
    headerMenu: 'Menu d’en-tête',
    userMenu: 'Menu utilisateur',
    settings: 'Paramètres',
    admin: 'Admin',
    fullscreen: 'Plein écran',
    language: 'Langue',
    languageOptions: 'Options de langue',
    publicFaq: 'FAQ',
    logOff: 'Se déconnecter',
    flagAltPrefix: 'Drapeau de ',
    settingsTitle: 'Paramètres',
    cancel: 'Annuler',
    save: 'Enregistrer',
    predefinedAvatars: 'Avatars prédéfinis',
    uploadImage: 'Importer une image',
    generalTab: 'Général',
    gameTab: 'Jeu',
    settingsSections: 'Sections des paramètres',
    cardLanguage: 'Langue des cartes',
    appLanguage: 'Langue de l’app',
    cardLanguageFallbackDisclaimer: '{percentage}% des cartes sont disponibles en {language}. Les cartes que nous ne pouvons pas fournir dans cette langue seront affichées en anglais.',
    visualTheme: 'Thème visuel',
    settingsSaveDisclaimer: 'Vous avez des modifications non enregistrées. Enregistrez pour les conserver.',
    premiumComingSoon: 'Premium arrive bientôt.',
  },
  it: {
    menu: 'Menu',
    headerMenu: 'Menu intestazione',
    userMenu: 'Menu utente',
    settings: 'Impostazioni',
    admin: 'Admin',
    fullscreen: 'Schermo intero',
    language: 'Lingua',
    languageOptions: 'Opzioni lingua',
    publicFaq: 'FAQ',
    logOff: 'Disconnetti',
    flagAltPrefix: 'Bandiera di ',
    settingsTitle: 'Impostazioni',
    cancel: 'Annulla',
    save: 'Salva',
    predefinedAvatars: 'Avatar predefiniti',
    uploadImage: 'Carica immagine',
    generalTab: 'Generale',
    gameTab: 'Gioco',
    settingsSections: 'Sezioni impostazioni',
    cardLanguage: 'Lingua delle carte',
    appLanguage: 'Lingua dell’app',
    cardLanguageFallbackDisclaimer: 'Il {percentage}% delle carte è disponibile in {language}. Le carte che non possiamo fornire in quella lingua verranno mostrate in inglese.',
    visualTheme: 'Tema visivo',
    settingsSaveDisclaimer: 'Hai modifiche non salvate. Salva per conservarle.',
    premiumComingSoon: 'Premium arriverà presto.',
  },
  pt: {
    menu: 'Menu',
    headerMenu: 'Menu do cabeçalho',
    userMenu: 'Menu do usuário',
    settings: 'Configurações',
    admin: 'Admin',
    fullscreen: 'Tela cheia',
    language: 'Idioma',
    languageOptions: 'Opções de idioma',
    publicFaq: 'FAQ',
    logOff: 'Sair',
    flagAltPrefix: 'Bandeira de ',
    settingsTitle: 'Configurações',
    cancel: 'Cancelar',
    save: 'Salvar',
    predefinedAvatars: 'Avatares predefinidos',
    uploadImage: 'Enviar imagem',
    generalTab: 'Geral',
    gameTab: 'Jogo',
    settingsSections: 'Seções de configuração',
    cardLanguage: 'Idioma das cartas',
    appLanguage: 'Idioma do app',
    cardLanguageFallbackDisclaimer: '{percentage}% das cartas estão disponíveis em {language}. As cartas que não pudermos servir nesse idioma serão exibidas em inglês.',
    visualTheme: 'Tema visual',
    settingsSaveDisclaimer: 'Você tem alterações não salvas. Salve para mantê-las.',
    premiumComingSoon: 'Premium chegará em breve.',
  },
  ja: {
    menu: 'メニュー',
    headerMenu: 'ヘッダーメニュー',
    userMenu: 'ユーザーメニュー',
    settings: '設定',
    admin: 'Admin',
    fullscreen: '全画面',
    language: '言語',
    languageOptions: '言語オプション',
    publicFaq: 'FAQ',
    logOff: 'ログアウト',
    flagAltPrefix: '旗: ',
    settingsTitle: '設定',
    cancel: 'キャンセル',
    save: '保存',
    predefinedAvatars: '既定のアバター',
    uploadImage: '画像をアップロード',
    generalTab: '一般',
    gameTab: 'ゲーム',
    settingsSections: '設定セクション',
    cardLanguage: 'カードの言語',
    appLanguage: 'アプリの言語',
    cardLanguageFallbackDisclaimer: '{language}で利用できるカードは{percentage}%です。その言語で表示できないカードは英語で表示されます。',
    visualTheme: 'ビジュアルテーマ',
    settingsSaveDisclaimer: '未保存の変更があります。保存すると変更が保持されます。',
    premiumComingSoon: 'Premium は近日公開です。',
  },
  zhs: {
    menu: '菜单',
    headerMenu: '页眉菜单',
    userMenu: '用户菜单',
    settings: '设置',
    admin: 'Admin',
    fullscreen: '全屏',
    language: '语言',
    languageOptions: '语言选项',
    publicFaq: 'FAQ',
    logOff: '退出登录',
    flagAltPrefix: '旗帜：',
    settingsTitle: '设置',
    cancel: '取消',
    save: '保存',
    predefinedAvatars: '预设头像',
    uploadImage: '上传图片',
    generalTab: '通用',
    gameTab: '游戏',
    settingsSections: '设置分区',
    cardLanguage: '卡牌语言',
    appLanguage: '应用语言',
    cardLanguageFallbackDisclaimer: '{percentage}% 的卡牌可使用{language}显示。无法以该语言提供的卡牌将以英语显示。',
    visualTheme: '视觉主题',
    settingsSaveDisclaimer: '你有未保存的更改。保存后才能保留。',
    premiumComingSoon: 'Premium 即将推出。',
  },
  nl: {
    menu: 'Menu',
    headerMenu: 'Headermenu',
    userMenu: 'Gebruikersmenu',
    settings: 'Instellingen',
    admin: 'Admin',
    fullscreen: 'Volledig scherm',
    language: 'Taal',
    languageOptions: 'Taalopties',
    publicFaq: 'FAQ',
    logOff: 'Uitloggen',
    flagAltPrefix: 'Vlag van ',
    settingsTitle: 'Instellingen',
    cancel: 'Annuleren',
    save: 'Opslaan',
    predefinedAvatars: 'Vooraf ingestelde avatars',
    uploadImage: 'Afbeelding uploaden',
    generalTab: 'Algemeen',
    gameTab: 'Spel',
    settingsSections: 'Instellingensecties',
    cardLanguage: 'Kaarttaal',
    appLanguage: 'App-taal',
    cardLanguageFallbackDisclaimer: '{percentage}% van de kaarten is beschikbaar in {language}. Kaarten die we niet in die taal kunnen leveren, worden in het Engels getoond.',
    visualTheme: 'Visueel thema',
    settingsSaveDisclaimer: 'Je hebt niet-opgeslagen wijzigingen. Sla op om ze te bewaren.',
    premiumComingSoon: 'Premium komt binnenkort.',
  },
  ca: {
    menu: 'Menú',
    headerMenu: 'Menú superior',
    userMenu: 'Menú d’usuari',
    settings: 'Configuració',
    admin: 'Admin',
    fullscreen: 'Pantalla completa',
    language: 'Idioma',
    languageOptions: 'Opcions d’idioma',
    publicFaq: 'PMF',
    logOff: 'Tanca la sessió',
    flagAltPrefix: 'Bandera de ',
    settingsTitle: 'Configuració',
    cancel: 'Cancel·la',
    save: 'Desa',
    predefinedAvatars: 'Avatars predefinits',
    uploadImage: 'Puja una imatge',
    generalTab: 'General',
    gameTab: 'Joc',
    settingsSections: 'Seccions de configuració',
    cardLanguage: 'Idioma de les cartes',
    appLanguage: 'Idioma de l’app',
    cardLanguageFallbackDisclaimer: 'El {percentage}% de les cartes està disponible en {language}. Les cartes que no puguem servir en aquest idioma es mostraran en anglès.',
    visualTheme: 'Tema visual',
    settingsSaveDisclaimer: 'Tens canvis sense desar. Desa per conservar-los.',
    premiumComingSoon: 'Premium arribarà aviat.',
  },
  ru: {
    menu: 'Меню',
    headerMenu: 'Меню заголовка',
    userMenu: 'Меню пользователя',
    settings: 'Настройки',
    admin: 'Admin',
    fullscreen: 'Полный экран',
    language: 'Язык',
    languageOptions: 'Настройки языка',
    publicFaq: 'FAQ',
    logOff: 'Выйти',
    flagAltPrefix: 'Флаг: ',
    settingsTitle: 'Настройки',
    cancel: 'Отмена',
    save: 'Сохранить',
    predefinedAvatars: 'Готовые аватары',
    uploadImage: 'Загрузить изображение',
    generalTab: 'Общие',
    gameTab: 'Игра',
    settingsSections: 'Разделы настроек',
    cardLanguage: 'Язык карт',
    appLanguage: 'Язык приложения',
    cardLanguageFallbackDisclaimer: '{percentage}% карт доступно на языке {language}. Карты, которые мы не можем показать на этом языке, будут отображаться на английском.',
    visualTheme: 'Визуальная тема',
    settingsSaveDisclaimer: 'У вас есть несохраненные изменения. Сохраните их, чтобы не потерять.',
    premiumComingSoon: 'Premium скоро появится.',
  },
} as const satisfies Record<SupportedLanguageCode, Record<AppShellTextKey, string>>;

const DISPLAY_LANGUAGE_CODE: Record<string, string> = {
  zhs: 'zh-Hans',
  zht: 'zh-Hant',
};

const INTL_LOCALE_BY_LANGUAGE: Record<SupportedLanguageCode, string> = {
  en: 'en',
  es: 'es',
  de: 'de',
  fr: 'fr',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  zhs: 'zh-Hans',
  nl: 'nl',
  ca: 'ca',
  ru: 'ru',
};

@Injectable({ providedIn: 'root' })
export class AppShellI18nService {
  private readonly languagePreferences = inject(LanguagePreferencesService);

  readonly appLanguage = this.languagePreferences.appLanguage;
  readonly locale = computed<SupportedLanguageCode>(() => this.resolveLocale(this.appLanguage()));
  private readonly intlLocale = computed(() => INTL_LOCALE_BY_LANGUAGE[this.locale()]);

  text(key: AppShellTextKey): string {
    return APP_SHELL_TEXTS[this.locale()][key];
  }

  languageName(code: string): string {
    const displayCode = DISPLAY_LANGUAGE_CODE[code] ?? code;

    try {
      const name = new Intl.DisplayNames([this.intlLocale()], { type: 'language' }).of(displayCode);
      return name ? this.capitalizeLabel(name) : code;
    } catch {
      return code;
    }
  }

  cardLanguageFallbackDisclaimer(percentage: number, languageName: string): string {
    return this.text('cardLanguageFallbackDisclaimer')
      .replace('{percentage}', this.formatPercentage(percentage))
      .replace('{language}', languageName);
  }

  private resolveLocale(language: SupportedLanguageCode): SupportedLanguageCode {
    return normalizeLanguageCode(language);
  }

  private formatPercentage(value: number): string {
    return new Intl.NumberFormat(this.intlLocale(), {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  }

  private capitalizeLabel(value: string): string {
    return value.charAt(0).toLocaleUpperCase(this.intlLocale()) + value.slice(1);
  }
}

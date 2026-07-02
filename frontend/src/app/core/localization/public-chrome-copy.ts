import { SeoLocaleCode } from './locale-config';
import { getSeoPath } from './seo-routes';
import { getLegalLinks } from '../legal/legal-routes';

export interface PublicChromeLink {
  readonly label: string;
  readonly href: string;
  readonly ariaLabel?: string;
}

export interface PublicChromeCopy {
  readonly languageSelector: {
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly navigation: {
    readonly ariaLabel: string;
    readonly playOnline: string;
    readonly faq: string;
  };
  readonly authActions: {
    readonly ariaLabel: string;
    readonly login: string;
    readonly register: string;
  };
  readonly cookieBanner: {
    readonly title: string;
    readonly copyStart: string;
    readonly privacyPolicyLabel: string;
    readonly privacyJoin: string;
    readonly cookiePolicyLabel: string;
    readonly cookiesJoin: string;
    readonly reject: string;
    readonly accept: string;
    readonly managePreferences: string;
    readonly essentialCookies: string;
    readonly essentialDescription: string;
    readonly preferencesCookies: string;
    readonly preferencesDescription: string;
    readonly adsCookies: string;
    readonly adsDescription: string;
  };
  readonly disclaimer: {
    readonly heading: string;
    readonly text: string;
    readonly copyright: string;
  };
  readonly footer: {
    readonly ariaLabel: string;
    readonly links: readonly PublicChromeLink[];
  };
}

const CURRENT_YEAR = new Date().getFullYear();

const PUBLIC_CHROME_COPY = {
  en: {
    languageSelector: {
      label: 'Language',
      ariaLabel: 'Select language',
    },
    navigation: {
      ariaLabel: 'Public navigation',
      playOnline: 'Play online',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Account actions',
      login: 'Login',
      register: 'Register',
    },
    cookieBanner: {
      title: 'Cookie preferences',
      copyStart: 'CommanderZone uses essential cookies and functional preferences. Read the',
      privacyPolicyLabel: 'privacy policy',
      privacyJoin: 'and',
      cookiePolicyLabel: 'cookie policy',
      cookiesJoin: '',
      reject: 'Reject',
      accept: 'Accept',
      managePreferences: 'Cookie preferences',
      essentialCookies: 'Essential cookies',
      essentialDescription: 'Required for login, security, consent storage and core app behavior.',
      preferencesCookies: 'Functional preferences',
      preferencesDescription: 'Used for your own app settings such as theme, table view and saved interface choices.',
      adsCookies: 'Advertising cookies',
      adsDescription: 'Prepared for a future ads phase. Not active now.',
    },
    disclaimer: {
      heading: 'Disclaimer',
      text: "CommanderZone is unofficial Fan Content permitted under Wizards' Fan Content Policy. It is not approved, endorsed, sponsored or affiliated with Wizards of the Coast, Hasbro or Magic: The Gathering.",
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Public footer',
      links: [
        { label: 'Frequently asked questions', href: getSeoPath('faq', 'en') },
        { label: 'Table Assistant', href: getSeoPath('tableAssistant', 'en') },
        { label: 'Import your Commander deck', href: getSeoPath('importCommanderDeck', 'en') },
        ...getLegalLinks('en'),
      ],
    },
  },
  es: {
    languageSelector: {
      label: 'Idioma',
      ariaLabel: 'Seleccionar idioma',
    },
    navigation: {
      ariaLabel: 'Navegación pública',
      playOnline: 'Jugar online',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Acciones de cuenta',
      login: 'Login',
      register: 'Registrarse',
    },
    cookieBanner: {
      title: 'Preferencias de cookies',
      copyStart: 'CommanderZone usa cookies esenciales y preferencias funcionales. Lee la',
      privacyPolicyLabel: 'política de privacidad',
      privacyJoin: 'y la',
      cookiePolicyLabel: 'política de cookies',
      cookiesJoin: '',
      reject: 'Rechazar',
      accept: 'Aceptar',
      managePreferences: 'Preferencias de cookies',
      essentialCookies: 'Cookies esenciales',
      essentialDescription: 'Necesarias para login, seguridad, consentimiento y funcionamiento básico.',
      preferencesCookies: 'Preferencias funcionales',
      preferencesDescription: 'Usadas para tus ajustes propios como tema, vista de mesa y opciones de interfaz.',
      adsCookies: 'Cookies publicitarias',
      adsDescription: 'Preparadas para una fase futura de anuncios. No activas ahora.',
    },
    disclaimer: {
      heading: 'Aviso legal',
      text: 'CommanderZone es contenido de fans no oficial permitido por la Política de Contenido de Fans de Wizards. No está aprobado, respaldado, patrocinado ni afiliado a Wizards of the Coast, Hasbro ni Magic: The Gathering.',
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Pie público',
      links: [
        { label: 'Preguntas frecuentes', href: getSeoPath('faq', 'es') },
        { label: 'Asistente de mesa', href: getSeoPath('tableAssistant', 'es') },
        { label: 'Importar mazo Commander', href: getSeoPath('importCommanderDeck', 'es') },
        ...getLegalLinks('es'),
      ],
    },
  },
  de: {
    languageSelector: {
      label: 'Sprache',
      ariaLabel: 'Sprache auswählen',
    },
    navigation: {
      ariaLabel: 'Öffentliche Navigation',
      playOnline: 'Online spielen',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Kontoaktionen',
      login: 'Login',
      register: 'Registrieren',
    },
    cookieBanner: {
      title: 'Cookie-Einstellungen',
      copyStart: 'CommanderZone verwendet notwendige Cookies und funktionale Einstellungen. Lies die',
      privacyPolicyLabel: 'Datenschutzerklärung',
      privacyJoin: 'und die',
      cookiePolicyLabel: 'Cookie-Richtlinie',
      cookiesJoin: '',
      reject: 'Ablehnen',
      accept: 'Akzeptieren',
      managePreferences: 'Cookie-Einstellungen',
      essentialCookies: 'Essenzielle Cookies',
      essentialDescription: 'Erforderlich für Login, Sicherheit, Einwilligungsspeicher und Kernfunktionen.',
      preferencesCookies: 'Funktionale Einstellungen',
      preferencesDescription: 'Für eigene App-Einstellungen wie Theme, Tischansicht und gespeicherte UI-Auswahl.',
      adsCookies: 'Werbe-Cookies',
      adsDescription: 'Für eine künftige Werbephase vorbereitet. Derzeit nicht aktiv.',
    },
    disclaimer: {
      heading: 'Hinweis',
      text: 'CommanderZone ist inoffizieller Fan Content im Rahmen der Fan Content Policy von Wizards. Es ist nicht von Wizards of the Coast, Hasbro oder Magic: The Gathering genehmigt, unterstützt, gesponsert oder mit ihnen verbunden.',
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Öffentliche Fußzeile',
      links: [
        { label: 'Häufige Fragen', href: getSeoPath('faq', 'de') },
        { label: 'Tischassistent', href: getSeoPath('tableAssistant', 'de') },
        { label: 'Commander-Deck importieren', href: getSeoPath('importCommanderDeck', 'de') },
        ...getLegalLinks('de'),
      ],
    },
  },
  fr: {
    languageSelector: {
      label: 'Langue',
      ariaLabel: 'Choisir la langue',
    },
    navigation: {
      ariaLabel: 'Navigation publique',
      playOnline: 'Jouer en ligne',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Actions de compte',
      login: 'Login',
      register: 'Inscription',
    },
    cookieBanner: {
      title: 'Préférences de cookies',
      copyStart: 'CommanderZone utilise des cookies essentiels et des préférences fonctionnelles. Consultez la',
      privacyPolicyLabel: 'politique de confidentialité',
      privacyJoin: 'et la',
      cookiePolicyLabel: 'politique relative aux cookies',
      cookiesJoin: '',
      reject: 'Refuser',
      accept: 'Accepter',
      managePreferences: 'Préférences de cookies',
      essentialCookies: 'Cookies essentiels',
      essentialDescription: 'Nécessaires pour la connexion, la sécurité, le consentement et les fonctions de base.',
      preferencesCookies: 'Préférences fonctionnelles',
      preferencesDescription: 'Utilisées pour vos réglages comme le thème, la vue de table et les choix d’interface.',
      adsCookies: 'Cookies publicitaires',
      adsDescription: 'Préparés pour une future phase publicitaire. Non actifs actuellement.',
    },
    disclaimer: {
      heading: 'Mention légale',
      text: 'CommanderZone est un contenu de fan non officiel autorisé par la Fan Content Policy de Wizards. Il n’est pas approuvé, soutenu, sponsorisé ni affilié à Wizards of the Coast, Hasbro ou Magic: The Gathering.',
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Pied de page public',
      links: [
        { label: 'Questions fréquentes', href: getSeoPath('faq', 'fr') },
        { label: 'Assistant de table', href: getSeoPath('tableAssistant', 'fr') },
        { label: 'Importer un deck Commander', href: getSeoPath('importCommanderDeck', 'fr') },
        ...getLegalLinks('fr'),
      ],
    },
  },
  pt: {
    languageSelector: {
      label: 'Idioma',
      ariaLabel: 'Selecionar idioma',
    },
    navigation: {
      ariaLabel: 'Navegação pública',
      playOnline: 'Jogar online',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Acoes de conta',
      login: 'Login',
      register: 'Registrar',
    },
    cookieBanner: {
      title: 'Preferências de cookies',
      copyStart: 'CommanderZone usa cookies essenciais e preferências funcionais. Leia a',
      privacyPolicyLabel: 'política de privacidade',
      privacyJoin: 'e a',
      cookiePolicyLabel: 'política de cookies',
      cookiesJoin: '',
      reject: 'Rejeitar',
      accept: 'Aceitar',
      managePreferences: 'Preferências de cookies',
      essentialCookies: 'Cookies essenciais',
      essentialDescription: 'Necessários para login, segurança, consentimento e funções principais.',
      preferencesCookies: 'Preferências funcionais',
      preferencesDescription: 'Usadas para suas configurações como tema, visualização da mesa e opções da interface.',
      adsCookies: 'Cookies de publicidade',
      adsDescription: 'Preparados para uma fase futura de anúncios. Não ativos agora.',
    },
    disclaimer: {
      heading: 'Aviso legal',
      text: 'CommanderZone é conteúdo de fã não oficial permitido pela Fan Content Policy da Wizards. Não é aprovado, endossado, patrocinado nem afiliado à Wizards of the Coast, Hasbro ou Magic: The Gathering.',
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Rodapé público',
      links: [
        { label: 'Perguntas frequentes', href: getSeoPath('faq', 'pt') },
        { label: 'Assistente de mesa', href: getSeoPath('tableAssistant', 'pt') },
        { label: 'Importar deck Commander', href: getSeoPath('importCommanderDeck', 'pt') },
        ...getLegalLinks('pt'),
      ],
    },
  },
  it: {
    languageSelector: {
      label: 'Lingua',
      ariaLabel: 'Seleziona lingua',
    },
    navigation: {
      ariaLabel: 'Navigazione pubblica',
      playOnline: 'Gioca online',
      faq: 'FAQ',
    },
    authActions: {
      ariaLabel: 'Azioni account',
      login: 'Login',
      register: 'Registrati',
    },
    cookieBanner: {
      title: 'Preferenze cookie',
      copyStart: 'CommanderZone usa cookie essenziali e preferenze funzionali. Leggi l’informativa sulla',
      privacyPolicyLabel: 'privacy',
      privacyJoin: 'e la',
      cookiePolicyLabel: 'cookie policy',
      cookiesJoin: '',
      reject: 'Rifiuta',
      accept: 'Accetta',
      managePreferences: 'Preferenze cookie',
      essentialCookies: 'Cookie essenziali',
      essentialDescription: 'Necessari per login, sicurezza, consenso e funzioni principali.',
      preferencesCookies: 'Preferenze funzionali',
      preferencesDescription: 'Usate per impostazioni come tema, vista tavolo e scelte dell’interfaccia.',
      adsCookies: 'Cookie pubblicitari',
      adsDescription: 'Preparati per una futura fase pubblicitaria. Non attivi ora.',
    },
    disclaimer: {
      heading: 'Avviso legale',
      text: 'CommanderZone è contenuto fan non ufficiale consentito dalla Fan Content Policy di Wizards. Non è approvato, supportato, sponsorizzato né affiliato a Wizards of the Coast, Hasbro o Magic: The Gathering.',
      copyright: `© 1993–${CURRENT_YEAR} Wizards of the Coast LLC. All rights reserved.`,
    },
    footer: {
      ariaLabel: 'Footer pubblico',
      links: [
        { label: 'Domande frequenti', href: getSeoPath('faq', 'it') },
        { label: 'Assistente da tavolo', href: getSeoPath('tableAssistant', 'it') },
        { label: 'Importare un mazzo Commander', href: getSeoPath('importCommanderDeck', 'it') },
        ...getLegalLinks('it'),
      ],
    },
  },
} as const satisfies Record<SeoLocaleCode, PublicChromeCopy>;

export function getPublicChromeCopy(locale: SeoLocaleCode): PublicChromeCopy {
  return PUBLIC_CHROME_COPY[locale];
}

export function getPublicFooterUtilityLinks(locale: SeoLocaleCode): readonly PublicChromeLink[] {
  return PUBLIC_CHROME_COPY[locale].footer.links.slice(0, 3);
}

export function getPublicFooterLegalLinks(locale: SeoLocaleCode): readonly PublicChromeLink[] {
  return PUBLIC_CHROME_COPY[locale].footer.links.slice(3);
}

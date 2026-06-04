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
  readonly cookieBanner: {
    readonly title: string;
    readonly copyStart: string;
    readonly privacyPolicyLabel: string;
    readonly privacyJoin: string;
    readonly cookiePolicyLabel: string;
    readonly cookiesJoin: string;
    readonly configure: string;
    readonly reject: string;
    readonly accept: string;
    readonly save: string;
    readonly analyticsCookies: string;
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
    cookieBanner: {
      title: 'Cookie preferences',
      copyStart: 'CommanderZone uses essential cookies for the app. Optional analytics stay disabled unless you allow them. Read the',
      privacyPolicyLabel: 'privacy policy',
      privacyJoin: 'and',
      cookiePolicyLabel: 'cookie policy',
      cookiesJoin: '',
      configure: 'Configure',
      reject: 'Reject',
      accept: 'Accept',
      save: 'Save',
      analyticsCookies: 'Analytics cookies',
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
    cookieBanner: {
      title: 'Preferencias de cookies',
      copyStart: 'CommanderZone usa cookies esenciales para la app. La analítica opcional permanece desactivada salvo que la permitas. Lee la',
      privacyPolicyLabel: 'política de privacidad',
      privacyJoin: 'y la',
      cookiePolicyLabel: 'política de cookies',
      cookiesJoin: '',
      configure: 'Configurar',
      reject: 'Rechazar',
      accept: 'Aceptar',
      save: 'Guardar',
      analyticsCookies: 'Cookies de analítica',
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
    cookieBanner: {
      title: 'Cookie-Einstellungen',
      copyStart: 'CommanderZone verwendet notwendige Cookies für die App. Optionale Analyse bleibt deaktiviert, sofern du sie nicht erlaubst. Lies die',
      privacyPolicyLabel: 'Datenschutzerklärung',
      privacyJoin: 'und die',
      cookiePolicyLabel: 'Cookie-Richtlinie',
      cookiesJoin: '',
      configure: 'Konfigurieren',
      reject: 'Ablehnen',
      accept: 'Akzeptieren',
      save: 'Speichern',
      analyticsCookies: 'Analyse-Cookies',
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
    cookieBanner: {
      title: 'Préférences de cookies',
      copyStart: 'CommanderZone utilise des cookies essentiels pour l’application. L’analyse optionnelle reste désactivée sauf si vous l’autorisez. Consultez la',
      privacyPolicyLabel: 'politique de confidentialité',
      privacyJoin: 'et la',
      cookiePolicyLabel: 'politique relative aux cookies',
      cookiesJoin: '',
      configure: 'Configurer',
      reject: 'Refuser',
      accept: 'Accepter',
      save: 'Enregistrer',
      analyticsCookies: 'Cookies d’analyse',
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
    cookieBanner: {
      title: 'Preferências de cookies',
      copyStart: 'CommanderZone usa cookies essenciais para a app. A análise opcional fica desativada a menos que você permita. Leia a',
      privacyPolicyLabel: 'política de privacidade',
      privacyJoin: 'e a',
      cookiePolicyLabel: 'política de cookies',
      cookiesJoin: '',
      configure: 'Configurar',
      reject: 'Rejeitar',
      accept: 'Aceitar',
      save: 'Salvar',
      analyticsCookies: 'Cookies de análise',
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
    cookieBanner: {
      title: 'Preferenze cookie',
      copyStart: 'CommanderZone usa cookie essenziali per l’app. L’analisi opzionale resta disattivata salvo tuo consenso. Leggi l’informativa sulla',
      privacyPolicyLabel: 'privacy',
      privacyJoin: 'e la',
      cookiePolicyLabel: 'cookie policy',
      cookiesJoin: '',
      configure: 'Configura',
      reject: 'Rifiuta',
      accept: 'Accetta',
      save: 'Salva',
      analyticsCookies: 'Cookie di analisi',
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

import {
  SEO_LOCALES,
  SEO_LOCALE_CODES,
  SeoLocaleCode,
  getLocaleHreflang,
} from '../../../core/localization/locale-config';
import { getSeoPath, SEO_ROUTE_KEYS, SeoRouteKey } from '../../../core/localization/seo-routes';
import {
  getPublicChromeCopy,
  getPublicFooterLegalLinks,
  getPublicFooterUtilityLinks,
} from '../../../core/localization/public-chrome-copy';
import { SEO_CANONICAL_ORIGIN, toSeoAbsoluteUrl } from '../../../core/seo/seo.service';
import {
  LandingBreadcrumbContent,
  LandingComparisonContent,
  LandingFaqContent,
  LandingFeature,
  LandingInternalLinksContent,
  LandingSectionContent,
  LandingStep,
  SeoJsonLdValue,
  SeoLandingContent,
  SeoMetadataContent,
} from '../models/seo-landing-content.model';
import {
  COMPARISON_LANDING_ROUTE_KEYS,
  GUIDE_LANDING_ROUTE_KEYS,
  PRODUCT_LANDING_ROUTE_KEYS,
} from '../models/seo-landing-template.model';
import { SEO_LANDING_METADATA_COPY, type PriorityLocaleCode } from './seo-landing-metadata-copy';

type SeoJsonLdObject = Readonly<Record<string, SeoJsonLdValue>>;

interface SectionCopy {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

interface ComparisonRowCopy {
  readonly label: string;
  readonly firstValue: string;
  readonly secondValue: string;
}

interface ComparisonCopy {
  readonly title: string;
  readonly intro: string;
  readonly firstColumnLabel: string;
  readonly secondColumnLabel: string;
  readonly rows: readonly ComparisonRowCopy[];
}

interface FaqItemCopy {
  readonly question: string;
  readonly answer: string;
}

interface LandingCopy {
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly h1: string;
  readonly heroSubtitle: string;
  readonly heroHighlights?: readonly string[];
  readonly primaryCta: string;
  readonly secondaryCta: string;
  readonly sections: readonly SectionCopy[];
  readonly features?: readonly LandingFeature[];
  readonly steps?: readonly LandingStep[];
  readonly comparison?: ComparisonCopy;
  readonly faq?: readonly FaqItemCopy[];
  readonly ctaTitle?: string;
  readonly ctaDescription?: string;
}

interface LandingCtaCopy {
  readonly primaryCta: string;
  readonly secondaryCta: string;
}

interface LocaleUiCopy {
  readonly homeLabel: string;
  readonly eyebrow: string;
  readonly navPlay: string;
  readonly navFaq: string;
  readonly footerFaq: string;
  readonly featureGridTitle: string;
  readonly featureGridIntro: string;
  readonly faqTitle: string;
  readonly faqIntro: string;
  readonly relatedTitle: string;
  readonly relatedIntro: string;
  readonly trustLabel: string;
  readonly manualValue: string;
  readonly manualLabel: string;
  readonly browserValue: string;
  readonly browserLabel: string;
  readonly defaultCtaTitle: string;
  readonly defaultCtaDescription: string;
  readonly defaultFaq: readonly FaqItemCopy[];
}

const PRIORITY_LOCALES = ['es', 'en', 'de', 'fr', 'pt', 'it'] as const satisfies readonly PriorityLocaleCode[];
const APP_DECKS_ENTRY_PATH = '/auth/login?redirect=/decks';
const APP_TABLE_ASSISTANT_ENTRY_PATH = '/auth/login?redirect=/table-assistant';
const SEO_STRUCTURED_DATA_DATE_MODIFIED = '2026-06-04';

const LANDING_CTA_COPY = {
  home: {
    es: cta('Entrar y preparar mazo', 'Cómo jugar Commander'),
    en: cta('Sign in and prepare deck', 'How to play Commander'),
    de: cta('Einloggen und Deck vorbereiten', 'Commander-Anleitung'),
    fr: cta('Se connecter et préparer un deck', 'Comment jouer à Commander'),
    pt: cta('Entrar e preparar deck', 'Como jogar Commander'),
    it: cta('Accedi e prepara il mazzo', 'Come giocare Commander'),
  },
  playCommanderOnline: {
    es: cta('Entrar para jugar Commander', 'Cómo jugar Commander'),
    en: cta('Sign in to play Commander', 'How to play Commander'),
    de: cta('Einloggen und Commander spielen', 'Commander-Anleitung'),
    fr: cta('Se connecter pour jouer à Commander', 'Comment jouer à Commander'),
    pt: cta('Entrar para jogar Commander', 'Como jogar Commander'),
    it: cta('Accedi per giocare Commander', 'Come giocare Commander'),
  },
  playMagicOnlineWithFriends: {
    es: cta('Entrar y preparar mazo', 'Formas de jugar Commander'),
    en: cta('Sign in and prepare deck', 'Ways to play Commander'),
    de: cta('Einloggen und Deck vorbereiten', 'Commander online spielen'),
    fr: cta('Se connecter et préparer un deck', 'Façons de jouer Commander'),
    pt: cta('Entrar e preparar deck', 'Formas de jogar Commander'),
    it: cta('Accedi e prepara il mazzo', 'Modi per giocare Commander'),
  },
  createCommanderRoom: {
    es: cta('Entrar y preparar partida', 'Cómo jugar Commander'),
    en: cta('Sign in and prepare game', 'How to play Commander'),
    de: cta('Einloggen und Partie vorbereiten', 'Commander-Anleitung'),
    fr: cta('Se connecter et préparer une partie', 'Comment jouer à Commander'),
    pt: cta('Entrar e preparar partida', 'Como jogar Commander'),
    it: cta('Accedi e prepara la partita', 'Come giocare Commander'),
  },
  importCommanderDeck: {
    es: cta('Entrar e importar mazo', 'Leer FAQ'),
    en: cta('Sign in and import deck', 'Read FAQ'),
    de: cta('Einloggen und Deck importieren', 'FAQ lesen'),
    fr: cta('Se connecter et importer un deck', 'Lire la FAQ'),
    pt: cta('Entrar e importar deck', 'Ler FAQ'),
    it: cta('Accedi e importa il mazzo', 'Leggi FAQ'),
  },
  commanderDeckBuilder: {
    es: cta('Entrar y preparar mazo', 'Leer FAQ'),
    en: cta('Sign in and prepare deck', 'Read FAQ'),
    de: cta('Einloggen und Deck vorbereiten', 'FAQ lesen'),
    fr: cta('Se connecter et préparer un deck', 'Lire la FAQ'),
    pt: cta('Entrar e preparar deck', 'Ler FAQ'),
    it: cta('Accedi e prepara il mazzo', 'Leggi FAQ'),
  },
  tableAssistant: {
    es: cta('Abrir contador Commander', 'Leer FAQ'),
    en: cta('Open Commander life counter', 'Read FAQ'),
    de: cta('Commander Life Counter öffnen', 'FAQ lesen'),
    fr: cta('Ouvrir le compteur Commander', 'Lire la FAQ'),
    pt: cta('Abrir contador Commander', 'Ler FAQ'),
    it: cta('Apri contatore Commander', 'Leggi FAQ'),
  },
  waysToPlayCommanderOnline: {
    es: cta('Entrar y preparar partida', 'Guía paso a paso'),
    en: cta('Sign in and prepare game', 'Step-by-step guide'),
    de: cta('Einloggen und Partie vorbereiten', 'Schritt-für-Schritt-Anleitung'),
    fr: cta('Se connecter et préparer une partie', 'Guide étape par étape'),
    pt: cta('Entrar e preparar partida', 'Guia passo a passo'),
    it: cta('Accedi e prepara la partita', 'Guida passo passo'),
  },
  howToPlayCommanderOnline: {
    es: cta('Entrar y empezar', 'Ver formas de jugar'),
    en: cta('Sign in and start', 'See ways to play'),
    de: cta('Einloggen und starten', 'Möglichkeiten ansehen'),
    fr: cta('Se connecter et commencer', 'Voir les façons de jouer'),
    pt: cta('Entrar e começar', 'Ver formas de jogar'),
    it: cta('Accedi e inizia', 'Vedere modi per giocare'),
  },
  spellTableAlternative: {
    es: cta('Entrar y preparar partida', 'Jugar sin webcam'),
    en: cta('Sign in and prepare game', 'Play without webcam'),
    de: cta('Einloggen und Partie vorbereiten', 'Ohne Webcam spielen'),
    fr: cta('Se connecter et préparer une partie', 'Jouer sans webcam'),
    pt: cta('Entrar e preparar partida', 'Jogar sem webcam'),
    it: cta('Accedi e prepara la partita', 'Giocare senza webcam'),
  },
  playCommanderOnlineFree: {
    es: cta('Entrar y jugar Commander', 'Leer FAQ'),
    en: cta('Sign in to play Commander', 'Read FAQ'),
    de: cta('Einloggen und Commander spielen', 'FAQ lesen'),
    fr: cta('Se connecter pour jouer à Commander', 'Lire la FAQ'),
    pt: cta('Entrar para jogar Commander', 'Ler FAQ'),
    it: cta('Accedi per giocare Commander', 'Leggi FAQ'),
  },
  playCommanderWithoutWebcam: {
    es: cta('Entrar y preparar partida', 'Ver alternativa a SpellTable'),
    en: cta('Sign in and prepare game', 'See SpellTable alternative'),
    de: cta('Einloggen und Partie vorbereiten', 'SpellTable Alternative ansehen'),
    fr: cta('Se connecter et préparer une partie', 'Voir l’alternative à SpellTable'),
    pt: cta('Entrar e preparar partida', 'Ver alternativa ao SpellTable'),
    it: cta('Accedi e prepara la partita', 'Vedi alternativa a SpellTable'),
  },
  playEdhOnline: {
    es: cta('Entrar y jugar EDH', 'Jugar Commander online'),
    en: cta('Sign in to play EDH', 'Play Commander online'),
    de: cta('Einloggen und EDH spielen', 'Commander online spielen'),
    fr: cta('Se connecter pour jouer à EDH', 'Jouer à Commander en ligne'),
    pt: cta('Entrar para jogar EDH', 'Jogar Commander online'),
    it: cta('Accedi per giocare EDH', 'Giocare Commander online'),
  },
  commanderSimulator: {
    es: cta('Abrir mesa Commander manual', 'Ver Commander gratis'),
    en: cta('Open manual Commander table', 'See free Commander play'),
    de: cta('Manuellen Commander-Tisch öffnen', 'Commander kostenlos ansehen'),
    fr: cta('Ouvrir la table Commander manuelle', 'Voir Commander gratuit'),
    pt: cta('Abrir mesa Commander manual', 'Ver Commander grátis'),
    it: cta('Apri tavolo Commander manuale', 'Vedi Commander gratis'),
  },
  faq: {
    es: cta('Entrar y preparar mazo', 'Jugar Commander online'),
    en: cta('Sign in and prepare deck', 'Play Commander online'),
    de: cta('Einloggen und Deck vorbereiten', 'Commander online spielen'),
    fr: cta('Se connecter et préparer un deck', 'Jouer à Commander en ligne'),
    pt: cta('Entrar e preparar deck', 'Jogar Commander online'),
    it: cta('Accedi e prepara il mazzo', 'Giocare Commander online'),
  },
} as const satisfies Record<SeoRouteKey, Record<PriorityLocaleCode, LandingCtaCopy>>;

const INTERNAL_ROUTE_LABEL_COPY: Partial<Record<SeoRouteKey, Record<PriorityLocaleCode, string>>> = {
  playEdhOnline: {
    es: 'Jugar Commander online con una mesa manual',
    en: 'Play Commander online with a manual table',
    de: 'Commander online an einem manuellen Tisch spielen',
    fr: 'Jouer à Commander en ligne sur une table manuelle',
    pt: 'Jogar Commander online em uma mesa manual',
    it: 'Giocare Commander online con un tavolo manuale',
  },
};

const LOCALE_COPY = {
  es: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Mesa manual de Commander',
    navPlay: 'Jugar online',
    navFaq: 'FAQ',
    footerFaq: 'Preguntas frecuentes',
    featureGridTitle: 'Qué puedes hacer en CommanderZone',
    featureGridIntro: 'Herramientas pensadas para preparar la partida y mantener clara la mesa.',
    faqTitle: 'Preguntas frecuentes',
    faqIntro: 'Respuestas directas para jugadores de Commander.',
    relatedTitle: 'Más sobre CommanderZone',
    relatedIntro: 'Descubre más formas de jugar, preparar mazos y usar CommanderZone.',
    trustLabel: 'CommanderZone está pensado para pods reales',
    manualValue: 'Manual',
    manualLabel: 'Sin motor automático de reglas',
    browserValue: 'Navegador',
    browserLabel: 'Online, móvil y tablet',
    defaultCtaTitle: 'Empieza tu próxima partida de Commander',
    defaultCtaDescription: 'Crea una sala, comparte el enlace y empieza a jugar con tu grupo.',
    defaultFaq: [
      {
        question: '¿CommanderZone aplica reglas automáticamente?',
        answer: 'No. La mesa es manual y flexible. Los jugadores mantienen el control de la partida.',
      },
      {
        question: '¿Necesito instalar algo?',
        answer: 'No. CommanderZone funciona desde el navegador.',
      },
    ],
  },
  en: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Manual Commander table',
    navPlay: 'Play online',
    navFaq: 'FAQ',
    footerFaq: 'Frequently asked questions',
    featureGridTitle: 'What you can do in CommanderZone',
    featureGridIntro: 'Tools built to prepare the game and keep the table clear.',
    faqTitle: 'Frequently asked questions',
    faqIntro: 'Direct answers for Commander players.',
    relatedTitle: 'More from CommanderZone',
    relatedIntro: 'Explore more ways to play, prepare decks and use CommanderZone.',
    trustLabel: 'CommanderZone is built for real pods',
    manualValue: 'Manual',
    manualLabel: 'No automatic rules engine',
    browserValue: 'Browser',
    browserLabel: 'Online, phone and tablet',
    defaultCtaTitle: 'Start your next Commander game',
    defaultCtaDescription: 'Sign in, prepare your deck and open the room when your group is ready.',
    defaultFaq: [
      {
        question: 'Does CommanderZone enforce Magic rules automatically?',
        answer: 'No. The table is manual and flexible. Players stay in control of the game.',
      },
      {
        question: 'Do I need to install anything?',
        answer: 'No. CommanderZone runs in the browser.',
      },
    ],
  },
  de: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Manueller Commander-Tisch',
    navPlay: 'Online spielen',
    navFaq: 'FAQ',
    footerFaq: 'Häufige Fragen',
    featureGridTitle: 'Was du mit CommanderZone tun kannst',
    featureGridIntro: 'Werkzeuge, um Partien vorzubereiten und den Tisch übersichtlich zu halten.',
    faqTitle: 'Häufige Fragen',
    faqIntro: 'Direkte Antworten für Commander-Spieler.',
    relatedTitle: 'Mehr zu CommanderZone',
    relatedIntro: 'Entdecke weitere Möglichkeiten, CommanderZone zu nutzen.',
    trustLabel: 'CommanderZone ist für echte Commander-Runden gedacht',
    manualValue: 'Manuell',
    manualLabel: 'Kein automatischer Regelmotor',
    browserValue: 'Browser',
    browserLabel: 'Online, Smartphone und Tablet',
    defaultCtaTitle: 'Starte deine nächste Commander-Partie',
    defaultCtaDescription: 'Erstelle einen Raum, teile den Link und spiele mit deiner Gruppe.',
    defaultFaq: [
      {
        question: 'Automatisiert CommanderZone Magic-Regeln?',
        answer: 'Nein. Der Tisch ist manuell und flexibel. Die Spieler behalten die Kontrolle über die Partie.',
      },
      {
        question: 'Muss ich etwas installieren?',
        answer: 'Nein. CommanderZone funktioniert im Browser.',
      },
    ],
  },
  fr: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Table Commander manuelle',
    navPlay: 'Jouer en ligne',
    navFaq: 'FAQ',
    footerFaq: 'Questions fréquentes',
    featureGridTitle: 'Ce que vous pouvez faire dans CommanderZone',
    featureGridIntro: 'Des outils pour préparer la partie et garder la table lisible.',
    faqTitle: 'Questions fréquentes',
    faqIntro: 'Des réponses directes pour les joueurs de Commander.',
    relatedTitle: 'Plus sur CommanderZone',
    relatedIntro: 'Découvrez d’autres façons d’utiliser CommanderZone.',
    trustLabel: 'CommanderZone est pensé pour de vrais groupes',
    manualValue: 'Manuel',
    manualLabel: 'Pas de moteur de règles automatique',
    browserValue: 'Navigateur',
    browserLabel: 'En ligne, mobile et tablette',
    defaultCtaTitle: 'Lancez votre prochaine partie de Commander',
    defaultCtaDescription: 'Créez une salle, partagez le lien et commencez à jouer avec votre groupe.',
    defaultFaq: [
      {
        question: 'CommanderZone applique-t-il automatiquement les règles de Magic ?',
        answer: 'Non. La table est manuelle et flexible. Les joueurs gardent le contrôle de la partie.',
      },
      {
        question: 'Dois-je installer quelque chose ?',
        answer: 'Non. CommanderZone fonctionne depuis le navigateur.',
      },
    ],
  },
  pt: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Mesa manual de Commander',
    navPlay: 'Jogar online',
    navFaq: 'FAQ',
    footerFaq: 'Perguntas frequentes',
    featureGridTitle: 'O que você pode fazer no CommanderZone',
    featureGridIntro: 'Ferramentas para preparar a partida e manter a mesa clara.',
    faqTitle: 'Perguntas frequentes',
    faqIntro: 'Respostas diretas para jogadores de Commander.',
    relatedTitle: 'Mais sobre CommanderZone',
    relatedIntro: 'Explore outras formas de usar o CommanderZone.',
    trustLabel: 'CommanderZone foi feito para grupos reais',
    manualValue: 'Manual',
    manualLabel: 'Sem motor automático de regras',
    browserValue: 'Navegador',
    browserLabel: 'Online, celular e tablet',
    defaultCtaTitle: 'Comece sua próxima partida de Commander',
    defaultCtaDescription: 'Crie uma sala, compartilhe o link e comece a jogar com seu grupo.',
    defaultFaq: [
      {
        question: 'O CommanderZone aplica regras automaticamente?',
        answer: 'Não. A mesa é manual e flexível. Os jogadores mantêm o controle da partida.',
      },
      {
        question: 'Preciso instalar algo?',
        answer: 'Não. CommanderZone funciona pelo navegador.',
      },
    ],
  },
  it: {
    homeLabel: 'CommanderZone',
    eyebrow: 'Tavolo Commander manuale',
    navPlay: 'Gioca online',
    navFaq: 'FAQ',
    footerFaq: 'Domande frequenti',
    featureGridTitle: 'Cosa puoi fare con CommanderZone',
    featureGridIntro: 'Strumenti pensati per preparare la partita, usare i tuoi mazzi e mantenere il tavolo chiaro.',
    faqTitle: 'Domande frequenti',
    faqIntro: 'Risposte dirette per giocatori di Commander.',
    relatedTitle: 'Scopri altro su CommanderZone',
    relatedIntro: 'Scopri altri modi per giocare, preparare mazzi e usare CommanderZone.',
    trustLabel: 'CommanderZone è pensato per pod reali',
    manualValue: 'Manuale',
    manualLabel: 'Senza motore automatico di regole',
    browserValue: 'Browser',
    browserLabel: 'Online, smartphone e tablet',
    defaultCtaTitle: 'Inizia la tua prossima partita Commander',
    defaultCtaDescription: 'Prepara il tuo mazzo, crea una stanza e inizia a giocare con il tuo gruppo.',
    defaultFaq: [
      faq('CommanderZone applica automaticamente le regole di Magic?', 'No. Il tavolo è manuale e flessibile. I giocatori mantengono il controllo della partita.'),
      faq('Devo installare qualcosa?', 'No. CommanderZone funziona dal browser.'),
    ],
  },
} as const satisfies Record<PriorityLocaleCode, LocaleUiCopy>;

const MAIN_FAQ_ITEMS = {
  en: [
    faq('What is CommanderZone?', 'CommanderZone is a manual digital table for Magic: The Gathering Commander. It helps your group prepare decks, create rooms, track life totals and commander damage, and play online from the browser.'),
    faq('Is CommanderZone official?', 'No. CommanderZone is unofficial fan content. It is not approved, endorsed, sponsored or affiliated with Wizards of the Coast, Hasbro or Magic: The Gathering.'),
    faq('Does CommanderZone enforce Magic rules automatically?', 'No. CommanderZone is intentionally manual. Players remain responsible for game actions, triggers, priority, the stack and legal decisions, just like at a real Commander table.'),
    faq('Can I play Commander online with four players?', 'Yes. CommanderZone is built for multiplayer Commander pods and long social games.'),
    faq('Do I need to install anything?', 'No. CommanderZone runs in the browser.'),
    faq('Do I need a webcam?', 'No webcam is required for the digital table. CommanderZone is different from webcam-based paper Magic tools because the table itself lives in the browser.'),
    faq('Do I need an account?', 'You need an account for persistent features such as saving decks, preparing games and returning to your content. Public SEO pages remain accessible without signing in.'),
    faq('Can I use my own Commander decks?', 'Yes. CommanderZone is designed around preparing, importing or organizing your Commander deck before entering a game.'),
    faq('Can I use CommanderZone for physical games?', 'Yes. The Table Assistant can help track life totals, commander damage and table state around a physical Commander table.'),
    faq('Is CommanderZone free?', 'CommanderZone is currently free to use for its available features. If paid features are introduced later, they must focus on convenience and storage, not on selling official Magic content.'),
    faq('Is CommanderZone a replacement for MTG Arena or Magic Online?', 'No. CommanderZone is not a rules engine or official digital Magic client. It is a manual Commander-focused table for groups who want control and flexibility.'),
    faq('Where can I report bugs or rights issues?', 'Use the Contact page. Rights holders can contact CommanderZone directly and the issue will be reviewed.'),
  ],
  es: [
    faq('¿Qué es CommanderZone?', 'CommanderZone es una mesa digital manual para Magic: The Gathering Commander. Ayuda a tu grupo a preparar mazos, crear salas, controlar vidas y daño de comandante, y jugar online desde el navegador.'),
    faq('¿CommanderZone es oficial?', 'No. CommanderZone es contenido de fans no oficial. No está aprobado, respaldado, patrocinado ni afiliado a Wizards of the Coast, Hasbro ni Magic: The Gathering.'),
    faq('¿CommanderZone aplica reglas de Magic automáticamente?', 'No. CommanderZone es manual a propósito. Los jugadores siguen siendo responsables de acciones, triggers, prioridad, pila y decisiones legales, como en una mesa real de Commander.'),
    faq('¿Puedo jugar Commander online con cuatro jugadores?', 'Sí. CommanderZone está pensado para pods multijugador de Commander y partidas sociales largas.'),
    faq('¿Necesito instalar algo?', 'No. CommanderZone funciona desde el navegador.'),
    faq('¿Necesito webcam?', 'No necesitas webcam para la mesa digital. CommanderZone es diferente de las herramientas de Magic físico por webcam porque la mesa vive en el navegador.'),
    faq('¿Necesito una cuenta?', 'Necesitas una cuenta para funciones persistentes como guardar mazos, preparar partidas y volver a tu contenido. Las páginas SEO públicas siguen accesibles sin iniciar sesión.'),
    faq('¿Puedo usar mis propios mazos Commander?', 'Sí. CommanderZone está diseñado alrededor de preparar, importar u organizar tu mazo Commander antes de entrar en partida.'),
    faq('¿Puedo usar CommanderZone en partidas físicas?', 'Sí. El Asistente de mesa puede ayudar a controlar vidas, daño de comandante y estado de mesa en una partida presencial.'),
    faq('¿CommanderZone es gratis?', 'CommanderZone es actualmente gratuito para las funciones disponibles. Si en el futuro se introducen funciones de pago, se centrarán en comodidad y almacenamiento, no en vender contenido oficial de Magic.'),
    faq('¿CommanderZone sustituye a MTG Arena o Magic Online?', 'No. CommanderZone no es un motor de reglas ni un cliente digital oficial de Magic. Es una mesa manual centrada en Commander para grupos que quieren control y flexibilidad.'),
    faq('¿Dónde puedo reportar bugs o problemas de derechos?', 'Usa la página de Contacto. Los titulares de derechos pueden contactar directamente con CommanderZone y el caso será revisado.'),
  ],
  de: [
    faq('Was ist CommanderZone?', 'CommanderZone ist ein manueller digitaler Tisch für Magic: The Gathering Commander. Er hilft deiner Gruppe, Decks vorzubereiten, Räume zu erstellen, Lebenspunkte und Commander-Schaden zu verfolgen und online im Browser zu spielen.'),
    faq('Ist CommanderZone offiziell?', 'Nein. CommanderZone ist inoffizieller Fan Content. Es ist nicht von Wizards of the Coast, Hasbro oder Magic: The Gathering genehmigt, unterstützt, gesponsert oder mit ihnen verbunden.'),
    faq('Wendet CommanderZone Magic-Regeln automatisch an?', 'Nein. CommanderZone ist bewusst manuell. Die Spieler bleiben für Aktionen, Trigger, Priorität, den Stack und legale Entscheidungen verantwortlich, wie an einem echten Commander-Tisch.'),
    faq('Kann ich Commander online mit vier Spielern spielen?', 'Ja. CommanderZone ist für Multiplayer-Commander-Pods und lange soziale Partien gebaut.'),
    faq('Muss ich etwas installieren?', 'Nein. CommanderZone läuft im Browser.'),
    faq('Brauche ich eine Webcam?', 'Für den digitalen Tisch ist keine Webcam erforderlich. CommanderZone unterscheidet sich von Webcam-Tools für Paper Magic, weil der Tisch selbst im Browser läuft.'),
    faq('Brauche ich ein Konto?', 'Für dauerhafte Funktionen wie gespeicherte Decks, vorbereitete Partien und wiederkehrende Inhalte brauchst du ein Konto. Öffentliche SEO-Seiten bleiben ohne Anmeldung zugänglich.'),
    faq('Kann ich meine eigenen Commander-Decks verwenden?', 'Ja. CommanderZone ist darauf ausgelegt, dein Commander-Deck vorzubereiten, zu importieren oder zu organisieren, bevor du eine Partie startest.'),
    faq('Kann ich CommanderZone für physische Partien nutzen?', 'Ja. Der Tischassistent kann Lebenspunkte, Commander-Schaden und den Tischstatus bei physischen Commander-Partien verfolgen.'),
    faq('Ist CommanderZone kostenlos?', 'CommanderZone ist für die aktuell verfügbaren Funktionen kostenlos nutzbar. Falls später kostenpflichtige Funktionen eingeführt werden, betreffen sie Komfort und Speicher, nicht den Verkauf offizieller Magic-Inhalte.'),
    faq('Ersetzt CommanderZone MTG Arena oder Magic Online?', 'Nein. CommanderZone ist kein Regelmotor und kein offizieller digitaler Magic-Client. Es ist ein manueller Commander-Tisch für Gruppen, die Kontrolle und Flexibilität möchten.'),
    faq('Wo kann ich Fehler oder Rechteprobleme melden?', 'Nutze die Kontaktseite. Rechteinhaber können CommanderZone direkt kontaktieren; der Fall wird geprüft.'),
  ],
  fr: [
    faq('Qu’est-ce que CommanderZone ?', 'CommanderZone est une table numérique manuelle pour Magic: The Gathering Commander. Elle aide votre groupe à préparer des decks, créer des salles, suivre les points de vie et les blessures de commandant, et jouer en ligne depuis le navigateur.'),
    faq('CommanderZone est-il officiel ?', 'Non. CommanderZone est un contenu de fan non officiel. Il n’est pas approuvé, soutenu, sponsorisé ni affilié à Wizards of the Coast, Hasbro ou Magic: The Gathering.'),
    faq('CommanderZone applique-t-il automatiquement les règles de Magic ?', 'Non. CommanderZone est volontairement manuel. Les joueurs restent responsables des actions, triggers, priorités, de la pile et des décisions légales, comme autour d’une vraie table Commander.'),
    faq('Puis-je jouer à Commander en ligne à quatre joueurs ?', 'Oui. CommanderZone est conçu pour les pods multijoueurs Commander et les longues parties sociales.'),
    faq('Dois-je installer quelque chose ?', 'Non. CommanderZone fonctionne dans le navigateur.'),
    faq('Ai-je besoin d’une webcam ?', 'Aucune webcam n’est nécessaire pour la table numérique. CommanderZone est différent des outils de Magic papier par webcam car la table elle-même est dans le navigateur.'),
    faq('Ai-je besoin d’un compte ?', 'Un compte est nécessaire pour les fonctionnalités persistantes comme enregistrer des decks, préparer des parties et retrouver votre contenu. Les pages SEO publiques restent accessibles sans connexion.'),
    faq('Puis-je utiliser mes propres decks Commander ?', 'Oui. CommanderZone est conçu autour de la préparation, l’importation ou l’organisation de votre deck Commander avant d’entrer dans une partie.'),
    faq('Puis-je utiliser CommanderZone pour des parties physiques ?', 'Oui. L’assistant de table peut aider à suivre les points de vie, les blessures de commandant et l’état de table autour d’une table physique.'),
    faq('CommanderZone est-il gratuit ?', 'CommanderZone est actuellement gratuit pour les fonctionnalités disponibles. Si des fonctionnalités payantes sont introduites plus tard, elles porteront sur le confort et le stockage, pas sur la vente de contenu Magic officiel.'),
    faq('CommanderZone remplace-t-il MTG Arena ou Magic Online ?', 'Non. CommanderZone n’est pas un moteur de règles ni un client Magic numérique officiel. C’est une table manuelle centrée sur Commander pour les groupes qui veulent du contrôle et de la flexibilité.'),
    faq('Où signaler un bug ou un problème de droits ?', 'Utilisez la page Contact. Les ayants droit peuvent contacter CommanderZone directement; la demande sera examinée.'),
  ],
  pt: [
    faq('O que é o CommanderZone?', 'CommanderZone é uma mesa digital manual para Magic: The Gathering Commander. Ele ajuda seu grupo a preparar decks, criar salas, acompanhar vida e dano de comandante, e jogar online pelo navegador.'),
    faq('CommanderZone é oficial?', 'Não. CommanderZone é conteúdo de fã não oficial. Não é aprovado, endossado, patrocinado nem afiliado à Wizards of the Coast, Hasbro ou Magic: The Gathering.'),
    faq('CommanderZone aplica regras de Magic automaticamente?', 'Não. CommanderZone é manual de propósito. Os jogadores continuam responsáveis por ações, triggers, prioridade, pilha e decisões legais, como em uma mesa real de Commander.'),
    faq('Posso jogar Commander online com quatro jogadores?', 'Sim. CommanderZone foi feito para pods multiplayer de Commander e partidas sociais longas.'),
    faq('Preciso instalar algo?', 'Não. CommanderZone funciona no navegador.'),
    faq('Preciso de webcam?', 'Não é preciso webcam para a mesa digital. CommanderZone é diferente das ferramentas de Magic físico por webcam porque a própria mesa fica no navegador.'),
    faq('Preciso de uma conta?', 'Você precisa de uma conta para recursos persistentes como salvar decks, preparar partidas e voltar ao seu conteúdo. As páginas SEO públicas continuam acessíveis sem login.'),
    faq('Posso usar meus próprios decks Commander?', 'Sim. CommanderZone foi criado para preparar, importar ou organizar seu deck Commander antes de entrar em uma partida.'),
    faq('Posso usar CommanderZone em partidas físicas?', 'Sim. O Assistente de mesa pode ajudar a acompanhar vida, dano de comandante e estado da mesa em uma partida presencial.'),
    faq('CommanderZone é grátis?', 'CommanderZone é atualmente gratuito para os recursos disponíveis. Se recursos pagos forem introduzidos no futuro, eles focarão conveniência e armazenamento, não venda de conteúdo oficial de Magic.'),
    faq('CommanderZone substitui MTG Arena ou Magic Online?', 'Não. CommanderZone não é um motor de regras nem um cliente digital oficial de Magic. É uma mesa manual focada em Commander para grupos que querem controle e flexibilidade.'),
    faq('Onde posso reportar bugs ou problemas de direitos?', 'Use a página de Contato. Titulares de direitos podem contatar CommanderZone diretamente e o caso será analisado.'),
  ],
  it: [
    faq('Che cos’è CommanderZone?', 'CommanderZone è un tavolo digitale manuale per Magic: The Gathering Commander. Aiuta il tuo gruppo a preparare mazzi, creare stanze, seguire punti vita e danno da comandante, e giocare online dal browser.'),
    faq('CommanderZone è ufficiale?', 'No. CommanderZone è contenuto fan non ufficiale. Non è approvato, supportato, sponsorizzato né affiliato a Wizards of the Coast, Hasbro o Magic: The Gathering.'),
    faq('CommanderZone applica automaticamente le regole di Magic?', 'No. CommanderZone è volutamente manuale. I giocatori restano responsabili di azioni, trigger, priorità, pila e decisioni legali, come a un vero tavolo Commander.'),
    faq('Posso giocare Commander online con quattro giocatori?', 'Sì. CommanderZone è pensato per pod Commander multiplayer e partite sociali lunghe.'),
    faq('Devo installare qualcosa?', 'No. CommanderZone funziona dal browser.'),
    faq('Mi serve una webcam?', 'Non serve una webcam per il tavolo digitale. CommanderZone è diverso dagli strumenti per Magic cartaceo via webcam perché il tavolo stesso vive nel browser.'),
    faq('Mi serve un account?', 'Serve un account per funzioni persistenti come salvare mazzi, preparare partite e ritrovare i tuoi contenuti. Le pagine SEO pubbliche restano accessibili senza login.'),
    faq('Posso usare i miei mazzi Commander?', 'Sì. CommanderZone è progettato per preparare, importare o organizzare il tuo mazzo Commander prima di entrare in partita.'),
    faq('Posso usare CommanderZone per partite fisiche?', 'Sì. L’Assistente da tavolo può aiutare a seguire punti vita, danno da comandante e stato del tavolo in una partita dal vivo.'),
    faq('CommanderZone è gratis?', 'CommanderZone è attualmente gratuito per le funzioni disponibili. Se in futuro saranno introdotte funzioni a pagamento, riguarderanno comodità e archiviazione, non la vendita di contenuti Magic ufficiali.'),
    faq('CommanderZone sostituisce MTG Arena o Magic Online?', 'No. CommanderZone non è un motore di regole né un client digitale ufficiale di Magic. È un tavolo manuale focalizzato su Commander per gruppi che vogliono controllo e flessibilità.'),
    faq('Dove posso segnalare bug o problemi di diritti?', 'Usa la pagina Contatto. I titolari dei diritti possono contattare direttamente CommanderZone e il caso sarà esaminato.'),
  ],
} as const satisfies Record<PriorityLocaleCode, readonly FaqItemCopy[]>;

const LANDING_COPY = {
  home: {
    es: homeCopy(
      'CommanderZone | Juega Commander MTG online con tu grupo',
      'Prepara tu mazo, entra en CommanderZone y juega Commander online con tu grupo. Una mesa manual para Commander MTG, pensada para pods reales.',
      'Juega Commander online con tu grupo',
      'Prepara tu mazo de Commander MTG, entra en CommanderZone y juega online con una mesa clara, manual y pensada para partidas multijugador reales.',
      'Entrar y preparar mazo',
      'Acceder a CommanderZone',
      ['Mesa manual de Commander', 'Mazos conectados a partidas', 'Pensada para pods reales', 'Desde el navegador'],
      [
        section('deck-first', 'Primero el mazo, luego la partida', 'CommanderZone empieza donde empieza una partida real de Commander: con tu mazo. Prepara o importa tu lista y entra en la app para organizar partidas, crear salas y jugar con tu grupo.'),
        section('manual-table', 'Una mesa manual para Commander MTG', 'Commander es social, político y lleno de decisiones de mesa. CommanderZone no intenta automatizar cada regla de Magic: te da una mesa flexible mientras los jugadores mantienen el control.'),
        section('browser-play', 'Juega online sin complicarte el setup', 'Usa CommanderZone desde el navegador, lleva tus mazos a la app y mantén claras vidas, daño de comandante y estado de mesa durante partidas largas.'),
        section('paper-games', 'También para partidas físicas', 'No todas las partidas ocurren online. El Asistente de mesa te ayuda a controlar vidas, daño de comandante y estado de partida desde móvil o tablet.'),
      ],
      [
        feature('Prepara tu mazo', 'Importa u organiza tus listas de Commander MTG antes de entrar en partida.'),
        feature('Juega con tu grupo', 'Cuando tengas el mazo listo, usa CommanderZone para preparar partidas con tu pod.'),
        feature('Controla la mesa', 'Mantén visibles vidas, daño de comandante y estado de la partida.'),
        feature('Sin motor de reglas', 'Mesa manual y flexible, pensada para jugadores que ya saben jugar.'),
        feature('Asistente de mesa', 'Convierte móvil o tablet en panel compartido para partidas físicas.'),
        feature('Hecho para partidas largas', 'Diseñado para sesiones reales de Commander multijugador.'),
      ],
      [
        faq('¿CommanderZone sirve para Commander MTG?', 'Sí. CommanderZone está pensada específicamente para partidas de Commander MTG, tanto online como en mesa física.'),
        faq('¿Necesito un mazo para empezar?', 'Sí. El flujo principal empieza preparando, importando o seleccionando un mazo antes de pasar a partidas y salas.'),
        faq('¿CommanderZone aplica reglas automáticamente?', 'No. CommanderZone es una mesa manual y flexible. Los jugadores mantienen el control de la partida.'),
        faq('¿Puedo usarlo en partidas físicas?', 'Sí. El Asistente de mesa ayuda a controlar vidas, daño de comandante y estado de partida en partidas presenciales.'),
      ],
      'Prepara tu próxima partida de Commander',
      'Entra en CommanderZone, prepara tu mazo y juega Commander MTG online con tu grupo.',
    ),
    en: homeCopy(
      'CommanderZone | Play MTG Commander Online with Your Pod',
      'Prepare your deck, sign in and play Commander online with your pod. CommanderZone is a manual table for MTG Commander games, built for real multiplayer pods.',
      'Play Commander online with your pod',
      'Prepare your MTG Commander deck, enter CommanderZone and play online with a clear, manual table built for real multiplayer games.',
      'Sign in and prepare deck',
      'Open CommanderZone',
      ['Manual Commander table', 'Decks connected to games', 'Built for real pods', 'Browser-based'],
      [
        section('deck-first', 'Deck first, then the table', 'CommanderZone starts where real Commander games start: with your deck. Prepare or import your list, then move into the app to create rooms, organize games and play with your group.'),
        section('manual-table', 'A manual table for MTG Commander', 'Commander is social, political and full of table decisions. CommanderZone does not try to automate every Magic rule. It gives your pod a flexible table while players stay in control.'),
        section('browser-play', 'Play online without rebuilding your setup', 'Use CommanderZone from the browser, bring your decks into the app and keep life totals, commander damage and table state clear during long multiplayer games.'),
        section('paper-games', 'Also useful around a physical table', 'Not every game happens online. The Table Assistant helps you track life totals, commander damage and game state from a phone or tablet during paper Commander games.'),
      ],
      [
        feature('Prepare your deck', 'Import or organize your MTG Commander lists before entering a game.'),
        feature('Create rooms with your pod', 'Once your deck is ready, use CommanderZone to prepare games with your group.'),
        feature('Track the game clearly', 'Keep life totals, commander damage and table state visible.'),
        feature('Stay in control', 'The table is manual and flexible, without an automatic rules engine.'),
        feature('Use the Table Assistant', 'Turn a phone or tablet into a shared panel for paper Commander games.'),
        feature('Built for long games', 'Designed for real multiplayer Commander sessions, not quick one-off matches.'),
      ],
      [
        faq('Is CommanderZone built for MTG Commander?', 'Yes. CommanderZone is built specifically for MTG Commander games, both online and around a physical table.'),
        faq('Do I need a deck to start?', 'Yes. The main flow starts by preparing, importing or selecting a deck before you move into games and rooms.'),
        faq('Does CommanderZone enforce Magic rules automatically?', 'No. CommanderZone is a manual and flexible table. Players stay in control of the game.'),
        faq('Can I use it for paper games?', 'Yes. The Table Assistant can help track life totals, commander damage and game state during physical Commander games.'),
      ],
      'Ready for your next Commander game?',
      'Sign in, prepare your deck and enter CommanderZone to play MTG Commander online with your group.',
    ),
    de: homeCopy(
      'CommanderZone | MTG Commander online mit deiner Gruppe spielen',
      'Bereite dein Deck vor, öffne CommanderZone und spiele Commander online mit deiner Gruppe. Ein manueller Tisch für MTG Commander-Partien.',
      'Commander online mit deiner Gruppe spielen',
      'Bereite dein MTG Commander-Deck vor, öffne CommanderZone und spiele online an einem klaren, manuellen Tisch für echte Multiplayer-Partien.',
      'Einloggen und Deck vorbereiten',
      'CommanderZone öffnen',
      ['Manueller Commander-Tisch', 'Decks mit Partien verbunden', 'Für echte Commander-Runden', 'Im Browser'],
      [
        section('deck-first', 'Erst das Deck, dann die Partie', 'CommanderZone beginnt dort, wo echte Commander-Partien beginnen: bei deinem Deck. Bereite deine Liste vor oder importiere sie und nutze die App, um Partien zu organisieren.'),
        section('manual-table', 'Ein manueller Tisch für MTG Commander', 'Commander ist ein soziales Format mit vielen Entscheidungen am Tisch. CommanderZone automatisiert nicht jede Magic-Regel, sondern gibt deiner Gruppe einen flexiblen Tisch.'),
        section('browser-play', 'Online spielen ohne unnötige Einrichtung', 'Nutze CommanderZone im Browser, bring deine Decks in die App und behalte Lebenspunkte, Commander-Schaden und Tischstatus im Blick.'),
        section('paper-games', 'Auch für Papierpartien geeignet', 'Mit dem Tischassistenten kannst du Lebenspunkte, Commander-Schaden und Spielstatus bei physischen Partien auf Smartphone oder Tablet verfolgen.'),
      ],
      [
        feature('Deck vorbereiten', 'Importiere oder organisiere deine MTG Commander-Decks vor der Partie.'),
        feature('Mit der Gruppe spielen', 'Nutze CommanderZone, um Partien mit deiner Commander-Runde vorzubereiten.'),
        feature('Partie im Blick behalten', 'Verfolge Lebenspunkte, Commander-Schaden und Tischstatus.'),
        feature('Manuell und flexibel', 'Kein automatischer Regelmotor, sondern Kontrolle für die Spieler.'),
        feature('Tischassistent', 'Nutze Smartphone oder Tablet als gemeinsames Panel am physischen Tisch.'),
        feature('Für lange Partien gebaut', 'Ausgelegt für echte Multiplayer-Commander-Sessions.'),
      ],
      [
        faq('Ist CommanderZone für MTG Commander gedacht?', 'Ja. CommanderZone ist speziell für MTG Commander-Partien gedacht, online und am physischen Tisch.'),
        faq('Brauche ich ein Deck, um zu starten?', 'Ja. Der Hauptablauf beginnt damit, ein Deck vorzubereiten, zu importieren oder auszuwählen.'),
        faq('Automatisiert CommanderZone Magic-Regeln?', 'Nein. CommanderZone ist ein manueller und flexibler Tisch. Die Spieler behalten die Kontrolle.'),
        faq('Kann ich CommanderZone für Papierpartien nutzen?', 'Ja. Der Tischassistent hilft bei Lebenspunkten, Commander-Schaden und Spielstatus am physischen Tisch.'),
      ],
      'Bereite deine nächste Commander-Partie vor',
      'Öffne CommanderZone, bereite dein Deck vor und spiele MTG Commander online mit deiner Gruppe.',
    ),
    fr: homeCopy(
      'CommanderZone | Jouer à Commander MTG en ligne avec votre groupe',
      'Préparez votre deck, ouvrez CommanderZone et jouez à Commander en ligne avec votre groupe. Une table manuelle pour Commander MTG.',
      'Jouer à Commander en ligne avec votre groupe',
      'Préparez votre deck Commander MTG, ouvrez CommanderZone et jouez en ligne sur une table claire, manuelle et pensée pour les parties multijoueurs.',
      'Se connecter et préparer un deck',
      'Ouvrir CommanderZone',
      ['Table Commander manuelle', 'Decks connectés aux parties', 'Pensé pour de vrais groupes', 'Depuis le navigateur'],
      [
        section('deck-first', 'D’abord le deck, puis la partie', 'CommanderZone commence là où commence une vraie partie de Commander : avec votre deck. Préparez ou importez votre liste, puis utilisez l’app pour organiser vos parties.'),
        section('manual-table', 'Une table manuelle pour Commander MTG', 'Commander est un format social, politique et plein de décisions de table. CommanderZone ne cherche pas à automatiser chaque règle de Magic : les joueurs gardent le contrôle.'),
        section('browser-play', 'Jouer en ligne sans configuration lourde', 'Utilisez CommanderZone depuis le navigateur, amenez vos decks dans l’app et gardez les points de vie, les blessures de commandant et l’état de la table visibles.'),
        section('paper-games', 'Aussi utile autour d’une table physique', 'L’assistant de table aide à suivre les points de vie, les blessures de commandant et l’état de la partie depuis un mobile ou une tablette.'),
      ],
      [
        feature('Préparer votre deck', 'Importez ou organisez vos decks Commander MTG avant la partie.'),
        feature('Jouer avec votre groupe', 'Utilisez CommanderZone pour préparer des parties avec votre groupe.'),
        feature('Suivre la table', 'Gardez les points de vie, les blessures de commandant et l’état de partie visibles.'),
        feature('Manuel et flexible', 'Pas de moteur de règles automatique : les joueurs gardent le contrôle.'),
        feature('Assistant de table', 'Utilisez mobile ou tablette comme panneau partagé autour de la table.'),
        feature('Pensé pour les longues parties', 'Conçu pour de vraies sessions multijoueurs de Commander.'),
      ],
      [
        faq('CommanderZone est-il pensé pour Commander MTG ?', 'Oui. CommanderZone est pensé spécifiquement pour les parties de Commander MTG, en ligne comme autour d’une table physique.'),
        faq('Ai-je besoin d’un deck pour commencer ?', 'Oui. Le flux principal commence par préparer, importer ou sélectionner un deck.'),
        faq('CommanderZone applique-t-il automatiquement les règles ?', 'Non. CommanderZone est une table manuelle et flexible. Les joueurs gardent le contrôle.'),
        faq('Puis-je l’utiliser pour des parties physiques ?', 'Oui. L’assistant de table aide à suivre les points de vie, les blessures de commandant et l’état de partie.'),
      ],
      'Préparez votre prochaine partie de Commander',
      'Ouvrez CommanderZone, préparez votre deck et jouez à Commander MTG en ligne avec votre groupe.',
    ),
    pt: homeCopy(
      'CommanderZone | Jogue Commander MTG online com seu grupo',
      'Prepare seu deck, abra o CommanderZone e jogue Commander online com seu grupo. Uma mesa manual para partidas de Commander MTG.',
      'Jogue Commander online com seu grupo',
      'Prepare seu deck Commander MTG, entre no CommanderZone e jogue online em uma mesa clara, manual e feita para partidas multiplayer reais.',
      'Entrar e preparar deck',
      'Abrir CommanderZone',
      ['Mesa manual de Commander', 'Decks conectados às partidas', 'Feito para grupos reais', 'Pelo navegador'],
      [
        section('deck-first', 'Primeiro o deck, depois a partida', 'CommanderZone começa onde uma partida real de Commander começa: no seu deck. Prepare ou importe sua lista e use a app para organizar partidas com seu grupo.'),
        section('manual-table', 'Uma mesa manual para Commander MTG', 'Commander é um formato social e cheio de decisões de mesa. CommanderZone não tenta automatizar todas as regras de Magic: ele dá ao grupo uma mesa flexível.'),
        section('browser-play', 'Jogue online sem complicar o setup', 'Use CommanderZone pelo navegador, leve seus decks para a app e mantenha vida, dano de comandante e estado da mesa claros durante partidas longas.'),
        section('paper-games', 'Também útil em partidas físicas', 'O Assistente de mesa ajuda a controlar vida, dano de comandante e estado da partida pelo celular ou tablet durante jogos presenciais.'),
      ],
      [
        feature('Preparar seu deck', 'Importe ou organize seus decks Commander MTG antes da partida.'),
        feature('Jogar com seu grupo', 'Use CommanderZone para preparar partidas com seu pod.'),
        feature('Acompanhar a mesa', 'Mantenha vida, dano de comandante e estado da partida visíveis.'),
        feature('Manual e flexível', 'Sem motor automático de regras: os jogadores mantêm o controle.'),
        feature('Assistente de mesa', 'Use celular ou tablet como painel compartilhado em partidas físicas.'),
        feature('Feito para partidas longas', 'Criado para sessões reais de Commander multiplayer.'),
      ],
      [
        faq('CommanderZone é feito para Commander MTG?', 'Sim. CommanderZone foi feito especificamente para partidas de Commander MTG, online ou em mesa física.'),
        faq('Preciso de um deck para começar?', 'Sim. O fluxo principal começa preparando, importando ou selecionando um deck.'),
        faq('CommanderZone aplica regras automaticamente?', 'Não. CommanderZone é uma mesa manual e flexível. Os jogadores mantêm o controle.'),
        faq('Posso usar em partidas físicas?', 'Sim. O Assistente de mesa ajuda a controlar vida, dano de comandante e estado da partida.'),
      ],
      'Prepare sua próxima partida de Commander',
      'Abra o CommanderZone, prepare seu deck e jogue Commander MTG online com seu grupo.',
    ),
    it: homeCopy(
      'CommanderZone | Gioca a Commander MTG online con il tuo gruppo',
      'Prepara il mazzo, apri CommanderZone e gioca a Commander online con il tuo gruppo. Un tavolo manuale per partite di Commander MTG.',
      'Gioca a Commander online con il tuo gruppo',
      'Prepara il tuo mazzo Commander MTG, entra in CommanderZone e gioca online con un tavolo chiaro, manuale e pensato per vere partite multiplayer.',
      'Accedi e prepara il mazzo',
      'Apri CommanderZone',
      ['Tavolo Commander manuale', 'Mazzi collegati alle partite', 'Pensato per pod reali', 'Dal browser'],
      [
        section('deck-first', 'Prima il mazzo, poi la partita', 'CommanderZone inizia dove inizia una vera partita Commander: dal tuo mazzo. Prepara o importa la lista e usa l’app per organizzare partite con il tuo gruppo.'),
        section('manual-table', 'Un tavolo manuale per Commander MTG', 'Commander è un formato sociale, politico e pieno di decisioni al tavolo. CommanderZone non prova ad automatizzare ogni regola di Magic: dà al pod un tavolo flessibile.'),
        section('browser-play', 'Gioca online senza configurazioni inutili', 'Usa CommanderZone dal browser, porta i tuoi mazzi nell’app e mantieni chiari punti vita, danno da comandante e stato del tavolo durante partite lunghe.'),
        section('paper-games', 'Utile anche al tavolo fisico', 'L’Assistente da tavolo aiuta a seguire punti vita, danno da comandante e stato della partita da smartphone o tablet durante partite dal vivo.'),
      ],
      [
        feature('Preparare il mazzo', 'Importa o organizza i tuoi mazzi Commander MTG prima della partita.'),
        feature('Giocare con il gruppo', 'Usa CommanderZone per preparare partite con il tuo pod.'),
        feature('Tenere il tavolo chiaro', 'Segui punti vita, danno da comandante e stato della partita.'),
        feature('Manuale e flessibile', 'Nessun motore automatico di regole: i giocatori mantengono il controllo.'),
        feature('Assistente da tavolo', 'Usa smartphone o tablet come pannello condiviso nelle partite fisiche.'),
        feature('Pensato per partite lunghe', 'Creato per vere sessioni Commander multiplayer.'),
      ],
      [
        faq('CommanderZone è pensato per Commander MTG?', 'Sì. CommanderZone è pensato specificamente per partite di Commander MTG, online o al tavolo fisico.'),
        faq('Mi serve un mazzo per iniziare?', 'Sì. Il flusso principale inizia preparando, importando o selezionando un mazzo.'),
        faq('CommanderZone applica automaticamente le regole?', 'No. CommanderZone è un tavolo manuale e flessibile. I giocatori mantengono il controllo.'),
        faq('Posso usarlo nelle partite fisiche?', 'Sì. L’Assistente da tavolo aiuta a seguire punti vita, danno da comandante e stato della partita.'),
      ],
      'Prepara la tua prossima partita Commander',
      'Apri CommanderZone, prepara il mazzo e gioca a Commander MTG online con il tuo gruppo.',
    ),
  },
  playCommanderOnline: {
    es: {
      metaTitle: 'Jugar Commander online | Crea una sala gratis en CommanderZone',
      metaDescription: 'Juega Commander online con amigos desde el navegador. Prepara tu mazo de Commander MTG, crea una sala, comparte el enlace y controla vidas y daño de comandante.',
      h1: 'Jugar Commander online sin complicaciones',
      heroSubtitle: 'Importa o crea tu mazo, invita a tus amigos y juega desde el navegador con una mesa pensada para partidas multijugador reales.',
      primaryCta: 'Preparar mazo para jugar',
      secondaryCta: 'Cómo funciona',
      sections: [
        section('fast-start', 'Una forma rápida de montar la partida', 'No necesitas configurar una plataforma compleja para empezar. El flujo es directo: preparar mazo, crear sala, compartir enlace y jugar.'),
        section('manual-control', 'Mesa manual, control real', 'Commander es un formato social. CommanderZone te da herramientas para organizar la partida, pero las decisiones siguen siendo de los jugadores.'),
        section('long-games', 'Preparada para partidas largas', 'Una partida de Commander puede durar horas. La interfaz debe ser clara, estable y cómoda durante toda la sesión.'),
      ],
      features: [
        feature('Salas privadas', 'Comparte la partida solo con tu grupo.'),
        feature('Vidas y daño de comandante', 'Controla la información clave de la partida.'),
        feature('Mazos disponibles', 'Lleva tus listas a la mesa.'),
        feature('Desde el navegador', 'Juega sin instalar una aplicación pesada.'),
      ],
      faq: [
        faq('¿Puedo jugar Commander online con 4 jugadores?', 'Sí. CommanderZone está pensada para pods de Commander y partidas multijugador.'),
        faq('¿Necesito instalar algo?', 'No. CommanderZone funciona desde el navegador.'),
        faq('¿La mesa aplica reglas automáticamente?', 'No. La mesa es manual y flexible. Los jugadores mantienen el control de la partida.'),
        faq('¿Puedo usar mis propios mazos?', 'Sí. CommanderZone está pensada para importar mazos y usarlos en tus partidas.'),
      ],
    },
    en: {
      metaTitle: 'Play Commander Online | Create a Free Room on CommanderZone',
      metaDescription: 'Play Commander online with friends from your browser. Prepare your MTG Commander deck, create a room, share the link and track life totals and commander damage.',
      h1: 'Play Commander online without the setup headache',
      heroSubtitle: 'Import or build your deck, invite your friends and play from your browser with a table built for real multiplayer games.',
      primaryCta: 'Prepare deck to play',
      secondaryCta: 'How it works',
      sections: [
        section('fast-start', 'A faster way to start the game', 'You do not need a complex setup to play. Prepare a deck, create a room, share the link and start playing.'),
        section('manual-control', 'Manual table, real control', 'Commander is a social format. CommanderZone gives your group the tools, but the players stay in control of the game.'),
        section('long-games', 'Built for long games', 'Commander games can last for hours. The table should stay clear, stable and comfortable for the whole session.'),
      ],
      features: [
        feature('Private rooms', 'Share the game only with your group.'),
        feature('Life and commander damage', 'Track the key information of a Commander game.'),
        feature('Decks ready to use', 'Bring your lists to the table.'),
        feature('Browser-based', 'Play without installing a heavy app.'),
      ],
      faq: [
        faq('Can I play Commander online with four players?', 'Yes. CommanderZone is built for Commander pods and multiplayer games.'),
        faq('Do I need to install anything?', 'No. CommanderZone runs in the browser.'),
        faq('Does the table enforce Magic rules automatically?', 'No. The table is manual and flexible. Players stay in control of the game.'),
        faq('Can I use my own decks?', 'Yes. CommanderZone is designed to import decks and use them in your games.'),
      ],
    },
    de: localizedPlayCommander('Commander online spielen | Deck vorbereiten und Raum erstellen', 'Spiele Commander online mit Freunden im Browser. Bereite dein MTG-Commander-Deck vor, erstelle einen Raum, teile den Link und zähle Lebenspunkte und Commander-Schaden.', 'Commander online spielen ohne unnötige Einrichtung', 'Importiere oder erstelle dein Deck, lade deine Freunde ein und spiele direkt im Browser an einem Tisch für echte Mehrspieler-Partien.', 'Deck zum Spielen vorbereiten', 'So funktioniert es', 'de'),
    fr: localizedPlayCommander('Jouer à Commander en ligne | Préparer un deck et créer une salle', 'Jouez à Commander en ligne avec vos amis depuis le navigateur. Préparez votre deck Commander MTG, créez une salle, partagez le lien et suivez les points de vie et blessures de commandant.', 'Jouer à Commander en ligne sans configuration compliquée', 'Importez ou créez votre deck, invitez vos amis et jouez depuis le navigateur sur une table pensée pour les parties multijoueurs.', 'Préparer un deck pour jouer', 'Comment ça marche', 'fr'),
    pt: localizedPlayCommander('Jogar Commander online | Prepare deck e crie uma sala', 'Jogue Commander online com amigos pelo navegador. Prepare seu deck de Commander MTG, crie uma sala, compartilhe o link e controle vida e dano de comandante.', 'Jogar Commander online sem complicação', 'Importe ou crie seu deck, convide seus amigos e jogue pelo navegador em uma mesa feita para partidas multiplayer reais.', 'Preparar deck para jogar', 'Como funciona', 'pt'),
    it: simpleCopy('Giocare a Commander online | Prepara un mazzo e crea una stanza', 'Gioca a Commander online con gli amici dal browser. Prepara il tuo mazzo MTG Commander, crea una stanza, condividi il link e tieni traccia di vite e danno da comandante.', 'Giocare a Commander online senza complicazioni', 'Importa o crea il tuo mazzo, invita i tuoi amici e gioca dal browser con un tavolo pensato per vere partite multiplayer.', 'Preparare mazzo per giocare', 'Come funziona', [
      section('fast-start', 'Un modo rapido per iniziare la partita', 'Non serve configurare una piattaforma complicata. Il flusso è semplice: prepara il mazzo, crea la stanza, condividi il link e gioca.'),
      section('manual-control', 'Tavolo manuale, controllo reale', 'Commander è un formato sociale. CommanderZone ti dà gli strumenti per organizzare la partita, ma le decisioni restano nelle mani dei giocatori.'),
      section('long-games', 'Pensato per partite lunghe', 'Una partita Commander può durare ore. L’interfaccia deve restare chiara, stabile e comoda per tutta la sessione.'),
    ], [
      feature('Stanze private', 'Condividi la partita solo con il tuo gruppo.'),
      feature('Vite e danno da comandante', 'Tieni sotto controllo le informazioni chiave della partita.'),
      feature('Mazzi pronti', 'Porta le tue liste direttamente al tavolo.'),
      feature('Dal browser', 'Gioca senza installare applicazioni pesanti.'),
    ], [
      faq('Posso giocare a Commander online con quattro giocatori?', 'Sì. CommanderZone è pensato per pod Commander e partite multiplayer.'),
      faq('Devo installare qualcosa?', 'No. CommanderZone funziona dal browser.'),
      faq('Il tavolo applica automaticamente le regole di Magic?', 'No. Il tavolo è manuale e flessibile. I giocatori mantengono il controllo della partita.'),
      faq('Posso usare i miei mazzi?', 'Sì. CommanderZone è pensato per importare, creare o selezionare mazzi e usarli nelle tue partite.'),
    ]),
  },
  createCommanderRoom: {
    es: simpleCopy('Crear sala Commander online | CommanderZone', 'Prepara tu mazo, crea una sala privada de Commander online, comparte el enlace con tu grupo y empieza desde el navegador.', 'Crea una sala de Commander online en segundos', 'Prepara tu mazo, abre una sala, invita a tu pod y juega Commander online sin configuraciones innecesarias.', 'Entrar y preparar partida', 'Acceder a mis mazos', [
      section('deck-first', 'Primero el mazo, luego la sala', 'Para empezar una partida necesitas tener un mazo preparado. Puedes importar una decklist, crear un mazo desde cero o seleccionar uno de tus mazos guardados antes de crear la sala.'),
      section('link-invite', 'El enlace es la invitación', 'Invitar a otros jugadores debe ser tan simple como compartir un enlace.'),
      section('lobby', 'Lobby antes de jugar', 'Organiza quién entra, qué mazos se usan y cuándo empieza la partida.'),
      section('room-to-game', 'De sala a partida', 'Cuando el grupo está listo, la sala se convierte en una mesa clara y centrada en Commander.'),
    ], [
      feature('Sala privada', 'Comparte el enlace solo con quien quieras.'),
      feature('Preparación del pod', 'Organiza jugadores antes de empezar.'),
      feature('Mazo listo', 'Selecciona o importa el mazo que vas a usar.'),
      feature('Inicio rápido', 'Menos pasos antes de la partida.'),
    ]),
    en: simpleCopy('Create a Commander Room Online | CommanderZone', 'Prepare your deck, create a private Commander room online, share the link with your group and start from your browser.', 'Create a Commander room online in seconds', 'Prepare your deck, open a room, invite your pod and play Commander online without unnecessary setup.', 'Sign in and prepare game', 'Go to my decks', [
      section('deck-first', 'Deck first, room next', 'To start a game, you need a deck ready. Import a decklist, build a deck from scratch or choose one of your saved decks before creating the room.'),
      section('link-invite', 'The link is the invite', 'Inviting other players should be as simple as sharing a link.'),
      section('lobby', 'Lobby before the game', 'Organize who joins, which decks are used and when the game starts.'),
      section('room-to-game', 'From room to table', 'When your group is ready, the room becomes a clear table focused on Commander.'),
    ], [
      feature('Private room', 'Share the link only with the people you choose.'),
      feature('Pod setup', 'Organize players before the game starts.'),
      feature('Deck ready', 'Select or import the deck you want to play.'),
      feature('Fast start', 'Fewer steps before the game.'),
    ]),
    de: localizedCreateRoom('Commander-Raum online erstellen | CommanderZone', 'Bereite dein Deck vor, erstelle einen privaten Commander-Raum online, teile den Link und starte die Partie im Browser.', 'Erstelle einen Commander-Raum in Sekunden', 'Bereite dein Deck vor, öffne einen Raum, lade deine Gruppe ein und spiele Commander online ohne unnötige Einrichtung.', 'Deck importieren und Raum erstellen', 'Deck neu erstellen', 'de'),
    fr: localizedCreateRoom('Créer une salle Commander en ligne | CommanderZone', 'Préparez votre deck, créez une salle privée de Commander en ligne, partagez le lien et lancez la partie depuis le navigateur.', 'Créer une salle Commander en ligne en quelques secondes', 'Préparez votre deck, ouvrez une salle, invitez votre groupe et jouez à Commander en ligne sans configuration inutile.', 'Importer un deck et créer une salle', 'Créer un deck', 'fr'),
    pt: localizedCreateRoom('Criar sala Commander online | CommanderZone', 'Prepare seu deck, crie uma sala privada de Commander online, compartilhe o link e comece a partida pelo navegador.', 'Crie uma sala de Commander online em segundos', 'Prepare seu deck, abra uma sala, convide seu grupo e jogue Commander online sem configuração desnecessária.', 'Importar deck e criar sala', 'Criar deck do zero', 'pt'),
    it: simpleCopy('Creare una stanza Commander online | CommanderZone', 'Prepara il tuo mazzo, crea una stanza Commander online, condividi il link con il tuo gruppo e inizia la partita dal browser.', 'Crea una stanza Commander online in pochi secondi', 'Prepara il tuo mazzo, apri una stanza, invita il tuo pod e gioca a Commander online senza configurazioni inutili.', 'Importare mazzo e creare stanza', 'Creare mazzo da zero', [
      section('deck-first', 'Prima il mazzo, poi la stanza', 'Per iniziare una partita serve un mazzo pronto. Puoi importare una decklist, creare un mazzo da zero o scegliere uno dei tuoi mazzi salvati prima di creare la stanza.'),
      section('link-invite', 'Il link è l’invito', 'Invitare altri giocatori è semplice come condividere un link.'),
      section('lobby', 'Lobby prima della partita', 'Organizza chi entra, quali mazzi vengono usati e quando inizia la partita.'),
      section('room-to-game', 'Dalla stanza al tavolo', 'Quando il gruppo è pronto, la stanza diventa un tavolo chiaro e centrato su Commander.'),
    ], [
      feature('Stanza privata', 'Condividi il link solo con chi vuoi.'),
      feature('Preparazione del pod', 'Organizza i giocatori prima di iniziare.'),
      feature('Mazzo pronto', 'Importa, crea o seleziona il mazzo da usare.'),
      feature('Avvio rapido', 'Meno passaggi prima della partita.'),
    ]),
  },
  importCommanderDeck: {
    es: simpleCopy('Importar mazo Commander MTG | CommanderZone', 'Importa tu mazo de Commander MTG desde una decklist y prepáralo para jugar online, analizarlo y usarlo en tus partidas.', 'Importa tu mazo Commander y llévalo a la mesa', 'Pega tu decklist, guarda el mazo y úsalo para crear una sala.', 'Entrar e importar mazo', 'Acceder a mis mazos', [
      section('existing-lists', 'No empieces desde cero', 'Si ya tienes tus listas en texto u otras plataformas, impórtalas sin rehacer el trabajo completo.'),
      section('ready-to-play', 'Preparado para jugar', 'Importar un mazo no es solo guardarlo: es tenerlo listo para usarlo en una sala.'),
      section('analysis', 'Análisis después de importar', 'Revisa tierras, curva, colores, tipos de carta, ramp, robo e interacción antes de la partida.'),
    ], [
      feature('Pega tu lista', 'Importa desde texto de forma rápida.'),
      feature('Organiza mazos', 'Guarda y clasifica tus listas.'),
      feature('Revisa composición', 'Consulta curva, colores y tipos de carta.'),
      feature('Úsalo en sala', 'Lleva el mazo directamente a la partida.'),
    ]),
    en: simpleCopy('Import MTG Commander Deck | CommanderZone', 'Import your MTG Commander deck from a decklist and get it ready to play online, analyze and use in your games.', 'Import your Commander deck and bring it to the table', 'Paste your decklist, save the deck and use it to create a room.', 'Sign in and import deck', 'Go to my decks', [
      section('existing-lists', 'Do not start from scratch', 'If you already have your lists in text or other tools, import them without rebuilding everything.'),
      section('ready-to-play', 'Ready to play', 'Importing a deck is not just saving it. It means having it ready to use in a room.'),
      section('analysis', 'Analyze after importing', 'Review lands, curve, colors, card types, ramp, draw and interaction before the game.'),
    ], [
      feature('Paste your list', 'Import from text quickly.'),
      feature('Organize decks', 'Save and classify your lists.'),
      feature('Review composition', 'Check curve, colors and card types.'),
      feature('Use it in a room', 'Bring the deck straight to the game.'),
    ]),
    de: localizedImportDeck('MTG Commander Deck importieren | CommanderZone', 'Importiere dein MTG-Commander-Deck aus einer Decklist und bereite es vor, um online zu spielen, es zu analysieren und in deinen Partien zu nutzen.', 'Importiere dein Commander-Deck und bring es an den Tisch', 'Füge deine Deckliste ein, speichere das Deck und nutze es, um einen Raum zu erstellen.', 'Deck importieren', 'Deck neu erstellen', 'de'),
    fr: localizedImportDeck('Importer un deck Commander MTG | CommanderZone', 'Importez votre deck Commander MTG depuis une decklist et préparez-le pour jouer en ligne, l’analyser et l’utiliser dans vos parties.', 'Importez votre deck Commander et amenez-le à la table', 'Collez votre decklist, sauvegardez le deck et utilisez-le pour créer une salle.', 'Importer un deck', 'Créer un deck', 'fr'),
    pt: localizedImportDeck('Importar deck Commander MTG | CommanderZone', 'Importe seu deck de Commander MTG a partir de uma decklist e prepare-o para jogar online, analisar e usar nas suas partidas.', 'Importe seu deck Commander e leve-o para a mesa', 'Cole sua decklist, salve o deck e use-o para criar uma sala.', 'Importar deck', 'Criar deck do zero', 'pt'),
    it: simpleCopy('Importare mazzo Commander MTG | CommanderZone', 'Importa il tuo mazzo MTG Commander da una decklist e preparalo per giocare online, analizzarlo e usarlo nelle tue partite.', 'Importa il tuo mazzo Commander e portalo al tavolo', 'Incolla la tua decklist, salva il mazzo e usalo in CommanderZone per giocare online, controllare la curva e preparare le tue partite.', 'Importare mazzo', 'Creare mazzo da zero', [
      section('existing-lists', 'Non ripartire da zero', 'Se hai già le tue liste in formato testo o su altre piattaforme, importale senza ricostruire tutto da capo.'),
      section('ready-to-play', 'Pronto per giocare', 'Importare un mazzo non significa solo salvarlo: significa averlo pronto per creare una stanza e iniziare la partita.'),
      section('analysis', 'Analisi dopo l’importazione', 'Controlla terre, curva, colori, tipi di carta, ramp, pescate e interazione prima della partita.'),
    ], [
      feature('Incolla la lista', 'Importa rapidamente da testo.'),
      feature('Organizza mazzi', 'Salva e classifica le tue liste.'),
      feature('Controlla la composizione', 'Verifica curva, colori e tipi di carta.'),
      feature('Usalo in stanza', 'Porta il mazzo direttamente in partita.'),
    ]),
  },
  commanderDeckBuilder: {
    es: simpleCopy('Deck builder Commander MTG | Crea e importa mazos', 'Crea, importa y analiza mazos de Commander MTG en CommanderZone. Organiza tus listas y prepáralas para jugar online con tu grupo.', 'Un deck builder Commander conectado a tus partidas', 'Crea, importa y organiza tus mazos para usarlos directamente en tus salas de CommanderZone.', 'Crear mazo', 'Importar decklist', [
        section('build-to-play', 'Construir para jugar', 'CommanderZone no quiere ser solo una colección de listas. El objetivo es que tus mazos estén preparados para entrar en partida.'),
        section('room-ready', 'Listo para llevarlo a una sala', 'Cuando tu mazo esté listo, podrás llevarlo directamente a una sala de CommanderZone.'),
        section('deck-review', 'Revisión clara del mazo', 'Consulta curva, colores, tierras, tipos de carta y estructura general para entender si tu lista está equilibrada.'),
      section('improve', 'Mejora entre partidas', 'Guarda versiones, prueba cambios y aprende qué necesita tu mazo después de jugarlo.'),
    ], [
      feature('Crear mazo', 'Empieza una lista desde cero.'),
      feature('Importar decklist', 'Trae tus listas existentes.'),
      feature('Analizar estructura', 'Revisa curva, colores y composición.'),
      feature('Preparar para sala', 'Usa el mazo al crear o entrar en partidas.'),
    ]),
    en: simpleCopy('MTG Commander Deck Builder | Build, Import and Play', 'Build, import and analyze MTG Commander decks in CommanderZone. Organize your lists and bring them straight to your online games.', 'A Commander deck builder connected to your games', 'Build, import and organize your decks so you can use them directly in your CommanderZone rooms.', 'Sign in and prepare deck', 'Go to my decks', [
        section('build-to-play', 'Build to play', 'CommanderZone is not just a place to store lists. The goal is to make your decks ready for the table.'),
        section('room-ready', 'Ready for a room', 'Once your deck is ready, you can bring it straight into a CommanderZone room.'),
        section('deck-review', 'Clear deck review', 'Check curve, colors, lands, card types and overall structure to understand whether your list is balanced.'),
      section('improve', 'Improve between games', 'Save versions, test changes and learn what your deck needs after you play it.'),
    ], [
      feature('Build a deck', 'Start a list from scratch.'),
      feature('Import decklist', 'Bring your existing lists.'),
      feature('Analyze structure', 'Review curve, colors and composition.'),
      feature('Prepare for rooms', 'Use the deck when creating or joining games.'),
    ]),
    de: localizedDeckBuilder('MTG Commander Deck Builder | Bauen, importieren und spielen', 'Erstelle, importiere und analysiere MTG-Commander-Decks in CommanderZone. Organisiere deine Listen und nutze sie direkt in deinen Online-Partien.', 'Ein Commander Deck Builder, der mit deinen Partien verbunden ist', 'Erstelle, importiere und organisiere deine Decks, damit du sie direkt in deinen CommanderZone-Räumen nutzen kannst.', 'Deck erstellen', 'Deckliste importieren', 'de'),
    fr: localizedDeckBuilder('Deck builder Commander MTG | Créer et importer des decks', 'Créez, importez et analysez des decks Commander MTG dans CommanderZone. Organisez vos listes et préparez-les pour jouer en ligne avec votre groupe.', 'Un deck builder Commander connecté à vos parties', 'Créez, importez et organisez vos decks pour les utiliser directement dans vos salles CommanderZone.', 'Créer un deck', 'Importer une decklist', 'fr'),
    pt: localizedDeckBuilder('Deck builder Commander MTG | Crie e importe decks', 'Crie, importe e analise decks de Commander MTG no CommanderZone. Organize suas listas e prepare-as para jogar online com seu grupo.', 'Um deck builder Commander conectado às suas partidas', 'Crie, importe e organize seus decks para usá-los diretamente nas salas do CommanderZone.', 'Criar deck', 'Importar decklist', 'pt'),
    it: simpleCopy('Deck builder Commander MTG | Crea e importa mazzi', 'Crea, importa e analizza mazzi MTG Commander in CommanderZone. Organizza le tue liste e preparale per giocare online con il tuo gruppo.', 'Un deck builder Commander collegato alle tue partite', 'Crea, importa e organizza i tuoi mazzi per usarli direttamente nelle stanze CommanderZone.', 'Creare mazzo', 'Importare decklist', [
      section('build-to-play', 'Costruire per giocare', 'CommanderZone non vuole essere solo un archivio di liste. L’obiettivo è rendere i tuoi mazzi pronti per entrare in partita.'),
      section('deck-review', 'Revisione chiara del mazzo', 'Controlla curva, colori, terre, tipi di carta e struttura generale per capire se la tua lista è equilibrata.'),
      section('improve', 'Migliora tra una partita e l’altra', 'Salva versioni, prova cambiamenti e capisci cosa serve davvero al tuo mazzo dopo averlo giocato.'),
      section('room-ready', 'Dal deck builder alla stanza', 'Quando il mazzo è pronto, puoi portarlo direttamente in una stanza CommanderZone e iniziare la partita con il tuo gruppo.'),
    ], [
      feature('Creare mazzo', 'Inizia una lista da zero.'),
      feature('Importare decklist', 'Porta dentro le tue liste esistenti.'),
      feature('Analizzare struttura', 'Rivedi curva, colori e composizione.'),
      feature('Preparare per la stanza', 'Usa il mazzo quando crei o entri in partita.'),
    ]),
  },
  tableAssistant: {
    es: simpleCopy('Asistente de mesa Commander | Contador de vidas y daño de comandante', 'Usa CommanderZone como asistente de mesa para partidas físicas de Commander MTG. Controla vidas, daño de comandante y estado de la partida desde móvil o tablet.', 'Convierte tu móvil o tablet en un asistente de mesa para Commander', 'Controla vidas, daño de comandante y estado de la partida física con una interfaz pensada para pods reales.', 'Abrir Asistente de mesa', 'Ver cómo funciona', [
      section('paper-games', 'Para partidas físicas de Commander', 'No todas las partidas ocurren online. El Asistente de mesa está pensado para grupos que juegan en persona y quieren una forma cómoda de controlar la partida.'),
      section('visible-totals', 'Vidas y daño de comandante visibles', 'Mantén la información importante clara para todos los jugadores, sin depender de notas sueltas o dados repartidos por la mesa.'),
      section('mobile-tablet', 'Ideal para móvil o tablet', 'Coloca el dispositivo en el centro de la mesa y úsalo como panel compartido durante la partida.'),
    ], [
      feature('Contador de vidas', 'Actualiza vidas de forma rápida.'),
      feature('Daño de comandante', 'Controla daño entre jugadores.'),
      feature('Pods presenciales', 'Pensado para mesas físicas.'),
      feature('Interfaz clara', 'Diseñada para verse durante partidas largas.'),
    ], [
      faq('¿El Asistente de mesa es para partidas online o físicas?', 'Principalmente para partidas físicas, aunque también puede complementar partidas online.'),
      faq('¿Funciona en móvil?', 'Sí. Está pensado especialmente para móvil y tablet.'),
      faq('¿Puede controlar daño de comandante?', 'Sí. El daño de comandante es una parte esencial del Asistente de mesa.'),
    ]),
    en: simpleCopy('Commander Table Assistant | Life Counter and Commander Damage Tracker', 'Use CommanderZone as a table assistant for paper MTG Commander games. Track life totals, commander damage and game state from your phone or tablet.', 'Turn your phone or tablet into a Commander table assistant', 'Track life totals, commander damage and table state during paper games with an interface built for real pods.', 'Open Table Assistant', 'See how it works', [
      section('paper-games', 'For paper Commander games', 'Not every game happens online. The Table Assistant is built for groups playing in person who want a clearer way to manage the game.'),
      section('visible-totals', 'Life totals and commander damage', 'Keep the important information visible to every player without scattered notes or dice all over the table.'),
      section('mobile-tablet', 'Made for phone or tablet', 'Place the device at the center of the table and use it as a shared panel during the game.'),
    ], [
      feature('Life counter', 'Update life totals quickly.'),
      feature('Commander damage', 'Track damage between players.'),
      feature('Paper pods', 'Designed for physical tables.'),
      feature('Clear interface', 'Readable during long games.'),
    ], [
      faq('Is the Table Assistant for online or paper games?', 'It is mainly built for paper Commander games, but it can also complement online games.'),
      faq('Does it work on mobile?', 'Yes. It is designed especially for phones and tablets.'),
      faq('Can it track commander damage?', 'Yes. Commander damage is a core part of the Table Assistant.'),
    ]),
    de: localizedTableAssistant('Commander-Tischassistent | Lebenspunkte und Commander-Schaden zählen', 'Nutze CommanderZone als Tischassistent für physische MTG-Commander-Partien. Zähle Lebenspunkte, Commander-Schaden und Spielstatus auf Smartphone oder Tablet.', 'Mach dein Smartphone oder Tablet zum Commander-Tischassistenten', 'Behalte Lebenspunkte, Commander-Schaden und Spielstatus bei physischen Partien mit einer Oberfläche für echte Commander-Runden im Blick.', 'Tischassistent öffnen', 'So funktioniert es', 'de'),
    fr: localizedTableAssistant('Assistant de table Commander | Compteur de vie et blessures de commandant', 'Utilisez CommanderZone comme assistant de table pour vos parties physiques Commander MTG. Suivez les points de vie, les blessures de commandant et l’état de la partie sur mobile ou tablette.', 'Transformez votre mobile ou tablette en assistant de table Commander', 'Suivez les points de vie, les blessures de commandant et l’état de la partie physique avec une interface pensée pour les groupes Commander.', 'Ouvrir l’assistant de table', 'Voir comment ça marche', 'fr'),
    pt: localizedTableAssistant('Assistente de mesa Commander | Contador de vida e dano de comandante', 'Use CommanderZone como assistente de mesa para partidas físicas de Commander MTG. Controle vida, dano de comandante e estado da partida pelo celular ou tablet.', 'Transforme seu celular ou tablet em um assistente de mesa Commander', 'Controle vida, dano de comandante e estado da partida física com uma interface feita para grupos reais.', 'Abrir Assistente de mesa', 'Ver como funciona', 'pt'),
    it: simpleCopy('Assistente da tavolo Commander | Segnapunti e danno da comandante', 'Usa CommanderZone come assistente da tavolo per partite fisiche MTG Commander. Tieni traccia di punti vita, danno da comandante e stato della partita da smartphone o tablet.', 'Trasforma smartphone o tablet in un assistente da tavolo Commander', 'Tieni traccia di punti vita, danno da comandante e stato della partita fisica con un’interfaccia pensata per pod reali.', 'Aprire Assistente da tavolo', 'Vedi come funziona', [
      section('paper-games', 'Per partite fisiche di Commander', 'Non tutte le partite si giocano online. L’Assistente da tavolo è pensato per gruppi che giocano dal vivo e vogliono un modo più chiaro per gestire la partita.'),
      section('visible-totals', 'Punti vita e danno da comandante visibili', 'Mantieni le informazioni importanti chiare per tutti i giocatori, senza appunti sparsi o dadi ovunque sul tavolo.'),
      section('mobile-tablet', 'Ideale per smartphone o tablet', 'Metti il dispositivo al centro del tavolo e usalo come pannello condiviso durante la partita.'),
    ], [
      feature('Segnapunti vita', 'Aggiorna rapidamente i punti vita.'),
      feature('Danno da comandante', 'Tieni traccia del danno tra giocatori.'),
      feature('Pod dal vivo', 'Pensato per tavoli fisici.'),
      feature('Interfaccia chiara', 'Leggibile anche durante partite lunghe.'),
    ], [
      faq('L’Assistente da tavolo serve per partite online o fisiche?', 'È pensato soprattutto per partite fisiche di Commander, ma può anche completare una partita online.'),
      faq('Funziona su smartphone?', 'Sì. È pensato in particolare per smartphone e tablet.'),
      faq('Può tenere traccia del danno da comandante?', 'Sì. Il danno da comandante è una parte essenziale dell’Assistente da tavolo.'),
    ]),
  },
  howToPlayCommanderOnline: {
    es: guideCopy('Cómo jugar Commander online | Guía rápida para empezar', 'Aprende cómo jugar Commander online con amigos: prepara tu mazo, crea una sala, comparte el enlace y empieza la partida.', 'Cómo jugar Commander online paso a paso', 'Jugar Commander online puede ser sencillo si separas lo importante: preparar mazos, crear una sala, compartir el enlace y mantener clara la información de la partida.', 'Preparar mazo y empezar', 'Ver formas de jugar', [
      step('Prepara tu mazo', 'Importa una decklist, crea un mazo desde cero o selecciona uno de tus mazos guardados.'),
      step('Crea una sala', 'Cuando tengas el mazo listo, abre una sala online para tu pod.'),
      step('Comparte el enlace', 'Envía el enlace a tus amigos para que puedan unirse.'),
      step('Empieza la partida', 'Controla vidas, daño de comandante y estado de la mesa mientras jugáis.'),
    ], [
      section('group-needs', 'Qué necesita tu grupo', 'Necesitáis un canal para hablar, una forma de ver la información importante y una mesa que todos puedan entender.'),
      section('manual-table', 'Por qué una mesa manual puede funcionar mejor', 'Commander tiene muchas situaciones sociales y acuerdos de mesa. Una herramienta demasiado rígida puede estorbar más que ayudar.'),
    ]),
    en: guideCopy('How to Play Commander Online | Quick Guide to Start', 'Learn how to play Commander online with friends: prepare your deck, create a room, share the link and start the game.', 'How to play Commander online step by step', 'Playing Commander online becomes simple when you focus on what matters: prepare decks, create a room, share the link and keep game information clear.', 'Prepare deck and start', 'See ways to play', [
      step('Prepare your deck', 'Import a decklist, build a deck from scratch or choose one of your saved decks.'),
      step('Create a room', 'Once your deck is ready, open an online room for your pod.'),
      step('Share the link', 'Send the link to your friends so they can join.'),
      step('Start the game', 'Track life totals, commander damage and table state while you play.'),
    ], [
      section('group-needs', 'What your group needs', 'You need a way to talk, a way to see the important game information and a table everyone understands.'),
      section('manual-table', 'Why a manual table can work better', 'Commander has many social situations and table agreements. A tool that is too rigid can get in the way.'),
    ]),
    de: localizedHowTo('Wie man Commander online spielt | Kurzanleitung', 'Lerne, wie du Commander online mit Freunden spielst: Deck vorbereiten, Raum erstellen, Link teilen und Partie starten.', 'Commander online spielen: Schritt für Schritt', 'Commander online zu spielen wird einfacher, wenn der Ablauf klar ist: Decks vorbereiten, Raum erstellen, Link teilen und Spielinformationen sichtbar halten.', 'Deck vorbereiten und starten', 'Möglichkeiten ansehen', 'de'),
    fr: localizedHowTo('Comment jouer à Commander en ligne | Guide rapide', 'Apprenez comment jouer à Commander en ligne avec des amis : préparez votre deck, créez une salle, partagez le lien et lancez la partie.', 'Comment jouer à Commander en ligne étape par étape', 'Jouer à Commander en ligne devient simple quand l’essentiel est clair : préparer les decks, créer une salle, partager le lien et suivre la partie.', 'Préparer un deck et commencer', 'Voir les façons de jouer', 'fr'),
    pt: localizedHowTo('Como jogar Commander online | Guia rápido', 'Aprenda como jogar Commander online com amigos: prepare seu deck, crie uma sala, compartilhe o link e comece a partida.', 'Como jogar Commander online passo a passo', 'Jogar Commander online fica simples quando o fluxo é claro: preparar os decks, criar uma sala, compartilhar o link e manter as informações da partida visíveis.', 'Preparar deck e começar', 'Ver formas de jogar', 'pt'),
    it: guideCopy('Come giocare a Commander online | Guida rapida', 'Scopri come giocare a Commander online con gli amici: prepara il mazzo, crea una stanza, condividi il link e inizia la partita.', 'Come giocare a Commander online passo dopo passo', 'Giocare a Commander online diventa semplice quando il flusso è chiaro: prepara il mazzo, riunisci il gruppo, crea una stanza e mantieni visibili le informazioni della partita.', 'Preparare mazzo e iniziare', 'Vedere modi per giocare', [
      step('Prepara il tuo mazzo', 'Importa una decklist, crea un mazzo da zero o scegli uno dei tuoi mazzi salvati.'),
      step('Crea una stanza', 'Quando il mazzo è pronto, apri una stanza online per il tuo pod.'),
      step('Condividi il link', 'Invia il link ai tuoi amici così possono entrare.'),
      step('Inizia la partita', 'Tieni traccia di punti vita, danno da comandante e stato del tavolo mentre giocate.'),
    ], [
      section('group-needs', 'Cosa serve al tuo gruppo', 'Vi serve un modo per parlare, una forma chiara per vedere le informazioni importanti e un tavolo che tutti possano capire.'),
      section('manual-table', 'Perché un tavolo manuale può funzionare meglio', 'Commander ha molte situazioni sociali e accordi di tavolo. Uno strumento troppo rigido può intralciare più che aiutare.'),
    ]),
  },
  waysToPlayCommanderOnline: {
    es: comparisonCopy('Formas de jugar Commander online | Guía y comparación', 'Descubre formas de jugar Commander online con amigos: webcam, mesa manual, herramientas digitales y salas privadas. Compara opciones y elige la mejor para tu grupo.', 'Formas de jugar Commander online con tu grupo', 'Hay varias maneras de jugar Commander a distancia. CommanderZone encaja cuando tu grupo quiere conectar mazos, sala y mesa manual sin configuraciones pesadas.', 'Preparar partida en CommanderZone', 'Ver guía paso a paso', [
      section('webcam', 'Jugar por webcam', 'Es la opción más parecida a jugar en físico: cada jugador usa sus cartas reales y una cámara para mostrar la mesa.'),
      section('manual-table', 'Mesa online manual', 'Una mesa manual reduce configuración y permite que el grupo mantenga el control sin depender de un motor completo de reglas.'),
      section('platforms', 'Simuladores y plataformas completas', 'Algunas herramientas recrean el juego de forma más completa, pero pueden requerir más aprendizaje, instalación o configuración.'),
    ], [
      row('Webcam', 'Usa cartas físicas', 'Requiere cámara y buen setup.'),
      row('Mesa manual', 'Flexible y rápida', 'No valida reglas automáticamente.'),
      row('Simulador completo', 'Más automatización', 'Más curva de aprendizaje.'),
      row('Asistente de mesa', 'Muy cómodo en físico', 'No sustituye toda la mesa online.'),
    ], 'Opción', 'Encaja cuando', 'Ten en cuenta'),
    en: comparisonCopy('Ways to Play Commander Online | Guide and Comparison', 'Discover ways to play Commander online with friends: webcam, manual tables, digital tools and private rooms. Compare options and choose what fits your group.', 'Ways to play Commander online with your group', 'There are several ways to play Commander remotely. CommanderZone fits when your group wants to connect decks, a room and a manual table without heavy setup.', 'Prepare game in CommanderZone', 'Read step-by-step guide', [
      section('webcam', 'Play with webcam', 'This is the closest option to paper play: each player uses real cards and a camera to show the table.'),
      section('manual-table', 'Manual online table', 'A manual table reduces setup and lets the group stay in control without relying on a full rules engine.'),
      section('platforms', 'Simulators and full platforms', 'Some tools recreate the game more completely, but they may require more learning, installation or configuration.'),
    ], [
      row('Webcam', 'Uses physical cards', 'Requires camera and a good setup.'),
      row('Manual table', 'Flexible and fast', 'Does not enforce rules automatically.'),
      row('Full simulator', 'More automation', 'Higher learning curve.'),
      row('Table assistant', 'Great for paper games', 'Does not replace the full online table.'),
    ], 'Option', 'Fits when', 'Keep in mind'),
    de: localizedWays('Möglichkeiten, Commander online zu spielen | Vergleich', 'Entdecke Möglichkeiten, Commander online mit Freunden zu spielen: Webcam, manueller Tisch, digitale Tools und private Räume.', 'Möglichkeiten, Commander online mit deiner Gruppe zu spielen', 'CommanderZone passt, wenn deine Gruppe Decks, Raum und manuellen Tisch ohne schwere Einrichtung verbinden möchte.', 'Partie in CommanderZone vorbereiten', 'Schritt-für-Schritt-Anleitung lesen', 'de'),
    fr: localizedWays('Façons de jouer à Commander en ligne | Guide et comparaison', 'Découvrez plusieurs façons de jouer à Commander en ligne avec des amis : webcam, table manuelle, outils numériques et salles privées.', 'Façons de jouer à Commander en ligne avec votre groupe', 'CommanderZone convient quand votre groupe veut relier decks, salle et table manuelle sans configuration lourde.', 'Préparer une partie dans CommanderZone', 'Lire le guide étape par étape', 'fr'),
    pt: localizedWays('Formas de jogar Commander online | Guia e comparação', 'Descubra formas de jogar Commander online com amigos: webcam, mesa manual, ferramentas digitais e salas privadas.', 'Formas de jogar Commander online com seu grupo', 'CommanderZone funciona quando seu grupo quer conectar decks, sala e mesa manual sem configuração pesada.', 'Preparar partida no CommanderZone', 'Ler guia passo a passo', 'pt'),
    it: comparisonCopy('Modi per giocare a Commander online | Guida e confronto', 'Scopri modi per giocare a Commander online con gli amici: webcam, tavolo manuale, strumenti digitali e stanze private. Confronta le opzioni e scegli quella giusta per il tuo gruppo.', 'Modi per giocare a Commander online con il tuo gruppo', 'Ci sono diversi modi per giocare a Commander a distanza. La scelta migliore dipende da come gioca il tuo pod, da quanta automazione volete e dagli strumenti che vi servono.', 'Preparare partita in CommanderZone', 'Leggere guida passo passo', [
      section('webcam', 'Giocare con webcam', 'È l’opzione più vicina al gioco fisico: ogni giocatore usa le proprie carte reali e una camera per mostrare il tavolo.'),
      section('manual-table', 'Tavolo online manuale', 'Un tavolo manuale riduce la configurazione e permette al gruppo di mantenere il controllo senza dipendere da un motore completo di regole.'),
      section('platforms', 'Simulatori e piattaforme complete', 'Alcuni strumenti ricreano il gioco in modo più completo, ma possono richiedere più apprendimento, installazione o configurazione.'),
    ], [
      row('Webcam', 'Usa carte fisiche', 'Richiede camera e buon setup.'),
      row('Tavolo manuale', 'Flessibile e rapido', 'Non applica le regole automaticamente.'),
      row('Simulatore completo', 'Più automazione', 'Curva di apprendimento più alta.'),
      row('Assistente da tavolo', 'Molto comodo dal vivo', 'Non sostituisce tutto il tavolo online.'),
    ], 'Opzione', 'Quando funziona', 'Da considerare'),
  },
  playMagicOnlineWithFriends: {
    es: simpleCopy('Jugar Magic online con amigos | CommanderZone', 'Juega Magic online con tu grupo usando una mesa manual pensada para Commander. Prepara tu mazo, crea una sala y comparte el enlace.', 'Juega Magic online con amigos desde el navegador', 'CommanderZone está enfocada en Commander: prepara tu mazo, crea una sala y da a tu grupo una mesa online clara para jugar sin perder tiempo en configuraciones.', 'Preparar mazo y jugar', 'Ver formas de jugar online', [
      section('play-not-configure', 'Para grupos que quieren jugar, no configurar', 'Cuando tu grupo queda para jugar Magic online, lo importante es entrar rápido, organizar la mesa y empezar la partida.'),
      section('commander-focused', 'Especialmente pensada para Commander', 'CommanderZone está diseñada alrededor de las necesidades de Commander: varios jugadores, daño de comandante, partidas largas y pods estables.'),
      section('complementary', 'Una herramienta complementaria', 'Puedes combinar CommanderZone con las herramientas que ya usas para hablar, enseñar cartas o gestionar tu comunidad.'),
    ]),
    en: simpleCopy('Play Magic Online with Friends | CommanderZone', 'Play Magic online with your group using a manual table built for Commander. Prepare your deck, create a room and share the link.', 'Play Magic online with friends from your browser', 'CommanderZone is focused on Commander: prepare your deck, create a room and give your group a clear online table without wasting time on setup.', 'Prepare deck and play', 'See ways to play online', [
      section('play-not-configure', 'For groups that want to play, not configure', 'When your group meets to play Magic online, the important thing is to get in, organize the table and start the game.'),
      section('commander-focused', 'Designed especially for Commander', 'CommanderZone is built around Commander needs: multiple players, commander damage, long games and recurring pods.'),
      section('complementary', 'A complementary tool', 'You can combine CommanderZone with the tools you already use for voice, video, cards or community.'),
    ]),
    de: localizedMagicFriends('Magic online mit Freunden spielen | CommanderZone', 'Spiele Magic online mit deiner Gruppe über einen manuellen Tisch für Commander. Bereite dein Deck vor, erstelle einen Raum und teile den Link.', 'Magic online mit Freunden im Browser spielen', 'CommanderZone ist auf Commander ausgerichtet: Bereite dein Deck vor, erstelle einen Raum und gib deiner Gruppe einen klaren Online-Tisch.', 'Deck vorbereiten und spielen', 'Möglichkeiten ansehen', 'de'),
    fr: localizedMagicFriends('Jouer à Magic en ligne avec des amis | CommanderZone', 'Jouez à Magic en ligne avec votre groupe grâce à une table manuelle pensée pour Commander. Préparez votre deck, créez une salle et partagez le lien.', 'Jouer à Magic en ligne avec des amis depuis le navigateur', 'CommanderZone est centrée sur Commander : préparez votre deck, créez une salle et donnez à votre groupe une table en ligne claire.', 'Préparer un deck et jouer', 'Voir les façons de jouer', 'fr'),
    pt: localizedMagicFriends('Jogar Magic online com amigos | CommanderZone', 'Jogue Magic online com seu grupo usando uma mesa manual feita para Commander. Prepare seu deck, crie uma sala e compartilhe o link.', 'Jogue Magic online com amigos pelo navegador', 'CommanderZone é focada em Commander: prepare seu deck, crie uma sala e ofereça ao grupo uma mesa online clara.', 'Preparar deck e jogar', 'Ver formas de jogar online', 'pt'),
    it: simpleCopy('Giocare a Magic online con amici | CommanderZone', 'Gioca a Magic online con il tuo gruppo usando un tavolo manuale pensato per Commander. Prepara il mazzo, crea una stanza privata e condividi il link.', 'Gioca a Magic online con amici dal browser', 'CommanderZone è focalizzato su Commander: prepara il tuo mazzo, crea una stanza e dai al tuo gruppo un tavolo online chiaro senza perdere tempo in configurazioni.', 'Preparare mazzo e giocare', 'Vedere modi per giocare online', [
      section('play-not-configure', 'Per gruppi che vogliono giocare, non configurare', 'Quando il tuo gruppo si ritrova per giocare a Magic online, la cosa importante è entrare rapidamente, organizzare il tavolo e iniziare la partita.'),
      section('commander-focused', 'Pensato soprattutto per Commander', 'CommanderZone è progettato intorno alle esigenze di Commander: più giocatori, danno da comandante, partite lunghe e pod ricorrenti.'),
      section('complementary', 'Uno strumento complementare', 'Puoi combinare CommanderZone con gli strumenti che usi già per voce, video, carte o community.'),
    ]),
  },
  spellTableAlternative: {
    en: {
      metaTitle: 'SpellTable Alternative for Commander Online | CommanderZone',
      metaDescription: 'Looking for a SpellTable alternative for Commander? CommanderZone gives your pod a manual digital table in the browser, without webcam setup or paper table overhead.',
      h1: 'A SpellTable alternative for digital Commander pods',
      heroSubtitle: 'SpellTable is great for webcam paper Magic. CommanderZone is different: your pod plays on a manual digital table connected to decks, rooms, life totals and commander damage.',
      primaryCta: 'Sign in and prepare game',
      secondaryCta: 'Play without webcam',
      sections: [
        section('different-from-webcam', 'Different from webcam Magic', 'CommanderZone does not try to scan physical cards through a camera. The table lives in the browser, so your group can focus on the Commander game instead of camera angles and paper setup.'),
        section('manual-not-automatic', 'Manual, not automatic', 'CommanderZone is not a rules engine. Players stay responsible for triggers, stack, priority and legal decisions.'),
        section('when-spelltable-fits', 'When SpellTable fits', 'Use SpellTable if you want to play with physical cards on camera.'),
        section('when-commanderzone-fits', 'When CommanderZone is better', 'Use CommanderZone if you want a digital manual table, browser-based rooms and deck-connected gameplay.'),
      ],
      comparison: comparison('Webcam paper Magic or digital table', 'Compare the setup your group actually wants before choosing a Commander tool.', 'Need', 'Good fit', [
        row('Physical cards on camera', 'SpellTable', 'CommanderZone is built for a browser table instead.'),
        row('No webcam setup', 'CommanderZone', 'Players use a manual digital table in the browser.'),
        row('Automatic card scanning', 'SpellTable', 'CommanderZone does not scan cards.'),
        row('Manual Commander decisions', 'CommanderZone', 'Players keep responsibility for rules and table choices.'),
      ]),
      faq: [
        faq('Is CommanderZone a replacement for SpellTable?', 'It depends on how your group plays. SpellTable fits webcam paper Magic. CommanderZone fits groups that want a manual digital table in the browser.'),
        faq('Do I need a webcam?', 'No. CommanderZone does not require a webcam for the digital table.'),
        faq('Does CommanderZone scan cards?', 'No. CommanderZone is not a webcam card scanner.'),
      ],
    },
    es: {
      metaTitle: 'Alternativa a SpellTable para jugar Commander online | CommanderZone',
      metaDescription: '¿Buscas una alternativa a SpellTable para Commander? CommanderZone ofrece una mesa digital manual en el navegador, sin depender de webcam ni setup físico.',
      h1: 'Una alternativa a SpellTable para pods digitales de Commander',
      heroSubtitle: 'SpellTable es muy útil para jugar Magic físico por webcam. CommanderZone es distinto: tu grupo juega en una mesa digital manual conectada a mazos, salas, vidas y daño de comandante.',
      primaryCta: 'Entrar y preparar partida',
      secondaryCta: 'Jugar sin webcam',
      sections: [
        section('different-from-webcam', 'Diferente al Magic por webcam', 'CommanderZone no intenta escanear cartas físicas con una cámara. La mesa vive en el navegador para que el grupo se centre en la partida de Commander.'),
        section('manual-not-automatic', 'Manual, no automático', 'CommanderZone no es un motor de reglas. Los jugadores siguen siendo responsables de triggers, pila, prioridad y decisiones legales.'),
        section('when-spelltable-fits', 'Cuándo SpellTable encaja mejor', 'Usa SpellTable si quieres jugar con cartas físicas delante de una cámara.'),
        section('when-commanderzone-fits', 'Cuándo CommanderZone encaja mejor', 'Usa CommanderZone si quieres una mesa digital manual, salas en navegador y partidas conectadas a tus mazos.'),
      ],
      comparison: comparison('Magic por webcam o mesa digital', 'Compara qué setup quiere tu grupo antes de elegir una herramienta para Commander.', 'Necesidad', 'Encaja mejor', [
        row('Cartas físicas en cámara', 'SpellTable', 'CommanderZone usa una mesa digital en navegador.'),
        row('Sin configurar webcam', 'CommanderZone', 'Los jugadores usan una mesa manual digital.'),
        row('Escaneo de cartas', 'SpellTable', 'CommanderZone no escanea cartas.'),
        row('Decisiones manuales de Commander', 'CommanderZone', 'Los jugadores mantienen la responsabilidad de reglas y acuerdos.'),
      ]),
      faq: [
        faq('¿CommanderZone es mejor que SpellTable?', 'Depende. SpellTable encaja mejor para Magic físico por webcam. CommanderZone encaja mejor si tu grupo quiere una mesa digital manual en el navegador.'),
        faq('¿Necesito webcam?', 'No. CommanderZone no requiere webcam para la mesa digital.'),
        faq('¿CommanderZone escanea cartas?', 'No. CommanderZone no es un escáner de cartas por webcam.'),
      ],
    },
    de: {
      metaTitle: 'SpellTable Alternative für Commander online | CommanderZone',
      metaDescription: 'Suchst du eine SpellTable Alternative für Commander? CommanderZone bietet deiner Runde einen manuellen digitalen Tisch im Browser, ohne Webcam-Setup.',
      h1: 'Eine SpellTable Alternative für digitale Commander-Runden',
      heroSubtitle: 'SpellTable ist stark für Paper Magic per Webcam. CommanderZone ist anders: Deine Runde spielt an einem manuellen digitalen Tisch mit Decks, Räumen, Lebenspunkten und Commander-Schaden.',
      primaryCta: 'Einloggen und Partie vorbereiten',
      secondaryCta: 'Ohne Webcam spielen',
      sections: [
        section('different-from-webcam', 'Anders als Webcam-Magic', 'CommanderZone versucht nicht, physische Karten per Kamera zu scannen. Der Tisch läuft im Browser, damit sich die Gruppe auf die Commander-Partie konzentrieren kann.'),
        section('manual-not-automatic', 'Manuell, nicht automatisch', 'CommanderZone ist kein Regelmotor. Spieler bleiben für Trigger, Stack, Priorität und legale Entscheidungen verantwortlich.'),
        section('when-spelltable-fits', 'Wann SpellTable besser passt', 'Nutze SpellTable, wenn du mit physischen Karten vor einer Kamera spielen möchtest.'),
        section('when-commanderzone-fits', 'Wann CommanderZone besser passt', 'Nutze CommanderZone, wenn du einen manuellen digitalen Tisch, Browser-Räume und Deck-bezogene Partien möchtest.'),
      ],
      comparison: comparison('Webcam-Paper oder digitaler Tisch', 'Vergleiche, welches Setup deine Runde wirklich möchte.', 'Bedarf', 'Passt besser', [
        row('Physische Karten vor Kamera', 'SpellTable', 'CommanderZone nutzt stattdessen einen Browser-Tisch.'),
        row('Ohne Webcam-Setup', 'CommanderZone', 'Die Runde spielt an einem manuellen digitalen Tisch.'),
        row('Kartenscan per Kamera', 'SpellTable', 'CommanderZone scannt keine Karten.'),
        row('Manuelle Commander-Entscheidungen', 'CommanderZone', 'Spieler bleiben für Regeln und Absprachen verantwortlich.'),
      ]),
      faq: [
        faq('Ist CommanderZone besser als SpellTable?', 'Es kommt darauf an. SpellTable passt besser für Paper Magic per Webcam. CommanderZone passt besser, wenn deine Gruppe einen manuellen digitalen Tisch im Browser möchte.'),
        faq('Brauche ich eine Webcam?', 'Nein. CommanderZone benötigt keine Webcam für den digitalen Tisch.'),
        faq('Scannt CommanderZone Karten?', 'Nein. CommanderZone ist kein Webcam-Kartenscanner.'),
      ],
    },
    fr: {
      metaTitle: 'Alternative à SpellTable pour Commander en ligne | CommanderZone',
      metaDescription: 'Vous cherchez une alternative à SpellTable pour Commander ? CommanderZone propose une table numérique manuelle dans le navigateur, sans configuration webcam.',
      h1: 'Une alternative à SpellTable pour les groupes Commander numériques',
      heroSubtitle: 'SpellTable est excellent pour Magic papier par webcam. CommanderZone est différent : votre groupe joue sur une table numérique manuelle reliée aux decks, salles, points de vie et blessures de commandant.',
      primaryCta: 'Se connecter et préparer une partie',
      secondaryCta: 'Jouer sans webcam',
      sections: [
        section('different-from-webcam', 'Différent du Magic par webcam', 'CommanderZone ne cherche pas à scanner des cartes physiques avec une caméra. La table vit dans le navigateur pour laisser le groupe se concentrer sur la partie.'),
        section('manual-not-automatic', 'Manuel, pas automatique', 'CommanderZone n’est pas un moteur de règles. Les joueurs restent responsables des triggers, de la pile, de la priorité et des décisions légales.'),
        section('when-spelltable-fits', 'Quand SpellTable est plus adapté', 'Utilisez SpellTable si vous voulez jouer avec des cartes physiques devant une caméra.'),
        section('when-commanderzone-fits', 'Quand CommanderZone est plus adapté', 'Utilisez CommanderZone si vous voulez une table numérique manuelle, des salles dans le navigateur et des parties liées aux decks.'),
      ],
      comparison: comparison('Magic par webcam ou table numérique', 'Comparez le type de configuration que votre groupe veut vraiment.', 'Besoin', 'Plus adapté', [
        row('Cartes physiques à la caméra', 'SpellTable', 'CommanderZone utilise une table dans le navigateur.'),
        row('Sans configuration webcam', 'CommanderZone', 'Le groupe utilise une table numérique manuelle.'),
        row('Scan de cartes', 'SpellTable', 'CommanderZone ne scanne pas les cartes.'),
        row('Décisions Commander manuelles', 'CommanderZone', 'Les joueurs restent responsables des règles et accords.'),
      ]),
      faq: [
        faq('CommanderZone est-il meilleur que SpellTable ?', 'Cela dépend. SpellTable est plus adapté à Magic papier par webcam. CommanderZone convient mieux si votre groupe veut une table numérique manuelle dans le navigateur.'),
        faq('Ai-je besoin d’une webcam ?', 'Non. CommanderZone ne nécessite pas de webcam pour la table numérique.'),
        faq('CommanderZone scanne-t-il les cartes ?', 'Non. CommanderZone n’est pas un scanner de cartes par webcam.'),
      ],
    },
    pt: {
      metaTitle: 'Alternativa ao SpellTable para Commander online | CommanderZone',
      metaDescription: 'Procurando uma alternativa ao SpellTable para Commander? CommanderZone oferece uma mesa digital manual no navegador, sem depender de webcam.',
      h1: 'Uma alternativa ao SpellTable para grupos digitais de Commander',
      heroSubtitle: 'SpellTable é ótimo para Magic físico por webcam. CommanderZone é diferente: seu grupo joga em uma mesa digital manual conectada a decks, salas, vida e dano de comandante.',
      primaryCta: 'Entrar e preparar partida',
      secondaryCta: 'Jogar sem webcam',
      sections: [
        section('different-from-webcam', 'Diferente do Magic por webcam', 'CommanderZone não tenta escanear cartas físicas pela câmera. A mesa fica no navegador para o grupo focar na partida de Commander.'),
        section('manual-not-automatic', 'Manual, não automático', 'CommanderZone não é um motor de regras. Os jogadores continuam responsáveis por triggers, pilha, prioridade e decisões legais.'),
        section('when-spelltable-fits', 'Quando SpellTable é melhor', 'Use SpellTable se você quer jogar com cartas físicas diante de uma câmera.'),
        section('when-commanderzone-fits', 'Quando CommanderZone é melhor', 'Use CommanderZone se você quer uma mesa digital manual, salas no navegador e partidas conectadas aos decks.'),
      ],
      comparison: comparison('Magic por webcam ou mesa digital', 'Compare o tipo de setup que seu grupo realmente quer.', 'Necessidade', 'Melhor opção', [
        row('Cartas físicas na câmera', 'SpellTable', 'CommanderZone usa uma mesa no navegador.'),
        row('Sem configurar webcam', 'CommanderZone', 'O grupo joga em uma mesa digital manual.'),
        row('Escaneamento de cartas', 'SpellTable', 'CommanderZone não escaneia cartas.'),
        row('Decisões manuais de Commander', 'CommanderZone', 'Os jogadores continuam responsáveis por regras e acordos.'),
      ]),
      faq: [
        faq('CommanderZone é melhor que SpellTable?', 'Depende. SpellTable é melhor para Magic físico por webcam. CommanderZone é melhor se seu grupo quer uma mesa digital manual no navegador.'),
        faq('Preciso de webcam?', 'Não. CommanderZone não exige webcam para a mesa digital.'),
        faq('CommanderZone escaneia cartas?', 'Não. CommanderZone não é um scanner de cartas por webcam.'),
      ],
    },
    it: {
      metaTitle: 'Alternativa a SpellTable per Commander online | CommanderZone',
      metaDescription: 'Cerchi un’alternativa a SpellTable per Commander? CommanderZone offre un tavolo digitale manuale nel browser, senza configurazione webcam.',
      h1: 'Un’alternativa a SpellTable per pod Commander digitali',
      heroSubtitle: 'SpellTable è ottimo per Magic cartaceo via webcam. CommanderZone è diverso: il tuo gruppo gioca su un tavolo digitale manuale collegato a mazzi, stanze, punti vita e danno da comandante.',
      primaryCta: 'Accedi e prepara la partita',
      secondaryCta: 'Giocare senza webcam',
      sections: [
        section('different-from-webcam', 'Diverso da Magic via webcam', 'CommanderZone non prova a scansionare carte fisiche con una camera. Il tavolo vive nel browser, così il gruppo può concentrarsi sulla partita Commander.'),
        section('manual-not-automatic', 'Manuale, non automatico', 'CommanderZone non è un motore di regole. I giocatori restano responsabili di trigger, pila, priorità e decisioni legali.'),
        section('when-spelltable-fits', 'Quando SpellTable è più adatto', 'Usa SpellTable se vuoi giocare con carte fisiche davanti a una webcam.'),
        section('when-commanderzone-fits', 'Quando CommanderZone è più adatto', 'Usa CommanderZone se vuoi un tavolo digitale manuale, stanze nel browser e partite collegate ai mazzi.'),
      ],
      comparison: comparison('Magic via webcam o tavolo digitale', 'Confronta il setup che il tuo gruppo vuole davvero.', 'Necessità', 'Più adatto', [
        row('Carte fisiche in camera', 'SpellTable', 'CommanderZone usa un tavolo nel browser.'),
        row('Senza configurare webcam', 'CommanderZone', 'Il gruppo usa un tavolo digitale manuale.'),
        row('Scansione carte', 'SpellTable', 'CommanderZone non scansiona carte.'),
        row('Decisioni Commander manuali', 'CommanderZone', 'I giocatori restano responsabili di regole e accordi.'),
      ]),
      faq: [
        faq('CommanderZone è meglio di SpellTable?', 'Dipende. SpellTable è più adatto a Magic cartaceo via webcam. CommanderZone è più adatto se il tuo gruppo vuole un tavolo digitale manuale nel browser.'),
        faq('Mi serve una webcam?', 'No. CommanderZone non richiede webcam per il tavolo digitale.'),
        faq('CommanderZone scansiona carte?', 'No. CommanderZone non è uno scanner di carte via webcam.'),
      ],
    },
  },
  playCommanderOnlineFree: {
    en: simpleCopy('Play Commander Online Free in Your Browser | CommanderZone', 'Play Commander online free with current CommanderZone features in your browser. Create rooms, use a manual table and keep limits clear.', 'Play Commander online free from your browser', 'CommanderZone is free to use for the features currently available. Play from the browser with no heavy download, while account-based app features may require signing in.', 'Sign in to play Commander', 'Open CommanderZone', [
      section('no-heavy-install', 'Start without a heavy install', 'CommanderZone runs in the browser, so your pod can start from a link instead of installing a large desktop client.'),
      section('room-and-pod', 'Create a room and invite your pod', 'Prepare a deck, create a Commander room and share the link with your group when everyone is ready.'),
      section('manual-decisions', 'Manual table, real Commander decisions', 'The table helps track life totals, commander damage and table state, but players remain responsible for rules and choices.'),
      section('honest-limits', 'Free features, honest limits', 'Current CommanderZone features are free to use. CommanderZone does not sell official Magic content, and persistent app features may require an account.'),
    ], [
      feature('Browser-based', 'Play from a modern browser without a heavy download.'),
      feature('Free current features', 'Available CommanderZone features are currently free to use.'),
      feature('No official card sales', 'CommanderZone does not sell official digital Magic cards.'),
      feature('Manual gameplay', 'Players keep control of Commander decisions.'),
    ], [
      faq('Is CommanderZone free?', 'CommanderZone is currently free to use for its available features.'),
      faq('Do I need to install anything?', 'No. CommanderZone runs in the browser.'),
      faq('Do I need to buy official digital cards?', 'No. CommanderZone does not sell official Magic content.'),
      faq('Does it enforce rules?', 'No. CommanderZone is a manual table, not an automatic rules engine.'),
    ]),
    es: simpleCopy('Jugar Commander online gratis en el navegador | CommanderZone', 'Juega Commander online gratis con las funciones actuales de CommanderZone. Crea salas, usa una mesa manual y mantén claros los límites.', 'Jugar Commander online gratis desde el navegador', 'CommanderZone es gratuito para las funciones disponibles actualmente. Juega desde el navegador sin descargas pesadas; algunas funciones persistentes pueden requerir cuenta.', 'Entrar y jugar Commander', 'Acceder a CommanderZone', [
      section('no-heavy-install', 'Empieza sin instalación pesada', 'CommanderZone funciona en el navegador para que tu pod pueda entrar desde un enlace sin instalar un cliente grande.'),
      section('room-and-pod', 'Crea una sala e invita a tu pod', 'Prepara un mazo, crea una sala Commander y comparte el enlace cuando el grupo esté listo.'),
      section('manual-decisions', 'Mesa manual, decisiones reales de Commander', 'La mesa ayuda con vidas, daño de comandante y estado de mesa, pero las reglas y decisiones siguen en manos de los jugadores.'),
      section('honest-limits', 'Funciones gratis, límites claros', 'Las funciones actuales de CommanderZone son gratuitas. CommanderZone no vende contenido oficial de Magic y algunas funciones persistentes pueden requerir cuenta.'),
    ], [
      feature('En navegador', 'Juega desde un navegador moderno sin descarga pesada.'),
      feature('Funciones actuales gratis', 'Las funciones disponibles actualmente son gratuitas.'),
      feature('Sin venta de cartas oficiales', 'CommanderZone no vende cartas digitales oficiales de Magic.'),
      feature('Juego manual', 'Los jugadores mantienen el control de las decisiones de Commander.'),
    ], [
      faq('¿CommanderZone es gratis?', 'CommanderZone es actualmente gratuito para las funciones disponibles.'),
      faq('¿Necesito instalar algo?', 'No. CommanderZone funciona desde el navegador.'),
      faq('¿Necesito comprar cartas digitales oficiales?', 'No. CommanderZone no vende contenido oficial de Magic.'),
      faq('¿Aplica reglas automáticamente?', 'No. CommanderZone es una mesa manual, no un motor automático de reglas.'),
    ]),
    de: simpleCopy('Commander kostenlos online im Browser spielen | CommanderZone', 'Spiele Commander mit aktuellen CommanderZone-Funktionen kostenlos online. Erstelle Räume, nutze einen manuellen Tisch und klare Grenzen.', 'Commander kostenlos online im Browser spielen', 'CommanderZone ist für die aktuell verfügbaren Funktionen kostenlos nutzbar. Spiele im Browser ohne große Installation; dauerhafte App-Funktionen können ein Konto erfordern.', 'Einloggen und Commander spielen', 'CommanderZone öffnen', [
      section('no-heavy-install', 'Ohne große Installation starten', 'CommanderZone läuft im Browser, damit deine Runde über einen Link starten kann, ohne einen großen Client zu installieren.'),
      section('room-and-pod', 'Raum erstellen und Runde einladen', 'Bereite ein Deck vor, erstelle einen Commander-Raum und teile den Link, wenn alle bereit sind.'),
      section('manual-decisions', 'Manueller Tisch, echte Commander-Entscheidungen', 'Der Tisch hilft bei Lebenspunkten, Commander-Schaden und Tischstatus, aber Spieler bleiben für Regeln und Entscheidungen verantwortlich.'),
      section('honest-limits', 'Kostenlose Funktionen, ehrliche Grenzen', 'Aktuelle CommanderZone-Funktionen sind kostenlos nutzbar. CommanderZone verkauft keine offiziellen Magic-Inhalte und dauerhafte Funktionen können ein Konto erfordern.'),
    ], [
      feature('Im Browser', 'Spiele ohne große App-Installation.'),
      feature('Aktuelle Funktionen kostenlos', 'Verfügbare CommanderZone-Funktionen sind derzeit kostenlos nutzbar.'),
      feature('Keine offiziellen Kartenverkäufe', 'CommanderZone verkauft keine offiziellen digitalen Magic-Karten.'),
      feature('Manuelles Spiel', 'Spieler behalten die Kontrolle über Commander-Entscheidungen.'),
    ], [
      faq('Ist CommanderZone kostenlos?', 'CommanderZone ist derzeit für die verfügbaren Funktionen kostenlos nutzbar.'),
      faq('Muss ich etwas installieren?', 'Nein. CommanderZone läuft im Browser.'),
      faq('Muss ich offizielle digitale Karten kaufen?', 'Nein. CommanderZone verkauft keine offiziellen Magic-Inhalte.'),
      faq('Wendet es Regeln automatisch an?', 'Nein. CommanderZone ist ein manueller Tisch, kein automatischer Regelmotor.'),
    ]),
    fr: simpleCopy('Jouer à Commander en ligne gratuitement | CommanderZone', 'Jouez à Commander en ligne gratuitement avec les fonctions actuelles de CommanderZone. Créez des salles et utilisez une table manuelle.', 'Jouer à Commander en ligne gratuitement depuis le navigateur', 'CommanderZone est gratuit pour les fonctions actuellement disponibles. Jouez depuis le navigateur sans téléchargement lourd; certaines fonctions persistantes peuvent demander un compte.', 'Se connecter pour jouer à Commander', 'Ouvrir CommanderZone', [
      section('no-heavy-install', 'Commencer sans installation lourde', 'CommanderZone fonctionne dans le navigateur, pour que votre groupe démarre depuis un lien sans installer un gros client.'),
      section('room-and-pod', 'Créer une salle et inviter votre groupe', 'Préparez un deck, créez une salle Commander et partagez le lien quand tout le monde est prêt.'),
      section('manual-decisions', 'Table manuelle, vraies décisions Commander', 'La table aide à suivre les points de vie, blessures de commandant et état de table, mais les joueurs restent responsables des règles.'),
      section('honest-limits', 'Fonctions gratuites, limites claires', 'Les fonctions actuelles de CommanderZone sont gratuites. CommanderZone ne vend pas de contenu Magic officiel et certaines fonctions persistantes peuvent demander un compte.'),
    ], [
      feature('Dans le navigateur', 'Jouez depuis un navigateur moderne sans téléchargement lourd.'),
      feature('Fonctions actuelles gratuites', 'Les fonctions disponibles sont actuellement gratuites.'),
      feature('Pas de vente de cartes officielles', 'CommanderZone ne vend pas de cartes Magic numériques officielles.'),
      feature('Jeu manuel', 'Les joueurs gardent le contrôle des décisions Commander.'),
    ], [
      faq('CommanderZone est-il gratuit ?', 'CommanderZone est actuellement gratuit pour ses fonctions disponibles.'),
      faq('Dois-je installer quelque chose ?', 'Non. CommanderZone fonctionne dans le navigateur.'),
      faq('Dois-je acheter des cartes numériques officielles ?', 'Non. CommanderZone ne vend pas de contenu Magic officiel.'),
      faq('Applique-t-il les règles ?', 'Non. CommanderZone est une table manuelle, pas un moteur de règles automatique.'),
    ]),
    pt: simpleCopy('Jogar Commander online grátis no navegador | CommanderZone', 'Jogue Commander online grátis com os recursos atuais do CommanderZone. Crie salas, use uma mesa manual e mantenha limites claros.', 'Jogar Commander online grátis pelo navegador', 'CommanderZone é gratuito para os recursos disponíveis atualmente. Jogue pelo navegador sem download pesado; recursos persistentes podem exigir conta.', 'Entrar para jogar Commander', 'Abrir CommanderZone', [
      section('no-heavy-install', 'Comece sem instalação pesada', 'CommanderZone funciona no navegador para que seu grupo comece por um link, sem instalar um cliente grande.'),
      section('room-and-pod', 'Crie uma sala e convide seu pod', 'Prepare um deck, crie uma sala Commander e compartilhe o link quando todos estiverem prontos.'),
      section('manual-decisions', 'Mesa manual, decisões reais de Commander', 'A mesa ajuda com vida, dano de comandante e estado da mesa, mas os jogadores continuam responsáveis por regras e escolhas.'),
      section('honest-limits', 'Recursos grátis, limites honestos', 'Os recursos atuais do CommanderZone são gratuitos. CommanderZone não vende conteúdo oficial de Magic e recursos persistentes podem exigir conta.'),
    ], [
      feature('No navegador', 'Jogue em um navegador moderno sem download pesado.'),
      feature('Recursos atuais grátis', 'Os recursos disponíveis atualmente são gratuitos.'),
      feature('Sem venda de cartas oficiais', 'CommanderZone não vende cartas digitais oficiais de Magic.'),
      feature('Jogo manual', 'Os jogadores mantêm controle das decisões de Commander.'),
    ], [
      faq('CommanderZone é grátis?', 'CommanderZone é atualmente gratuito para os recursos disponíveis.'),
      faq('Preciso instalar algo?', 'Não. CommanderZone funciona no navegador.'),
      faq('Preciso comprar cartas digitais oficiais?', 'Não. CommanderZone não vende conteúdo oficial de Magic.'),
      faq('Ele aplica regras?', 'Não. CommanderZone é uma mesa manual, não um motor automático de regras.'),
    ]),
    it: simpleCopy('Giocare Commander online gratis nel browser | CommanderZone', 'Gioca Commander online gratis con le funzioni attuali di CommanderZone. Crea stanze, usa un tavolo manuale e mantieni chiari i limiti.', 'Giocare Commander online gratis dal browser', 'CommanderZone è gratuito per le funzioni attualmente disponibili. Gioca dal browser senza download pesanti; alcune funzioni persistenti possono richiedere un account.', 'Accedi per giocare a Commander', 'Apri CommanderZone', [
      section('no-heavy-install', 'Inizia senza installazione pesante', 'CommanderZone funziona nel browser, così il tuo pod può partire da un link senza installare un client grande.'),
      section('room-and-pod', 'Crea una stanza e invita il pod', 'Prepara un mazzo, crea una stanza Commander e condividi il link quando il gruppo è pronto.'),
      section('manual-decisions', 'Tavolo manuale, vere decisioni Commander', 'Il tavolo aiuta con punti vita, danno da comandante e stato del tavolo, ma regole e scelte restano ai giocatori.'),
      section('honest-limits', 'Funzioni gratis, limiti chiari', 'Le funzioni attuali di CommanderZone sono gratuite. CommanderZone non vende contenuti Magic ufficiali e alcune funzioni persistenti possono richiedere un account.'),
    ], [
      feature('Nel browser', 'Gioca da un browser moderno senza download pesanti.'),
      feature('Funzioni attuali gratis', 'Le funzioni disponibili sono attualmente gratuite.'),
      feature('Nessuna vendita di carte ufficiali', 'CommanderZone non vende carte digitali ufficiali di Magic.'),
      feature('Gioco manuale', 'I giocatori mantengono il controllo delle decisioni Commander.'),
    ], [
      faq('CommanderZone è gratis?', 'CommanderZone è attualmente gratuito per le funzioni disponibili.'),
      faq('Devo installare qualcosa?', 'No. CommanderZone funziona dal browser.'),
      faq('Devo comprare carte digitali ufficiali?', 'No. CommanderZone non vende contenuti Magic ufficiali.'),
      faq('Applica le regole?', 'No. CommanderZone è un tavolo manuale, non un motore automatico di regole.'),
    ]),
  },
  playCommanderWithoutWebcam: {
    en: simpleCopy('Play Commander Online Without Webcam | CommanderZone', 'Play Commander online without a webcam setup. CommanderZone gives your pod a manual browser table for decks, rooms and Commander tracking.', 'Play Commander online without a webcam setup', 'Use a manual digital table in the browser instead of pointing cameras at paper cards. Your pod keeps Commander decisions manual and visible.', 'Sign in and prepare game', 'See SpellTable alternative', [
      section('no-camera', 'No camera angles, no paper table setup', 'You do not need to position a webcam, adjust lighting or keep a paper battlefield visible to everyone.'),
      section('browser-table', 'The table lives in the browser', 'CommanderZone gives each player access to a shared digital table connected to rooms, decks, life totals and commander damage.'),
      section('still-manual', 'Still manual like real Commander', 'CommanderZone does not automate the stack, priority or legal play. Your group keeps control of the game.'),
      section('remote-pods', 'Good for remote pods', 'It works well for groups that want to play Commander together online without camera hardware or paper table overhead.'),
    ], [
      feature('No webcam required', 'Play on a browser table instead of camera video.'),
      feature('Room-based flow', 'Create a room and invite your pod.'),
      feature('Commander tracking', 'Keep life totals and commander damage visible.'),
      feature('Manual control', 'Players make the real game decisions.'),
    ], [
      faq('Can I play Commander online without a webcam?', 'Yes. CommanderZone uses a manual digital table in the browser.'),
      faq('Does CommanderZone replace paper cards on camera?', 'It is a different approach: a browser table instead of webcam paper Magic.'),
      faq('Does CommanderZone automate rules?', 'No. Players remain responsible for rules, stack, priority and legal choices.'),
    ]),
    es: simpleCopy('Jugar Commander online sin webcam | CommanderZone', 'Juega Commander online sin configurar webcam. CommanderZone ofrece una mesa manual en navegador para mazos, salas y seguimiento Commander.', 'Jugar Commander online sin configurar webcam', 'Usa una mesa digital manual en el navegador en lugar de apuntar cámaras a cartas físicas. Tu pod mantiene las decisiones de Commander visibles y manuales.', 'Entrar y preparar partida', 'Ver alternativa a SpellTable', [
      section('no-camera', 'Sin ángulos de cámara ni setup físico', 'No necesitas colocar una webcam, ajustar luces ni mantener visible una mesa de papel para todos.'),
      section('browser-table', 'La mesa vive en el navegador', 'CommanderZone da a cada jugador una mesa digital compartida conectada a salas, mazos, vidas y daño de comandante.'),
      section('still-manual', 'Sigue siendo manual como Commander real', 'CommanderZone no automatiza pila, prioridad ni jugadas legales. El grupo mantiene el control de la partida.'),
      section('remote-pods', 'Útil para pods remotos', 'Funciona bien para grupos que quieren jugar Commander online sin hardware de cámara ni setup físico.'),
    ], [
      feature('Sin webcam', 'Juega en una mesa de navegador en lugar de vídeo de cámara.'),
      feature('Flujo por salas', 'Crea una sala e invita a tu pod.'),
      feature('Seguimiento Commander', 'Mantén visibles vidas y daño de comandante.'),
      feature('Control manual', 'Los jugadores toman las decisiones reales de partida.'),
    ], [
      faq('¿Puedo jugar Commander online sin webcam?', 'Sí. CommanderZone usa una mesa digital manual en el navegador.'),
      faq('¿CommanderZone sustituye a cartas físicas por cámara?', 'Es un enfoque diferente: mesa en navegador en lugar de Magic físico por webcam.'),
      faq('¿CommanderZone automatiza reglas?', 'No. Los jugadores siguen siendo responsables de reglas, pila, prioridad y decisiones legales.'),
    ]),
    de: simpleCopy('Commander online ohne Webcam spielen | CommanderZone', 'Spiele Commander online ohne Webcam-Setup. CommanderZone bietet deiner Runde einen manuellen Browser-Tisch für Decks, Räume und Commander-Tracking.', 'Commander online ohne Webcam-Setup spielen', 'Nutze einen manuellen digitalen Tisch im Browser, statt Kameras auf Papierkarten zu richten. Deine Runde behält Commander-Entscheidungen selbst in der Hand.', 'Einloggen und Partie vorbereiten', 'SpellTable Alternative ansehen', [
      section('no-camera', 'Keine Kamerawinkel, kein Paper-Setup', 'Du musst keine Webcam ausrichten, Licht anpassen oder ein Papier-Spielfeld sichtbar halten.'),
      section('browser-table', 'Der Tisch läuft im Browser', 'CommanderZone gibt jedem Spieler Zugang zu einem gemeinsamen digitalen Tisch mit Räumen, Decks, Lebenspunkten und Commander-Schaden.'),
      section('still-manual', 'Weiterhin manuell wie echtes Commander', 'CommanderZone automatisiert weder Stack noch Priorität oder legale Spielzüge. Die Gruppe behält die Kontrolle.'),
      section('remote-pods', 'Gut für entfernte Runden', 'Es passt für Gruppen, die online Commander spielen wollen, ohne Kamera-Hardware oder Papier-Setup.'),
    ], [
      feature('Keine Webcam nötig', 'Spiele an einem Browser-Tisch statt per Kameravideo.'),
      feature('Räume und Einladungen', 'Erstelle einen Raum und lade deine Runde ein.'),
      feature('Commander-Tracking', 'Halte Lebenspunkte und Commander-Schaden sichtbar.'),
      feature('Manuelle Kontrolle', 'Spieler treffen die echten Spielentscheidungen.'),
    ], [
      faq('Kann ich Commander online ohne Webcam spielen?', 'Ja. CommanderZone nutzt einen manuellen digitalen Tisch im Browser.'),
      faq('Ersetzt CommanderZone Papierkarten vor der Kamera?', 'Es ist ein anderer Ansatz: Browser-Tisch statt Paper Magic per Webcam.'),
      faq('Automatisiert CommanderZone Regeln?', 'Nein. Spieler bleiben für Regeln, Stack, Priorität und legale Entscheidungen verantwortlich.'),
    ]),
    fr: simpleCopy('Jouer à Commander en ligne sans webcam | CommanderZone', 'Jouez à Commander en ligne sans configuration webcam. CommanderZone propose une table manuelle dans le navigateur pour decks et salles.', 'Jouer à Commander en ligne sans configuration webcam', 'Utilisez une table numérique manuelle dans le navigateur au lieu de pointer des caméras vers des cartes papier. Votre groupe garde les décisions Commander en main.', 'Se connecter et préparer une partie', 'Voir l’alternative à SpellTable', [
      section('no-camera', 'Pas d’angles caméra ni de table papier à installer', 'Vous n’avez pas besoin de placer une webcam, régler la lumière ou garder un champ de bataille papier visible.'),
      section('browser-table', 'La table vit dans le navigateur', 'CommanderZone donne à chaque joueur une table numérique partagée reliée aux salles, decks, points de vie et blessures de commandant.'),
      section('still-manual', 'Toujours manuel comme Commander réel', 'CommanderZone n’automatise pas la pile, la priorité ni les actions légales. Le groupe garde le contrôle.'),
      section('remote-pods', 'Adapté aux groupes à distance', 'Cela convient aux groupes qui veulent jouer à Commander en ligne sans caméra ni installation de table papier.'),
    ], [
      feature('Pas de webcam requise', 'Jouez sur une table de navigateur plutôt qu’en vidéo caméra.'),
      feature('Salles et invitations', 'Créez une salle et invitez votre groupe.'),
      feature('Suivi Commander', 'Gardez points de vie et blessures de commandant visibles.'),
      feature('Contrôle manuel', 'Les joueurs prennent les vraies décisions de partie.'),
    ], [
      faq('Puis-je jouer à Commander en ligne sans webcam ?', 'Oui. CommanderZone utilise une table numérique manuelle dans le navigateur.'),
      faq('CommanderZone remplace-t-il les cartes papier à la caméra ?', 'C’est une approche différente : une table dans le navigateur plutôt que Magic papier par webcam.'),
      faq('CommanderZone automatise-t-il les règles ?', 'Non. Les joueurs restent responsables des règles, de la pile, de la priorité et des décisions légales.'),
    ]),
    pt: simpleCopy('Jogar Commander online sem webcam | CommanderZone', 'Jogue Commander online sem configurar webcam. CommanderZone oferece uma mesa manual no navegador para decks, salas e acompanhamento Commander.', 'Jogar Commander online sem configurar webcam', 'Use uma mesa digital manual no navegador em vez de apontar câmeras para cartas físicas. Seu grupo mantém as decisões de Commander manuais e visíveis.', 'Entrar e preparar partida', 'Ver alternativa ao SpellTable', [
      section('no-camera', 'Sem ângulos de câmera nem setup físico', 'Você não precisa posicionar webcam, ajustar luz ou manter uma mesa de papel visível para todos.'),
      section('browser-table', 'A mesa fica no navegador', 'CommanderZone dá a cada jogador acesso a uma mesa digital compartilhada com salas, decks, vida e dano de comandante.'),
      section('still-manual', 'Continua manual como Commander real', 'CommanderZone não automatiza pilha, prioridade nem jogadas legais. O grupo mantém controle da partida.'),
      section('remote-pods', 'Bom para pods remotos', 'Funciona bem para grupos que querem jogar Commander online sem hardware de câmera ou setup físico.'),
    ], [
      feature('Sem webcam', 'Jogue em uma mesa de navegador em vez de vídeo por câmera.'),
      feature('Fluxo por salas', 'Crie uma sala e convide seu pod.'),
      feature('Acompanhamento Commander', 'Mantenha vida e dano de comandante visíveis.'),
      feature('Controle manual', 'Os jogadores tomam as decisões reais da partida.'),
    ], [
      faq('Posso jogar Commander online sem webcam?', 'Sim. CommanderZone usa uma mesa digital manual no navegador.'),
      faq('CommanderZone substitui cartas físicas na câmera?', 'É uma abordagem diferente: mesa no navegador em vez de Magic físico por webcam.'),
      faq('CommanderZone automatiza regras?', 'Não. Os jogadores continuam responsáveis por regras, pilha, prioridade e decisões legais.'),
    ]),
    it: simpleCopy('Giocare Commander online senza webcam | CommanderZone', 'Gioca Commander online senza configurare webcam. CommanderZone offre un tavolo manuale nel browser per mazzi, stanze e monitoraggio Commander.', 'Giocare Commander online senza configurare una webcam', 'Usa un tavolo digitale manuale nel browser invece di puntare camere sulle carte fisiche. Il tuo pod mantiene manuali e visibili le decisioni Commander.', 'Accedi e prepara la partita', 'Vedi alternativa a SpellTable', [
      section('no-camera', 'Niente angoli camera, niente setup fisico', 'Non devi posizionare una webcam, regolare luci o tenere visibile un campo di battaglia cartaceo.'),
      section('browser-table', 'Il tavolo vive nel browser', 'CommanderZone dà a ogni giocatore accesso a un tavolo digitale condiviso con stanze, mazzi, punti vita e danno da comandante.'),
      section('still-manual', 'Sempre manuale come Commander reale', 'CommanderZone non automatizza pila, priorità o giocate legali. Il gruppo mantiene il controllo.'),
      section('remote-pods', 'Utile per pod remoti', 'Funziona bene per gruppi che vogliono giocare Commander online senza hardware camera o setup fisico.'),
    ], [
      feature('Senza webcam', 'Gioca su un tavolo nel browser invece che via video camera.'),
      feature('Flusso con stanze', 'Crea una stanza e invita il tuo pod.'),
      feature('Monitoraggio Commander', 'Mantieni visibili punti vita e danno da comandante.'),
      feature('Controllo manuale', 'I giocatori prendono le vere decisioni di partita.'),
    ], [
      faq('Posso giocare Commander online senza webcam?', 'Sì. CommanderZone usa un tavolo digitale manuale nel browser.'),
      faq('CommanderZone sostituisce le carte fisiche in camera?', 'È un approccio diverso: tavolo nel browser invece di Magic cartaceo via webcam.'),
      faq('CommanderZone automatizza le regole?', 'No. I giocatori restano responsabili di regole, pila, priorità e decisioni legali.'),
    ]),
  },
  playEdhOnline: {
    en: simpleCopy('Play EDH Online with Your Commander Pod | CommanderZone', 'Play EDH online with your Commander pod using a manual browser table for rooms, decks, life totals and commander damage.', 'Play EDH online with a manual Commander table', 'EDH is the community name many players still use for Commander. CommanderZone gives your group a manual digital table for playing together online.', 'Sign in to play EDH', 'Play Commander online', [
      section('edh-name', 'EDH and Commander mean the same table need', 'EDH is the community name many players still use for Commander. The game still needs clear life totals, commander damage and table state.'),
      section('browser-room', 'Create a room for your pod', 'Prepare your deck, open a room and invite the players who are joining the game.'),
      section('manual-table', 'Manual table for social games', 'CommanderZone does not automate the game. Players handle triggers, stack, priority and legal decisions.'),
      section('long-games', 'Built for multiplayer sessions', 'EDH games can be long and political, so the table keeps key information visible while the pod plays.'),
    ], [
      feature('EDH-friendly flow', 'Prepare decks, rooms and multiplayer tables.'),
      feature('Commander damage', 'Track the format-specific damage that matters.'),
      feature('Browser table', 'Play online without a heavy app install.'),
      feature('Manual decisions', 'Players keep control of the game.'),
    ], [
      faq('Is EDH the same as Commander?', 'EDH is the community name many players still use for Commander.'),
      faq('Can I play EDH online in CommanderZone?', 'Yes. CommanderZone is built for manual Commander pods online.'),
      faq('Does CommanderZone enforce EDH rules?', 'No. It is a manual table, so players remain responsible for rules and choices.'),
    ]),
    es: simpleCopy('Jugar EDH online con tu grupo de Commander | CommanderZone', 'Juega EDH online con tu grupo usando una mesa manual en navegador para salas, mazos, vidas y daño de comandante.', 'Jugar EDH online con una mesa manual de Commander', 'EDH es el nombre comunitario que muchos jugadores siguen usando para Commander. CommanderZone da a tu grupo una mesa digital manual para jugar online.', 'Entrar y jugar EDH', 'Jugar Commander online', [
      section('edh-name', 'EDH y Commander necesitan una mesa clara', 'EDH es el nombre comunitario que muchos jugadores siguen usando para Commander. La partida sigue necesitando vidas, daño de comandante y estado de mesa claros.'),
      section('browser-room', 'Crea una sala para tu pod', 'Prepara tu mazo, abre una sala e invita a los jugadores que van a entrar en partida.'),
      section('manual-table', 'Mesa manual para partidas sociales', 'CommanderZone no automatiza la partida. Los jugadores gestionan triggers, pila, prioridad y decisiones legales.'),
      section('long-games', 'Pensado para sesiones multijugador', 'Las partidas EDH pueden ser largas y políticas, así que la mesa mantiene visible la información importante.'),
    ], [
      feature('Flujo para EDH', 'Prepara mazos, salas y mesas multijugador.'),
      feature('Daño de comandante', 'Controla el daño específico del formato.'),
      feature('Mesa en navegador', 'Juega online sin instalación pesada.'),
      feature('Decisiones manuales', 'Los jugadores mantienen el control de la partida.'),
    ], [
      faq('¿EDH es lo mismo que Commander?', 'EDH es el nombre comunitario que muchos jugadores siguen usando para Commander.'),
      faq('¿Puedo jugar EDH online en CommanderZone?', 'Sí. CommanderZone está pensado para pods manuales de Commander online.'),
      faq('¿CommanderZone aplica reglas de EDH?', 'No. Es una mesa manual, así que los jugadores siguen siendo responsables de reglas y decisiones.'),
    ]),
    de: simpleCopy('EDH online mit deiner Commander-Runde spielen | CommanderZone', 'Spiele EDH online mit deiner Commander-Runde an einem manuellen Browser-Tisch für Räume, Decks, Lebenspunkte und Commander-Schaden.', 'EDH online an einem manuellen Commander-Tisch spielen', 'EDH ist der Community-Name, den viele Spieler weiterhin für Commander verwenden. CommanderZone gibt deiner Runde einen manuellen digitalen Tisch für Online-Partien.', 'Einloggen und EDH spielen', 'Commander online spielen', [
      section('edh-name', 'EDH und Commander brauchen denselben klaren Tisch', 'EDH ist der Community-Name, den viele Spieler weiterhin für Commander verwenden. Die Partie braucht weiterhin Lebenspunkte, Commander-Schaden und Tischstatus.'),
      section('browser-room', 'Erstelle einen Raum für deine Runde', 'Bereite dein Deck vor, öffne einen Raum und lade die Spieler ein, die mitspielen.'),
      section('manual-table', 'Manueller Tisch für soziale Partien', 'CommanderZone automatisiert die Partie nicht. Spieler verwalten Trigger, Stack, Priorität und legale Entscheidungen.'),
      section('long-games', 'Für Multiplayer-Sessions gedacht', 'EDH-Partien können lang und politisch sein, deshalb hält der Tisch wichtige Informationen sichtbar.'),
    ], [
      feature('EDH-tauglicher Ablauf', 'Bereite Decks, Räume und Multiplayer-Tische vor.'),
      feature('Commander-Schaden', 'Verfolge den formatspezifischen Schaden.'),
      feature('Browser-Tisch', 'Spiele online ohne große Installation.'),
      feature('Manuelle Entscheidungen', 'Spieler behalten die Kontrolle.'),
    ], [
      faq('Ist EDH dasselbe wie Commander?', 'EDH ist der Community-Name, den viele Spieler weiterhin für Commander verwenden.'),
      faq('Kann ich EDH online in CommanderZone spielen?', 'Ja. CommanderZone ist für manuelle Commander-Runden online gedacht.'),
      faq('Wendet CommanderZone EDH-Regeln an?', 'Nein. Es ist ein manueller Tisch, daher bleiben Spieler für Regeln und Entscheidungen verantwortlich.'),
    ]),
    fr: simpleCopy('Jouer à EDH en ligne avec votre groupe Commander | CommanderZone', 'Jouez à EDH en ligne avec votre groupe sur une table manuelle dans le navigateur pour salles, decks, vie et blessures de commandant.', 'Jouer à EDH en ligne sur une table Commander manuelle', 'EDH est le nom communautaire que de nombreux joueurs utilisent encore pour Commander. CommanderZone donne à votre groupe une table numérique manuelle pour jouer en ligne.', 'Se connecter pour jouer à EDH', 'Jouer à Commander en ligne', [
      section('edh-name', 'EDH et Commander demandent une table claire', 'EDH est le nom communautaire que de nombreux joueurs utilisent encore pour Commander. La partie a toujours besoin de points de vie, blessures de commandant et état de table clairs.'),
      section('browser-room', 'Créer une salle pour votre groupe', 'Préparez votre deck, ouvrez une salle et invitez les joueurs qui participent.'),
      section('manual-table', 'Table manuelle pour parties sociales', 'CommanderZone n’automatise pas la partie. Les joueurs gèrent triggers, pile, priorité et décisions légales.'),
      section('long-games', 'Pensé pour les sessions multijoueurs', 'Les parties EDH peuvent être longues et politiques, donc la table garde les informations importantes visibles.'),
    ], [
      feature('Flux adapté à EDH', 'Préparez decks, salles et tables multijoueurs.'),
      feature('Blessures de commandant', 'Suivez les dégâts spécifiques au format.'),
      feature('Table dans le navigateur', 'Jouez en ligne sans installation lourde.'),
      feature('Décisions manuelles', 'Les joueurs gardent le contrôle.'),
    ], [
      faq('EDH est-il la même chose que Commander ?', 'EDH est le nom communautaire que de nombreux joueurs utilisent encore pour Commander.'),
      faq('Puis-je jouer à EDH en ligne dans CommanderZone ?', 'Oui. CommanderZone est conçu pour des groupes Commander manuels en ligne.'),
      faq('CommanderZone applique-t-il les règles EDH ?', 'Non. C’est une table manuelle, donc les joueurs restent responsables des règles et décisions.'),
    ]),
    pt: simpleCopy('Jogar EDH online com seu grupo de Commander | CommanderZone', 'Jogue EDH online com seu grupo em uma mesa manual no navegador para salas, decks, vida e dano de comandante.', 'Jogar EDH online em uma mesa manual de Commander', 'EDH é o nome comunitário que muitos jogadores ainda usam para Commander. CommanderZone dá ao seu grupo uma mesa digital manual para jogar online.', 'Entrar para jogar EDH', 'Jogar Commander online', [
      section('edh-name', 'EDH e Commander precisam da mesma mesa clara', 'EDH é o nome comunitário que muitos jogadores ainda usam para Commander. A partida ainda precisa de vida, dano de comandante e estado da mesa claros.'),
      section('browser-room', 'Crie uma sala para seu pod', 'Prepare seu deck, abra uma sala e convide os jogadores que vão participar.'),
      section('manual-table', 'Mesa manual para partidas sociais', 'CommanderZone não automatiza a partida. Os jogadores gerenciam triggers, pilha, prioridade e decisões legais.'),
      section('long-games', 'Feito para sessões multiplayer', 'Partidas EDH podem ser longas e políticas, então a mesa mantém informações importantes visíveis.'),
    ], [
      feature('Fluxo para EDH', 'Prepare decks, salas e mesas multiplayer.'),
      feature('Dano de comandante', 'Acompanhe o dano específico do formato.'),
      feature('Mesa no navegador', 'Jogue online sem instalação pesada.'),
      feature('Decisões manuais', 'Os jogadores mantêm o controle.'),
    ], [
      faq('EDH é o mesmo que Commander?', 'EDH é o nome comunitário que muitos jogadores ainda usam para Commander.'),
      faq('Posso jogar EDH online no CommanderZone?', 'Sim. CommanderZone foi feito para pods manuais de Commander online.'),
      faq('CommanderZone aplica regras de EDH?', 'Não. É uma mesa manual, então os jogadores continuam responsáveis por regras e decisões.'),
    ]),
    it: simpleCopy('Giocare EDH online con il tuo gruppo Commander | CommanderZone', 'Gioca EDH online con il tuo gruppo su un tavolo manuale nel browser per stanze, mazzi, punti vita e danno da comandante.', 'Giocare EDH online con un tavolo Commander manuale', 'EDH è il nome usato dalla community che molti giocatori usano ancora per Commander. CommanderZone offre al gruppo un tavolo digitale manuale per giocare online.', 'Accedi per giocare a EDH', 'Giocare Commander online', [
      section('edh-name', 'EDH e Commander hanno bisogno dello stesso tavolo chiaro', 'EDH è il nome usato dalla community che molti giocatori usano ancora per Commander. La partita ha comunque bisogno di punti vita, danno da comandante e stato del tavolo chiari.'),
      section('browser-room', 'Crea una stanza per il pod', 'Prepara il mazzo, apri una stanza e invita i giocatori che partecipano.'),
      section('manual-table', 'Tavolo manuale per partite sociali', 'CommanderZone non automatizza la partita. I giocatori gestiscono trigger, pila, priorità e decisioni legali.'),
      section('long-games', 'Pensato per sessioni multiplayer', 'Le partite EDH possono essere lunghe e politiche, quindi il tavolo mantiene visibili le informazioni importanti.'),
    ], [
      feature('Flusso per EDH', 'Prepara mazzi, stanze e tavoli multiplayer.'),
      feature('Danno da comandante', 'Segui il danno specifico del formato.'),
      feature('Tavolo nel browser', 'Gioca online senza installazione pesante.'),
      feature('Decisioni manuali', 'I giocatori mantengono il controllo.'),
    ], [
      faq('EDH è lo stesso di Commander?', 'EDH è il nome usato dalla community che molti giocatori usano ancora per Commander.'),
      faq('Posso giocare EDH online in CommanderZone?', 'Sì. CommanderZone è pensato per pod Commander manuali online.'),
      faq('CommanderZone applica le regole EDH?', 'No. È un tavolo manuale, quindi i giocatori restano responsabili di regole e decisioni.'),
    ]),
  },
  commanderSimulator: {
    en: simpleCopy('MTG Commander Simulator for Manual Online Pods | CommanderZone', 'Use CommanderZone as a manual MTG Commander simulator for online pods. Track table state, life totals and commander damage in the browser.', 'A manual MTG Commander simulator for online pods', 'CommanderZone is a manual simulator and digital table for Commander pods. It helps track table state, life totals and commander damage without becoming a full rules simulator.', 'Open the manual simulator', 'See free Commander play', [
      section('manual-simulator', 'Manual simulator, not a full rules simulator', 'CommanderZone does not resolve the stack, priority or legal play for you. Players stay responsible for Commander decisions.'),
      section('digital-table', 'Digital table state in the browser', 'Your pod can keep battlefield information, life totals and commander damage visible in one shared place.'),
      section('rooms-and-decks', 'Rooms connected to decks', 'Prepare decks, create rooms and move into a manual Commander table when the group is ready.'),
      section('paper-support', 'Useful online or around a physical table', 'The same focus on table state also helps when your group wants a life counter and commander damage tracker for paper games.'),
    ], [
      feature('Manual simulator', 'Models table state without automating rules.'),
      feature('Life totals', 'Keep player life totals visible.'),
      feature('Commander damage', 'Track damage between commanders and players.'),
      feature('Browser-based', 'Use the table from a modern browser.'),
    ], [
      faq('Is CommanderZone a full MTG rules simulator?', 'No. CommanderZone is a manual simulator and digital table, not a full rules simulator.'),
      faq('What does the simulator track?', 'It helps track table state, life totals, commander damage and multiplayer information.'),
      faq('Does CommanderZone automate gameplay?', 'No. Players handle rules, triggers, priority, stack and legal decisions.'),
    ]),
    es: simpleCopy('Simulador Commander MTG para partidas online manuales | CommanderZone', 'Usa CommanderZone como simulador Commander MTG manual para pods online. Controla estado de mesa, vidas y daño de comandante en navegador.', 'Un simulador Commander MTG manual para pods online', 'CommanderZone es un simulador manual y mesa digital para pods Commander. Ayuda a controlar estado de mesa, vidas y daño de comandante sin convertirse en motor completo de reglas.', 'Entrar al simulador manual', 'Ver Commander gratis', [
      section('manual-simulator', 'Simulador manual, no simulador completo de reglas', 'CommanderZone no resuelve pila, prioridad ni jugadas legales por ti. Los jugadores siguen siendo responsables de las decisiones de Commander.'),
      section('digital-table', 'Estado de mesa digital en el navegador', 'Tu pod puede mantener visibles battlefield, vidas y daño de comandante en un lugar compartido.'),
      section('rooms-and-decks', 'Salas conectadas a mazos', 'Prepara mazos, crea salas y pasa a una mesa manual de Commander cuando el grupo esté listo.'),
      section('paper-support', 'Útil online o en mesa física', 'El mismo foco en estado de mesa ayuda cuando el grupo quiere contador de vidas y daño de comandante para partidas físicas.'),
    ], [
      feature('Simulador manual', 'Modela estado de mesa sin automatizar reglas.'),
      feature('Vidas', 'Mantén visibles los totales de vida.'),
      feature('Daño de comandante', 'Controla daño entre comandantes y jugadores.'),
      feature('En navegador', 'Usa la mesa desde un navegador moderno.'),
    ], [
      faq('¿CommanderZone es un simulador completo de reglas MTG?', 'No. CommanderZone es un simulador manual y mesa digital, no un simulador completo de reglas.'),
      faq('¿Qué controla el simulador?', 'Ayuda a controlar estado de mesa, vidas, daño de comandante e información multijugador.'),
      faq('¿CommanderZone automatiza la partida?', 'No. Los jugadores gestionan reglas, triggers, prioridad, pila y decisiones legales.'),
    ]),
    de: simpleCopy('MTG Commander Simulator für manuelle Online-Runden | CommanderZone', 'Nutze CommanderZone als manuellen MTG Commander Simulator für Online-Runden. Verfolge Tischstatus, Lebenspunkte und Commander-Schaden im Browser.', 'Ein manueller MTG Commander Simulator für Online-Runden', 'CommanderZone ist ein manueller Simulator und digitaler Tisch für Commander-Runden. Er hilft bei Tischstatus, Lebenspunkten und Commander-Schaden, ohne ein vollständiger Regel-Simulator zu sein.', 'Manuellen Simulator öffnen', 'Commander kostenlos ansehen', [
      section('manual-simulator', 'Manueller Simulator, kein vollständiger Regel-Simulator', 'CommanderZone löst Stack, Priorität oder legale Spielzüge nicht für dich. Spieler bleiben für Commander-Entscheidungen verantwortlich.'),
      section('digital-table', 'Digitaler Tischstatus im Browser', 'Deine Runde kann Battlefield-Informationen, Lebenspunkte und Commander-Schaden an einem gemeinsamen Ort sichtbar halten.'),
      section('rooms-and-decks', 'Räume mit Decks verbunden', 'Bereite Decks vor, erstelle Räume und wechsle an einen manuellen Commander-Tisch, wenn die Gruppe bereit ist.'),
      section('paper-support', 'Online oder am physischen Tisch nützlich', 'Der Fokus auf Tischstatus hilft auch, wenn deine Gruppe Lebenspunkte und Commander-Schaden bei Papierpartien verfolgen möchte.'),
    ], [
      feature('Manueller Simulator', 'Bildet Tischstatus ab, ohne Regeln zu automatisieren.'),
      feature('Lebenspunkte', 'Halte Lebenspunkte sichtbar.'),
      feature('Commander-Schaden', 'Verfolge Schaden zwischen Commandern und Spielern.'),
      feature('Im Browser', 'Nutze den Tisch in einem modernen Browser.'),
    ], [
      faq('Ist CommanderZone ein vollständiger MTG-Regel-Simulator?', 'Nein. CommanderZone ist ein manueller Simulator und digitaler Tisch, kein vollständiger Regel-Simulator.'),
      faq('Was verfolgt der Simulator?', 'Er hilft bei Tischstatus, Lebenspunkten, Commander-Schaden und Multiplayer-Informationen.'),
      faq('Automatisiert CommanderZone die Partie?', 'Nein. Spieler verwalten Regeln, Trigger, Priorität, Stack und legale Entscheidungen.'),
    ]),
    fr: simpleCopy('Simulateur Commander MTG pour parties en ligne manuelles | CommanderZone', 'Utilisez CommanderZone comme simulateur Commander MTG manuel pour groupes en ligne. Suivez état de table, points de vie et blessures de commandant.', 'Un simulateur Commander MTG manuel pour groupes en ligne', 'CommanderZone est un simulateur manuel et une table numérique pour groupes Commander. Il aide à suivre état de table, points de vie et blessures de commandant sans devenir un moteur complet de règles.', 'Ouvrir le simulateur manuel', 'Voir Commander gratuit', [
      section('manual-simulator', 'Simulateur manuel, pas simulateur complet de règles', 'CommanderZone ne résout pas la pile, la priorité ni les actions légales pour vous. Les joueurs restent responsables des décisions Commander.'),
      section('digital-table', 'État de table numérique dans le navigateur', 'Votre groupe peut garder les informations de champ de bataille, points de vie et blessures de commandant visibles au même endroit.'),
      section('rooms-and-decks', 'Salles reliées aux decks', 'Préparez des decks, créez des salles et passez sur une table Commander manuelle quand le groupe est prêt.'),
      section('paper-support', 'Utile en ligne ou autour d’une table physique', 'Le même suivi de table aide aussi quand le groupe veut un compteur de vie et blessures de commandant pour le papier.'),
    ], [
      feature('Simulateur manuel', 'Modélise l’état de table sans automatiser les règles.'),
      feature('Points de vie', 'Gardez les totaux de vie visibles.'),
      feature('Blessures de commandant', 'Suivez les blessures entre commandants et joueurs.'),
      feature('Dans le navigateur', 'Utilisez la table depuis un navigateur moderne.'),
    ], [
      faq('CommanderZone est-il un simulateur complet de règles MTG ?', 'Non. CommanderZone est un simulateur manuel et une table numérique, pas un simulateur complet de règles.'),
      faq('Que suit le simulateur ?', 'Il aide à suivre l’état de table, les points de vie, les blessures de commandant et les informations multijoueurs.'),
      faq('CommanderZone automatise-t-il la partie ?', 'Non. Les joueurs gèrent règles, triggers, priorité, pile et décisions légales.'),
    ]),
    pt: simpleCopy('Simulador Commander MTG para partidas online manuais | CommanderZone', 'Use CommanderZone como simulador Commander MTG manual para grupos online. Acompanhe estado da mesa, vida e dano de comandante no navegador.', 'Um simulador Commander MTG manual para grupos online', 'CommanderZone é um simulador manual e mesa digital para grupos Commander. Ele ajuda a acompanhar estado da mesa, vida e dano de comandante sem virar motor completo de regras.', 'Abrir o simulador manual', 'Ver Commander grátis', [
      section('manual-simulator', 'Simulador manual, não simulador completo de regras', 'CommanderZone não resolve pilha, prioridade nem jogadas legais por você. Os jogadores continuam responsáveis pelas decisões de Commander.'),
      section('digital-table', 'Estado da mesa digital no navegador', 'Seu grupo pode manter informações de campo, vida e dano de comandante visíveis em um lugar compartilhado.'),
      section('rooms-and-decks', 'Salas conectadas aos decks', 'Prepare decks, crie salas e entre em uma mesa manual de Commander quando o grupo estiver pronto.'),
      section('paper-support', 'Útil online ou na mesa física', 'O mesmo foco em estado da mesa ajuda quando o grupo quer contador de vida e dano de comandante para partidas presenciais.'),
    ], [
      feature('Simulador manual', 'Modela estado da mesa sem automatizar regras.'),
      feature('Vida', 'Mantenha totais de vida visíveis.'),
      feature('Dano de comandante', 'Acompanhe dano entre comandantes e jogadores.'),
      feature('No navegador', 'Use a mesa em um navegador moderno.'),
    ], [
      faq('CommanderZone é um simulador completo de regras MTG?', 'Não. CommanderZone é um simulador manual e mesa digital, não um simulador completo de regras.'),
      faq('O que o simulador acompanha?', 'Ele ajuda a acompanhar estado da mesa, vida, dano de comandante e informações multiplayer.'),
      faq('CommanderZone automatiza a partida?', 'Não. Os jogadores gerenciam regras, triggers, prioridade, pilha e decisões legais.'),
    ]),
    it: simpleCopy('Simulatore Commander MTG per partite online manuali | CommanderZone', 'Usa CommanderZone come simulatore Commander MTG manuale per pod online. Segui stato del tavolo, punti vita e danno da comandante nel browser.', 'Un simulatore Commander MTG manuale per pod online', 'CommanderZone è un simulatore manuale e tavolo digitale per pod Commander. Aiuta a seguire stato del tavolo, punti vita e danno da comandante senza diventare un motore completo di regole.', 'Apri il simulatore manuale', 'Vedi Commander gratis', [
      section('manual-simulator', 'Simulatore manuale, non simulatore completo di regole', 'CommanderZone non risolve pila, priorità o giocate legali per te. I giocatori restano responsabili delle decisioni Commander.'),
      section('digital-table', 'Stato del tavolo digitale nel browser', 'Il tuo pod può tenere visibili informazioni del campo, punti vita e danno da comandante in un posto condiviso.'),
      section('rooms-and-decks', 'Stanze collegate ai mazzi', 'Prepara mazzi, crea stanze e passa a un tavolo Commander manuale quando il gruppo è pronto.'),
      section('paper-support', 'Utile online o al tavolo fisico', 'Lo stesso focus sullo stato del tavolo aiuta quando il gruppo vuole segnapunti e danno da comandante per partite dal vivo.'),
    ], [
      feature('Simulatore manuale', 'Modella lo stato del tavolo senza automatizzare regole.'),
      feature('Punti vita', 'Mantieni visibili i punti vita.'),
      feature('Danno da comandante', 'Segui il danno tra comandanti e giocatori.'),
      feature('Nel browser', 'Usa il tavolo da un browser moderno.'),
    ], [
      faq('CommanderZone è un simulatore completo di regole MTG?', 'No. CommanderZone è un simulatore manuale e tavolo digitale, non un simulatore completo di regole.'),
      faq('Cosa segue il simulatore?', 'Aiuta a seguire stato del tavolo, punti vita, danno da comandante e informazioni multiplayer.'),
      faq('CommanderZone automatizza la partita?', 'No. I giocatori gestiscono regole, trigger, priorità, pila e decisioni legali.'),
    ]),
  },
  faq: {
    es: faqCopy('FAQ CommanderZone | Preguntas frecuentes', 'Resuelve dudas sobre CommanderZone: preparar mazos, jugar Commander online, crear salas, importar mazos y usar el Asistente de mesa.', 'Preguntas frecuentes sobre CommanderZone', 'Respuestas claras sobre cómo preparar tu mazo, crear una sala y jugar Commander online o usar CommanderZone en partidas físicas.', 'Preparar mazo y jugar', 'Jugar Commander online', [
      ...MAIN_FAQ_ITEMS.es,
    ]),
    en: faqCopy('CommanderZone FAQ | Frequently Asked Questions', 'Find answers about CommanderZone: preparing decks, playing Commander online, creating rooms, importing decks and using the Table Assistant.', 'Frequently asked questions about CommanderZone', 'Clear answers about preparing your deck, creating a room and playing Commander online or using CommanderZone for paper games.', 'Prepare deck and play', 'Play Commander online', [
      ...MAIN_FAQ_ITEMS.en,
    ]),
    de: localizedPublicFaq('CommanderZone FAQ | Häufige Fragen', 'Antworten zu CommanderZone: Decks vorbereiten, Commander online spielen, Räume erstellen, Decks importieren und den Tischassistenten nutzen.', 'Häufige Fragen zu CommanderZone', 'Klare Antworten zum Vorbereiten von Decks, Erstellen von Räumen und Spielen von Commander online oder am Tisch.', 'Deck vorbereiten und spielen', 'Commander online spielen', 'de'),
    fr: localizedPublicFaq('FAQ CommanderZone | Questions fréquentes', 'Trouvez des réponses sur CommanderZone : préparer des decks, jouer à Commander en ligne, créer des salles, importer des decks et utiliser l’assistant de table.', 'Questions fréquentes sur CommanderZone', 'Des réponses claires pour préparer votre deck, créer une salle et jouer à Commander en ligne ou autour d’une table.', 'Préparer un deck et jouer', 'Jouer à Commander en ligne', 'fr'),
    pt: localizedPublicFaq('FAQ CommanderZone | Perguntas frequentes', 'Tire dúvidas sobre CommanderZone: preparar decks, jogar Commander online, criar salas, importar decks e usar o Assistente de mesa.', 'Perguntas frequentes sobre CommanderZone', 'Respostas claras sobre preparar seu deck, criar uma sala e jogar Commander online ou em partidas físicas.', 'Preparar deck e jogar', 'Jogar Commander online', 'pt'),
    it: faqCopy('FAQ CommanderZone | Domande frequenti', 'Trova risposte su CommanderZone: giocare a Commander online, creare stanze, importare mazzi, usare l’Assistente da tavolo, account, privacy e funzioni premium.', 'Domande frequenti su CommanderZone', 'Risposte chiare su come giocare a Commander online, creare stanze, importare mazzi e usare CommanderZone online o al tavolo fisico.', 'Preparare mazzo e giocare', 'Giocare a Commander online', [
      ...MAIN_FAQ_ITEMS.it,
    ]),
  },
} as const satisfies Record<SeoRouteKey, Record<PriorityLocaleCode, LandingCopy>>;

export function createSeoLandingContentByLocale(routeKey: SeoRouteKey): Readonly<Record<SeoLocaleCode, SeoLandingContent>> {
  return Object.fromEntries(
    SEO_LOCALE_CODES.map((locale) => [locale, createSeoLandingContent(routeKey, locale)]),
  ) as Record<SeoLocaleCode, SeoLandingContent>;
}

function createSeoLandingContent(routeKey: SeoRouteKey, locale: SeoLocaleCode): SeoLandingContent {
  const copyLocale = getPriorityLocale(locale);
  const copy = getLandingCopy(routeKey, copyLocale);
  const ctaCopy = getLandingCtaCopy(routeKey, copyLocale);
  const uiCopy = getUiCopy(copyLocale);
  const publicChrome = getPublicChromeCopy(locale);
  const path = getSeoPath(routeKey, locale);
  const seo: SeoMetadataContent = {
    title: copy.metaTitle,
    description: copy.metaDescription,
    ogTitle: copy.metaTitle,
    ogDescription: copy.metaDescription,
    ogImage: getOpenGraphImagePath(routeKey),
  };
  const breadcrumbItems = routeKey === 'home'
    ? [{ label: uiCopy.homeLabel, href: getSeoPath('home', locale) }]
    : [
        { label: uiCopy.homeLabel, href: getSeoPath('home', locale) },
        { label: copy.h1, href: path },
      ];
  const breadcrumb: LandingBreadcrumbContent = {
    items: breadcrumbItems,
  };
  const faqContent = createFaqContent(copy, uiCopy);

  return {
    routeKey,
    locale,
    seo,
    jsonLd: createLandingJsonLd(routeKey, locale, copy.h1, copy.metaDescription, path, seo, breadcrumb, faqContent),
    siteName: 'CommanderZone',
    homeLink: { label: uiCopy.homeLabel, href: getSeoPath('home', locale), ariaLabel: uiCopy.homeLabel },
    publicNavigationLinks: [
      { label: publicChrome.navigation.playOnline, href: getSeoPath('playCommanderOnline', locale) },
      { label: publicChrome.navigation.faq, href: getSeoPath('faq', locale) },
    ],
    footerLinks: getPublicFooterUtilityLinks(locale),
    legalFooterLinks: getPublicFooterLegalLinks(locale),
    localeLinks: SEO_LOCALES.map((supportedLocale) => ({
      locale: supportedLocale.code,
      label: supportedLocale.nativeLabel,
      href: getSeoPath(routeKey, supportedLocale.code),
      ariaLabel: supportedLocale.label,
    })),
    breadcrumb,
    hero: {
      eyebrow: uiCopy.eyebrow,
      title: copy.h1,
      subtitle: copy.heroSubtitle,
      image: {
        src: getHeroImagePath(routeKey),
        alt: `${copy.h1} - CommanderZone`,
        width: 960,
        height: 504,
        loading: 'eager',
        fetchPriority: 'high',
      },
      primaryLink: { label: ctaCopy.primaryCta, href: getPrimaryCtaHref(routeKey) },
      secondaryLink: { label: ctaCopy.secondaryCta, href: getSecondaryCtaHref(routeKey, locale) },
      highlights: copy.heroHighlights ?? [uiCopy.manualLabel, uiCopy.browserLabel],
    },
    trustBar: {
      label: uiCopy.trustLabel,
      items: [
        { value: uiCopy.manualValue, label: uiCopy.manualLabel },
        { value: uiCopy.browserValue, label: uiCopy.browserLabel },
      ],
    },
    sections: copy.sections.map((item): LandingSectionContent => ({
      id: item.id,
      title: item.title,
      body: [item.text],
    })),
    featureGrid: copy.features ? {
      id: 'features',
      title: uiCopy.featureGridTitle,
      intro: uiCopy.featureGridIntro,
      features: copy.features,
    } : undefined,
    steps: copy.steps ? {
      id: 'steps',
      title: copy.h1,
      steps: copy.steps,
    } : undefined,
    comparison: copy.comparison ? createComparisonContent(copy.comparison) : undefined,
    faq: faqContent,
    cta: {
      id: 'cta',
      title: copy.ctaTitle ?? uiCopy.defaultCtaTitle,
      description: copy.ctaDescription ?? uiCopy.defaultCtaDescription,
      primaryLink: { label: ctaCopy.primaryCta, href: getPrimaryCtaHref(routeKey) },
      secondaryLink: { label: ctaCopy.secondaryCta, href: getSecondaryCtaHref(routeKey, locale) },
    },
    internalLinks: createInternalLinks(routeKey, locale, uiCopy),
  };
}

function createFaqContent(copy: LandingCopy, uiCopy: LocaleUiCopy): LandingFaqContent {
  const items = copy.faq ?? uiCopy.defaultFaq;

  return {
    id: 'faq',
    title: uiCopy.faqTitle,
    intro: uiCopy.faqIntro,
    items: items.map((item) => ({
      question: item.question,
      answer: [item.answer],
    })),
  };
}

function createComparisonContent(copy: ComparisonCopy): LandingComparisonContent {
  return {
    id: 'comparison',
    title: copy.title,
    intro: copy.intro,
    firstColumnLabel: copy.firstColumnLabel,
    secondColumnLabel: copy.secondColumnLabel,
    rows: copy.rows,
  };
}

function createInternalLinks(routeKey: SeoRouteKey, locale: SeoLocaleCode, uiCopy: LocaleUiCopy): LandingInternalLinksContent {
  return {
    id: 'related',
    title: uiCopy.relatedTitle,
    intro: uiCopy.relatedIntro,
    links: getRelatedRouteKeys(routeKey).map((relatedRouteKey) => ({
      label: getRouteLabel(relatedRouteKey, locale),
      href: getSeoPath(relatedRouteKey, locale),
    })),
  };
}

function createLandingJsonLd(
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  title: string,
  description: string,
  path: string,
  seo: SeoMetadataContent,
  breadcrumb: LandingBreadcrumbContent,
  faq: LandingFaqContent,
): SeoJsonLdObject {
  const canonicalUrl = toSeoAbsoluteUrl(path);
  const graph: SeoJsonLdObject[] = [
    createOrganizationJsonLd(description),
    createBreadcrumbJsonLd(canonicalUrl, breadcrumb),
  ];

  if (routeKey === 'home') {
    graph.push(createWebSiteJsonLd(locale, description));
  }

  if (isProductLandingRoute(routeKey)) {
    graph.push(createWebApplicationJsonLd(locale, description, canonicalUrl));
  }

  if (isArticleLandingRoute(routeKey)) {
    graph.push(createArticleJsonLd(locale, title, description, canonicalUrl, seo.ogImage));
  }

  graph.push(createFaqPageJsonLd(locale, title, description, canonicalUrl, faq));

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

function createOrganizationJsonLd(description: string): SeoJsonLdObject {
  return {
    '@type': 'Organization',
    '@id': `${SEO_CANONICAL_ORIGIN}/#organization`,
    name: 'CommanderZone',
    url: `${SEO_CANONICAL_ORIGIN}/`,
    description,
    sameAs: [],
  };
}

function createWebSiteJsonLd(locale: SeoLocaleCode, description: string): SeoJsonLdObject {
  return {
    '@type': 'WebSite',
    '@id': `${SEO_CANONICAL_ORIGIN}/#website`,
    name: 'CommanderZone',
    description,
    url: `${SEO_CANONICAL_ORIGIN}/`,
    inLanguage: getLocaleHreflang(locale),
    publisher: { '@id': `${SEO_CANONICAL_ORIGIN}/#organization` },
  };
}

function createWebApplicationJsonLd(
  locale: SeoLocaleCode,
  description: string,
  canonicalUrl: string,
): SeoJsonLdObject {
  return {
    '@type': 'WebApplication',
    '@id': `${canonicalUrl}#software`,
    name: 'CommanderZone',
    description,
    url: canonicalUrl,
    inLanguage: getLocaleHreflang(locale),
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    publisher: { '@id': `${SEO_CANONICAL_ORIGIN}/#organization` },
  };
}

function createArticleJsonLd(
  locale: SeoLocaleCode,
  title: string,
  description: string,
  canonicalUrl: string,
  imagePath: string,
): SeoJsonLdObject {
  return {
    '@type': 'Article',
    '@id': `${canonicalUrl}#article`,
    headline: title,
    description,
    url: canonicalUrl,
    image: toSeoAbsoluteUrl(imagePath),
    inLanguage: getLocaleHreflang(locale),
    mainEntityOfPage: canonicalUrl,
    author: { '@id': `${SEO_CANONICAL_ORIGIN}/#organization` },
    publisher: { '@id': `${SEO_CANONICAL_ORIGIN}/#organization` },
    dateModified: SEO_STRUCTURED_DATA_DATE_MODIFIED,
  };
}

function createBreadcrumbJsonLd(canonicalUrl: string, breadcrumb: LandingBreadcrumbContent): SeoJsonLdObject {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalUrl}#breadcrumb`,
    itemListElement: breadcrumb.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: toSeoAbsoluteUrl(item.href),
    })),
  };
}

function createFaqPageJsonLd(
  locale: SeoLocaleCode,
  title: string,
  description: string,
  canonicalUrl: string,
  faq: LandingFaqContent,
): SeoJsonLdObject {
  return {
    '@type': 'FAQPage',
    '@id': `${canonicalUrl}#faq`,
    name: title,
    description,
    inLanguage: getLocaleHreflang(locale),
    mainEntity: faq.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer.join(' '),
      },
    })),
  };
}

function isProductLandingRoute(routeKey: SeoRouteKey): boolean {
  return (PRODUCT_LANDING_ROUTE_KEYS as readonly SeoRouteKey[]).includes(routeKey);
}

function isArticleLandingRoute(routeKey: SeoRouteKey): boolean {
  const articleRoutes = [
    'howToPlayCommanderOnline',
    'waysToPlayCommanderOnline',
    'spellTableAlternative',
    'playCommanderWithoutWebcam',
  ] as const satisfies readonly SeoRouteKey[];

  return (articleRoutes as readonly SeoRouteKey[]).includes(routeKey);
}

function getLandingCopy(routeKey: SeoRouteKey, locale: PriorityLocaleCode): LandingCopy {
  const copy = LANDING_COPY[routeKey][locale];

  return {
    ...copy,
    ...SEO_LANDING_METADATA_COPY[routeKey][locale],
  };
}

function getLandingCtaCopy(routeKey: SeoRouteKey, locale: PriorityLocaleCode): LandingCtaCopy {
  return LANDING_CTA_COPY[routeKey][locale];
}

function getUiCopy(locale: PriorityLocaleCode): LocaleUiCopy {
  return LOCALE_COPY[locale];
}

function getPriorityLocale(locale: SeoLocaleCode): PriorityLocaleCode {
  return PRIORITY_LOCALES.includes(locale as PriorityLocaleCode) ? locale as PriorityLocaleCode : 'en';
}

function getRouteLabel(routeKey: SeoRouteKey, locale: SeoLocaleCode): string {
  return getPriorityRouteLabel(routeKey, getPriorityLocale(locale));
}

function getPriorityRouteLabel(routeKey: SeoRouteKey, locale: PriorityLocaleCode): string {
  const internalLabel = INTERNAL_ROUTE_LABEL_COPY[routeKey]?.[locale];

  if (internalLabel) {
    return internalLabel;
  }

  return getLandingCopy(routeKey, locale).h1;
}

function getRelatedRouteKeys(routeKey: SeoRouteKey): readonly SeoRouteKey[] {
  if (routeKey === 'home') {
    return SEO_ROUTE_KEYS.filter((seoRouteKey) => seoRouteKey !== 'home');
  }

  if (routeKey === 'faq') {
    return SEO_ROUTE_KEYS.filter((seoRouteKey) => seoRouteKey !== 'faq');
  }

  const requiredRoutes = [
    'home',
    'playCommanderOnline',
    'createCommanderRoom',
    'importCommanderDeck',
    'tableAssistant',
    'faq',
  ] as const satisfies readonly SeoRouteKey[];
  const routeSpecificLinks: Partial<Record<SeoRouteKey, readonly SeoRouteKey[]>> = {
    spellTableAlternative: ['playCommanderWithoutWebcam'],
    playCommanderWithoutWebcam: ['spellTableAlternative'],
    commanderSimulator: ['playCommanderOnlineFree'],
    playEdhOnline: ['playCommanderOnline'],
  };

  return uniqueRouteKeys([
    ...requiredRoutes,
    ...(routeSpecificLinks[routeKey] ?? []),
  ]).filter((relatedRouteKey) => relatedRouteKey !== routeKey);
}

function getOpenGraphImagePath(routeKey: SeoRouteKey): string {
  const images: Partial<Record<SeoRouteKey, string>> = {
    home: '/assets/og/home-og.png',
    playCommanderOnline: '/assets/og/play-commander-og.png',
    createCommanderRoom: '/assets/og/create-room-og.png',
    importCommanderDeck: '/assets/og/import-deck-og.png',
    commanderDeckBuilder: '/assets/og/deck-builder-og.png',
    tableAssistant: '/assets/og/table-assistant-og.png',
    waysToPlayCommanderOnline: '/assets/og/ways-to-play-og.png',
    faq: '/assets/og/faq-og.png',
  };

  return images[routeKey] ?? '/assets/og/default-og.png';
}

function getHeroImagePath(routeKey: SeoRouteKey): string {
  const images: Record<SeoRouteKey, string> = {
    home: '/assets/seo/home-hero.webp',
    playCommanderOnline: '/assets/seo/play-commander-online-hero.webp',
    playCommanderOnlineFree: '/assets/seo/play-commander-online-free-hero.webp',
    playEdhOnline: '/assets/seo/play-edh-online-hero.webp',
    commanderSimulator: '/assets/seo/commander-simulator-hero.webp',
    createCommanderRoom: '/assets/seo/create-commander-room-hero.webp',
    importCommanderDeck: '/assets/seo/import-commander-deck-hero.webp',
    commanderDeckBuilder: '/assets/seo/commander-deck-builder-hero.webp',
    tableAssistant: '/assets/seo/commander-life-counter-hero.webp',
    playMagicOnlineWithFriends: '/assets/seo/play-magic-online-with-friends-hero.webp',
    howToPlayCommanderOnline: '/assets/seo/how-to-play-commander-online-hero.webp',
    waysToPlayCommanderOnline: '/assets/seo/ways-to-play-commander-online-hero.webp',
    spellTableAlternative: '/assets/seo/spelltable-alternative-hero.webp',
    playCommanderWithoutWebcam: '/assets/seo/play-commander-without-webcam-hero.webp',
    faq: '/assets/seo/faq-hero.webp',
  };

  return images[routeKey];
}

function getPrimaryCtaHref(routeKey: SeoRouteKey): string {
  if (routeKey === 'tableAssistant') {
    return APP_TABLE_ASSISTANT_ENTRY_PATH;
  }

  return APP_DECKS_ENTRY_PATH;
}

function getSecondaryCtaHref(routeKey: SeoRouteKey, locale: SeoLocaleCode): string {
  const routeTargets: Partial<Record<SeoRouteKey, SeoRouteKey>> = {
    home: 'howToPlayCommanderOnline',
    playCommanderOnline: 'howToPlayCommanderOnline',
    playMagicOnlineWithFriends: 'waysToPlayCommanderOnline',
    createCommanderRoom: 'howToPlayCommanderOnline',
    importCommanderDeck: 'faq',
    commanderDeckBuilder: 'faq',
    tableAssistant: 'faq',
    waysToPlayCommanderOnline: 'howToPlayCommanderOnline',
    howToPlayCommanderOnline: 'waysToPlayCommanderOnline',
    spellTableAlternative: 'playCommanderWithoutWebcam',
    playCommanderOnlineFree: 'faq',
    playCommanderWithoutWebcam: 'spellTableAlternative',
    playEdhOnline: 'playCommanderOnline',
    commanderSimulator: 'playCommanderOnlineFree',
    faq: 'playCommanderOnline',
  };

  return getSeoPath(routeTargets[routeKey] ?? 'faq', locale);
}

function cta(primaryCta: string, secondaryCta: string): LandingCtaCopy {
  return { primaryCta, secondaryCta };
}

function section(id: string, title: string, text: string): SectionCopy {
  return { id, title, text };
}

function feature(title: string, description: string): LandingFeature {
  return { title, description };
}

function step(title: string, description: string): LandingStep {
  return { title, description };
}

function faq(question: string, answer: string): FaqItemCopy {
  return { question, answer };
}

function row(label: string, firstValue: string, secondValue: string): ComparisonRowCopy {
  return { label, firstValue, secondValue };
}

function comparison(
  title: string,
  intro: string,
  firstColumnLabel: string,
  secondColumnLabel: string,
  rows: readonly ComparisonRowCopy[],
): ComparisonCopy {
  return { title, intro, firstColumnLabel, secondColumnLabel, rows };
}

function uniqueRouteKeys(routeKeys: readonly SeoRouteKey[]): readonly SeoRouteKey[] {
  return [...new Set(routeKeys)];
}

function simpleCopy(
  metaTitle: string,
  metaDescription: string,
  h1: string,
  heroSubtitle: string,
  primaryCta: string,
  secondaryCta: string,
  sections: readonly SectionCopy[],
  features?: readonly LandingFeature[],
  faqItems?: readonly FaqItemCopy[],
): LandingCopy {
  return { metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, sections, features, faq: faqItems };
}

function homeCopy(
  metaTitle: string,
  metaDescription: string,
  h1: string,
  heroSubtitle: string,
  primaryCta: string,
  secondaryCta: string,
  heroHighlights: readonly string[],
  sections: readonly SectionCopy[],
  features: readonly LandingFeature[],
  faqItems: readonly FaqItemCopy[],
  ctaTitle: string,
  ctaDescription: string,
): LandingCopy {
  return {
    metaTitle,
    metaDescription,
    h1,
    heroSubtitle,
    primaryCta,
    secondaryCta,
    heroHighlights,
    sections,
    features,
    faq: faqItems,
    ctaTitle,
    ctaDescription,
  };
}

function guideCopy(
  metaTitle: string,
  metaDescription: string,
  h1: string,
  heroSubtitle: string,
  primaryCta: string,
  secondaryCta: string,
  steps: readonly LandingStep[],
  sections: readonly SectionCopy[],
): LandingCopy {
  return { metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, sections, steps };
}

function comparisonCopy(
  metaTitle: string,
  metaDescription: string,
  h1: string,
  heroSubtitle: string,
  primaryCta: string,
  secondaryCta: string,
  sections: readonly SectionCopy[],
  rows: readonly ComparisonRowCopy[],
  firstColumnLabel: string,
  secondColumnLabel: string,
  thirdColumnLabel: string,
): LandingCopy {
  return {
    metaTitle,
    metaDescription,
    h1,
    heroSubtitle,
    primaryCta,
    secondaryCta,
    sections,
    comparison: {
      title: h1,
      intro: heroSubtitle,
      firstColumnLabel,
      secondColumnLabel,
      rows: rows.map((item) => ({
        label: item.label,
        firstValue: item.firstValue,
        secondValue: `${thirdColumnLabel}: ${item.secondValue}`,
      })),
    },
  };
}

function faqCopy(
  metaTitle: string,
  metaDescription: string,
  h1: string,
  heroSubtitle: string,
  primaryCta: string,
  secondaryCta: string,
  faqItems: readonly FaqItemCopy[],
): LandingCopy {
  return {
    metaTitle,
    metaDescription,
    h1,
    heroSubtitle,
    primaryCta,
    secondaryCta,
    sections: [
      section('commanderzone-help', h1, heroSubtitle),
    ],
    faq: faqItems,
  };
}

function localizedHome(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  const localized = {
    de: simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, [
      section('commander-table', 'Ein Tisch für Commander', 'CommanderZone versucht nicht, jede Magic-Regel zu automatisieren. Es ist für Gruppen gedacht, die spielen können und einen schnellen, flexiblen Online-Tisch wollen.'),
      section('deck-to-game', 'Von der Deckliste zur Partie', 'Importiere deine Listen, organisiere deine Decks und bring sie direkt an den Tisch. Weniger Einrichtung, mehr Spielzeit.'),
      section('online-or-paper', 'Online oder am physischen Tisch', 'Spiele online mit Freunden oder nutze den Tischassistenten auf Smartphone oder Tablet bei Papierpartien.'),
    ], [
      feature('Räume schnell erstellen', 'Erstelle einen Raum und teile den Link mit deiner Gruppe.'),
      feature('Deine Decks nutzen', 'Importiere deine Listen und mach sie spielbereit.'),
      feature('Partie verfolgen', 'Verwalte Lebenspunkte, Commander-Schaden und Tischstatus.'),
      feature('Listen verbessern', 'Analysiere deine Decks und erkenne Schwachstellen.'),
    ]),
    fr: simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, [
      section('commander-table', 'Une table pensée pour Commander', 'CommanderZone ne cherche pas à automatiser chaque règle de Magic. L’outil s’adresse aux groupes qui savent jouer et veulent une table en ligne rapide et flexible.'),
      section('deck-to-game', 'De la decklist à la partie', 'Importez vos listes, organisez vos decks et amenez-les directement à la table. Moins de configuration, plus de jeu.'),
      section('online-or-paper', 'En ligne ou autour d’une table', 'Jouez en ligne avec vos amis ou utilisez l’assistant de table sur mobile ou tablette pendant vos parties physiques.'),
    ], [
      feature('Créer des salles vite', 'Générez une salle et partagez le lien avec votre groupe.'),
      feature('Utiliser vos decks', 'Importez vos listes et préparez-les pour jouer.'),
      feature('Suivre la partie', 'Gérez les points de vie, les blessures de commandant et l’état de table.'),
      feature('Améliorer vos listes', 'Analysez vos decks et repérez les points faibles.'),
    ]),
    pt: simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, [
      section('commander-table', 'Uma mesa feita para Commander', 'CommanderZone não tenta automatizar cada regra de Magic. Ele foi feito para grupos que já sabem jogar e querem uma mesa online rápida e flexível.'),
      section('deck-to-game', 'Da decklist à partida', 'Importe suas listas, organize seus decks e leve tudo direto para a mesa. Menos configuração, mais jogo.'),
      section('online-or-paper', 'Online ou na mesa física', 'Jogue online com amigos ou use o Assistente de mesa no celular ou tablet durante partidas presenciais.'),
    ], [
      feature('Crie salas rápido', 'Gere uma sala e compartilhe o link com seu grupo.'),
      feature('Use seus decks', 'Importe suas listas e deixe-as prontas para jogar.'),
      feature('Acompanhe a partida', 'Gerencie vida, dano de comandante e estado da mesa.'),
      feature('Melhore suas listas', 'Analise seus decks e encontre pontos fracos.'),
    ]),
  };

  if (locale !== 'de' && locale !== 'fr' && locale !== 'pt') {
    return LANDING_COPY.home.en;
  }

  return localized[locale];
}

function localizedPlayCommander(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'playCommanderOnline'), localizedFeatures(locale, 'playCommanderOnline'));
}

function localizedCreateRoom(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'createCommanderRoom'), localizedFeatures(locale, 'createCommanderRoom'));
}

function localizedImportDeck(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'importCommanderDeck'), localizedFeatures(locale, 'importCommanderDeck'));
}

function localizedDeckBuilder(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'commanderDeckBuilder'), localizedFeatures(locale, 'commanderDeckBuilder'));
}

function localizedTableAssistant(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'tableAssistant'), localizedFeatures(locale, 'tableAssistant'), localizedTableAssistantFaq(locale));
}

function localizedHowTo(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return guideCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSteps(locale), localizedSections(locale, 'howToPlayCommanderOnline'));
}

function localizedWays(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  const comparison = localizedComparison(locale);
  return comparisonCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'waysToPlayCommanderOnline'), comparison.rows, comparison.firstColumnLabel, comparison.secondColumnLabel, comparison.thirdColumnLabel);
}

function localizedMagicFriends(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return simpleCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedSections(locale, 'playMagicOnlineWithFriends'));
}

function localizedPublicFaq(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string, primaryCta: string, secondaryCta: string, locale: PriorityLocaleCode): LandingCopy {
  return faqCopy(metaTitle, metaDescription, h1, heroSubtitle, primaryCta, secondaryCta, localizedFaq(locale));
}

function localizedSections(locale: PriorityLocaleCode, routeKey: SeoRouteKey): readonly SectionCopy[] {
  if (locale !== 'de' && locale !== 'fr' && locale !== 'pt') {
    return [];
  }

  const sections: Partial<Record<PriorityLocaleCode, Partial<Record<SeoRouteKey, readonly SectionCopy[]>>>> = {
    de: {
      playCommanderOnline: [
        section('fast-start', 'Schneller in die Partie', 'Du brauchst keine komplexe Plattform, um loszulegen. Der Ablauf ist direkt: Deck vorbereiten, Raum erstellen, Link teilen und spielen.'),
        section('manual-control', 'Manueller Tisch, echte Kontrolle', 'Commander ist ein soziales Format. CommanderZone gibt deiner Gruppe Werkzeuge, aber die Spieler behalten die Kontrolle.'),
        section('long-games', 'Für lange Partien gebaut', 'Commander-Partien können lange dauern. Die Oberfläche soll klar, stabil und bequem bleiben.'),
      ],
      createCommanderRoom: [
        section('deck-first', 'Erst das Deck, dann der Raum', 'Um eine Partie zu starten, brauchst du ein vorbereitetes Deck. Importiere eine Deckliste, erstelle ein Deck neu oder wähle ein gespeichertes Deck vor dem Erstellen des Raums.'),
        section('link-invite', 'Der Link ist die Einladung', 'Andere Spieler einzuladen ist so einfach wie einen Link zu teilen.'),
        section('lobby', 'Lobby vor dem Spiel', 'Organisiere, wer beitritt, welche Decks genutzt werden und wann die Partie startet.'),
        section('room-to-game', 'Vom Raum zum Tisch', 'Wenn die Gruppe bereit ist, wird der Raum zu einem klaren Commander-Tisch.'),
      ],
      importCommanderDeck: [
        section('existing-lists', 'Nicht bei null anfangen', 'Wenn du deine Listen bereits als Text oder in anderen Tools hast, importiere sie ohne alles neu zu bauen.'),
        section('ready-to-play', 'Spielbereit', 'Ein Deck zu importieren bedeutet nicht nur speichern, sondern es für einen Raum bereit zu haben.'),
        section('analysis', 'Analyse nach dem Import', 'Prüfe Länder, Kurve, Farben, Kartentypen, Ramp, Kartenziehen und Interaktion vor der Partie.'),
      ],
      commanderDeckBuilder: [
        section('build-to-play', 'Bauen, um zu spielen', 'CommanderZone soll nicht nur Listen speichern. Deine Decks sollen bereit für den Tisch sein.'),
        section('room-ready', 'Bereit für den Raum', 'Sobald dein Deck bereit ist, kannst du es direkt in einen CommanderZone-Raum mitnehmen.'),
        section('deck-review', 'Klare Deckprüfung', 'Prüfe Kurve, Farben, Länder, Kartentypen und Struktur, um dein Deck besser zu verstehen.'),
        section('improve', 'Zwischen Partien verbessern', 'Speichere Versionen, teste Änderungen und lerne, was dein Deck nach Partien braucht.'),
      ],
      tableAssistant: [
        section('paper-games', 'Für physische Commander-Partien', 'Nicht jede Partie findet online statt. Der Tischassistent ist für Gruppen gedacht, die persönlich spielen und die Partie klarer verwalten möchten.'),
        section('visible-totals', 'Lebenspunkte und Commander-Schaden sichtbar', 'Halte wichtige Informationen für alle Spieler sichtbar, ohne lose Notizen oder Würfel überall auf dem Tisch.'),
        section('mobile-tablet', 'Ideal für Smartphone oder Tablet', 'Lege das Gerät in die Mitte des Tisches und nutze es während der Partie als gemeinsames Panel.'),
      ],
      howToPlayCommanderOnline: [
        section('group-needs', 'Was deine Gruppe braucht', 'Ihr braucht einen Sprachkanal, sichtbare Spielinformationen und einen Tisch, den alle verstehen.'),
        section('manual-table', 'Warum ein manueller Tisch gut funktionieren kann', 'Commander hat viele soziale Situationen und Absprachen am Tisch. Ein zu starres Tool kann stören.'),
      ],
      waysToPlayCommanderOnline: [
        section('webcam', 'Mit Webcam spielen', 'Das ist am nächsten an Papierpartien: Jeder nutzt echte Karten und zeigt den Tisch mit einer Kamera.'),
        section('manual-table', 'Manueller Online-Tisch', 'Ein manueller Tisch reduziert Einrichtung und lässt die Gruppe ohne vollständigen Regelmotor kontrolliert spielen.'),
        section('platforms', 'Simulatoren und komplette Plattformen', 'Einige Tools bilden das Spiel vollständiger ab, benötigen aber oft mehr Lernen, Installation oder Einrichtung.'),
      ],
      playMagicOnlineWithFriends: [
        section('play-not-configure', 'Für Gruppen, die spielen wollen', 'Wenn deine Gruppe online Magic spielt, zählt schnelles Reinkommen, Tisch organisieren und loslegen.'),
        section('commander-focused', 'Besonders für Commander gedacht', 'CommanderZone orientiert sich an Commander: mehrere Spieler, Commander-Schaden, lange Partien und feste Gruppen.'),
        section('complementary', 'Ein ergänzendes Werkzeug', 'Du kannst CommanderZone mit den Tools kombinieren, die du bereits für Sprache, Video, Karten oder Community nutzt.'),
      ],
      faq: [],
      home: [],
    },
    fr: {
      playCommanderOnline: [
        section('fast-start', 'Une façon rapide de lancer la partie', 'Vous n’avez pas besoin d’une configuration complexe pour commencer. Préparez un deck, créez une salle, partagez le lien et jouez.'),
        section('manual-control', 'Table manuelle, vrai contrôle', 'Commander est un format social. CommanderZone donne des outils au groupe, mais les joueurs gardent le contrôle.'),
        section('long-games', 'Pensée pour les longues parties', 'Une partie de Commander peut durer longtemps. L’interface doit rester claire, stable et confortable.'),
      ],
      createCommanderRoom: [
        section('deck-first', 'Le deck d’abord, la salle ensuite', 'Pour lancer une partie, vous devez avoir un deck prêt. Importez une decklist, créez un deck ou choisissez un deck sauvegardé avant de créer la salle.'),
        section('link-invite', 'Le lien est l’invitation', 'Inviter d’autres joueurs devrait être aussi simple que partager un lien.'),
        section('lobby', 'Lobby avant la partie', 'Organisez les joueurs, les decks utilisés et le moment où la partie commence.'),
        section('room-to-game', 'De la salle à la table', 'Quand le groupe est prêt, la salle devient une table claire centrée sur Commander.'),
      ],
      importCommanderDeck: [
        section('existing-lists', 'Ne repartez pas de zéro', 'Si vos listes existent déjà en texte ou dans d’autres outils, importez-les sans tout reconstruire.'),
        section('ready-to-play', 'Prêt à jouer', 'Importer un deck ne sert pas seulement à le sauvegarder : il devient prêt pour une salle.'),
        section('analysis', 'Analyse après import', 'Vérifiez terrains, courbe, couleurs, types de carte, ramp, pioche et interaction avant la partie.'),
      ],
      commanderDeckBuilder: [
        section('build-to-play', 'Construire pour jouer', 'CommanderZone n’est pas seulement un endroit où stocker des listes. Le but est de préparer vos decks pour la table.'),
        section('room-ready', 'Prêt pour une salle', 'Une fois votre deck prêt, vous pouvez l’amener directement dans une salle CommanderZone.'),
        section('deck-review', 'Revue claire du deck', 'Consultez courbe, couleurs, terrains, types de carte et structure pour comprendre votre liste.'),
        section('improve', 'S’améliorer entre les parties', 'Sauvegardez des versions, testez des changements et apprenez ce dont votre deck a besoin.'),
      ],
      tableAssistant: [
        section('paper-games', 'Pour les parties physiques de Commander', 'Toutes les parties ne se jouent pas en ligne. L’assistant de table aide les groupes qui jouent en personne à mieux gérer la partie.'),
        section('visible-totals', 'Points de vie et blessures de commandant visibles', 'Gardez les informations importantes visibles pour tous, sans notes éparpillées ni dés partout.'),
        section('mobile-tablet', 'Idéal sur mobile ou tablette', 'Placez l’appareil au centre de la table et utilisez-le comme panneau partagé.'),
      ],
      howToPlayCommanderOnline: [
        section('group-needs', 'Ce dont votre groupe a besoin', 'Il vous faut un canal pour parler, des informations de partie visibles et une table que tout le monde comprend.'),
        section('manual-table', 'Pourquoi une table manuelle peut mieux fonctionner', 'Commander comporte beaucoup de situations sociales et d’accords de table. Un outil trop rigide peut gêner.'),
      ],
      waysToPlayCommanderOnline: [
        section('webcam', 'Jouer avec webcam', 'C’est l’option la plus proche du jeu papier : chaque joueur utilise ses cartes réelles et montre la table avec une caméra.'),
        section('manual-table', 'Table en ligne manuelle', 'Une table manuelle réduit la configuration et laisse le groupe garder le contrôle sans moteur de règles complet.'),
        section('platforms', 'Simulateurs et plateformes complètes', 'Certains outils recréent le jeu plus complètement, mais demandent plus d’apprentissage, d’installation ou de configuration.'),
      ],
      playMagicOnlineWithFriends: [
        section('play-not-configure', 'Pour les groupes qui veulent jouer', 'Quand votre groupe se retrouve pour jouer à Magic en ligne, l’important est d’entrer vite, organiser la table et commencer.'),
        section('commander-focused', 'Pensé surtout pour Commander', 'CommanderZone est conçu autour des besoins de Commander : plusieurs joueurs, blessures de commandant, longues parties et groupes réguliers.'),
        section('complementary', 'Un outil complémentaire', 'Vous pouvez combiner CommanderZone avec les outils que vous utilisez déjà pour la voix, la vidéo, les cartes ou la communauté.'),
      ],
      faq: [],
      home: [],
    },
    pt: {
      playCommanderOnline: [
        section('fast-start', 'Uma forma rápida de começar', 'Você não precisa de uma configuração complexa para jogar. Prepare um deck, crie uma sala, compartilhe o link e comece.'),
        section('manual-control', 'Mesa manual, controle real', 'Commander é um formato social. CommanderZone dá ferramentas ao grupo, mas os jogadores continuam no controle.'),
        section('long-games', 'Feito para partidas longas', 'Partidas de Commander podem durar horas. A interface deve continuar clara, estável e confortável.'),
      ],
      createCommanderRoom: [
        section('deck-first', 'Primeiro o deck, depois a sala', 'Para começar uma partida, você precisa ter um deck pronto. Importe uma decklist, crie um deck do zero ou escolha um deck salvo antes de criar a sala.'),
        section('link-invite', 'O link é o convite', 'Convidar outros jogadores deve ser tão simples quanto compartilhar um link.'),
        section('lobby', 'Lobby antes da partida', 'Organize quem entra, quais decks serão usados e quando a partida começa.'),
        section('room-to-game', 'Da sala para a mesa', 'Quando o grupo está pronto, a sala vira uma mesa clara focada em Commander.'),
      ],
      importCommanderDeck: [
        section('existing-lists', 'Não comece do zero', 'Se suas listas já estão em texto ou em outras ferramentas, importe sem refazer tudo.'),
        section('ready-to-play', 'Pronto para jogar', 'Importar um deck não é só salvar: é deixá-lo pronto para usar em uma sala.'),
        section('analysis', 'Análise depois de importar', 'Revise terrenos, curva, cores, tipos de carta, ramp, compra e interação antes da partida.'),
      ],
      commanderDeckBuilder: [
        section('build-to-play', 'Construir para jogar', 'CommanderZone não quer ser só um lugar para guardar listas. O objetivo é deixar seus decks prontos para a mesa.'),
        section('room-ready', 'Pronto para uma sala', 'Quando seu deck estiver pronto, você pode levá-lo diretamente para uma sala do CommanderZone.'),
        section('deck-review', 'Revisão clara do deck', 'Confira curva, cores, terrenos, tipos de carta e estrutura geral para entender sua lista.'),
        section('improve', 'Melhore entre partidas', 'Salve versões, teste mudanças e aprenda o que seu deck precisa depois de jogar.'),
      ],
      tableAssistant: [
        section('paper-games', 'Para partidas físicas de Commander', 'Nem toda partida acontece online. O Assistente de mesa foi feito para grupos que jogam presencialmente e querem controlar melhor a partida.'),
        section('visible-totals', 'Vida e dano de comandante visíveis', 'Mantenha as informações importantes claras para todos, sem notas soltas ou dados espalhados pela mesa.'),
        section('mobile-tablet', 'Ideal para celular ou tablet', 'Coloque o dispositivo no centro da mesa e use como painel compartilhado durante a partida.'),
      ],
      howToPlayCommanderOnline: [
        section('group-needs', 'O que seu grupo precisa', 'Vocês precisam de um canal para conversar, uma forma de ver as informações importantes e uma mesa que todos entendam.'),
        section('manual-table', 'Por que uma mesa manual pode funcionar melhor', 'Commander tem muitas situações sociais e acordos de mesa. Uma ferramenta rígida demais pode atrapalhar.'),
      ],
      waysToPlayCommanderOnline: [
        section('webcam', 'Jogar por webcam', 'É a opção mais parecida com jogar presencialmente: cada jogador usa cartas reais e uma câmera para mostrar a mesa.'),
        section('manual-table', 'Mesa online manual', 'Uma mesa manual reduz configuração e deixa o grupo no controle sem depender de um motor completo de regras.'),
        section('platforms', 'Simuladores e plataformas completas', 'Algumas ferramentas recriam o jogo de forma mais completa, mas podem exigir mais aprendizado, instalação ou configuração.'),
      ],
      playMagicOnlineWithFriends: [
        section('play-not-configure', 'Para grupos que querem jogar', 'Quando seu grupo marca para jogar Magic online, o importante é entrar rápido, organizar a mesa e começar.'),
        section('commander-focused', 'Especialmente pensado para Commander', 'CommanderZone foi desenhado em torno das necessidades de Commander: vários jogadores, dano de comandante, partidas longas e grupos estáveis.'),
        section('complementary', 'Uma ferramenta complementar', 'Você pode combinar CommanderZone com as ferramentas que já usa para voz, vídeo, cartas ou comunidade.'),
      ],
      faq: [],
      home: [],
    },
  };

  return sections[locale]?.[routeKey] ?? [];
}

function localizedFeatures(locale: PriorityLocaleCode, routeKey: SeoRouteKey): readonly LandingFeature[] {
  const translations: Partial<Record<PriorityLocaleCode, Partial<Record<SeoRouteKey, readonly LandingFeature[]>>>> = {
    de: {
      playCommanderOnline: [
        feature('Private Räume', 'Teile die Partie nur mit deiner Gruppe.'),
        feature('Leben und Commander-Schaden', 'Behalte die wichtigsten Informationen im Blick.'),
        feature('Decks bereit', 'Bring deine Listen an den Tisch.'),
        feature('Im Browser', 'Spiele ohne schwere App-Installation.'),
      ],
    },
    fr: {
      playCommanderOnline: [
        feature('Salles privées', 'Partagez la partie seulement avec votre groupe.'),
        feature('Vie et blessures de commandant', 'Suivez les informations clés de la partie.'),
        feature('Decks prêts', 'Amenez vos listes à la table.'),
        feature('Depuis le navigateur', 'Jouez sans installer une application lourde.'),
      ],
    },
    pt: {
      playCommanderOnline: [
        feature('Salas privadas', 'Compartilhe a partida só com seu grupo.'),
        feature('Vida e dano de comandante', 'Acompanhe as informações principais da partida.'),
        feature('Decks prontos', 'Leve suas listas para a mesa.'),
        feature('Pelo navegador', 'Jogue sem instalar um aplicativo pesado.'),
      ],
    },
  };

  return translations[locale]?.[routeKey] ?? [
    feature('Flujo claro', 'Prepara el grupo y mantén visible la información importante de la partida.'),
    feature('Control manual', 'Los jugadores mantienen el control de decisiones y acuerdos de mesa.'),
  ];
}

function localizedSteps(locale: PriorityLocaleCode): readonly LandingStep[] {
  if (locale === 'de') {
    return [
      step('Deck vorbereiten', 'Halte deine Deckliste bereit, um sie zu importieren oder während der Partie zu prüfen.'),
      step('Raum erstellen', 'Öffne einen Online-Raum und bereite den Tisch für deine Gruppe vor.'),
      step('Link teilen', 'Sende den Link an deine Freunde, damit sie beitreten können.'),
      step('Partie starten', 'Verfolge Lebenspunkte, Commander-Schaden und Tischstatus während des Spiels.'),
    ];
  }

  if (locale === 'fr') {
    return [
      step('Préparer votre deck', 'Gardez votre decklist prête à importer ou consulter pendant la partie.'),
      step('Créer une salle', 'Ouvrez une salle en ligne et préparez la table pour votre groupe.'),
      step('Partager le lien', 'Envoyez le lien à vos amis pour qu’ils puissent rejoindre.'),
      step('Commencer la partie', 'Suivez les points de vie, les blessures de commandant et l’état de table pendant le jeu.'),
    ];
  }

  if (locale === 'pt') {
    return [
      step('Prepare seu deck', 'Tenha sua decklist pronta para importar ou consultar durante a partida.'),
      step('Crie uma sala', 'Abra uma sala online e prepare a mesa para seu grupo.'),
      step('Compartilhe o link', 'Envie o link para seus amigos entrarem.'),
      step('Comece a partida', 'Acompanhe vida, dano de comandante e estado da mesa enquanto joga.'),
    ];
  }

  return [];
}

function localizedComparison(locale: PriorityLocaleCode): { readonly rows: readonly ComparisonRowCopy[]; readonly firstColumnLabel: string; readonly secondColumnLabel: string; readonly thirdColumnLabel: string } {
  if (locale !== 'de' && locale !== 'fr' && locale !== 'pt') {
    return {
      firstColumnLabel: 'Option',
      secondColumnLabel: 'Fits when',
      thirdColumnLabel: 'Keep in mind',
      rows: [],
    };
  }

  const comparisons = {
    de: {
      firstColumnLabel: 'Option',
      secondColumnLabel: 'Passt wenn',
      thirdColumnLabel: 'Beachten',
      rows: [
        row('Webcam', 'Nutzt physische Karten', 'Braucht Kamera und gutes Setup.'),
        row('Manueller Tisch', 'Flexibel und schnell', 'Validiert Regeln nicht automatisch.'),
        row('Kompletter Simulator', 'Mehr Automatisierung', 'Höhere Lernkurve.'),
        row('Tischassistent', 'Sehr gut für Papierpartien', 'Ersetzt nicht den ganzen Online-Tisch.'),
      ],
    },
    fr: {
      firstColumnLabel: 'Option',
      secondColumnLabel: 'Adapté quand',
      thirdColumnLabel: 'À retenir',
      rows: [
        row('Webcam', 'Utilise des cartes physiques', 'Demande une caméra et un bon setup.'),
        row('Table manuelle', 'Flexible et rapide', 'N’applique pas les règles automatiquement.'),
        row('Simulateur complet', 'Plus d’automatisation', 'Courbe d’apprentissage plus élevée.'),
        row('Assistant de table', 'Très pratique en physique', 'Ne remplace pas toute la table en ligne.'),
      ],
    },
    pt: {
      firstColumnLabel: 'Opção',
      secondColumnLabel: 'Funciona quando',
      thirdColumnLabel: 'Atenção',
      rows: [
        row('Webcam', 'Usa cartas físicas', 'Exige câmera e bom setup.'),
        row('Mesa manual', 'Flexível e rápida', 'Não valida regras automaticamente.'),
        row('Simulador completo', 'Mais automação', 'Curva de aprendizado maior.'),
        row('Assistente de mesa', 'Ótimo em partidas físicas', 'Não substitui toda a mesa online.'),
      ],
    },
  };

  return comparisons[locale];
}

function localizedTableAssistantFaq(locale: PriorityLocaleCode): readonly FaqItemCopy[] {
  if (locale === 'de') {
    return [
      faq('Ist der Tischassistent für Online- oder Papierpartien?', 'Er ist hauptsächlich für physische Commander-Partien gedacht, kann aber auch Online-Partien ergänzen.'),
      faq('Funktioniert er auf dem Smartphone?', 'Ja. Er ist besonders für Smartphones und Tablets gedacht.'),
      faq('Kann er Commander-Schaden verfolgen?', 'Ja. Commander-Schaden ist ein Kernteil des Tischassistenten.'),
    ];
  }

  if (locale === 'fr') {
    return [
      faq('L’assistant de table sert-il aux parties en ligne ou physiques ?', 'Il est surtout conçu pour les parties physiques de Commander, mais peut aussi compléter des parties en ligne.'),
      faq('Fonctionne-t-il sur mobile ?', 'Oui. Il est pensé spécialement pour mobile et tablette.'),
      faq('Peut-il suivre les blessures de commandant ?', 'Oui. Les blessures de commandant sont une partie essentielle de l’assistant de table.'),
    ];
  }

  if (locale === 'pt') {
    return [
      faq('O Assistente de mesa é para partidas online ou físicas?', 'Ele foi feito principalmente para partidas físicas de Commander, mas também pode complementar partidas online.'),
      faq('Funciona no celular?', 'Sim. Ele foi pensado especialmente para celular e tablet.'),
      faq('Pode controlar dano de comandante?', 'Sim. Dano de comandante é uma parte essencial do Assistente de mesa.'),
    ];
  }

  return [];
}

function localizedFaq(locale: PriorityLocaleCode): readonly FaqItemCopy[] {
  return MAIN_FAQ_ITEMS[locale];
}

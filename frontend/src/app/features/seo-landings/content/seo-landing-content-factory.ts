import {
  SEO_LOCALES,
  SEO_LOCALE_CODES,
  SeoLocaleCode,
  getLocaleHreflang,
} from '../../../core/localization/locale-config';
import { getSeoPath, SeoRouteKey } from '../../../core/localization/seo-routes';
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

type PriorityLocaleCode = 'es' | 'en' | 'de' | 'fr' | 'pt' | 'it';
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
const APP_DECKS_REGISTER_ENTRY_PATH = '/auth/register?redirect=/decks';
const APP_TABLE_ASSISTANT_REGISTER_ENTRY_PATH = '/auth/register?redirect=/table-assistant';

const LANDING_CTA_COPY = {
  home: {
    es: cta('Entrar y preparar mazo', 'Acceder a CommanderZone'),
    en: cta('Sign in and prepare deck', 'Open CommanderZone'),
    de: cta('Einloggen und Deck vorbereiten', 'CommanderZone öffnen'),
    fr: cta('Se connecter et préparer un deck', 'Ouvrir CommanderZone'),
    pt: cta('Entrar e preparar deck', 'Abrir CommanderZone'),
    it: cta('Accedi e prepara il mazzo', 'Apri CommanderZone'),
  },
  playCommanderOnline: {
    es: cta('Entrar para jugar Commander', 'Entrar y preparar mazo'),
    en: cta('Sign in to play Commander', 'Sign in and prepare deck'),
    de: cta('Einloggen und Commander spielen', 'Einloggen und Deck vorbereiten'),
    fr: cta('Se connecter pour jouer à Commander', 'Se connecter et préparer un deck'),
    pt: cta('Entrar para jogar Commander', 'Entrar e preparar deck'),
    it: cta('Accedi per giocare a Commander', 'Accedi e prepara il mazzo'),
  },
  playMagicOnlineWithFriends: {
    es: cta('Entrar y preparar mazo', 'Acceder a CommanderZone'),
    en: cta('Sign in and prepare deck', 'Open CommanderZone'),
    de: cta('Einloggen und Deck vorbereiten', 'CommanderZone öffnen'),
    fr: cta('Se connecter et préparer un deck', 'Ouvrir CommanderZone'),
    pt: cta('Entrar e preparar deck', 'Abrir CommanderZone'),
    it: cta('Accedi e prepara il mazzo', 'Apri CommanderZone'),
  },
  createCommanderRoom: {
    es: cta('Entrar y preparar partida', 'Acceder a mis mazos'),
    en: cta('Sign in and prepare game', 'Go to my decks'),
    de: cta('Einloggen und Partie vorbereiten', 'Zu meinen Decks'),
    fr: cta('Se connecter et préparer une partie', 'Accéder à mes decks'),
    pt: cta('Entrar e preparar partida', 'Acessar meus decks'),
    it: cta('Accedi e prepara la partita', 'Vai ai miei mazzi'),
  },
  importCommanderDeck: {
    es: cta('Entrar e importar mazo', 'Acceder a mis mazos'),
    en: cta('Sign in and import deck', 'Go to my decks'),
    de: cta('Einloggen und Deck importieren', 'Zu meinen Decks'),
    fr: cta('Se connecter et importer un deck', 'Accéder à mes decks'),
    pt: cta('Entrar e importar deck', 'Acessar meus decks'),
    it: cta('Accedi e importa il mazzo', 'Vai ai miei mazzi'),
  },
  commanderDeckBuilder: {
    es: cta('Entrar y preparar mazo', 'Acceder a mis mazos'),
    en: cta('Sign in and prepare deck', 'Go to my decks'),
    de: cta('Einloggen und Deck vorbereiten', 'Zu meinen Decks'),
    fr: cta('Se connecter et préparer un deck', 'Accéder à mes decks'),
    pt: cta('Entrar e preparar deck', 'Acessar meus decks'),
    it: cta('Accedi e prepara il mazzo', 'Vai ai miei mazzi'),
  },
  tableAssistant: {
    es: cta('Abrir Asistente de mesa', 'Entrar en CommanderZone'),
    en: cta('Open Table Assistant', 'Open CommanderZone'),
    de: cta('Tischassistent öffnen', 'CommanderZone öffnen'),
    fr: cta('Ouvrir l’assistant de table', 'Ouvrir CommanderZone'),
    pt: cta('Abrir Assistente de mesa', 'Abrir CommanderZone'),
    it: cta('Aprire Assistente da tavolo', 'Apri CommanderZone'),
  },
  waysToPlayCommanderOnline: {
    es: cta('Entrar y preparar partida', 'Acceder a CommanderZone'),
    en: cta('Sign in and prepare game', 'Open CommanderZone'),
    de: cta('Einloggen und Partie vorbereiten', 'CommanderZone öffnen'),
    fr: cta('Se connecter et préparer une partie', 'Ouvrir CommanderZone'),
    pt: cta('Entrar e preparar partida', 'Abrir CommanderZone'),
    it: cta('Accedi e prepara la partita', 'Apri CommanderZone'),
  },
  howToPlayCommanderOnline: {
    es: cta('Entrar y empezar', 'Acceder a CommanderZone'),
    en: cta('Sign in and start', 'Open CommanderZone'),
    de: cta('Einloggen und starten', 'CommanderZone öffnen'),
    fr: cta('Se connecter et commencer', 'Ouvrir CommanderZone'),
    pt: cta('Entrar e começar', 'Abrir CommanderZone'),
    it: cta('Accedi e inizia', 'Apri CommanderZone'),
  },
  faq: {
    es: cta('Entrar y preparar mazo', 'Acceder a CommanderZone'),
    en: cta('Sign in and prepare deck', 'Open CommanderZone'),
    de: cta('Einloggen und Deck vorbereiten', 'CommanderZone öffnen'),
    fr: cta('Se connecter et préparer un deck', 'Ouvrir CommanderZone'),
    pt: cta('Entrar e preparar deck', 'Abrir CommanderZone'),
    it: cta('Accedi e prepara il mazzo', 'Apri CommanderZone'),
  },
} as const satisfies Record<SeoRouteKey, Record<PriorityLocaleCode, LandingCtaCopy>>;

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
      section('link-invite', 'Il link è l’invito', 'Invitare altri giocatori dovrebbe essere semplice come condividere un link.'),
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
  faq: {
    es: faqCopy('FAQ CommanderZone | Preguntas frecuentes', 'Resuelve dudas sobre CommanderZone: preparar mazos, jugar Commander online, crear salas, importar mazos y usar el Asistente de mesa.', 'Preguntas frecuentes sobre CommanderZone', 'Respuestas claras sobre cómo preparar tu mazo, crear una sala y jugar Commander online o usar CommanderZone en partidas físicas.', 'Preparar mazo y jugar', 'Jugar Commander online', [
      faq('¿Qué es CommanderZone?', 'CommanderZone es una plataforma no oficial pensada para jugar Commander online, crear o importar mazos, analizarlos y usar herramientas de mesa para partidas online o físicas.'),
      faq('¿CommanderZone sirve para Commander MTG?', 'Sí. CommanderZone está pensada específicamente para partidas de Commander MTG, tanto online como en mesa física.'),
      faq('¿CommanderZone es oficial de Wizards of the Coast?', 'No. CommanderZone es un proyecto no oficial y no está afiliado, aprobado ni patrocinado por Wizards of the Coast.'),
      faq('¿CommanderZone es gratis?', 'CommanderZone tendrá una versión gratuita para jugar y probar las funciones principales. Algunas funciones avanzadas podrán formar parte de planes premium.'),
      faq('¿Necesito instalar algo?', 'No. CommanderZone está pensada para funcionar desde el navegador.'),
      faq('¿Tengo que registrarme para jugar?', 'La experiencia ideal debe permitir probar con poca fricción. Para guardar mazos, historial, estadísticas o personalización, sí tendrá sentido tener cuenta.'),
      faq('¿Cómo creo una partida?', 'Prepara o selecciona un mazo, crea una sala, comparte el enlace con tu grupo y prepara la mesa antes de empezar.'),
      faq('¿Necesito un mazo para crear una partida?', 'Sí. Para jugar en CommanderZone necesitas importar, crear o seleccionar un mazo antes de empezar.'),
      faq('¿Puedo crear una sala sin mazo?', 'La experiencia principal está pensada para preparar primero el mazo y después crear la sala, para que la partida empiece sin pasos pendientes.'),
      faq('¿CommanderZone sirve para otros formatos de Magic?', 'CommanderZone está enfocada principalmente en Commander. Algunas herramientas pueden servir para otros formatos, pero el producto está diseñado alrededor de partidas multijugador de Commander.'),
      faq('¿Las salas son privadas?', 'Las salas se comparten mediante enlace. La privacidad dependerá de cómo compartas ese enlace y de las opciones disponibles en la sala.'),
      faq('¿CommanderZone aplica reglas automáticamente?', 'No. La mesa es manual. CommanderZone ayuda a organizar la partida, pero las decisiones y reglas siguen siendo responsabilidad del grupo.'),
      faq('¿Puedo importar mis mazos?', 'Sí. Puedes importar listas para guardarlas, revisarlas y usarlas en tus partidas.'),
      faq('¿Puedo analizar mi mazo?', 'Sí. El análisis puede mostrar estructura general, curva, colores, tierras, tipos de carta y otros aspectos útiles.'),
      faq('¿Qué es el Asistente de mesa?', 'Es una herramienta para usar móvil o tablet durante partidas físicas de Commander.'),
      faq('¿Funciona en móvil o tablet?', 'Sí. El Asistente de mesa está pensado especialmente para móvil y tablet.'),
      faq('¿Qué ventajas tendría Premium?', 'Premium puede incluir funciones como más mazos, análisis avanzado, estadísticas, historial, personalización, salas persistentes, grupos guardados y experiencia sin anuncios o sponsors visuales.'),
      faq('¿Premium vende contenido oficial de Magic?', 'No debería. Premium debe vender herramientas propias, comodidad, análisis, almacenamiento, estadísticas y personalización, no contenido oficial de Magic.'),
    ]),
    en: faqCopy('CommanderZone FAQ | Frequently Asked Questions', 'Find answers about CommanderZone: preparing decks, playing Commander online, creating rooms, importing decks and using the Table Assistant.', 'Frequently asked questions about CommanderZone', 'Clear answers about preparing your deck, creating a room and playing Commander online or using CommanderZone for paper games.', 'Prepare deck and play', 'Play Commander online', [
      faq('What is CommanderZone?', 'CommanderZone is an unofficial platform built to play Commander online, create or import decks, analyze lists and use table tools for online or paper games.'),
      faq('Is CommanderZone built for MTG Commander?', 'Yes. CommanderZone is built specifically for MTG Commander games, both online and around a physical table.'),
      faq('Is CommanderZone official?', 'No. CommanderZone is an unofficial project and is not affiliated with, endorsed by, sponsored by, or specifically approved by Wizards of the Coast.'),
      faq('Is CommanderZone free?', 'CommanderZone will have a free version to play and try the main features. Some advanced features may be part of premium plans.'),
      faq('Do I need to install anything?', 'No. CommanderZone is designed to work from the browser.'),
      faq('Do I need an account to play?', 'The ideal experience should let users try it with low friction. To save decks, history, stats or customization, an account makes sense.'),
      faq('How do I create a game?', 'Prepare or choose a deck, create a room, share the link with your group and prepare the table before starting.'),
      faq('Do I need a deck to create a game?', 'Yes. To play in CommanderZone, you need to import, build or select a deck before starting.'),
      faq('Can I create a room without a deck?', 'The main experience is designed to prepare the deck first and then create the room, so the game starts without missing steps.'),
      faq('Can I use CommanderZone for other Magic formats?', 'CommanderZone is mainly focused on Commander. Some tools may work for other formats, but the product is designed around multiplayer Commander games.'),
      faq('Are rooms private?', 'Rooms are shared through a link. Privacy depends on how you share that link and which room options are available.'),
      faq('Does CommanderZone enforce Magic rules automatically?', 'No. The table is manual. CommanderZone helps organize the game, but decisions and rules remain the responsibility of the group.'),
      faq('Can I import my decks?', 'Yes. You can import lists to save, review and use them in your games.'),
      faq('Can I analyze my deck?', 'Yes. Analysis can show structure, curve, colors, lands, card types and other useful details.'),
      faq('What is the Table Assistant?', 'It is a tool for using a phone or tablet during paper Commander games.'),
      faq('Does it work on mobile or tablet?', 'Yes. The Table Assistant is designed especially for phones and tablets.'),
      faq('What would Premium include?', 'Premium may include more decks, advanced analysis, stats, history, customization, persistent rooms, saved groups and an experience without ads or visual sponsors.'),
      faq('Does Premium sell official Magic content?', 'No. Premium should sell CommanderZone’s own tools, convenience, analysis, storage, stats and customization, not official Magic content.'),
    ]),
    de: localizedPublicFaq('CommanderZone FAQ | Häufige Fragen', 'Antworten zu CommanderZone: Decks vorbereiten, Commander online spielen, Räume erstellen, Decks importieren und den Tischassistenten nutzen.', 'Häufige Fragen zu CommanderZone', 'Klare Antworten zum Vorbereiten von Decks, Erstellen von Räumen und Spielen von Commander online oder am Tisch.', 'Deck vorbereiten und spielen', 'Commander online spielen', 'de'),
    fr: localizedPublicFaq('FAQ CommanderZone | Questions fréquentes', 'Trouvez des réponses sur CommanderZone : préparer des decks, jouer à Commander en ligne, créer des salles, importer des decks et utiliser l’assistant de table.', 'Questions fréquentes sur CommanderZone', 'Des réponses claires pour préparer votre deck, créer une salle et jouer à Commander en ligne ou autour d’une table.', 'Préparer un deck et jouer', 'Jouer à Commander en ligne', 'fr'),
    pt: localizedPublicFaq('FAQ CommanderZone | Perguntas frequentes', 'Tire dúvidas sobre CommanderZone: preparar decks, jogar Commander online, criar salas, importar decks e usar o Assistente de mesa.', 'Perguntas frequentes sobre CommanderZone', 'Respostas claras sobre preparar seu deck, criar uma sala e jogar Commander online ou em partidas físicas.', 'Preparar deck e jogar', 'Jogar Commander online', 'pt'),
    it: faqCopy('FAQ CommanderZone | Domande frequenti', 'Trova risposte su CommanderZone: giocare a Commander online, creare stanze, importare mazzi, usare l’Assistente da tavolo, account, privacy e funzioni premium.', 'Domande frequenti su CommanderZone', 'Risposte chiare su come giocare a Commander online, creare stanze, importare mazzi e usare CommanderZone online o al tavolo fisico.', 'Preparare mazzo e giocare', 'Giocare a Commander online', [
      faq('Cos’è CommanderZone?', 'CommanderZone è una piattaforma non ufficiale pensata per giocare a Commander online, creare o importare mazzi, analizzarli e usare strumenti da tavolo per partite online o fisiche.'),
      faq('CommanderZone è pensato per Commander MTG?', 'Sì. CommanderZone è pensato specificamente per partite di Commander MTG, online o al tavolo fisico.'),
      faq('CommanderZone è ufficiale?', 'No. CommanderZone è un progetto non ufficiale e non è affiliato, approvato, sponsorizzato o autorizzato da Wizards of the Coast.'),
      faq('CommanderZone è gratis?', 'CommanderZone è pensato per avere una versione gratuita con le funzioni principali per giocare e provare la piattaforma. Alcune funzioni avanzate potranno far parte di piani premium.'),
      faq('Devo installare qualcosa?', 'No. CommanderZone funziona dal browser.'),
      faq('Serve un account per giocare?', 'Vogliamo mantenere l’esperienza il più semplice possibile. Per salvare mazzi, storico, statistiche o personalizzazioni, avere un account ha senso.'),
      faq('Mi serve un mazzo per creare una partita?', 'Sì. Per giocare in CommanderZone devi importare, creare o selezionare un mazzo prima di iniziare.'),
      faq('Posso creare una stanza senza mazzo?', 'L’esperienza principale è pensata per preparare prima il mazzo e poi creare la stanza, così la partita parte senza passaggi mancanti.'),
      faq('Posso usare CommanderZone per altri formati di Magic?', 'CommanderZone è focalizzato principalmente su Commander. Alcuni strumenti possono essere utili anche per altri formati, ma il prodotto è progettato intorno alle partite multiplayer di Commander.'),
      faq('Come creo una partita?', 'Prepara il mazzo, crea una stanza, condividi il link con il tuo gruppo e organizza il tavolo prima di iniziare.'),
      faq('Le stanze sono private?', 'Le stanze si condividono tramite link. La privacy dipende da come condividi quel link e dalle opzioni disponibili nella stanza.'),
      faq('Posso invitare amici con un link?', 'Sì. Il flusso principale di CommanderZone è pensato per creare una stanza e condividere il link con il tuo pod.'),
      faq('Posso giocare a Commander online con più giocatori?', 'Sì. CommanderZone è pensato per partite multiplayer di Commander.'),
      faq('CommanderZone applica automaticamente le regole?', 'No. Il tavolo è manuale. CommanderZone aiuta a organizzare la partita, ma decisioni e regole restano responsabilità del gruppo.'),
      faq('Posso importare i miei mazzi?', 'Sì. Puoi importare liste per salvarle, rivederle e usarle nelle tue partite.'),
      faq('Posso incollare una decklist?', 'Sì. CommanderZone deve permettere di importare mazzi da testo per non dover creare la lista da zero.'),
      faq('Posso creare e modificare mazzi?', 'Sì. CommanderZone include strumenti per creare, importare, modificare e organizzare mazzi Commander.'),
      faq('Posso analizzare il mio mazzo?', 'Sì. L’analisi può mostrare struttura generale, curva, colori, terre, tipi di carta e altri aspetti utili.'),
      faq('Cos’è l’Assistente da tavolo?', 'È uno strumento per usare smartphone o tablet durante partite fisiche di Commander.'),
      faq('Funziona su smartphone o tablet?', 'Sì. L’Assistente da tavolo è pensato soprattutto per smartphone e tablet.'),
      faq('Può tenere traccia del danno da comandante?', 'Sì. Il danno da comandante è una parte essenziale dell’Assistente da tavolo.'),
      faq('Posso usare l’Assistente da tavolo senza creare una stanza online?', 'L’esperienza ideale dovrebbe permettere di usarlo con la minore frizione possibile durante partite dal vivo.'),
      faq('Mi serve una webcam per giocare?', 'Dipende da come vuole giocare il tuo gruppo. CommanderZone può completare una partita con webcam, ma non obbliga a usare una camera.'),
      faq('Posso usare carte fisiche?', 'Sì. CommanderZone può completare partite in cui ogni giocatore usa le proprie carte fisiche e il gruppo ha bisogno di un tavolo o assistente digitale.'),
      faq('CommanderZone è un’alternativa a SpellTable?', 'CommanderZone può essere un’alternativa o un complemento, soprattutto se cerchi un tavolo manuale collegato a mazzi e strumenti specifici per Commander.'),
      faq('Cosa includerebbe Premium?', 'Premium sarà orientato a funzioni come più mazzi, analisi avanzata, statistiche, storico, personalizzazione, stanze persistenti, gruppi salvati ed esperienza senza annunci o sponsor visivi.'),
      faq('Premium vende contenuto ufficiale di Magic?', 'No. Premium deve vendere strumenti propri di CommanderZone: comodità, analisi, archiviazione, statistiche e personalizzazione.'),
    ]),
  },
} as const satisfies Record<SeoRouteKey, Record<PriorityLocaleCode, LandingCopy>>;

const ROUTE_LABELS = LANDING_COPY;

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
        src: seo.ogImage,
        alt: `${copy.h1} - CommanderZone`,
        width: 1200,
        height: 630,
        loading: 'eager',
        fetchPriority: 'high',
      },
      primaryLink: { label: ctaCopy.primaryCta, href: getPrimaryCtaHref(routeKey) },
      secondaryLink: { label: ctaCopy.secondaryCta, href: getSecondaryCtaHref(routeKey) },
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
    faqPreview: {
      id: 'quick-faq',
      title: uiCopy.faqTitle,
      intro: uiCopy.faqIntro,
      items: routeKey === 'home' ? faqContent.items : faqContent.items.slice(0, 2),
    },
    fullFaq: faqContent,
    faq: faqContent,
    cta: {
      id: 'cta',
      title: copy.ctaTitle ?? uiCopy.defaultCtaTitle,
      description: copy.ctaDescription ?? uiCopy.defaultCtaDescription,
      primaryLink: { label: ctaCopy.primaryCta, href: getPrimaryCtaHref(routeKey) },
      secondaryLink: { label: ctaCopy.secondaryCta, href: getSecondaryCtaHref(routeKey) },
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
    createOrganizationJsonLd(),
    createBreadcrumbJsonLd(canonicalUrl, breadcrumb),
  ];

  if (routeKey === 'home') {
    graph.push(createWebSiteJsonLd(locale, description, canonicalUrl));
  }

  if (isProductLandingRoute(routeKey)) {
    graph.push(createSoftwareApplicationJsonLd(locale, title, description, canonicalUrl, seo.ogImage));
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

function createOrganizationJsonLd(): SeoJsonLdObject {
  return {
    '@type': 'Organization',
    '@id': `${SEO_CANONICAL_ORIGIN}/#organization`,
    name: 'CommanderZone',
    url: SEO_CANONICAL_ORIGIN,
  };
}

function createWebSiteJsonLd(locale: SeoLocaleCode, description: string, canonicalUrl: string): SeoJsonLdObject {
  return {
    '@type': 'WebSite',
    '@id': `${canonicalUrl}#website`,
    name: 'CommanderZone',
    description,
    url: canonicalUrl,
    inLanguage: getLocaleHreflang(locale),
    publisher: { '@id': `${SEO_CANONICAL_ORIGIN}/#organization` },
  };
}

function createSoftwareApplicationJsonLd(
  locale: SeoLocaleCode,
  title: string,
  description: string,
  canonicalUrl: string,
  imagePath: string,
): SeoJsonLdObject {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${canonicalUrl}#software-application`,
    name: title,
    description,
    url: canonicalUrl,
    image: toSeoAbsoluteUrl(imagePath),
    inLanguage: getLocaleHreflang(locale),
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web browser',
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
    name: faq.title || title,
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
  return (GUIDE_LANDING_ROUTE_KEYS as readonly SeoRouteKey[]).includes(routeKey)
    || (COMPARISON_LANDING_ROUTE_KEYS as readonly SeoRouteKey[]).includes(routeKey);
}

function getLandingCopy(routeKey: SeoRouteKey, locale: PriorityLocaleCode): LandingCopy {
  return LANDING_COPY[routeKey][locale];
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
  return ROUTE_LABELS[routeKey][locale].h1;
}

function getRelatedRouteKeys(routeKey: SeoRouteKey): readonly SeoRouteKey[] {
  if (routeKey === 'home') {
    return [
      'playCommanderOnline',
      'playMagicOnlineWithFriends',
      'createCommanderRoom',
      'importCommanderDeck',
      'commanderDeckBuilder',
      'tableAssistant',
      'waysToPlayCommanderOnline',
      'howToPlayCommanderOnline',
      'faq',
    ];
  }

  if (routeKey === 'faq') {
    return [
      'home',
      'playCommanderOnline',
      'playMagicOnlineWithFriends',
      'createCommanderRoom',
      'importCommanderDeck',
      'commanderDeckBuilder',
      'tableAssistant',
      'waysToPlayCommanderOnline',
      'howToPlayCommanderOnline',
    ];
  }

  return [
    'home',
    'playCommanderOnline',
    'createCommanderRoom',
    'importCommanderDeck',
    'commanderDeckBuilder',
    'tableAssistant',
    'waysToPlayCommanderOnline',
    'howToPlayCommanderOnline',
    'faq',
  ].filter((relatedRouteKey) => relatedRouteKey !== routeKey) as readonly SeoRouteKey[];
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

function getPrimaryCtaHref(routeKey: SeoRouteKey): string {
  if (routeKey === 'home') {
    return APP_DECKS_REGISTER_ENTRY_PATH;
  }

  if (routeKey === 'tableAssistant') {
    return APP_TABLE_ASSISTANT_REGISTER_ENTRY_PATH;
  }

  return APP_DECKS_ENTRY_PATH;
}

function getSecondaryCtaHref(routeKey: SeoRouteKey): string {
  if (routeKey === 'home') {
    return APP_DECKS_REGISTER_ENTRY_PATH;
  }

  if (routeKey === 'tableAssistant') {
    return APP_TABLE_ASSISTANT_REGISTER_ENTRY_PATH;
  }

  return APP_DECKS_ENTRY_PATH;
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

  const sections = {
    de: {
      playCommanderOnline: [
        section('fast-start', 'Schneller in die Partie', 'Du brauchst keine komplexe Plattform, um loszulegen. Der Ablauf ist direkt: Deck vorbereiten, Raum erstellen, Link teilen und spielen.'),
        section('manual-control', 'Manueller Tisch, echte Kontrolle', 'Commander ist ein soziales Format. CommanderZone gibt deiner Gruppe Werkzeuge, aber die Spieler behalten die Kontrolle.'),
        section('long-games', 'Für lange Partien gebaut', 'Commander-Partien können lange dauern. Die Oberfläche soll klar, stabil und bequem bleiben.'),
      ],
      createCommanderRoom: [
        section('deck-first', 'Erst das Deck, dann der Raum', 'Um eine Partie zu starten, brauchst du ein vorbereitetes Deck. Importiere eine Deckliste, erstelle ein Deck neu oder wähle ein gespeichertes Deck vor dem Erstellen des Raums.'),
        section('link-invite', 'Der Link ist die Einladung', 'Andere Spieler einzuladen sollte so einfach sein wie einen Link zu teilen.'),
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

  return sections[locale][routeKey];
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
  if (locale === 'de') {
    return [
      faq('Was ist CommanderZone?', 'CommanderZone ist eine inoffizielle Plattform, um Commander online zu spielen, Decks zu erstellen oder zu importieren, Listen zu analysieren und Tischwerkzeuge für Online- oder Papierpartien zu nutzen.'),
      faq('Ist CommanderZone für MTG Commander gedacht?', 'Ja. CommanderZone ist speziell für MTG Commander-Partien gedacht, online und am physischen Tisch.'),
      faq('Ist CommanderZone offiziell?', 'Nein. CommanderZone ist ein inoffizielles Projekt und nicht mit Wizards of the Coast verbunden, unterstützt, gesponsert oder speziell genehmigt.'),
      faq('Ist CommanderZone kostenlos?', 'CommanderZone wird eine kostenlose Version zum Spielen und Testen der Hauptfunktionen haben. Einige fortgeschrittene Funktionen können Teil von Premium-Plänen sein.'),
      faq('Muss ich etwas installieren?', 'Nein. CommanderZone ist für den Browser gedacht.'),
      faq('Brauche ich ein Konto zum Spielen?', 'Die ideale Erfahrung soll einen Einstieg mit wenig Reibung erlauben. Für gespeicherte Decks, Verlauf, Statistiken oder Anpassung ist ein Konto sinnvoll.'),
      faq('Wie erstelle ich eine Partie?', 'Bereite ein Deck vor oder wähle eines aus, erstelle einen Raum, teile den Link mit deiner Gruppe und bereite den Tisch vor dem Start vor.'),
      faq('Brauche ich ein Deck, um eine Partie zu erstellen?', 'Ja. Um in CommanderZone zu spielen, musst du zuerst ein Deck importieren, erstellen oder auswählen.'),
      faq('Kann ich einen Raum ohne Deck erstellen?', 'Die Hauptnutzung ist darauf ausgelegt, zuerst das Deck vorzubereiten und danach den Raum zu erstellen, damit die Partie ohne fehlende Schritte beginnt.'),
      faq('Kann ich CommanderZone für andere Magic-Formate nutzen?', 'CommanderZone ist hauptsächlich auf Commander ausgelegt. Einige Werkzeuge können auch für andere Formate nützlich sein, aber das Produkt ist für Multiplayer-Commander-Partien entwickelt.'),
      faq('Sind Räume privat?', 'Räume werden über einen Link geteilt. Die Privatsphäre hängt davon ab, wie du den Link teilst und welche Raumoptionen verfügbar sind.'),
      faq('Automatisiert CommanderZone Magic-Regeln?', 'Nein. Der Tisch ist manuell. CommanderZone hilft beim Organisieren der Partie, aber Entscheidungen und Regeln bleiben Sache der Gruppe.'),
      faq('Kann ich meine Decks importieren?', 'Ja. Du kannst Listen importieren, speichern, prüfen und in deinen Partien nutzen.'),
      faq('Kann ich mein Deck analysieren?', 'Ja. Die Analyse kann Struktur, Kurve, Farben, Länder, Kartentypen und weitere nützliche Details zeigen.'),
      faq('Was ist der Tischassistent?', 'Ein Werkzeug, um Smartphone oder Tablet bei physischen Commander-Partien zu nutzen.'),
      faq('Funktioniert er auf Smartphone oder Tablet?', 'Ja. Der Tischassistent ist besonders für Smartphone und Tablet gedacht.'),
      faq('Was könnte Premium enthalten?', 'Premium kann mehr Decks, erweiterte Analyse, Statistiken, Verlauf, Anpassung, persistente Räume, gespeicherte Gruppen und eine Erfahrung ohne Anzeigen oder visuelle Sponsoren enthalten.'),
      faq('Verkauft Premium offizielle Magic-Inhalte?', 'Nein. Premium sollte CommanderZones eigene Werkzeuge, Komfort, Analyse, Speicher, Statistiken und Anpassung verkaufen, nicht offizielle Magic-Inhalte.'),
    ];
  }

  if (locale === 'fr') {
    return [
      faq('Qu’est-ce que CommanderZone ?', 'CommanderZone est une plateforme non officielle pensée pour jouer à Commander en ligne, créer ou importer des decks, analyser des listes et utiliser des outils de table pour les parties en ligne ou physiques.'),
      faq('CommanderZone est-il pensé pour Commander MTG ?', 'Oui. CommanderZone est pensé spécifiquement pour les parties de Commander MTG, en ligne comme autour d’une table physique.'),
      faq('CommanderZone est-il officiel ?', 'Non. CommanderZone est un projet non officiel et n’est pas affilié, approuvé, sponsorisé ni spécifiquement validé par Wizards of the Coast.'),
      faq('CommanderZone est-il gratuit ?', 'CommanderZone aura une version gratuite pour jouer et tester les fonctions principales. Certaines fonctions avancées pourront faire partie de plans premium.'),
      faq('Dois-je installer quelque chose ?', 'Non. CommanderZone est conçu pour fonctionner depuis le navigateur.'),
      faq('Faut-il un compte pour jouer ?', 'L’expérience idéale doit permettre d’essayer avec peu de friction. Pour sauvegarder des decks, l’historique, les statistiques ou la personnalisation, un compte a du sens.'),
      faq('Comment créer une partie ?', 'Préparez ou choisissez un deck, créez une salle, partagez le lien avec votre groupe et préparez la table avant de commencer.'),
      faq('Ai-je besoin d’un deck pour créer une partie ?', 'Oui. Pour jouer dans CommanderZone, vous devez importer, créer ou sélectionner un deck avant de commencer.'),
      faq('Puis-je créer une salle sans deck ?', 'L’expérience principale est conçue pour préparer d’abord le deck, puis créer la salle, afin que la partie commence sans étape manquante.'),
      faq('Puis-je utiliser CommanderZone pour d’autres formats de Magic ?', 'CommanderZone est principalement centré sur Commander. Certains outils peuvent servir à d’autres formats, mais le produit est conçu autour des parties multijoueurs de Commander.'),
      faq('Les salles sont-elles privées ?', 'Les salles sont partagées par lien. La confidentialité dépend de la façon dont vous partagez ce lien et des options disponibles.'),
      faq('CommanderZone applique-t-il automatiquement les règles ?', 'Non. La table est manuelle. CommanderZone aide à organiser la partie, mais les décisions et règles restent sous la responsabilité du groupe.'),
      faq('Puis-je importer mes decks ?', 'Oui. Vous pouvez importer des listes pour les sauvegarder, les vérifier et les utiliser dans vos parties.'),
      faq('Puis-je analyser mon deck ?', 'Oui. L’analyse peut montrer la structure, la courbe, les couleurs, les terrains, les types de carte et d’autres détails utiles.'),
      faq('Qu’est-ce que l’assistant de table ?', 'C’est un outil pour utiliser un mobile ou une tablette pendant les parties physiques de Commander.'),
      faq('Fonctionne-t-il sur mobile ou tablette ?', 'Oui. L’assistant de table est pensé spécialement pour mobile et tablette.'),
      faq('Que pourrait inclure Premium ?', 'Premium peut inclure plus de decks, une analyse avancée, des statistiques, l’historique, la personnalisation, des salles persistantes, des groupes sauvegardés et une expérience sans annonces ni sponsors visuels.'),
      faq('Premium vend-il du contenu officiel Magic ?', 'Non. Premium doit vendre les outils propres à CommanderZone, le confort, l’analyse, le stockage, les statistiques et la personnalisation, pas du contenu officiel Magic.'),
    ];
  }

  if (locale === 'pt') {
    return [
      faq('O que é CommanderZone?', 'CommanderZone é uma plataforma não oficial feita para jogar Commander online, criar ou importar decks, analisar listas e usar ferramentas de mesa em partidas online ou físicas.'),
      faq('CommanderZone é feito para Commander MTG?', 'Sim. CommanderZone foi feito especificamente para partidas de Commander MTG, online ou em mesa física.'),
      faq('CommanderZone é oficial?', 'Não. CommanderZone é um projeto não oficial e não é afiliado, aprovado, patrocinado ou especificamente autorizado pela Wizards of the Coast.'),
      faq('CommanderZone é grátis?', 'CommanderZone terá uma versão gratuita para jogar e testar as funções principais. Algumas funções avançadas podem fazer parte de planos premium.'),
      faq('Preciso instalar algo?', 'Não. CommanderZone foi pensado para funcionar pelo navegador.'),
      faq('Preciso de conta para jogar?', 'A experiência ideal deve permitir testar com pouca fricção. Para salvar decks, histórico, estatísticas ou personalização, uma conta faz sentido.'),
      faq('Como crio uma partida?', 'Prepare ou escolha um deck, crie uma sala, compartilhe o link com seu grupo e prepare a mesa antes de começar.'),
      faq('Preciso de um deck para criar uma partida?', 'Sim. Para jogar no CommanderZone, você precisa importar, criar ou selecionar um deck antes de começar.'),
      faq('Posso criar uma sala sem deck?', 'A experiência principal foi pensada para preparar primeiro o deck e depois criar a sala, para que a partida comece sem etapas pendentes.'),
      faq('Posso usar CommanderZone para outros formatos de Magic?', 'CommanderZone é focado principalmente em Commander. Algumas ferramentas podem servir para outros formatos, mas o produto foi desenhado para partidas multiplayer de Commander.'),
      faq('As salas são privadas?', 'As salas são compartilhadas por link. A privacidade depende de como você compartilha esse link e das opções disponíveis na sala.'),
      faq('CommanderZone aplica regras automaticamente?', 'Não. A mesa é manual. CommanderZone ajuda a organizar a partida, mas decisões e regras continuam responsabilidade do grupo.'),
      faq('Posso importar meus decks?', 'Sim. Você pode importar listas para salvar, revisar e usar nas partidas.'),
      faq('Posso analisar meu deck?', 'Sim. A análise pode mostrar estrutura, curva, cores, terrenos, tipos de carta e outros detalhes úteis.'),
      faq('O que é o Assistente de mesa?', 'É uma ferramenta para usar celular ou tablet durante partidas físicas de Commander.'),
      faq('Funciona em celular ou tablet?', 'Sim. O Assistente de mesa foi pensado especialmente para celular e tablet.'),
      faq('O que Premium poderia incluir?', 'Premium pode incluir mais decks, análise avançada, estatísticas, histórico, personalização, salas persistentes, grupos salvos e uma experiência sem anúncios ou sponsors visuais.'),
      faq('Premium vende conteúdo oficial de Magic?', 'Não. Premium deve vender ferramentas próprias do CommanderZone, conveniência, análise, armazenamento, estatísticas e personalização, não conteúdo oficial de Magic.'),
    ];
  }

  return [];
}

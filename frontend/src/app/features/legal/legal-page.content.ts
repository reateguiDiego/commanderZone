import { SeoLocaleCode } from '../../core/localization/locale-config';
import { LEGAL_CONTACT_EMAIL, LegalPageKey } from '../../core/legal/legal-routes';

export interface LegalSectionContent {
  readonly heading: string;
  readonly body: readonly string[];
}

export interface LegalPageContent {
  readonly pageKey: LegalPageKey;
  readonly locale: SeoLocaleCode;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  readonly homeLabel: string;
  readonly footerLabel: string;
  readonly disclaimer: string;
  readonly sections: readonly LegalSectionContent[];
}

const COMMON_FAN_CONTENT = {
  en: 'CommanderZone is unofficial fan content. It is not affiliated with, endorsed by, sponsored by, or specifically approved by Wizards of the Coast or Hasbro.',
  es: 'CommanderZone es contenido de fans no oficial. No está afiliado, respaldado, patrocinado ni aprobado específicamente por Wizards of the Coast o Hasbro.',
  de: 'CommanderZone ist inoffizieller Fan-Content. Es ist nicht mit Wizards of the Coast oder Hasbro verbunden, wird nicht von ihnen unterstützt, gesponsert oder ausdrücklich genehmigt.',
  fr: 'CommanderZone est un contenu de fan non officiel. Il n’est pas affilié, approuvé, sponsorisé ni spécifiquement validé par Wizards of the Coast ou Hasbro.',
  pt: 'CommanderZone é conteúdo de fã não oficial. Não é afiliado, endossado, patrocinado nem aprovado especificamente pela Wizards of the Coast ou pela Hasbro.',
  it: 'CommanderZone è contenuto fan non ufficiale. Non è affiliato, approvato, sponsorizzato né specificamente autorizzato da Wizards of the Coast o Hasbro.',
} as const satisfies Record<SeoLocaleCode, string>;

const HOME_LABELS = {
  en: 'CommanderZone home',
  es: 'Inicio de CommanderZone',
  de: 'CommanderZone Startseite',
  fr: 'Accueil CommanderZone',
  pt: 'Início do CommanderZone',
  it: 'Home di CommanderZone',
} as const satisfies Record<SeoLocaleCode, string>;

const FOOTER_LABELS = {
  en: 'Legal pages',
  es: 'Páginas legales',
  de: 'Rechtliche Seiten',
  fr: 'Pages légales',
  pt: 'Páginas legais',
  it: 'Pagine legali',
} as const satisfies Record<SeoLocaleCode, string>;

export const LEGAL_PAGE_CONTENT = {
  privacy: {
    en: legalPage('privacy', 'en', 'Privacy Policy | CommanderZone', 'Privacy Policy', 'How CommanderZone handles account data, cookies, deck data, room metadata, logs and optional analytics.', [
      section('Who we are', 'CommanderZone is a browser-based tool for manual Magic: The Gathering Commander games online and for supporting physical games. CommanderZone does not sell official Magic products.'),
      section('What data we process', 'CommanderZone may process account information, session cookies, deck data, room and game metadata, technical logs and optional analytics if you accept analytics cookies.'),
      section('Account and authentication data', 'If you create an account, we may process identifiers such as email address, display name, authentication tokens and security events needed to operate the service.'),
      section('Deck and gameplay-related data', 'Deck lists, room settings, game metadata and manual table actions may be stored so the app can provide the features you choose to use. CommanderZone does not validate legal play or automate Magic rules.'),
      section('Cookies and local storage', 'Essential cookies and local storage may be required for login, session security, consent preferences and app functionality.'),
      section('Analytics consent', 'Optional analytics are disabled unless you accept them. If enabled, analytics may help us understand aggregated usage and technical performance.'),
      section('Legal basis and user choices', 'We process data to provide the service, protect sessions, respond to requests and respect your consent choices where consent is required.'),
      section('Data retention', 'We keep data only as long as reasonably needed for the service, security, support, legal obligations or user-controlled account features.'),
      section('Contact', `For privacy questions, contact ${LEGAL_CONTACT_EMAIL}. This page is informational and is not legal advice.`),
    ]),
    es: legalPage('privacy', 'es', 'Política de privacidad | CommanderZone', 'Política de privacidad', 'Cómo CommanderZone trata datos de cuenta, cookies, mazos, metadatos de sala, registros técnicos y analítica opcional.', [
      section('Quiénes somos', 'CommanderZone es una herramienta de navegador para partidas manuales de Magic: The Gathering Commander online y para apoyar partidas físicas. CommanderZone no vende productos oficiales de Magic.'),
      section('Qué datos tratamos', 'CommanderZone puede tratar datos de cuenta, cookies de sesión, datos de mazos, metadatos de salas y partidas, registros técnicos y analítica opcional si la aceptas.'),
      section('Cuenta y autenticación', 'Si creas una cuenta, podemos tratar identificadores como email, nombre visible, tokens de autenticación y eventos de seguridad necesarios para operar el servicio.'),
      section('Mazos y datos relacionados con partidas', 'Las listas de mazo, ajustes de sala, metadatos de partida y acciones manuales de mesa pueden guardarse para ofrecer las funciones que decides usar. CommanderZone no valida jugadas legales ni automatiza reglas de Magic.'),
      section('Cookies y almacenamiento local', 'Las cookies esenciales y el almacenamiento local pueden ser necesarios para login, seguridad de sesión, preferencias de consentimiento y funcionamiento de la app.'),
      section('Analítica opcional', 'La analítica opcional está desactivada salvo que la aceptes. Si se activa, puede ayudarnos a entender uso agregado y rendimiento técnico.'),
      section('Base legal y opciones del usuario', 'Tratamos datos para prestar el servicio, proteger sesiones, responder solicitudes y respetar tus opciones de consentimiento cuando proceda.'),
      section('Conservación de datos', 'Conservamos datos solo durante el tiempo razonablemente necesario para el servicio, seguridad, soporte, obligaciones legales o funciones de cuenta controladas por el usuario.'),
      section('Contacto', `Para consultas de privacidad, contacta con ${LEGAL_CONTACT_EMAIL}. Esta página es informativa y no es asesoramiento legal.`),
    ]),
    de: legalPage('privacy', 'de', 'Datenschutzerklärung | CommanderZone', 'Datenschutzerklärung', 'Wie CommanderZone Kontodaten, Cookies, Deckdaten, Raum-Metadaten, technische Logs und optionale Analyse verarbeitet.', [
      section('Wer wir sind', 'CommanderZone ist ein Browser-Tool für manuelle Magic: The Gathering Commander-Partien online und zur Unterstützung physischer Partien. CommanderZone verkauft keine offiziellen Magic-Produkte.'),
      section('Welche Daten wir verarbeiten', 'CommanderZone kann Kontodaten, Sitzungscookies, Deckdaten, Raum- und Spielmetadaten, technische Logs und optionale Analyse verarbeiten, wenn du Analyse-Cookies akzeptierst.'),
      section('Konto und Authentifizierung', 'Wenn du ein Konto erstellst, können wir Kennungen wie E-Mail-Adresse, Anzeigename, Authentifizierungs-Tokens und Sicherheitsereignisse verarbeiten, die für den Betrieb nötig sind.'),
      section('Decks und spielbezogene Daten', 'Decklisten, Raumeinstellungen, Spielmetadaten und manuelle Tischaktionen können gespeichert werden, um die gewählten Funktionen bereitzustellen. CommanderZone validiert keine legalen Spielzüge und automatisiert keine Magic-Regeln.'),
      section('Cookies und lokaler Speicher', 'Essenzielle Cookies und lokaler Speicher können für Login, Sitzungssicherheit, Einwilligungspräferenzen und App-Funktionen erforderlich sein.'),
      section('Optionale Analyse', 'Optionale Analyse ist deaktiviert, sofern du sie nicht akzeptierst. Wenn aktiviert, hilft sie uns, aggregierte Nutzung und technische Leistung zu verstehen.'),
      section('Rechtsgrundlage und Wahlmöglichkeiten', 'Wir verarbeiten Daten, um den Dienst bereitzustellen, Sitzungen zu schützen, Anfragen zu beantworten und Einwilligungen zu respektieren.'),
      section('Speicherdauer', 'Wir speichern Daten nur so lange, wie es für Dienst, Sicherheit, Support, rechtliche Pflichten oder nutzergesteuerte Kontofunktionen angemessen nötig ist.'),
      section('Kontakt', `Bei Datenschutzfragen kontaktiere ${LEGAL_CONTACT_EMAIL}. Diese Seite dient der Information und ist keine Rechtsberatung.`),
    ]),
    fr: legalPage('privacy', 'fr', 'Politique de confidentialité | CommanderZone', 'Politique de confidentialité', 'Comment CommanderZone traite les données de compte, cookies, decks, métadonnées de salon, journaux techniques et analyse optionnelle.', [
      section('Qui nous sommes', 'CommanderZone est un outil de navigateur pour des parties manuelles de Magic: The Gathering Commander en ligne et pour accompagner les parties physiques. CommanderZone ne vend pas de produits Magic officiels.'),
      section('Données traitées', 'CommanderZone peut traiter des données de compte, cookies de session, données de decks, métadonnées de salons et parties, journaux techniques et analyse optionnelle si vous l’acceptez.'),
      section('Compte et authentification', 'Si vous créez un compte, nous pouvons traiter des identifiants comme l’adresse e-mail, le nom affiché, les jetons d’authentification et les événements de sécurité nécessaires au service.'),
      section('Decks et données liées aux parties', 'Les listes de decks, paramètres de salon, métadonnées de partie et actions manuelles de table peuvent être conservés pour fournir les fonctions choisies. CommanderZone ne valide pas les actions légales et n’automatise pas les règles de Magic.'),
      section('Cookies et stockage local', 'Les cookies essentiels et le stockage local peuvent être nécessaires pour la connexion, la sécurité de session, les préférences de consentement et le fonctionnement de l’application.'),
      section('Analyse optionnelle', 'L’analyse optionnelle est désactivée sauf si vous l’acceptez. Si elle est activée, elle nous aide à comprendre l’usage agrégé et la performance technique.'),
      section('Base légale et choix utilisateur', 'Nous traitons les données pour fournir le service, protéger les sessions, répondre aux demandes et respecter vos choix de consentement lorsque c’est requis.'),
      section('Conservation des données', 'Nous conservons les données uniquement le temps raisonnablement nécessaire au service, à la sécurité, au support, aux obligations légales ou aux fonctions de compte.'),
      section('Contact', `Pour les questions de confidentialité, contactez ${LEGAL_CONTACT_EMAIL}. Cette page est informative et ne constitue pas un conseil juridique.`),
    ]),
    pt: legalPage('privacy', 'pt', 'Política de privacidade | CommanderZone', 'Política de privacidade', 'Como o CommanderZone processa dados de conta, cookies, decks, metadados de sala, logs técnicos e análise opcional.', [
      section('Quem somos', 'CommanderZone é uma ferramenta de navegador para partidas manuais de Magic: The Gathering Commander online e para apoiar partidas físicas. CommanderZone não vende produtos oficiais de Magic.'),
      section('Quais dados processamos', 'CommanderZone pode processar dados de conta, cookies de sessão, dados de decks, metadados de salas e partidas, logs técnicos e análise opcional se você aceitar.'),
      section('Conta e autenticação', 'Se você criar uma conta, podemos processar identificadores como e-mail, nome exibido, tokens de autenticação e eventos de segurança necessários para operar o serviço.'),
      section('Decks e dados relacionados às partidas', 'Listas de decks, configurações de sala, metadados de partida e ações manuais de mesa podem ser armazenados para fornecer os recursos que você escolhe usar. CommanderZone não valida jogadas legais nem automatiza regras de Magic.'),
      section('Cookies e armazenamento local', 'Cookies essenciais e armazenamento local podem ser necessários para login, segurança de sessão, preferências de consentimento e funcionamento do app.'),
      section('Análise opcional', 'A análise opcional fica desativada a menos que você aceite. Se ativada, ela nos ajuda a entender uso agregado e desempenho técnico.'),
      section('Base legal e escolhas do usuário', 'Processamos dados para fornecer o serviço, proteger sessões, responder solicitações e respeitar suas escolhas de consentimento quando necessário.'),
      section('Retenção de dados', 'Mantemos dados apenas pelo tempo razoavelmente necessário para o serviço, segurança, suporte, obrigações legais ou recursos de conta controlados pelo usuário.'),
      section('Contato', `Para questões de privacidade, entre em contato em ${LEGAL_CONTACT_EMAIL}. Esta página é informativa e não é aconselhamento jurídico.`),
    ]),
    it: legalPage('privacy', 'it', 'Informativa sulla privacy | CommanderZone', 'Informativa sulla privacy', 'Come CommanderZone tratta dati account, cookie, mazzi, metadati delle stanze, log tecnici e analisi opzionale.', [
      section('Chi siamo', 'CommanderZone è uno strumento browser per partite manuali di Magic: The Gathering Commander online e per supportare partite fisiche. CommanderZone non vende prodotti ufficiali Magic.'),
      section('Quali dati trattiamo', 'CommanderZone può trattare dati account, cookie di sessione, dati dei mazzi, metadati di stanze e partite, log tecnici e analisi opzionale se accettata.'),
      section('Account e autenticazione', 'Se crei un account, possiamo trattare identificativi come email, nome visualizzato, token di autenticazione ed eventi di sicurezza necessari al servizio.'),
      section('Mazzi e dati collegati alle partite', 'Liste dei mazzi, impostazioni stanza, metadati di partita e azioni manuali del tavolo possono essere salvati per fornire le funzioni scelte. CommanderZone non valida giocate legali e non automatizza le regole di Magic.'),
      section('Cookie e archiviazione locale', 'Cookie essenziali e archiviazione locale possono essere necessari per login, sicurezza sessione, preferenze di consenso e funzionamento dell’app.'),
      section('Analisi opzionale', 'L’analisi opzionale è disattivata salvo accettazione. Se attivata, aiuta a capire uso aggregato e prestazioni tecniche.'),
      section('Base giuridica e scelte dell’utente', 'Trattiamo dati per fornire il servizio, proteggere le sessioni, rispondere alle richieste e rispettare le scelte di consenso quando richiesto.'),
      section('Conservazione dei dati', 'Conserviamo i dati solo per il tempo ragionevolmente necessario per servizio, sicurezza, supporto, obblighi legali o funzioni account controllate dall’utente.'),
      section('Contatto', `Per domande sulla privacy, contatta ${LEGAL_CONTACT_EMAIL}. Questa pagina è informativa e non è consulenza legale.`),
    ]),
  },
  cookies: {
    en: cookiePage('en', 'Cookie Policy | CommanderZone', 'Cookie Policy'),
    es: cookiePage('es', 'Política de cookies | CommanderZone', 'Política de cookies'),
    de: cookiePage('de', 'Cookie-Richtlinie | CommanderZone', 'Cookie-Richtlinie'),
    fr: cookiePage('fr', 'Politique relative aux cookies | CommanderZone', 'Politique relative aux cookies'),
    pt: cookiePage('pt', 'Política de cookies | CommanderZone', 'Política de cookies'),
    it: cookiePage('it', 'Cookie policy | CommanderZone', 'Cookie policy'),
  },
  terms: {
    en: termsPage('en', 'Terms of Use | CommanderZone', 'Terms of Use'),
    es: termsPage('es', 'Términos de uso | CommanderZone', 'Términos de uso'),
    de: termsPage('de', 'Nutzungsbedingungen | CommanderZone', 'Nutzungsbedingungen'),
    fr: termsPage('fr', 'Conditions d’utilisation | CommanderZone', 'Conditions d’utilisation'),
    pt: termsPage('pt', 'Termos de uso | CommanderZone', 'Termos de uso'),
    it: termsPage('it', 'Termini di utilizzo | CommanderZone', 'Termini di utilizzo'),
  },
  contact: {
    en: contactPage('en', 'Contact | CommanderZone', 'Contact'),
    es: contactPage('es', 'Contacto | CommanderZone', 'Contacto'),
    de: contactPage('de', 'Kontakt | CommanderZone', 'Kontakt'),
    fr: contactPage('fr', 'Contact | CommanderZone', 'Contact'),
    pt: contactPage('pt', 'Contato | CommanderZone', 'Contato'),
    it: contactPage('it', 'Contatto | CommanderZone', 'Contatto'),
  },
} as const satisfies Record<LegalPageKey, Record<SeoLocaleCode, LegalPageContent>>;

export function getLegalPageContent(pageKey: LegalPageKey, locale: SeoLocaleCode): LegalPageContent {
  return LEGAL_PAGE_CONTENT[pageKey][locale];
}

function legalPage(
  pageKey: LegalPageKey,
  locale: SeoLocaleCode,
  title: string,
  h1: string,
  description: string,
  sections: readonly LegalSectionContent[],
): LegalPageContent {
  return {
    pageKey,
    locale,
    title,
    description,
    h1,
    homeLabel: HOME_LABELS[locale],
    footerLabel: FOOTER_LABELS[locale],
    disclaimer: COMMON_FAN_CONTENT[locale],
    sections,
  };
}

function cookiePage(locale: SeoLocaleCode, title: string, h1: string): LegalPageContent {
  const descriptions = {
    en: 'How CommanderZone uses essential cookies, optional analytics and consent choices.',
    es: 'Cómo CommanderZone usa cookies esenciales, analítica opcional y opciones de consentimiento.',
    de: 'Wie CommanderZone essenzielle Cookies, optionale Analyse und Einwilligungsoptionen nutzt.',
    fr: 'Comment CommanderZone utilise les cookies essentiels, l’analyse optionnelle et les choix de consentement.',
    pt: 'Como o CommanderZone usa cookies essenciais, análise opcional e escolhas de consentimento.',
    it: 'Come CommanderZone usa cookie essenziali, analisi opzionale e scelte di consenso.',
  } as const satisfies Record<SeoLocaleCode, string>;
  const copy = {
    en: [
      section('Essential cookies', 'CommanderZone uses essential cookies and local storage for login, session security, consent preferences and core app behavior.'),
      section('Optional analytics', 'Analytics cookies are disabled unless you accept them. They are used only to understand aggregated usage and technical performance.'),
      section('Accept, reject or configure', 'You can accept all optional cookies, reject optional cookies, or configure analytics preferences from the cookie banner.'),
      section('Changing preferences', 'You can clear browser data or use available cookie controls to change your preferences. Future product settings may provide a direct preference manager.'),
      section('Advertising cookies', 'CommanderZone does not use advertising cookies unless they are explicitly introduced later with clear notice and consent controls.'),
    ],
    es: [
      section('Cookies esenciales', 'CommanderZone usa cookies esenciales y almacenamiento local para login, seguridad de sesión, preferencias de consentimiento y funciones básicas.'),
      section('Analítica opcional', 'Las cookies de analítica están desactivadas salvo que las aceptes. Se usan solo para entender uso agregado y rendimiento técnico.'),
      section('Aceptar, rechazar o configurar', 'Puedes aceptar todas las cookies opcionales, rechazarlas o configurar la analítica desde el banner de cookies.'),
      section('Cambiar preferencias', 'Puedes borrar los datos del navegador o usar los controles disponibles para cambiar tus preferencias. En el futuro puede haber un gestor directo.'),
      section('Cookies publicitarias', 'CommanderZone no usa cookies publicitarias salvo que se introduzcan explícitamente más adelante con aviso claro y controles de consentimiento.'),
    ],
    de: [
      section('Essenzielle Cookies', 'CommanderZone nutzt essenzielle Cookies und lokalen Speicher für Login, Sitzungssicherheit, Einwilligungspräferenzen und Kernfunktionen.'),
      section('Optionale Analyse', 'Analyse-Cookies sind deaktiviert, sofern du sie nicht akzeptierst. Sie dienen nur aggregierter Nutzung und technischer Leistung.'),
      section('Akzeptieren, ablehnen oder konfigurieren', 'Du kannst optionale Cookies akzeptieren, ablehnen oder Analysepräferenzen im Cookie-Banner konfigurieren.'),
      section('Präferenzen ändern', 'Du kannst Browserdaten löschen oder verfügbare Cookie-Kontrollen nutzen. Künftige Einstellungen können einen direkten Manager enthalten.'),
      section('Werbe-Cookies', 'CommanderZone nutzt keine Werbe-Cookies, sofern sie nicht später ausdrücklich mit klarer Information und Einwilligungskontrollen eingeführt werden.'),
    ],
    fr: [
      section('Cookies essentiels', 'CommanderZone utilise des cookies essentiels et le stockage local pour la connexion, la sécurité de session, les préférences de consentement et les fonctions de base.'),
      section('Analyse optionnelle', 'Les cookies d’analyse sont désactivés sauf acceptation. Ils servent uniquement à comprendre l’usage agrégé et la performance technique.'),
      section('Accepter, refuser ou configurer', 'Vous pouvez accepter les cookies optionnels, les refuser ou configurer l’analyse depuis le bandeau cookies.'),
      section('Modifier les préférences', 'Vous pouvez effacer les données du navigateur ou utiliser les contrôles disponibles. Un gestionnaire direct pourra être ajouté plus tard.'),
      section('Cookies publicitaires', 'CommanderZone n’utilise pas de cookies publicitaires sauf introduction explicite ultérieure avec information claire et contrôles de consentement.'),
    ],
    pt: [
      section('Cookies essenciais', 'CommanderZone usa cookies essenciais e armazenamento local para login, segurança de sessão, preferências de consentimento e funções principais.'),
      section('Análise opcional', 'Cookies de análise ficam desativados a menos que você aceite. Eles servem apenas para entender uso agregado e desempenho técnico.'),
      section('Aceitar, rejeitar ou configurar', 'Você pode aceitar cookies opcionais, rejeitá-los ou configurar preferências de análise no banner de cookies.'),
      section('Alterar preferências', 'Você pode limpar dados do navegador ou usar controles disponíveis para mudar preferências. Configurações futuras podem incluir um gerenciador direto.'),
      section('Cookies de publicidade', 'CommanderZone não usa cookies de publicidade, salvo se forem introduzidos explicitamente depois com aviso claro e controles de consentimento.'),
    ],
    it: [
      section('Cookie essenziali', 'CommanderZone usa cookie essenziali e archiviazione locale per login, sicurezza sessione, preferenze di consenso e funzioni principali.'),
      section('Analisi opzionale', 'I cookie di analisi sono disattivati salvo accettazione. Servono solo a comprendere uso aggregato e prestazioni tecniche.'),
      section('Accettare, rifiutare o configurare', 'Puoi accettare i cookie opzionali, rifiutarli o configurare le preferenze di analisi dal banner cookie.'),
      section('Modificare le preferenze', 'Puoi cancellare i dati del browser o usare i controlli disponibili. Impostazioni future potranno includere un gestore diretto.'),
      section('Cookie pubblicitari', 'CommanderZone non usa cookie pubblicitari salvo introduzione esplicita futura con avviso chiaro e controlli di consenso.'),
    ],
  } as const satisfies Record<SeoLocaleCode, readonly LegalSectionContent[]>;

  return legalPage('cookies', locale, title, h1, descriptions[locale], copy[locale]);
}

function termsPage(locale: SeoLocaleCode, title: string, h1: string): LegalPageContent {
  const descriptions = {
    en: 'Terms for using CommanderZone as unofficial fan content and a manual Commander table.',
    es: 'Términos para usar CommanderZone como contenido fan no oficial y mesa manual de Commander.',
    de: 'Bedingungen für die Nutzung von CommanderZone als inoffizieller Fan-Content und manueller Commander-Tisch.',
    fr: 'Conditions d’utilisation de CommanderZone comme contenu fan non officiel et table Commander manuelle.',
    pt: 'Termos para usar o CommanderZone como conteúdo de fã não oficial e mesa manual de Commander.',
    it: 'Termini per usare CommanderZone come contenuto fan non ufficiale e tavolo Commander manuale.',
  } as const satisfies Record<SeoLocaleCode, string>;
  const copy = {
    en: [
      section('Unofficial fan content', COMMON_FAN_CONTENT.en),
      section('Community tool', 'CommanderZone is intended as a free, non-commercial entertainment and community tool unless future terms clearly state otherwise.'),
      section('User responsibility', 'You are responsible for your decks, conduct, room links, account activity and compliance with applicable rules or platform policies.'),
      section('No official tournament service', 'CommanderZone does not provide official tournaments, ranked play, matchmaking rankings or sanctioned competitive services.'),
      section('Manual table', 'CommanderZone is a manual table. It does not guarantee rules automation, stack handling, priority management or legal-play validation.'),
      section('Service changes', 'The service may change, pause, lose data or become unavailable. We aim to be careful, but availability is not guaranteed.'),
      section('Intellectual property', 'Magic: The Gathering and related marks belong to their owners. CommanderZone only references fan content and community play contexts.'),
      section('Contact', `For terms questions, contact ${LEGAL_CONTACT_EMAIL}.`),
    ],
    es: [
      section('Contenido de fans no oficial', COMMON_FAN_CONTENT.es),
      section('Herramienta comunitaria', 'CommanderZone se ofrece como herramienta gratuita, no comercial, de entretenimiento y comunidad salvo que futuros términos indiquen claramente otra cosa.'),
      section('Responsabilidad del usuario', 'Eres responsable de tus mazos, conducta, enlaces de sala, actividad de cuenta y cumplimiento de reglas o políticas aplicables.'),
      section('Sin torneos oficiales', 'CommanderZone no ofrece torneos oficiales, juego ranked, rankings de matchmaking ni servicios competitivos sancionados.'),
      section('Mesa manual', 'CommanderZone es una mesa manual. No garantiza automatización de reglas, stack, prioridad ni validación de jugadas legales.'),
      section('Cambios del servicio', 'El servicio puede cambiar, pausarse, perder datos o no estar disponible. Intentamos ser cuidadosos, pero la disponibilidad no está garantizada.'),
      section('Propiedad intelectual', 'Magic: The Gathering y marcas relacionadas pertenecen a sus propietarios. CommanderZone solo referencia contenido fan y contextos de juego comunitario.'),
      section('Contacto', `Para preguntas sobre términos, contacta con ${LEGAL_CONTACT_EMAIL}.`),
    ],
    de: [
      section('Inoffizieller Fan-Content', COMMON_FAN_CONTENT.de),
      section('Community-Tool', 'CommanderZone ist als kostenloses, nicht-kommerzielles Unterhaltungs- und Community-Tool gedacht, sofern künftige Bedingungen nichts anderes klar regeln.'),
      section('Verantwortung der Nutzer', 'Du bist verantwortlich für Decks, Verhalten, Raumlinks, Kontoaktivität und die Einhaltung anwendbarer Regeln oder Plattformrichtlinien.'),
      section('Kein offizieller Turnierdienst', 'CommanderZone bietet keine offiziellen Turniere, Ranked Play, Matchmaking-Ranglisten oder sanktionierte Wettbewerbsdienste.'),
      section('Manueller Tisch', 'CommanderZone ist ein manueller Tisch. Es garantiert keine Regelautomatisierung, keinen Stack, keine Priorität und keine Legalitätsprüfung von Spielzügen.'),
      section('Änderungen des Dienstes', 'Der Dienst kann sich ändern, pausieren, Daten verlieren oder nicht verfügbar sein. Verfügbarkeit wird nicht garantiert.'),
      section('Geistiges Eigentum', 'Magic: The Gathering und verwandte Marken gehören ihren Eigentümern. CommanderZone verweist nur auf Fan-Content und Community-Spielkontexte.'),
      section('Kontakt', `Bei Fragen zu den Bedingungen kontaktiere ${LEGAL_CONTACT_EMAIL}.`),
    ],
    fr: [
      section('Contenu de fan non officiel', COMMON_FAN_CONTENT.fr),
      section('Outil communautaire', 'CommanderZone est prévu comme outil gratuit, non commercial, de divertissement et de communauté, sauf indication contraire claire dans de futurs termes.'),
      section('Responsabilité utilisateur', 'Vous êtes responsable de vos decks, de votre conduite, des liens de salon, de l’activité du compte et du respect des règles applicables.'),
      section('Pas de service de tournoi officiel', 'CommanderZone ne fournit pas de tournois officiels, de mode classé, de classement de matchmaking ni de services compétitifs sanctionnés.'),
      section('Table manuelle', 'CommanderZone est une table manuelle. Il ne garantit pas l’automatisation des règles, la pile, la priorité ou la validation des actions légales.'),
      section('Évolution du service', 'Le service peut changer, être suspendu, perdre des données ou devenir indisponible. La disponibilité n’est pas garantie.'),
      section('Propriété intellectuelle', 'Magic: The Gathering et les marques associées appartiennent à leurs propriétaires. CommanderZone référence seulement du contenu fan et des contextes de jeu communautaire.'),
      section('Contact', `Pour les questions sur les conditions, contactez ${LEGAL_CONTACT_EMAIL}.`),
    ],
    pt: [
      section('Conteúdo de fã não oficial', COMMON_FAN_CONTENT.pt),
      section('Ferramenta comunitária', 'CommanderZone é pensado como ferramenta gratuita, não comercial, de entretenimento e comunidade, salvo se termos futuros disserem claramente o contrário.'),
      section('Responsabilidade do usuário', 'Você é responsável por seus decks, conduta, links de sala, atividade da conta e cumprimento de regras ou políticas aplicáveis.'),
      section('Sem serviço oficial de torneios', 'CommanderZone não oferece torneios oficiais, jogo ranqueado, rankings de matchmaking ou serviços competitivos sancionados.'),
      section('Mesa manual', 'CommanderZone é uma mesa manual. Não garante automação de regras, pilha, prioridade ou validação de jogadas legais.'),
      section('Mudanças no serviço', 'O serviço pode mudar, pausar, perder dados ou ficar indisponível. A disponibilidade não é garantida.'),
      section('Propriedade intelectual', 'Magic: The Gathering e marcas relacionadas pertencem aos seus donos. CommanderZone apenas referencia conteúdo de fã e contextos de jogo comunitário.'),
      section('Contato', `Para perguntas sobre termos, entre em contato em ${LEGAL_CONTACT_EMAIL}.`),
    ],
    it: [
      section('Contenuto fan non ufficiale', COMMON_FAN_CONTENT.it),
      section('Strumento community', 'CommanderZone è pensato come strumento gratuito, non commerciale, di intrattenimento e community, salvo futuri termini espliciti diversi.'),
      section('Responsabilità utente', 'Sei responsabile di mazzi, comportamento, link stanza, attività account e rispetto di regole o policy applicabili.'),
      section('Nessun servizio torneo ufficiale', 'CommanderZone non offre tornei ufficiali, gioco classificato, ranking di matchmaking o servizi competitivi sanzionati.'),
      section('Tavolo manuale', 'CommanderZone è un tavolo manuale. Non garantisce automazione delle regole, stack, priorità o validazione di giocate legali.'),
      section('Modifiche al servizio', 'Il servizio può cambiare, fermarsi, perdere dati o diventare indisponibile. La disponibilità non è garantita.'),
      section('Proprietà intellettuale', 'Magic: The Gathering e i marchi collegati appartengono ai rispettivi proprietari. CommanderZone cita solo contenuto fan e contesti di gioco community.'),
      section('Contatto', `Per domande sui termini, contatta ${LEGAL_CONTACT_EMAIL}.`),
    ],
  } as const satisfies Record<SeoLocaleCode, readonly LegalSectionContent[]>;

  return legalPage('terms', locale, title, h1, descriptions[locale], copy[locale]);
}

function contactPage(locale: SeoLocaleCode, title: string, h1: string): LegalPageContent {
  const descriptions = {
    en: 'Contact CommanderZone for privacy, support, copyright, abuse and bug reports.',
    es: 'Contacta con CommanderZone por privacidad, soporte, copyright, abuso y reportes de bugs.',
    de: 'Kontaktiere CommanderZone für Datenschutz, Support, Urheberrecht, Missbrauch und Fehlerberichte.',
    fr: 'Contacter CommanderZone pour la confidentialité, le support, le copyright, les abus et les bugs.',
    pt: 'Entre em contato com o CommanderZone sobre privacidade, suporte, copyright, abuso e bugs.',
    it: 'Contatta CommanderZone per privacy, supporto, copyright, abusi e segnalazioni di bug.',
  } as const satisfies Record<SeoLocaleCode, string>;
  const rightsHolderText = {
    en: 'If you are a rights holder and believe content on CommanderZone violates your rights, contact us and we will review it.',
    es: 'Si eres titular de derechos y crees que algún contenido de CommanderZone vulnera tus derechos, contáctanos y lo revisaremos.',
    de: 'Wenn du Rechteinhaber bist und glaubst, dass Inhalte auf CommanderZone deine Rechte verletzen, kontaktiere uns und wir prüfen es.',
    fr: 'Si vous êtes titulaire de droits et pensez qu’un contenu sur CommanderZone porte atteinte à vos droits, contactez-nous et nous l’examinerons.',
    pt: 'Se você é titular de direitos e acredita que algum conteúdo no CommanderZone viola seus direitos, entre em contato e iremos analisar.',
    it: 'Se sei titolare di diritti e ritieni che contenuti su CommanderZone violino i tuoi diritti, contattaci e li esamineremo.',
  } as const satisfies Record<SeoLocaleCode, string>;
  const copy = {
    en: [
      section('Support contact', `Use ${LEGAL_CONTACT_EMAIL} for privacy requests, copyright or IP concerns, bug reports, abuse reports and general support.`),
      section('Rights holders', rightsHolderText.en),
      section('What to include', 'Include the relevant URL, a clear description of the issue and a way to reply. Do not send secrets or payment information.'),
    ],
    es: [
      section('Contacto de soporte', `Usa ${LEGAL_CONTACT_EMAIL} para privacidad, copyright o propiedad intelectual, bugs, abuso y soporte general.`),
      section('Titulares de derechos', rightsHolderText.es),
      section('Qué incluir', 'Incluye la URL relevante, una descripción clara del problema y una forma de respuesta. No envíes secretos ni datos de pago.'),
    ],
    de: [
      section('Support-Kontakt', `Nutze ${LEGAL_CONTACT_EMAIL} für Datenschutzanfragen, Urheberrechts- oder IP-Themen, Fehlerberichte, Missbrauchsmeldungen und allgemeinen Support.`),
      section('Rechteinhaber', rightsHolderText.de),
      section('Was du angeben solltest', 'Gib die relevante URL, eine klare Beschreibung des Problems und eine Antwortmöglichkeit an. Sende keine Geheimnisse oder Zahlungsdaten.'),
    ],
    fr: [
      section('Contact support', `Utilisez ${LEGAL_CONTACT_EMAIL} pour la confidentialité, le copyright ou la propriété intellectuelle, les bugs, les abus et le support général.`),
      section('Titulaires de droits', rightsHolderText.fr),
      section('À inclure', 'Indiquez l’URL concernée, une description claire du problème et un moyen de répondre. N’envoyez pas de secrets ni de données de paiement.'),
    ],
    pt: [
      section('Contato de suporte', `Use ${LEGAL_CONTACT_EMAIL} para privacidade, copyright ou propriedade intelectual, bugs, abuso e suporte geral.`),
      section('Titulares de direitos', rightsHolderText.pt),
      section('O que incluir', 'Inclua a URL relevante, uma descrição clara do problema e uma forma de resposta. Não envie segredos nem dados de pagamento.'),
    ],
    it: [
      section('Contatto supporto', `Usa ${LEGAL_CONTACT_EMAIL} per privacy, copyright o proprietà intellettuale, bug, abusi e supporto generale.`),
      section('Titolari di diritti', rightsHolderText.it),
      section('Cosa includere', 'Includi l’URL rilevante, una descrizione chiara del problema e un modo per rispondere. Non inviare segreti o dati di pagamento.'),
    ],
  } as const satisfies Record<SeoLocaleCode, readonly LegalSectionContent[]>;

  return legalPage('contact', locale, title, h1, descriptions[locale], copy[locale]);
}

function section(heading: string, ...body: readonly string[]): LegalSectionContent {
  return { heading, body };
}

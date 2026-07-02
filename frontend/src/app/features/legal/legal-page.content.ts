import { SeoLocaleCode } from '../../core/localization/locale-config';
import { LEGAL_CONTACT_EMAIL, LEGAL_CONTACT_PATH, LegalPageKey } from '../../core/legal/legal-routes';

export interface LegalSectionAction {
  readonly label: string;
  readonly href: string;
}

export interface LegalSectionContent {
  readonly heading: string;
  readonly body: readonly string[];
  readonly actions?: readonly LegalSectionAction[];
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
  en: 'Home',
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

const LEGAL_OWNER_NAME = 'CommanderZone';
const LEGAL_OWNER_COUNTRY = 'España';
const CONTACT_ACTION_LABELS = {
  en: 'Open contact page',
  es: 'Ir a contacto',
  de: 'Kontakt öffnen',
  fr: 'Ouvrir le contact',
  pt: 'Abrir contato',
  it: 'Apri contatto',
} as const satisfies Record<SeoLocaleCode, string>;

export const LEGAL_PAGE_CONTENT = {
  privacy: {
    en: legalPage('privacy', 'en', 'Privacy Policy | CommanderZone', 'Privacy Policy', 'How CommanderZone handles account data, cookies, deck data, room metadata, technical logs and advertising readiness.', [
      section('Who we are', 'CommanderZone is a browser-based tool for manual Magic: The Gathering Commander games online and for supporting physical games. CommanderZone does not sell official Magic products.'),
      section('Controller and contact', `${LEGAL_OWNER_NAME} is operated from ${LEGAL_OWNER_COUNTRY}. For privacy requests, contact ${LEGAL_CONTACT_EMAIL}. No postal address or tax ID is published in this phase.`),
      section('Scope', 'This policy applies when you browse CommanderZone, create an account, manage decks, join rooms, play games or contact us.'),
      section('What data we process', 'CommanderZone may process account and contact details, authentication data, deck lists, room and game metadata, manual table actions, technical logs and local app preferences.'),
      section('How we collect data', 'Most data is provided by you or generated when you use the app. Some technical data is created automatically to keep the service secure and working.'),
      section('Account and authentication data', 'If you create an account, we may process identifiers such as email address, display name, authentication tokens and security events needed to operate the service.'),
      section('Deck and gameplay-related data', 'Deck lists, room settings, game metadata and manual table actions may be stored so the app can provide the features you choose to use. CommanderZone does not validate legal play or automate Magic rules.'),
      section('Cookies and ads', 'CommanderZone uses essential cookies and functional preferences. It does not use analytics or load ads in this phase; future ads will require updated notice, consent controls and, where needed, a certified CMP.'),
      section('Legal basis', 'We process data to provide the service you request, secure accounts and rooms, respond to support requests, comply with legal obligations and respect consent choices where consent is required.'),
      section('Recipients', 'We do not sell personal data. Service providers may access data only when needed to operate hosting, email, security, realtime or support features. Authorities may receive data if required by law.'),
      section('Retention', 'We keep data only while reasonably needed for the service, security, support, legal obligations or user-controlled account features.'),
      section('Your rights', `You can request access, correction, deletion, objection, restriction, portability or withdrawal of consent by contacting ${LEGAL_CONTACT_EMAIL}.`),
      contactSection('en', 'Contact', `For privacy questions, contact ${LEGAL_CONTACT_EMAIL}. This page is informational and is not legal advice.`),
    ]),
    es: legalPage('privacy', 'es', 'Política de privacidad | CommanderZone', 'Política de privacidad', 'Cómo CommanderZone trata datos de cuenta, cookies, mazos, metadatos de sala, registros técnicos y preparación publicitaria.', [
      section('Quiénes somos', 'CommanderZone es una herramienta de navegador para partidas manuales de Magic: The Gathering Commander online y para apoyar partidas físicas. CommanderZone no vende productos oficiales de Magic.'),
      section('Responsable y contacto', `${LEGAL_OWNER_NAME} opera desde ${LEGAL_OWNER_COUNTRY}. Para solicitudes de privacidad, contacta con ${LEGAL_CONTACT_EMAIL}. En esta fase no se publica domicilio postal ni NIF.`),
      section('Alcance', 'Esta política se aplica cuando navegas por CommanderZone, creas una cuenta, gestionas mazos, entras en salas, juegas partidas o contactas con nosotros.'),
      section('Qué datos tratamos', 'CommanderZone puede tratar datos de cuenta y contacto, autenticación, listas de mazo, metadatos de salas y partidas, acciones manuales de mesa, registros técnicos y preferencias locales de la app.'),
      section('Cómo obtenemos los datos', 'La mayoría de datos los facilitas tú o se generan al usar la app. Algunos datos técnicos se crean automáticamente para mantener el servicio seguro y funcionando.'),
      section('Cuenta y autenticación', 'Si creas una cuenta, podemos tratar identificadores como email, nombre visible, tokens de autenticación y eventos de seguridad necesarios para operar el servicio.'),
      section('Mazos y datos relacionados con partidas', 'Las listas de mazo, ajustes de sala, metadatos de partida y acciones manuales de mesa pueden guardarse para ofrecer las funciones que decides usar. CommanderZone no valida jugadas legales ni automatiza reglas de Magic.'),
      section('Cookies y publicidad', 'CommanderZone usa cookies esenciales y preferencias funcionales. No usa analítica ni carga publicidad en esta fase; la publicidad futura requerirá aviso actualizado, controles de consentimiento y, cuando proceda, una CMP certificada.'),
      section('Base legal', 'Tratamos datos para prestar el servicio que solicitas, proteger cuentas y salas, responder soporte, cumplir obligaciones legales y respetar tus opciones de consentimiento cuando proceda.'),
      section('Destinatarios', 'No vendemos datos personales. Los proveedores del servicio pueden acceder a datos solo cuando sea necesario para hosting, email, seguridad, realtime o soporte. Las autoridades pueden recibir datos si lo exige la ley.'),
      section('Conservación', 'Conservamos datos solo durante el tiempo razonablemente necesario para el servicio, seguridad, soporte, obligaciones legales o funciones de cuenta controladas por el usuario.'),
      section('Tus derechos', `Puedes solicitar acceso, rectificación, supresión, oposición, limitación, portabilidad o retirada del consentimiento escribiendo a ${LEGAL_CONTACT_EMAIL}.`),
      contactSection('es', 'Contacto', `Para consultas de privacidad, contacta con ${LEGAL_CONTACT_EMAIL}. Esta página es informativa y no es asesoramiento legal.`),
    ]),
    de: legalPage('privacy', 'de', 'Datenschutzerklärung | CommanderZone', 'Datenschutzerklärung', 'Wie CommanderZone Kontodaten, Cookies, Deckdaten, Raum-Metadaten, technische Logs und Werbevorbereitung verarbeitet.', [
      section('Wer wir sind', 'CommanderZone ist ein Browser-Tool für manuelle Magic: The Gathering Commander-Partien online und zur Unterstützung physischer Partien. CommanderZone verkauft keine offiziellen Magic-Produkte.'),
      section('Verantwortlicher und Kontakt', `${LEGAL_OWNER_NAME} wird von ${LEGAL_OWNER_COUNTRY} aus betrieben. Für Datenschutzanfragen kontaktiere ${LEGAL_CONTACT_EMAIL}. In dieser Phase werden keine Postanschrift und keine Steuer-ID veröffentlicht.`),
      section('Geltungsbereich', 'Diese Erklärung gilt, wenn du CommanderZone besuchst, ein Konto erstellst, Decks verwaltest, Räumen beitrittst, Partien spielst oder uns kontaktierst.'),
      section('Welche Daten wir verarbeiten', 'CommanderZone kann Konto- und Kontaktdaten, Authentifizierungsdaten, Decklisten, Raum- und Spielmetadaten, manuelle Tischaktionen, technische Logs und lokale App-Einstellungen verarbeiten.'),
      section('Wie wir Daten erhalten', 'Die meisten Daten gibst du selbst an oder sie entstehen bei der Nutzung der App. Einige technische Daten entstehen automatisch, damit der Dienst sicher und funktionsfähig bleibt.'),
      section('Konto und Authentifizierung', 'Wenn du ein Konto erstellst, können wir Kennungen wie E-Mail-Adresse, Anzeigename, Authentifizierungs-Tokens und Sicherheitsereignisse verarbeiten, die für den Betrieb nötig sind.'),
      section('Decks und spielbezogene Daten', 'Decklisten, Raumeinstellungen, Spielmetadaten und manuelle Tischaktionen können gespeichert werden, um die gewählten Funktionen bereitzustellen. CommanderZone validiert keine legalen Spielzüge und automatisiert keine Magic-Regeln.'),
      section('Cookies und Werbung', 'CommanderZone verwendet essenzielle Cookies und funktionale Einstellungen. In dieser Phase werden keine Analyse und keine Werbung geladen; künftige Werbung erfordert aktualisierte Information, Einwilligungskontrollen und, falls nötig, eine zertifizierte CMP.'),
      section('Rechtsgrundlage', 'Wir verarbeiten Daten, um den angefragten Dienst bereitzustellen, Konten und Räume zu schützen, Supportanfragen zu beantworten, rechtliche Pflichten zu erfüllen und Einwilligungen zu respektieren.'),
      section('Empfänger', 'Wir verkaufen keine personenbezogenen Daten. Dienstleister können nur dann Zugriff erhalten, wenn dies für Hosting, E-Mail, Sicherheit, Echtzeitfunktionen oder Support nötig ist. Behörden können Daten erhalten, wenn das gesetzlich vorgeschrieben ist.'),
      section('Speicherdauer', 'Wir speichern Daten nur so lange, wie es für Dienst, Sicherheit, Support, rechtliche Pflichten oder nutzergesteuerte Kontofunktionen angemessen nötig ist.'),
      section('Deine Rechte', `Du kannst Auskunft, Berichtigung, Löschung, Widerspruch, Einschränkung, Übertragbarkeit oder Widerruf einer Einwilligung über ${LEGAL_CONTACT_EMAIL} anfragen.`),
      contactSection('de', 'Kontakt', `Bei Datenschutzfragen kontaktiere ${LEGAL_CONTACT_EMAIL}. Diese Seite dient der Information und ist keine Rechtsberatung.`),
    ]),
    fr: legalPage('privacy', 'fr', 'Politique de confidentialité | CommanderZone', 'Politique de confidentialité', 'Comment CommanderZone traite les données de compte, cookies, decks, métadonnées de salon, journaux techniques et préparation publicitaire.', [
      section('Qui nous sommes', 'CommanderZone est un outil de navigateur pour des parties manuelles de Magic: The Gathering Commander en ligne et pour accompagner les parties physiques. CommanderZone ne vend pas de produits Magic officiels.'),
      section('Responsable et contact', `${LEGAL_OWNER_NAME} est exploité depuis ${LEGAL_OWNER_COUNTRY}. Pour les demandes de confidentialité, contactez ${LEGAL_CONTACT_EMAIL}. Aucune adresse postale ni identifiant fiscal n’est publié dans cette phase.`),
      section('Champ d’application', 'Cette politique s’applique lorsque vous naviguez sur CommanderZone, créez un compte, gérez des decks, rejoignez des salons, jouez des parties ou nous contactez.'),
      section('Données traitées', 'CommanderZone peut traiter des données de compte et de contact, d’authentification, des listes de decks, des métadonnées de salons et parties, des actions manuelles de table, des journaux techniques et des préférences locales.'),
      section('Origine des données', 'La plupart des données sont fournies par vous ou générées lorsque vous utilisez l’application. Certaines données techniques sont créées automatiquement pour maintenir le service sûr et fonctionnel.'),
      section('Compte et authentification', 'Si vous créez un compte, nous pouvons traiter des identifiants comme l’adresse e-mail, le nom affiché, les jetons d’authentification et les événements de sécurité nécessaires au service.'),
      section('Decks et données liées aux parties', 'Les listes de decks, paramètres de salon, métadonnées de partie et actions manuelles de table peuvent être conservés pour fournir les fonctions choisies. CommanderZone ne valide pas les actions légales et n’automatise pas les règles de Magic.'),
      section('Cookies et publicité', 'CommanderZone utilise des cookies essentiels et des préférences fonctionnelles. Aucune analyse ni publicité n’est chargée dans cette phase; toute publicité future nécessitera une information mise à jour, des contrôles de consentement et, si nécessaire, une CMP certifiée.'),
      section('Base légale', 'Nous traitons les données pour fournir le service demandé, protéger les comptes et salons, répondre au support, respecter les obligations légales et appliquer vos choix de consentement.'),
      section('Destinataires', 'Nous ne vendons pas les données personnelles. Des prestataires peuvent y accéder uniquement si nécessaire pour l’hébergement, l’e-mail, la sécurité, le temps réel ou le support. Les autorités peuvent recevoir des données si la loi l’exige.'),
      section('Conservation', 'Nous conservons les données uniquement le temps raisonnablement nécessaire au service, à la sécurité, au support, aux obligations légales ou aux fonctions de compte.'),
      section('Vos droits', `Vous pouvez demander l’accès, la rectification, l’effacement, l’opposition, la limitation, la portabilité ou le retrait du consentement via ${LEGAL_CONTACT_EMAIL}.`),
      contactSection('fr', 'Contact', `Pour les questions de confidentialité, contactez ${LEGAL_CONTACT_EMAIL}. Cette page est informative et ne constitue pas un conseil juridique.`),
    ]),
    pt: legalPage('privacy', 'pt', 'Política de privacidade | CommanderZone', 'Política de privacidade', 'Como o CommanderZone processa dados de conta, cookies, decks, metadados de sala, logs técnicos e preparação publicitária.', [
      section('Quem somos', 'CommanderZone é uma ferramenta de navegador para partidas manuais de Magic: The Gathering Commander online e para apoiar partidas físicas. CommanderZone não vende produtos oficiais de Magic.'),
      section('Responsável e contato', `${LEGAL_OWNER_NAME} é operado a partir de ${LEGAL_OWNER_COUNTRY}. Para pedidos de privacidade, entre em contato em ${LEGAL_CONTACT_EMAIL}. Nenhum endereço postal ou identificação fiscal é publicado nesta fase.`),
      section('Âmbito', 'Esta política se aplica quando você navega no CommanderZone, cria uma conta, gerencia decks, entra em salas, joga partidas ou entra em contato conosco.'),
      section('Quais dados processamos', 'CommanderZone pode processar dados de conta e contato, autenticação, listas de decks, metadados de salas e partidas, ações manuais de mesa, logs técnicos e preferências locais do app.'),
      section('Como obtemos dados', 'A maioria dos dados é fornecida por você ou gerada ao usar o app. Alguns dados técnicos são criados automaticamente para manter o serviço seguro e funcionando.'),
      section('Conta e autenticação', 'Se você criar uma conta, podemos processar identificadores como e-mail, nome exibido, tokens de autenticação e eventos de segurança necessários para operar o serviço.'),
      section('Decks e dados relacionados às partidas', 'Listas de decks, configurações de sala, metadados de partida e ações manuais de mesa podem ser armazenados para fornecer os recursos que você escolhe usar. CommanderZone não valida jogadas legais nem automatiza regras de Magic.'),
      section('Cookies e publicidade', 'CommanderZone usa cookies essenciais e preferências funcionais. Não usa análise nem carrega publicidade nesta fase; publicidade futura exigirá aviso atualizado, controles de consentimento e, quando necessário, uma CMP certificada.'),
      section('Base legal', 'Processamos dados para fornecer o serviço solicitado, proteger contas e salas, responder suporte, cumprir obrigações legais e respeitar escolhas de consentimento.'),
      section('Destinatários', 'Não vendemos dados pessoais. Prestadores de serviço podem acessar dados apenas quando necessário para hospedagem, e-mail, segurança, realtime ou suporte. Autoridades podem receber dados se a lei exigir.'),
      section('Retenção', 'Mantemos dados apenas pelo tempo razoavelmente necessário para o serviço, segurança, suporte, obrigações legais ou recursos de conta controlados pelo usuário.'),
      section('Seus direitos', `Você pode solicitar acesso, correção, exclusão, oposição, limitação, portabilidade ou retirada de consentimento em ${LEGAL_CONTACT_EMAIL}.`),
      contactSection('pt', 'Contato', `Para questões de privacidade, entre em contato em ${LEGAL_CONTACT_EMAIL}. Esta página é informativa e não é aconselhamento jurídico.`),
    ]),
    it: legalPage('privacy', 'it', 'Informativa sulla privacy | CommanderZone', 'Informativa sulla privacy', 'Come CommanderZone tratta dati account, cookie, mazzi, metadati delle stanze, log tecnici e preparazione pubblicitaria.', [
      section('Chi siamo', 'CommanderZone è uno strumento browser per partite manuali di Magic: The Gathering Commander online e per supportare partite fisiche. CommanderZone non vende prodotti ufficiali Magic.'),
      section('Titolare e contatto', `${LEGAL_OWNER_NAME} è gestito da ${LEGAL_OWNER_COUNTRY}. Per richieste privacy, contatta ${LEGAL_CONTACT_EMAIL}. In questa fase non vengono pubblicati indirizzo postale né codice fiscale/partita IVA.`),
      section('Ambito', 'Questa informativa si applica quando navighi su CommanderZone, crei un account, gestisci mazzi, entri in stanze, giochi partite o ci contatti.'),
      section('Quali dati trattiamo', 'CommanderZone può trattare dati account e contatto, autenticazione, liste mazzi, metadati di stanze e partite, azioni manuali del tavolo, log tecnici e preferenze locali dell’app.'),
      section('Come raccogliamo i dati', 'La maggior parte dei dati è fornita da te o generata quando usi l’app. Alcuni dati tecnici vengono creati automaticamente per mantenere il servizio sicuro e funzionante.'),
      section('Account e autenticazione', 'Se crei un account, possiamo trattare identificativi come email, nome visualizzato, token di autenticazione ed eventi di sicurezza necessari al servizio.'),
      section('Mazzi e dati collegati alle partite', 'Liste dei mazzi, impostazioni stanza, metadati di partita e azioni manuali del tavolo possono essere salvati per fornire le funzioni scelte. CommanderZone non valida giocate legali e non automatizza le regole di Magic.'),
      section('Cookie e pubblicità', 'CommanderZone usa cookie essenziali e preferenze funzionali. Non usa analisi né carica pubblicità in questa fase; pubblicità futura richiederà informativa aggiornata, controlli di consenso e, se necessario, una CMP certificata.'),
      section('Base giuridica', 'Trattiamo dati per fornire il servizio richiesto, proteggere account e stanze, rispondere al supporto, rispettare obblighi legali e applicare le scelte di consenso.'),
      section('Destinatari', 'Non vendiamo dati personali. I fornitori possono accedere ai dati solo quando necessario per hosting, email, sicurezza, realtime o supporto. Le autorità possono ricevere dati se richiesto dalla legge.'),
      section('Conservazione', 'Conserviamo i dati solo per il tempo ragionevolmente necessario per servizio, sicurezza, supporto, obblighi legali o funzioni account controllate dall’utente.'),
      section('I tuoi diritti', `Puoi chiedere accesso, rettifica, cancellazione, opposizione, limitazione, portabilità o revoca del consenso scrivendo a ${LEGAL_CONTACT_EMAIL}.`),
      contactSection('it', 'Contatto', `Per domande sulla privacy, contatta ${LEGAL_CONTACT_EMAIL}. Questa pagina è informativa e non è consulenza legale.`),
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
    en: 'How CommanderZone uses essential cookies, functional preferences and advertising readiness controls.',
    es: 'Cómo CommanderZone usa cookies esenciales, preferencias funcionales y controles de preparación publicitaria.',
    de: 'Wie CommanderZone essenzielle Cookies, funktionale Einstellungen und Werbevorbereitung nutzt.',
    fr: 'Comment CommanderZone utilise les cookies essentiels, les préférences fonctionnelles et les contrôles de préparation publicitaire.',
    pt: 'Como o CommanderZone usa cookies essenciais, preferências funcionais e controles de preparação publicitária.',
    it: 'Come CommanderZone usa cookie essenziali, preferenze funzionali e controlli di preparazione pubblicitaria.',
  } as const satisfies Record<SeoLocaleCode, string>;
  const copy = {
    en: [
      section('Controller', `${LEGAL_OWNER_NAME} operates from ${LEGAL_OWNER_COUNTRY}. Contact: ${LEGAL_CONTACT_EMAIL}.`),
      section('What this page covers', 'Cookies and browser storage help the app remember session, security and interface information. This page lists what CommanderZone actually uses.'),
      section('Essential app cookies', 'We use essential storage to keep you signed in, protect your session, remember your cookie choice and enable authenticated realtime features when needed. Technical names: commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Preferences we remember', 'We remember interface choices you make, such as theme, background, deck view, table zoom, read chat state, recent deck history and missing-card watchlist. Technical names: commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Analytics and ads', 'CommanderZone does not use analytics cookies. Ads are prepared for a future phase, but are not loaded or treated as consented now.'),
      section('Changing preferences', 'You can reopen Cookie preferences from the footer controls and update your choice. You can also clear browser data, but the in-app control is the preferred method.'),
    ],
    es: [
      section('Responsable', `${LEGAL_OWNER_NAME} opera desde ${LEGAL_OWNER_COUNTRY}. Contacto: ${LEGAL_CONTACT_EMAIL}.`),
      section('Qué cubre esta página', 'Las cookies y el almacenamiento del navegador ayudan a recordar información de sesión, seguridad e interfaz. Esta página lista lo que CommanderZone usa realmente.'),
      section('Cookies esenciales de la app', 'Usamos almacenamiento esencial para mantener tu sesión, proteger el acceso, recordar tu elección de cookies y activar funciones realtime autenticadas cuando hacen falta. Nombres técnicos: commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Preferencias que recordamos', 'Recordamos ajustes de interfaz que eliges, como tema, fondo, vista de mazos, zoom de mesa, chats leídos, historial reciente de mazos y lista de cartas pendientes. Nombres técnicos: commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Analítica y publicidad', 'CommanderZone no usa cookies de analítica. La publicidad queda preparada para una fase futura, pero ahora no carga scripts publicitarios ni trata la publicidad como consentida.'),
      section('Cambiar preferencias', 'Puedes reabrir Preferencias de cookies desde los controles del pie de página y actualizar tu elección. También puedes borrar datos del navegador, pero el control dentro de la app es el método preferente.'),
    ],
    de: [
      section('Verantwortlicher', `${LEGAL_OWNER_NAME} wird von ${LEGAL_OWNER_COUNTRY} aus betrieben. Kontakt: ${LEGAL_CONTACT_EMAIL}.`),
      section('Worum es hier geht', 'Cookies und Browser-Speicher helfen der App, Sitzungs-, Sicherheits- und Oberflächeninformationen zu speichern. Diese Seite listet, was CommanderZone tatsächlich nutzt.'),
      section('Essenzielle App-Cookies', 'Wir verwenden essenziellen Speicher, um deine Sitzung zu halten, den Zugriff zu schützen, deine Cookie-Auswahl zu speichern und bei Bedarf authentifizierte Echtzeitfunktionen zu ermöglichen. Technische Namen: commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Gespeicherte Einstellungen', 'Wir merken uns von dir gewählte Oberflächenoptionen wie Theme, Hintergrund, Deckansicht, Tisch-Zoom, gelesene Chats, aktuelle Deckhistorie und Merkliste fehlender Karten. Technische Namen: commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Analyse und Werbung', 'CommanderZone verwendet keine Analyse-Cookies. Werbung ist für eine künftige Phase vorbereitet, wird derzeit aber nicht geladen oder als eingewilligt behandelt.'),
      section('Präferenzen ändern', 'Du kannst die Cookie-Einstellungen über die Fußzeilen-Steuerung erneut öffnen und deine Auswahl ändern. Browserdaten können ebenfalls gelöscht werden, der App-interne Kontrollpunkt ist jedoch der bevorzugte Weg.'),
    ],
    fr: [
      section('Responsable', `${LEGAL_OWNER_NAME} est exploité depuis ${LEGAL_OWNER_COUNTRY}. Contact : ${LEGAL_CONTACT_EMAIL}.`),
      section('Ce que couvre cette page', 'Les cookies et le stockage du navigateur aident l’app à mémoriser les informations de session, de sécurité et d’interface. Cette page liste ce que CommanderZone utilise réellement.'),
      section('Cookies essentiels de l’app', 'Nous utilisons un stockage essentiel pour maintenir votre session, protéger l’accès, mémoriser votre choix de cookies et activer les fonctions temps réel authentifiées si nécessaire. Noms techniques : commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Préférences mémorisées', 'Nous mémorisons les choix d’interface que vous faites, comme le thème, le fond, la vue des decks, le zoom de table, les chats lus, l’historique récent des decks et la liste des cartes manquantes. Noms techniques : commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Analyse et publicité', 'CommanderZone n’utilise pas de cookies d’analyse. La publicité est préparée pour une future phase, mais elle n’est pas chargée ni considérée comme consentie actuellement.'),
      section('Modifier les préférences', 'Vous pouvez rouvrir les préférences de cookies depuis le pied de page et mettre à jour votre choix. Vous pouvez aussi effacer les données du navigateur, mais le contrôle dans l’app est la méthode préférée.'),
    ],
    pt: [
      section('Responsável', `${LEGAL_OWNER_NAME} é operado a partir de ${LEGAL_OWNER_COUNTRY}. Contato: ${LEGAL_CONTACT_EMAIL}.`),
      section('O que esta página cobre', 'Cookies e armazenamento do navegador ajudam o app a lembrar informações de sessão, segurança e interface. Esta página lista o que o CommanderZone realmente usa.'),
      section('Cookies essenciais do app', 'Usamos armazenamento essencial para manter sua sessão, proteger o acesso, lembrar sua escolha de cookies e ativar recursos realtime autenticados quando necessário. Nomes técnicos: commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Preferências que lembramos', 'Lembramos escolhas de interface que você faz, como tema, fundo, visualização de decks, zoom da mesa, chats lidos, histórico recente de decks e lista de cartas pendentes. Nomes técnicos: commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Análise e publicidade', 'CommanderZone não usa cookies de análise. A publicidade fica preparada para uma fase futura, mas agora não carrega scripts publicitários nem é tratada como consentida.'),
      section('Alterar preferências', 'Você pode reabrir Preferências de cookies pelos controles do rodapé e atualizar sua escolha. Também pode limpar dados do navegador, mas o controle dentro do app é o método preferido.'),
    ],
    it: [
      section('Titolare', `${LEGAL_OWNER_NAME} è gestito da ${LEGAL_OWNER_COUNTRY}. Contatto: ${LEGAL_CONTACT_EMAIL}.`),
      section('Cosa copre questa pagina', 'Cookie e storage del browser aiutano l’app a ricordare informazioni di sessione, sicurezza e interfaccia. Questa pagina elenca ciò che CommanderZone usa davvero.'),
      section('Cookie essenziali dell’app', 'Usiamo storage essenziale per mantenere la sessione, proteggere l’accesso, ricordare la scelta sui cookie e attivare funzioni realtime autenticate quando necessario. Nomi tecnici: commanderzone.refresh, mercureAuthorization, commanderzone.cookieConsent, commanderzone.user.'),
      section('Preferenze ricordate', 'Ricordiamo scelte di interfaccia come tema, sfondo, vista mazzi, zoom del tavolo, chat lette, cronologia recente dei mazzi e lista delle carte mancanti. Nomi tecnici: commanderzone.theme, commanderzone.backgroundImage, commanderzone.backgroundTheme, community.deckViewer.viewMode, commanderZone.gameTable.battlefieldZoomPercent, commanderZone:game-chat-read:v1, commanderzone.deck-history.*, commanderzone.missing-watchlist.'),
      section('Analisi e pubblicità', 'CommanderZone non usa cookie di analisi. La pubblicità è preparata per una fase futura, ma ora non viene caricata né considerata consentita.'),
      section('Modificare le preferenze', 'Puoi riaprire le preferenze cookie dai controlli del footer e aggiornare la scelta. Puoi anche cancellare i dati del browser, ma il controllo interno dell’app è il metodo preferito.'),
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
      contactSection('en', 'Contact', `For terms questions, contact ${LEGAL_CONTACT_EMAIL}.`),
    ],
    es: [
      section('Contenido de fans no oficial', COMMON_FAN_CONTENT.es),
      section('Herramienta comunitaria', 'CommanderZone se ofrece como herramienta gratuita, no comercial, de entretenimiento y comunidad salvo que futuros términos indiquen claramente otra cosa.'),
      section('Responsabilidad del usuario', 'Eres responsable de tus mazos, conducta, enlaces de sala, actividad de cuenta y cumplimiento de reglas o políticas aplicables.'),
      section('Sin torneos oficiales', 'CommanderZone no ofrece torneos oficiales, juego ranked, rankings de matchmaking ni servicios competitivos sancionados.'),
      section('Mesa manual', 'CommanderZone es una mesa manual. No garantiza automatización de reglas, stack, prioridad ni validación de jugadas legales.'),
      section('Cambios del servicio', 'El servicio puede cambiar, pausarse, perder datos o no estar disponible. Intentamos ser cuidadosos, pero la disponibilidad no está garantizada.'),
      section('Propiedad intelectual', 'Magic: The Gathering y marcas relacionadas pertenecen a sus propietarios. CommanderZone solo referencia contenido fan y contextos de juego comunitario.'),
      contactSection('es', 'Contacto', `Para preguntas sobre términos, contacta con ${LEGAL_CONTACT_EMAIL}.`),
    ],
    de: [
      section('Inoffizieller Fan-Content', COMMON_FAN_CONTENT.de),
      section('Community-Tool', 'CommanderZone ist als kostenloses, nicht-kommerzielles Unterhaltungs- und Community-Tool gedacht, sofern künftige Bedingungen nichts anderes klar regeln.'),
      section('Verantwortung der Nutzer', 'Du bist verantwortlich für Decks, Verhalten, Raumlinks, Kontoaktivität und die Einhaltung anwendbarer Regeln oder Plattformrichtlinien.'),
      section('Kein offizieller Turnierdienst', 'CommanderZone bietet keine offiziellen Turniere, Ranked Play, Matchmaking-Ranglisten oder sanktionierte Wettbewerbsdienste.'),
      section('Manueller Tisch', 'CommanderZone ist ein manueller Tisch. Es garantiert keine Regelautomatisierung, keinen Stack, keine Priorität und keine Legalitätsprüfung von Spielzügen.'),
      section('Änderungen des Dienstes', 'Der Dienst kann sich ändern, pausieren, Daten verlieren oder nicht verfügbar sein. Verfügbarkeit wird nicht garantiert.'),
      section('Geistiges Eigentum', 'Magic: The Gathering und verwandte Marken gehören ihren Eigentümern. CommanderZone verweist nur auf Fan-Content und Community-Spielkontexte.'),
      contactSection('de', 'Kontakt', `Bei Fragen zu den Bedingungen kontaktiere ${LEGAL_CONTACT_EMAIL}.`),
    ],
    fr: [
      section('Contenu de fan non officiel', COMMON_FAN_CONTENT.fr),
      section('Outil communautaire', 'CommanderZone est prévu comme outil gratuit, non commercial, de divertissement et de communauté, sauf indication contraire claire dans de futurs termes.'),
      section('Responsabilité utilisateur', 'Vous êtes responsable de vos decks, de votre conduite, des liens de salon, de l’activité du compte et du respect des règles applicables.'),
      section('Pas de service de tournoi officiel', 'CommanderZone ne fournit pas de tournois officiels, de mode classé, de classement de matchmaking ni de services compétitifs sanctionnés.'),
      section('Table manuelle', 'CommanderZone est une table manuelle. Il ne garantit pas l’automatisation des règles, la pile, la priorité ou la validation des actions légales.'),
      section('Évolution du service', 'Le service peut changer, être suspendu, perdre des données ou devenir indisponible. La disponibilité n’est pas garantie.'),
      section('Propriété intellectuelle', 'Magic: The Gathering et les marques associées appartiennent à leurs propriétaires. CommanderZone référence seulement du contenu fan et des contextes de jeu communautaire.'),
      contactSection('fr', 'Contact', `Pour les questions sur les conditions, contactez ${LEGAL_CONTACT_EMAIL}.`),
    ],
    pt: [
      section('Conteúdo de fã não oficial', COMMON_FAN_CONTENT.pt),
      section('Ferramenta comunitária', 'CommanderZone é pensado como ferramenta gratuita, não comercial, de entretenimento e comunidade, salvo se termos futuros disserem claramente o contrário.'),
      section('Responsabilidade do usuário', 'Você é responsável por seus decks, conduta, links de sala, atividade da conta e cumprimento de regras ou políticas aplicáveis.'),
      section('Sem serviço oficial de torneios', 'CommanderZone não oferece torneios oficiais, jogo ranqueado, rankings de matchmaking ou serviços competitivos sancionados.'),
      section('Mesa manual', 'CommanderZone é uma mesa manual. Não garante automação de regras, pilha, prioridade ou validação de jogadas legais.'),
      section('Mudanças no serviço', 'O serviço pode mudar, pausar, perder dados ou ficar indisponível. A disponibilidade não é garantida.'),
      section('Propriedade intelectual', 'Magic: The Gathering e marcas relacionadas pertencem aos seus donos. CommanderZone apenas referencia conteúdo de fã e contextos de jogo comunitário.'),
      contactSection('pt', 'Contato', `Para perguntas sobre termos, entre em contato em ${LEGAL_CONTACT_EMAIL}.`),
    ],
    it: [
      section('Contenuto fan non ufficiale', COMMON_FAN_CONTENT.it),
      section('Strumento community', 'CommanderZone è pensato come strumento gratuito, non commerciale, di intrattenimento e community, salvo futuri termini espliciti diversi.'),
      section('Responsabilità utente', 'Sei responsabile di mazzi, comportamento, link stanza, attività account e rispetto di regole o policy applicabili.'),
      section('Nessun servizio torneo ufficiale', 'CommanderZone non offre tornei ufficiali, gioco classificato, ranking di matchmaking o servizi competitivi sanzionati.'),
      section('Tavolo manuale', 'CommanderZone è un tavolo manuale. Non garantisce automazione delle regole, stack, priorità o validazione di giocate legali.'),
      section('Modifiche al servizio', 'Il servizio può cambiare, fermarsi, perdere dati o diventare indisponibile. La disponibilità non è garantita.'),
      section('Proprietà intellettuale', 'Magic: The Gathering e i marchi collegati appartengono ai rispettivi proprietari. CommanderZone cita solo contenuto fan e contesti di gioco community.'),
      contactSection('it', 'Contatto', `Per domande sui termini, contatta ${LEGAL_CONTACT_EMAIL}.`),
    ],
  } as const satisfies Record<SeoLocaleCode, readonly LegalSectionContent[]>;

  return legalPage('terms', locale, title, h1, descriptions[locale], copy[locale]);
}

function section(heading: string, ...body: readonly string[]): LegalSectionContent {
  return { heading, body };
}

function contactSection(locale: SeoLocaleCode, heading: string, ...body: readonly string[]): LegalSectionContent {
  return {
    heading,
    body,
    actions: [
      {
        label: CONTACT_ACTION_LABELS[locale],
        href: LEGAL_CONTACT_PATH,
      },
    ],
  };
}

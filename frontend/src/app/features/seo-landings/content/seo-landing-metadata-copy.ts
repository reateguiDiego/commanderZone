import { SeoRouteKey } from '../../../core/localization/seo-routes';

export type PriorityLocaleCode = 'es' | 'en' | 'de' | 'fr' | 'pt' | 'it';

export interface SeoLandingMetadataCopy {
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly h1: string;
  readonly heroSubtitle: string;
}

export const SEO_LANDING_METADATA_COPY = {
  home: {
    en: metadata(
      'CommanderZone | Play MTG Commander Online with Your Pod',
      'Play MTG Commander online with your pod from the browser. Prepare decks, create rooms and use a manual table for real Commander games.',
      'Play Commander online with your pod',
      'Prepare your Commander deck, open CommanderZone in the browser and play with a clear manual table for rooms, life totals and commander damage.',
    ),
    es: metadata(
      'CommanderZone | Jugar Commander MTG online con tu grupo',
      'Juega Commander MTG online con tu grupo desde el navegador. Prepara mazos, crea salas y usa una mesa manual para partidas reales.',
      'Jugar Commander online con tu grupo',
      'Prepara tu mazo Commander, entra desde el navegador y juega con una mesa manual clara para salas, vidas y daño de comandante.',
    ),
    de: metadata(
      'CommanderZone | MTG Commander online mit deiner Gruppe spielen',
      'Spiele MTG Commander online mit deiner Gruppe im Browser. Bereite Decks vor, erstelle Räume und nutze einen manuellen Commander-Tisch.',
      'Commander online mit deiner Gruppe spielen',
      'Bereite dein Commander-Deck vor, öffne CommanderZone im Browser und spiele an einem manuellen Tisch mit Räumen, Lebenspunkten und Commander-Schaden.',
    ),
    fr: metadata(
      'CommanderZone | Jouer à Commander en ligne',
      'Jouez à Commander MTG en ligne avec votre groupe depuis le navigateur. Préparez des decks, créez des salles et utilisez une table manuelle.',
      'Jouer à Commander en ligne avec votre groupe',
      'Préparez votre deck Commander, ouvrez CommanderZone dans le navigateur et jouez sur une table manuelle avec salles, points de vie et blessures de commandant.',
    ),
    pt: metadata(
      'CommanderZone | Jogar Commander MTG online com seu grupo',
      'Jogue Commander MTG online com seu grupo pelo navegador. Prepare decks, crie salas e use uma mesa manual para partidas reais.',
      'Jogar Commander online com seu grupo',
      'Prepare seu deck Commander, abra o CommanderZone no navegador e jogue em uma mesa manual com salas, vida e dano de comandante.',
    ),
    it: metadata(
      'CommanderZone | Giocare Commander MTG online con il tuo gruppo',
      'Gioca Commander MTG online con il tuo gruppo dal browser. Prepara mazzi, crea stanze e usa un tavolo manuale per partite reali.',
      'Giocare Commander online con il tuo gruppo',
      'Prepara il tuo mazzo Commander, apri CommanderZone nel browser e gioca su un tavolo manuale con stanze, punti vita e danno da comandante.',
    ),
  },
  playCommanderOnline: {
    en: metadata(
      'Play Commander Online in Your Browser | CommanderZone',
      'Play Commander online with your pod from the browser. Prepare decks, create rooms, track life totals and use a manual MTG Commander table.',
      'Play Commander online in your browser',
      'Create a room, invite your pod and play Commander from the browser with a manual digital table for decks, life totals and commander damage.',
    ),
    es: metadata(
      'Jugar Commander online en el navegador | CommanderZone',
      'Juega Commander online con tu grupo desde el navegador. Prepara mazos, crea salas, controla vidas y usa una mesa manual para MTG Commander.',
      'Jugar Commander online en el navegador',
      'Crea una sala, invita a tu grupo y juega Commander desde el navegador con una mesa digital manual para mazos, vidas y daño de comandante.',
    ),
    de: metadata(
      'Commander online im Browser spielen | CommanderZone',
      'Spiele Commander online mit deiner Gruppe im Browser. Bereite Decks vor, erstelle Räume und nutze einen manuellen MTG-Commander-Tisch.',
      'Commander online im Browser spielen',
      'Erstelle einen Raum, lade deine Gruppe ein und spiele Commander im Browser an einem manuellen digitalen Tisch für Decks und Lebenspunkte.',
    ),
    fr: metadata(
      'Jouer à Commander en ligne dans le navigateur | CommanderZone',
      'Jouez à Commander en ligne avec votre groupe depuis le navigateur. Préparez des decks, créez des salles et suivez les points de vie.',
      'Jouer à Commander en ligne dans le navigateur',
      'Créez une salle, invitez votre groupe et jouez à Commander dans le navigateur sur une table numérique manuelle pour decks et points de vie.',
    ),
    pt: metadata(
      'Jogar Commander online no navegador | CommanderZone',
      'Jogue Commander online com seu grupo pelo navegador. Prepare decks, crie salas, acompanhe vida e use uma mesa manual para Commander.',
      'Jogar Commander online no navegador',
      'Crie uma sala, convide seu grupo e jogue Commander pelo navegador em uma mesa digital manual para decks, vida e dano de comandante.',
    ),
    it: metadata(
      'Giocare Commander online nel browser | CommanderZone',
      'Gioca Commander online con il tuo gruppo dal browser. Prepara mazzi, crea stanze, segui i punti vita e usa un tavolo manuale.',
      'Giocare Commander online nel browser',
      'Crea una stanza, invita il tuo gruppo e gioca Commander dal browser con un tavolo digitale manuale per mazzi, vite e danno da comandante.',
    ),
  },
  playMagicOnlineWithFriends: {
    en: metadata(
      'Play Magic Online with Friends for Commander | CommanderZone',
      'Play Magic online with friends in Commander pods. Use a browser-based manual table for rooms, decks, life totals and commander damage.',
      'Play Magic online with friends for Commander',
      'Prepare a Commander deck, create a browser room and give your friends a manual table for clear multiplayer Magic sessions.',
    ),
    es: metadata(
      'Jugar Magic online con amigos en Commander | CommanderZone',
      'Juega Magic online con amigos en partidas Commander. Usa una mesa manual en navegador para salas, mazos, vidas y daño de comandante.',
      'Jugar Magic online con amigos en Commander',
      'Prepara un mazo Commander, crea una sala en el navegador y da a tus amigos una mesa manual para partidas multijugador claras.',
    ),
    de: metadata(
      'Magic online mit Freunden | CommanderZone',
      'Spiele Magic online mit Freunden für Commander-Runden. Nutze einen manuellen Browser-Tisch für Räume, Decks und Commander-Schaden.',
      'Magic online mit Freunden für Commander spielen',
      'Bereite ein Commander-Deck vor, erstelle einen Browser-Raum und gib deiner Gruppe einen manuellen Tisch für klare Multiplayer-Partien.',
    ),
    fr: metadata(
      'Jouer à Magic en ligne avec des amis | CommanderZone',
      'Jouez à Magic en ligne avec des amis autour de Commander. Utilisez une table manuelle dans le navigateur pour salles, decks et points de vie.',
      'Jouer à Magic en ligne avec des amis en Commander',
      'Préparez un deck Commander, créez une salle dans le navigateur et donnez à votre groupe une table manuelle pour jouer clairement.',
    ),
    pt: metadata(
      'Jogar Magic online com amigos no Commander | CommanderZone',
      'Jogue Magic online com amigos em partidas Commander. Use uma mesa manual no navegador para salas, decks, vida e dano de comandante.',
      'Jogar Magic online com amigos no Commander',
      'Prepare um deck Commander, crie uma sala no navegador e dê ao grupo uma mesa manual para partidas multiplayer claras.',
    ),
    it: metadata(
      'Giocare Magic online con amici in Commander | CommanderZone',
      'Gioca Magic online con amici in partite Commander. Usa un tavolo manuale nel browser per stanze, mazzi, vite e danno da comandante.',
      'Giocare Magic online con amici in Commander',
      'Prepara un mazzo Commander, crea una stanza nel browser e dai al gruppo un tavolo manuale per partite multiplayer chiare.',
    ),
  },
  createCommanderRoom: {
    en: metadata(
      'Create a Private Commander Room Online | CommanderZone',
      'Create a private Commander room online from the browser. Prepare a deck, invite your pod and move into a manual table when everyone is ready.',
      'Create a private Commander room online',
      'Prepare your deck, open a browser-based Commander room and invite your pod before moving into the manual table.',
    ),
    es: metadata(
      'Crear una sala privada de Commander online | CommanderZone',
      'Crea una sala privada de Commander online desde el navegador. Prepara un mazo, invita a tu grupo y pasa a una mesa manual.',
      'Crear una sala privada de Commander online',
      'Prepara tu mazo, abre una sala Commander en el navegador e invita a tu grupo antes de pasar a la mesa manual.',
    ),
    de: metadata(
      'Privaten Commander-Raum online erstellen | CommanderZone',
      'Erstelle einen privaten Commander-Raum online im Browser. Bereite ein Deck vor, lade deine Runde ein und wechsle an den manuellen Tisch.',
      'Privaten Commander-Raum online erstellen',
      'Bereite dein Deck vor, öffne einen Commander-Raum im Browser und lade deine Runde ein, bevor ihr an den manuellen Tisch wechselt.',
    ),
    fr: metadata(
      'Créer une salle Commander privée en ligne | CommanderZone',
      'Créez une salle Commander privée en ligne depuis le navigateur. Préparez un deck, invitez votre groupe et passez sur la table manuelle.',
      'Créer une salle Commander privée en ligne',
      'Préparez votre deck, ouvrez une salle Commander dans le navigateur et invitez votre groupe avant la table manuelle.',
    ),
    pt: metadata(
      'Criar uma sala privada de Commander online | CommanderZone',
      'Crie uma sala privada de Commander online pelo navegador. Prepare um deck, convide seu grupo e entre em uma mesa manual.',
      'Criar uma sala privada de Commander online',
      'Prepare seu deck, abra uma sala Commander no navegador e convide seu grupo antes de entrar na mesa manual.',
    ),
    it: metadata(
      'Creare una stanza Commander privata online | CommanderZone',
      'Crea una stanza Commander privata online dal browser. Prepara un mazzo, invita il tuo gruppo e passa a un tavolo manuale.',
      'Creare una stanza Commander privata online',
      'Prepara il mazzo, apri una stanza Commander nel browser e invita il tuo gruppo prima di passare al tavolo manuale.',
    ),
  },
  importCommanderDeck: {
    en: metadata(
      'Import a Commander Deck and Play Online | CommanderZone',
      'Import a Commander deck from a text decklist, review it in the browser and use it in rooms with your pod on a manual table.',
      'Import a Commander deck and play online',
      'Paste your decklist, save the Commander deck and bring it into browser rooms with a manual table for your pod.',
    ),
    es: metadata(
      'Importar un mazo Commander para jugar online | CommanderZone',
      'Importa un mazo Commander desde una decklist, revísalo en el navegador y úsalo en salas con tu grupo en una mesa manual.',
      'Importar un mazo Commander para jugar online',
      'Pega tu decklist, guarda el mazo Commander y llévalo a salas del navegador con una mesa manual para tu grupo.',
    ),
    de: metadata(
      'Commander-Deck importieren und online spielen | CommanderZone',
      'Importiere ein Commander-Deck aus einer Deckliste, prüfe es im Browser und nutze es in Räumen mit deiner Gruppe am manuellen Tisch.',
      'Commander-Deck importieren und online spielen',
      'Füge deine Deckliste ein, speichere das Commander-Deck und nutze es in Browser-Räumen an einem manuellen Tisch.',
    ),
    fr: metadata(
      'Importer un deck Commander pour jouer en ligne | CommanderZone',
      'Importez un deck Commander depuis une decklist, vérifiez-le dans le navigateur et utilisez-le en salle sur une table manuelle.',
      'Importer un deck Commander pour jouer en ligne',
      'Collez votre decklist, sauvegardez le deck Commander et utilisez-le dans des salles avec une table manuelle.',
    ),
    pt: metadata(
      'Importar um deck Commander para jogar online | CommanderZone',
      'Importe um deck Commander de uma decklist, revise no navegador e use em salas com seu grupo em uma mesa manual.',
      'Importar um deck Commander para jogar online',
      'Cole sua decklist, salve o deck Commander e leve-o para salas no navegador com uma mesa manual para seu grupo.',
    ),
    it: metadata(
      'Importare mazzo Commander online | CommanderZone',
      'Importa un mazzo Commander da una decklist, controllalo nel browser e usalo nelle stanze con il tuo gruppo su un tavolo manuale.',
      'Importare un mazzo Commander per giocare online',
      'Incolla la decklist, salva il mazzo Commander e portalo nelle stanze del browser con un tavolo manuale.',
    ),
  },
  commanderDeckBuilder: {
    en: metadata(
      'Commander Deck Builder for Online MTG Pods | CommanderZone',
      'Build and organize Commander decks in the browser, then use them with your MTG pod in rooms and manual online games.',
      'Commander deck builder for online MTG pods',
      'Create, import and organize Commander decks in the browser so they are ready for rooms and manual online games.',
    ),
    es: metadata(
      'Deck builder Commander para MTG online | CommanderZone',
      'Crea y organiza mazos Commander en el navegador, luego úsalos con tu grupo de MTG en salas y partidas online manuales.',
      'Deck builder Commander para MTG online',
      'Crea, importa y organiza mazos Commander en el navegador para usarlos en salas y partidas online manuales.',
    ),
    de: metadata(
      'Commander Deck Builder für Online-MTG | CommanderZone',
      'Baue und organisiere Commander-Decks im Browser, dann nutze sie mit deiner MTG-Runde in Räumen und manuellen Online-Partien.',
      'Commander Deck Builder für Online-MTG',
      'Erstelle, importiere und organisiere Commander-Decks im Browser, damit sie für Räume und manuelle Partien bereit sind.',
    ),
    fr: metadata(
      'Deck builder Commander pour MTG en ligne | CommanderZone',
      'Créez et organisez des decks Commander dans le navigateur, puis utilisez-les avec votre groupe MTG en salle et table manuelle.',
      'Deck builder Commander pour MTG en ligne',
      'Créez, importez et organisez des decks Commander dans le navigateur pour les utiliser en salle et parties manuelles.',
    ),
    pt: metadata(
      'Deck builder Commander para MTG online | CommanderZone',
      'Crie e organize decks Commander no navegador, depois use com seu grupo de MTG em salas e partidas online manuais.',
      'Deck builder Commander para MTG online',
      'Crie, importe e organize decks Commander no navegador para usar em salas e partidas online manuais.',
    ),
    it: metadata(
      'Deck builder Commander per MTG online | CommanderZone',
      'Crea e organizza mazzi Commander nel browser, poi usali con il tuo gruppo MTG in stanze e partite online manuali.',
      'Deck builder Commander per MTG online',
      'Crea, importa e organizza mazzi Commander nel browser per usarli in stanze e partite online manuali.',
    ),
  },
  tableAssistant: {
    en: metadata(
      'Commander Life Counter for MTG Pods | CommanderZone',
      'Use CommanderZone as a Commander life counter for paper MTG games. Track life totals, commander damage and table state on phone or tablet.',
      'Commander life counter for MTG pods',
      'Track life totals, commander damage and table state on a phone or tablet with a manual assistant for physical Commander games.',
    ),
    es: metadata(
      'Contador de vidas Commander MTG | CommanderZone',
      'Usa CommanderZone como contador de vidas para Commander MTG físico. Controla vidas, daño de comandante y estado de mesa desde móvil o tablet.',
      'Contador de vidas Commander para MTG',
      'Controla vidas, daño de comandante y estado de mesa desde móvil o tablet con un asistente manual para partidas físicas de Commander.',
    ),
    de: metadata(
      'Commander Life Counter für MTG-Runden | CommanderZone',
      'Nutze CommanderZone als Life Counter für physische MTG-Commander-Partien. Zähle Lebenspunkte, Commander-Schaden und Tischstatus.',
      'Commander Life Counter für MTG-Runden',
      'Zähle Lebenspunkte, Commander-Schaden und Tischstatus auf Smartphone oder Tablet mit einem manuellen Assistenten für Commander.',
    ),
    fr: metadata(
      'Compteur de vie Commander MTG | CommanderZone',
      'Utilisez CommanderZone comme compteur de vie pour Commander MTG physique. Suivez points de vie, blessures de commandant et table.',
      'Compteur de vie Commander pour MTG',
      'Suivez les points de vie, les blessures de commandant et l’état de table sur mobile ou tablette avec un assistant manuel.',
    ),
    pt: metadata(
      'Contador de vida Commander MTG | CommanderZone',
      'Use CommanderZone como contador de vida para Commander MTG físico. Controle vida, dano de comandante e estado da mesa pelo celular.',
      'Contador de vida Commander para MTG',
      'Controle vida, dano de comandante e estado da mesa pelo celular ou tablet com um assistente manual para partidas físicas de Commander.',
    ),
    it: metadata(
      'Contatore vite Commander MTG | CommanderZone',
      'Usa CommanderZone come contatore vite per Commander MTG fisico. Segui punti vita, danno da comandante e stato del tavolo.',
      'Contatore vite Commander per MTG',
      'Segui punti vita, danno da comandante e stato del tavolo da smartphone o tablet con un assistente manuale.',
    ),
  },
  waysToPlayCommanderOnline: {
    en: metadata(
      'Ways to Play Commander Online with Your Pod | CommanderZone',
      'Compare ways to play Commander online with your pod: webcam, manual browser table, rooms, decks and life total tracking.',
      'Ways to play Commander online with your pod',
      'Compare webcam play, manual browser tables and digital rooms so your Commander pod can choose a setup that fits.',
    ),
    es: metadata(
      'Formas de jugar Commander online con tu grupo | CommanderZone',
      'Compara formas de jugar Commander online con tu grupo: webcam, mesa manual en navegador, salas, mazos y control de vidas.',
      'Formas de jugar Commander online con tu grupo',
      'Compara webcam, mesas manuales en navegador y salas digitales para que tu grupo Commander elija el setup adecuado.',
    ),
    de: metadata(
      'Möglichkeiten, Commander online zu spielen | CommanderZone',
      'Vergleiche Möglichkeiten, Commander online zu spielen: Webcam, manueller Browser-Tisch, Räume, Decks und Lebenspunkte.',
      'Möglichkeiten, Commander online zu spielen',
      'Vergleiche Webcam-Spiel, manuelle Browser-Tische und digitale Räume, damit deine Commander-Runde ein passendes Setup findet.',
    ),
    fr: metadata(
      'Façons de jouer à Commander en ligne | CommanderZone',
      'Comparez les façons de jouer à Commander en ligne : webcam, table manuelle dans le navigateur, salles, decks et points de vie.',
      'Façons de jouer à Commander en ligne',
      'Comparez webcam, tables manuelles dans le navigateur et salles numériques pour choisir le bon setup Commander.',
    ),
    pt: metadata(
      'Formas de jogar Commander online com seu grupo | CommanderZone',
      'Compare formas de jogar Commander online com seu grupo: webcam, mesa manual no navegador, salas, decks e controle de vida.',
      'Formas de jogar Commander online com seu grupo',
      'Compare webcam, mesas manuais no navegador e salas digitais para seu grupo Commander escolher o setup certo.',
    ),
    it: metadata(
      'Modi per giocare Commander online | CommanderZone',
      'Confronta modi per giocare Commander online: webcam, tavolo manuale nel browser, stanze, mazzi e punti vita.',
      'Modi per giocare Commander online con il tuo gruppo',
      'Confronta webcam, tavoli manuali nel browser e stanze digitali per scegliere il setup Commander adatto al gruppo.',
    ),
  },
  howToPlayCommanderOnline: {
    en: metadata(
      'How to Play Commander Online Step by Step | CommanderZone',
      'Learn how to play Commander online step by step: prepare a deck, create a room, invite friends and use a manual browser table.',
      'How to play Commander online step by step',
      'Follow a simple Commander flow in the browser: prepare decks, create a room, invite your pod and keep the manual table clear.',
    ),
    es: metadata(
      'Cómo jugar Commander online paso a paso | CommanderZone',
      'Aprende cómo jugar Commander online paso a paso: prepara un mazo, crea una sala, invita amigos y usa una mesa manual en navegador.',
      'Cómo jugar Commander online paso a paso',
      'Sigue un flujo Commander sencillo en el navegador: prepara mazos, crea una sala, invita a tu grupo y mantén clara la mesa manual.',
    ),
    de: metadata(
      'Commander online spielen: Anleitung | CommanderZone',
      'Lerne Schritt für Schritt, Commander online zu spielen: Deck vorbereiten, Raum erstellen, Freunde einladen und manuellen Browser-Tisch nutzen.',
      'Commander online spielen: Anleitung',
      'Folge einem klaren Commander-Ablauf im Browser: Decks vorbereiten, Raum erstellen, Gruppe einladen und den manuellen Tisch sichtbar halten.',
    ),
    fr: metadata(
      'Comment jouer à Commander en ligne | CommanderZone',
      'Apprenez comment jouer à Commander en ligne : préparer un deck, créer une salle, inviter des amis et utiliser une table manuelle.',
      'Comment jouer à Commander en ligne',
      'Suivez un flux Commander simple dans le navigateur : préparez les decks, créez une salle, invitez le groupe et gardez la table claire.',
    ),
    pt: metadata(
      'Como jogar Commander online passo a passo | CommanderZone',
      'Aprenda como jogar Commander online passo a passo: prepare um deck, crie uma sala, convide amigos e use uma mesa manual no navegador.',
      'Como jogar Commander online passo a passo',
      'Siga um fluxo Commander simples no navegador: prepare decks, crie uma sala, convide seu grupo e mantenha a mesa manual clara.',
    ),
    it: metadata(
      'Come giocare Commander online passo dopo passo | CommanderZone',
      'Scopri come giocare Commander online passo dopo passo: prepara un mazzo, crea una stanza, invita amici e usa un tavolo manuale.',
      'Come giocare Commander online passo dopo passo',
      'Segui un flusso Commander semplice nel browser: prepara mazzi, crea una stanza, invita il gruppo e tieni chiaro il tavolo manuale.',
    ),
  },
  spellTableAlternative: {
    en: metadata(
      'SpellTable Alternative for Commander Online | CommanderZone',
      'Looking for a SpellTable alternative for Commander? Use a manual digital table in the browser with rooms, decks, life totals and commander damage.',
      'A SpellTable alternative for digital Commander pods',
      'SpellTable fits webcam paper Magic. CommanderZone gives your pod a manual browser table connected to decks, rooms, life totals and commander damage.',
    ),
    es: metadata(
      'Alternativa a SpellTable para Commander | CommanderZone',
      '¿Buscas una alternativa a SpellTable para Commander? Usa una mesa digital manual en navegador con salas, mazos, vidas y daño de comandante.',
      'Una alternativa a SpellTable para pods digitales de Commander',
      'SpellTable encaja con Magic físico por webcam. CommanderZone da a tu grupo una mesa manual en navegador con mazos, salas, vidas y daño de comandante.',
    ),
    de: metadata(
      'SpellTable Alternative für Commander online | CommanderZone',
      'Suchst du eine SpellTable Alternative für Commander? Nutze einen manuellen digitalen Tisch im Browser mit Räumen, Decks und Commander-Schaden.',
      'Eine SpellTable Alternative für digitale Commander-Runden',
      'SpellTable passt zu Paper Magic per Webcam. CommanderZone gibt deiner Runde einen manuellen Browser-Tisch mit Decks, Räumen und Commander-Schaden.',
    ),
    fr: metadata(
      'Alternative à SpellTable pour Commander | CommanderZone',
      'Vous cherchez une alternative à SpellTable pour Commander ? Utilisez une table numérique manuelle dans le navigateur avec salles et decks.',
      'Une alternative à SpellTable pour les groupes Commander numériques',
      'SpellTable convient à Magic papier par webcam. CommanderZone offre une table manuelle dans le navigateur avec decks, salles et blessures de commandant.',
    ),
    pt: metadata(
      'Alternativa ao SpellTable para Commander | CommanderZone',
      'Procurando uma alternativa ao SpellTable para Commander? Use uma mesa digital manual no navegador com salas, decks, vida e dano de comandante.',
      'Uma alternativa ao SpellTable para grupos digitais de Commander',
      'SpellTable funciona para Magic físico por webcam. CommanderZone dá ao grupo uma mesa manual no navegador com decks, salas, vida e dano de comandante.',
    ),
    it: metadata(
      'Alternativa a SpellTable per Commander online | CommanderZone',
      'Cerchi un’alternativa a SpellTable per Commander? Usa un tavolo digitale manuale nel browser con stanze, mazzi, vite e danno da comandante.',
      'Un’alternativa a SpellTable per pod Commander digitali',
      'SpellTable è adatto a Magic cartaceo via webcam. CommanderZone offre al pod un tavolo manuale nel browser con mazzi, stanze e danno da comandante.',
    ),
  },
  playCommanderOnlineFree: {
    en: metadata(
      'Play Commander Online Free in Your Browser | CommanderZone',
      'Play Commander online free with current CommanderZone features. Use the browser for rooms, decks and a manual table without buying digital cards.',
      'Play Commander online free from your browser',
      'Start a Commander game from the browser with free current features for decks, rooms and a manual table; account may be needed for saved app features.',
    ),
    es: metadata(
      'Jugar Commander online gratis en el navegador | CommanderZone',
      'Juega Commander online gratis con las funciones actuales de CommanderZone. Usa navegador, salas, mazos y mesa manual sin compras de cartas digitales.',
      'Jugar Commander online gratis desde el navegador',
      'Empieza una partida Commander en el navegador con funciones actuales gratuitas para mazos, salas y mesa manual; algunas funciones guardadas requieren cuenta.',
    ),
    de: metadata(
      'Commander kostenlos online im Browser spielen | CommanderZone',
      'Spiele Commander kostenlos online mit aktuellen CommanderZone-Funktionen: Browser, Räume, Decks und manueller Tisch ohne digitale Kartenkäufe.',
      'Commander kostenlos online im Browser spielen',
      'Starte Commander im Browser mit kostenlosen aktuellen Funktionen für Decks, Räume und manuellen Tisch; gespeicherte App-Funktionen können ein Konto brauchen.',
    ),
    fr: metadata(
      'Jouer à Commander en ligne gratuitement | CommanderZone',
      'Jouez à Commander en ligne gratuitement avec les fonctions actuelles de CommanderZone : navigateur, salles, decks et table manuelle.',
      'Jouer à Commander en ligne gratuitement depuis le navigateur',
      'Lancez une partie Commander dans le navigateur avec les fonctions gratuites actuelles pour decks, salles et table manuelle; certaines options demandent un compte.',
    ),
    pt: metadata(
      'Jogar Commander online grátis no navegador | CommanderZone',
      'Jogue Commander online grátis com os recursos atuais do CommanderZone. Use navegador, salas, decks e mesa manual sem comprar cartas digitais.',
      'Jogar Commander online grátis pelo navegador',
      'Comece uma partida Commander no navegador com recursos atuais gratuitos para decks, salas e mesa manual; recursos salvos podem exigir conta.',
    ),
    it: metadata(
      'Giocare Commander online gratis nel browser | CommanderZone',
      'Gioca Commander online gratis con le funzioni attuali di CommanderZone. Usa browser, stanze, mazzi e tavolo manuale senza acquisti di carte digitali.',
      'Giocare Commander online gratis dal browser',
      'Inizia una partita Commander nel browser con funzioni attuali gratuite per mazzi, stanze e tavolo manuale; alcune funzioni salvate richiedono account.',
    ),
  },
  playCommanderWithoutWebcam: {
    en: metadata(
      'Play Commander Online Without Webcam | CommanderZone',
      'Play Commander online without a webcam setup. Use a manual browser table for rooms, decks, life totals and commander damage with your pod.',
      'Play Commander online without a webcam setup',
      'Use a digital manual table in the browser instead of pointing cameras at paper cards, while your pod keeps Commander decisions manual.',
    ),
    es: metadata(
      'Jugar Commander online sin webcam | CommanderZone',
      'Juega Commander online sin configurar webcam. Usa una mesa manual en navegador para salas, mazos, vidas y daño de comandante con tu grupo.',
      'Jugar Commander online sin configurar webcam',
      'Usa una mesa digital manual en el navegador en lugar de apuntar cámaras a cartas físicas, manteniendo las decisiones de Commander en manos del grupo.',
    ),
    de: metadata(
      'Commander online ohne Webcam spielen | CommanderZone',
      'Spiele Commander online ohne Webcam-Setup. Nutze einen manuellen Browser-Tisch für Räume, Decks, Lebenspunkte und Commander-Schaden.',
      'Commander online ohne Webcam-Setup spielen',
      'Nutze einen manuellen digitalen Tisch im Browser statt Kameras auf Papierkarten zu richten; die Commander-Entscheidungen bleiben bei der Runde.',
    ),
    fr: metadata(
      'Jouer à Commander en ligne sans webcam | CommanderZone',
      'Jouez à Commander en ligne sans configuration webcam. Utilisez une table manuelle dans le navigateur pour salles, decks et points de vie.',
      'Jouer à Commander en ligne sans configuration webcam',
      'Utilisez une table numérique manuelle dans le navigateur au lieu de filmer des cartes papier, avec des décisions Commander gérées par le groupe.',
    ),
    pt: metadata(
      'Jogar Commander online sem webcam | CommanderZone',
      'Jogue Commander online sem configurar webcam. Use uma mesa manual no navegador para salas, decks, vida e dano de comandante com seu grupo.',
      'Jogar Commander online sem configurar webcam',
      'Use uma mesa digital manual no navegador em vez de apontar câmeras para cartas físicas, mantendo as decisões de Commander com o grupo.',
    ),
    it: metadata(
      'Giocare Commander online senza webcam | CommanderZone',
      'Gioca Commander online senza configurare webcam. Usa un tavolo manuale nel browser per stanze, mazzi, vite e danno da comandante.',
      'Giocare Commander online senza configurare una webcam',
      'Usa un tavolo digitale manuale nel browser invece di puntare camere sulle carte fisiche, lasciando le decisioni Commander al gruppo.',
    ),
  },
  playEdhOnline: {
    en: metadata(
      'Play EDH Online with Your Commander Pod | CommanderZone',
      'Play EDH online with your Commander pod. EDH is the community name for Commander; use a manual browser table for decks, rooms and life totals.',
      'Play EDH online with a manual Commander table',
      'EDH is the community name many players still use for Commander. Create a browser room and use a manual digital table with your pod.',
    ),
    es: metadata(
      'Jugar EDH online con tu grupo de Commander | CommanderZone',
      'Juega EDH online con tu grupo de Commander. EDH es el nombre comunitario de Commander; usa una mesa manual en navegador.',
      'Jugar EDH online con una mesa manual de Commander',
      'EDH es el nombre comunitario que muchos jugadores siguen usando para Commander. Crea una sala en navegador y usa una mesa digital manual.',
    ),
    de: metadata(
      'EDH online mit deiner Commander-Runde spielen | CommanderZone',
      'Spiele EDH online mit deiner Commander-Runde. EDH ist der Community-Name für Commander; nutze einen manuellen Browser-Tisch.',
      'EDH online an einem manuellen Commander-Tisch spielen',
      'EDH ist der Community-Name, den viele Spieler weiterhin für Commander verwenden. Erstelle einen Browser-Raum und nutze einen manuellen Tisch.',
    ),
    fr: metadata(
      'Jouer à EDH en ligne | CommanderZone',
      'Jouez à EDH en ligne avec votre groupe Commander. EDH est le nom communautaire de Commander; utilisez une table manuelle.',
      'Jouer à EDH en ligne sur une table Commander manuelle',
      'EDH est le nom communautaire que de nombreux joueurs utilisent encore pour Commander. Créez une salle dans le navigateur et jouez sur table manuelle.',
    ),
    pt: metadata(
      'Jogar EDH online com seu grupo de Commander | CommanderZone',
      'Jogue EDH online com seu grupo de Commander. EDH é o nome comunitário de Commander; use uma mesa manual no navegador.',
      'Jogar EDH online em uma mesa manual de Commander',
      'EDH é o nome comunitário que muitos jogadores ainda usam para Commander. Crie uma sala no navegador e use uma mesa digital manual.',
    ),
    it: metadata(
      'Giocare EDH online con il tuo gruppo Commander | CommanderZone',
      'Gioca EDH online con il tuo gruppo Commander. EDH è il nome usato dalla community per Commander; usa un tavolo manuale nel browser.',
      'Giocare EDH online con un tavolo Commander manuale',
      'EDH è il nome usato dalla community che molti giocatori usano ancora per Commander. Crea una stanza nel browser e usa un tavolo manuale.',
    ),
  },
  commanderSimulator: {
    en: metadata(
      'MTG Commander Simulator for Manual Online Pods | CommanderZone',
      'Use a manual MTG Commander simulator for online pods. Track table state, life totals and commander damage in a browser-based digital table.',
      'A manual MTG Commander simulator for online pods',
      'CommanderZone is a manual simulator and digital table for Commander pods, focused on table state, life totals and commander damage.',
    ),
    es: metadata(
      'Simulador Commander MTG manual | CommanderZone',
      'Usa un simulador Commander MTG manual para pods online. Controla estado de mesa, vidas y daño de comandante en una mesa digital.',
      'Un simulador Commander MTG manual para pods online',
      'CommanderZone es un simulador manual y mesa digital para pods Commander, centrado en estado de mesa, vidas y daño de comandante.',
    ),
    de: metadata(
      'MTG Commander Simulator manuell | CommanderZone',
      'Nutze einen manuellen MTG Commander Simulator für Online-Runden. Verfolge Tischstatus, Lebenspunkte und Commander-Schaden im Browser.',
      'Ein manueller MTG Commander Simulator für Online-Runden',
      'CommanderZone ist ein manueller Simulator und digitaler Tisch für Commander-Runden, fokussiert auf Tischstatus, Lebenspunkte und Commander-Schaden.',
    ),
    fr: metadata(
      'Simulateur Commander MTG manuel | CommanderZone',
      'Utilisez un simulateur Commander MTG manuel pour groupes en ligne. Suivez état de table, points de vie et blessures de commandant.',
      'Un simulateur Commander MTG manuel pour groupes en ligne',
      'CommanderZone est un simulateur manuel et une table numérique pour groupes Commander, centré sur état de table, points de vie et blessures de commandant.',
    ),
    pt: metadata(
      'Simulador Commander MTG manual | CommanderZone',
      'Use um simulador Commander MTG manual para grupos online. Acompanhe estado da mesa, vida e dano de comandante em uma mesa digital.',
      'Um simulador Commander MTG manual para grupos online',
      'CommanderZone é um simulador manual e mesa digital para grupos Commander, focado em estado da mesa, vida e dano de comandante.',
    ),
    it: metadata(
      'Simulatore Commander MTG manuale | CommanderZone',
      'Usa un simulatore Commander MTG manuale per pod online. Segui stato del tavolo, punti vita e danno da comandante in un tavolo digitale.',
      'Un simulatore Commander MTG manuale per pod online',
      'CommanderZone è un simulatore manuale e tavolo digitale per pod Commander, focalizzato su stato del tavolo, punti vita e danno da comandante.',
    ),
  },
  faq: {
    en: metadata(
      'CommanderZone FAQ | Commander Online Questions',
      'Read answers about CommanderZone, Commander online games, deck preparation, private rooms, life totals, commander damage and manual table limits.',
      'CommanderZone FAQ for Commander online',
      'Find clear answers about playing Commander online in the browser, preparing decks, creating rooms and using a manual table.',
    ),
    es: metadata(
      'FAQ de CommanderZone | Preguntas sobre Commander online',
      'Resuelve dudas sobre CommanderZone, Commander online, preparación de mazos, salas privadas, vidas, daño de comandante y límites de la mesa manual.',
      'FAQ de CommanderZone sobre Commander online',
      'Encuentra respuestas claras sobre jugar Commander online en el navegador, preparar mazos, crear salas y usar una mesa manual.',
    ),
    de: metadata(
      'CommanderZone FAQ | Fragen zu Commander online',
      'Lies Antworten zu CommanderZone, Commander online, Deckvorbereitung, privaten Räumen, Lebenspunkten, Commander-Schaden und manuellem Tisch.',
      'CommanderZone FAQ zu Commander online',
      'Finde klare Antworten zum Commander-Spielen im Browser, zum Vorbereiten von Decks, Erstellen von Räumen und manuellen Tisch.',
    ),
    fr: metadata(
      'FAQ CommanderZone | Questions sur Commander en ligne',
      'Consultez les réponses sur CommanderZone, Commander en ligne, préparation de decks, salles privées, points de vie et table manuelle.',
      'FAQ CommanderZone sur Commander en ligne',
      'Trouvez des réponses claires pour jouer à Commander dans le navigateur, préparer des decks, créer des salles et utiliser une table manuelle.',
    ),
    pt: metadata(
      'FAQ CommanderZone | Perguntas sobre Commander online',
      'Leia respostas sobre CommanderZone, Commander online, preparo de decks, salas privadas, vida, dano de comandante e limites da mesa manual.',
      'FAQ CommanderZone sobre Commander online',
      'Encontre respostas claras sobre jogar Commander online no navegador, preparar decks, criar salas e usar uma mesa manual.',
    ),
    it: metadata(
      'FAQ CommanderZone | Domande su Commander online',
      'Leggi risposte su CommanderZone, Commander online, preparazione mazzi, stanze private, punti vita, danno da comandante e tavolo manuale.',
      'FAQ CommanderZone su Commander online',
      'Trova risposte chiare su come giocare Commander nel browser, preparare mazzi, creare stanze e usare un tavolo manuale.',
    ),
  },
} as const satisfies Record<SeoRouteKey, Record<PriorityLocaleCode, SeoLandingMetadataCopy>>;

function metadata(metaTitle: string, metaDescription: string, h1: string, heroSubtitle: string): SeoLandingMetadataCopy {
  return { metaTitle, metaDescription, h1, heroSubtitle };
}

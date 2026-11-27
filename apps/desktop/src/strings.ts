// Every word the app itself shows: its own pages, the tray menu and its error lines. Studio's
// words live in Studio. English, French and Portuguese, picked from the system language.
// No line here may name the setup code: the app's log is checked for that phrase.

export type Lang = 'en' | 'fr' | 'pt';

/** fr-CA gives fr, pt-BR gives pt, anything else gives en. */
export function pickLang(locale: string): Lang {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return base === 'fr' || base === 'pt' ? base : 'en';
}

export interface AppStrings {
  /** The window title. */
  windowTitle: string;
  /** The starting page. */
  startingTitle: string;
  checkingNote: string;
  postgresNote: string;
  recoveringNote: string;
  serverNote: string;
  /** The stopping page. */
  stoppingTitle: string;
  stoppingNote: string;
  /** The error page. */
  errorTitle: string;
  logsLabel: string;
  retryLabel: string;
  /** The tray icon and its menu. */
  trayTooltip: string;
  trayOpen: string;
  trayStartAtSignIn: string;
  trayOpenLogs: string;
  trayQuit: string;
  /** Sharing OpenLDR on the lab network: the tray items and the two boxes it asks in. */
  trayShare: string;
  trayNoAddress: string;
  trayCopyAddress: string;
  trayCopyFingerprint: string;
  traySaveCertificate: string;
  shareConfirmTitle: string;
  shareConfirmBody: string;
  shareConfirmYes: string;
  shareConfirmNo: string;
  shareNextStart: string;
  shareRestartFailed: string;
  shareSaveFailed: string;
  /** Error lines. */
  launcherEnded: string;
  launcherGone: string;
  /** `status` gave no answer in time. */
  statusNoAnswer: string;
  notBuilt: string;
  /** Shown and logged in place of a launcher line that held a secret. */
  lineHidden: string;
  /** Connect mode: the mode choice, the server address, the certificate question and the unreachable page. `{address}` is the server's address. */
  chooseTitle: string;
  chooseMessage: string;
  chooseLocal: string;
  chooseConnect: string;
  connectTitle: string;
  connectLabel: string;
  connectPlaceholder: string;
  connectAction: string;
  backAction: string;
  problemEmpty: string;
  problemNotHttps: string;
  problemUnreadable: string;
  problemNoAnswer: string;
  problemCertificate: string;
  problemNotSaved: string;
  certFirstTitle: string;
  certFirstMessage: string;
  certChangedTitle: string;
  certChangedMessage: string;
  trustYes: string;
  trustNo: string;
  unreachableTitle: string;
  unreachableMessage: string;
  changeServer: string;
  studioWillNotLoad: string;
  /** Switching between the two ways of running, from the tray. */
  trayChangeServer: string;
  trayUseLocal: string;
  trayUseConnect: string;
  switchConfirmYes: string;
  switchConfirmNo: string;
  switchToConnectBody: string;
  switchToLocalBody: string;
  /** The mode could not be written to the settings file, so the app stays as it is. */
  switchSaveFailed: string;
  /** The lock: the PIN window for each purpose, and the two tray items. */
  pinSetTitle: string;
  pinSetMessage: string;
  pinSetAction: string;
  pinUnlockTitle: string;
  pinUnlockAction: string;
  pinQuitTitle: string;
  pinQuitMessage: string;
  pinQuitAction: string;
  pinLabel: string;
  pinCancel: string;
  pinWrong: string;
  pinTooShort: string;
  /** The lock could not be written to the settings file, so this PC is as it was. */
  pinNotSaved: string;
  trayLock: string;
  trayUnlock: string;
  /** The PC is locked, but the system could not be told to start the app at sign-in. */
  lockNoAutostart: string;
  /** The app's own list of serial ports. */
  serialTitle: string;
  serialNone: string;
  serialLastNote: string;
  serialUse: string;
  serialCancel: string;
}

const en: AppStrings = {
  windowTitle: 'OpenLDR',
  startingTitle: 'Starting OpenLDR',
  checkingNote: 'Checking whether OpenLDR is already running.',
  postgresNote: 'Starting the database.',
  recoveringNote: 'The database is recovering after an unexpected stop. This can take a few minutes.',
  serverNote: 'Starting the server.',
  stoppingTitle: 'Stopping OpenLDR',
  stoppingNote: 'OpenLDR is shutting down. Please wait.',
  errorTitle: 'OpenLDR is not running',
  logsLabel: 'The logs are in:',
  retryLabel: 'Try again',
  trayTooltip: 'OpenLDR',
  trayOpen: 'Open OpenLDR',
  trayStartAtSignIn: 'Start when I sign in',
  trayOpenLogs: 'Open the log folder',
  trayQuit: 'Quit',
  trayShare: 'Share on the lab network',
  trayNoAddress: 'No network address was found',
  trayCopyAddress: 'Copy network address',
  trayCopyFingerprint: 'Copy certificate fingerprint',
  traySaveCertificate: 'Save certificate...',
  shareConfirmTitle: 'Share OpenLDR on this network?',
  shareConfirmBody: 'Other PCs on this network will be able to open OpenLDR and sign in. OpenLDR restarts now. Anyone using it waits a moment.',
  shareConfirmYes: 'Share',
  shareConfirmNo: 'Cancel',
  shareNextStart: 'OpenLDR was started outside this app. The change applies the next time this app starts it.',
  shareRestartFailed: 'OpenLDR did not stop, so sharing was not changed. Quit OpenLDR and open it again.',
  shareSaveFailed: 'The setting could not be saved, so sharing was not changed. See the app log.',
  launcherEnded: 'OpenLDR stopped unexpectedly.',
  launcherGone: 'OpenLDR is no longer running.',
  statusNoAnswer: 'OpenLDR did not respond to a status check.',
  notBuilt: 'OpenLDR is not built. Build it, then start the app again.',
  lineHidden: 'A log line was hidden because it contained a secret.',
  chooseTitle: "How will this PC use OpenLDR?",
  chooseMessage: "This PC holds the lab's data: OpenLDR and its database run here. Connect to the lab's server: this PC only shows OpenLDR from another PC.",
  chooseLocal: "This PC holds the lab's data",
  chooseConnect: "Connect to the lab's server",
  connectTitle: "Connect to the lab's server",
  connectLabel: "Server address",
  connectPlaceholder: "labpc:3443",
  connectAction: "Connect",
  backAction: "Back",
  problemEmpty: "Type the server's address.",
  problemNotHttps: "The address must start with https.",
  problemUnreadable: "That is not an address OpenLDR can use.",
  problemNoAnswer: "Nothing answered at that address. Check it and that the server is on.",
  problemCertificate: "The server's certificate could not be accepted. Check the address, or ask whoever looks after the server.",
  problemNotSaved: "The server could not be saved on this PC. Try again.",
  certFirstTitle: "Check the server's certificate",
  certFirstMessage: "This is the first time this PC connects to {address}. Compare this fingerprint with the one shown on the server.",
  certChangedTitle: "The server's certificate has changed",
  certChangedMessage: "The certificate of {address} is not the one this PC accepted before. Compare this fingerprint with the one shown on the server. If you did not expect a change, stop here.",
  trustYes: "It matches",
  trustNo: "Cancel",
  unreachableTitle: "Cannot reach the server",
  unreachableMessage: "{address} is not answering. OpenLDR will come back by itself when it does.",
  changeServer: "Change server",
  studioWillNotLoad: "The server answers, but OpenLDR did not load from it.",
  trayChangeServer: "Change server...",
  trayUseLocal: "Use this PC for the lab's data...",
  trayUseConnect: "Connect to a lab server...",
  switchConfirmYes: "Switch and restart",
  switchConfirmNo: "Cancel",
  switchToConnectBody: "This PC will show OpenLDR from another PC. The data on this PC stays where it is and is not used.",
  switchToLocalBody: "OpenLDR and its database will run on this PC.",
  switchSaveFailed: "The setting could not be saved, so nothing was changed. See the app log.",
  pinSetTitle: "Lock this PC to OpenLDR",
  pinSetMessage: "Choose a PIN. Unlocking this PC, or quitting OpenLDR, will ask for it. Press Ctrl+Shift+L to unlock.",
  pinSetAction: "Lock",
  pinUnlockTitle: "Unlock this PC",
  pinUnlockAction: "Unlock",
  pinQuitTitle: "Quit OpenLDR",
  pinQuitMessage: "This PC is locked to OpenLDR. Type the PIN to quit.",
  pinQuitAction: "Quit",
  pinLabel: "PIN",
  pinCancel: "Cancel",
  pinWrong: "That PIN is not right.",
  pinTooShort: "Use at least 4 characters.",
  pinNotSaved: "The setting could not be saved, so nothing was changed. See the app log.",
  trayLock: "Lock this PC to OpenLDR...",
  trayUnlock: "Unlock this PC...",
  lockNoAutostart: "This PC is locked, but OpenLDR could not be set to start when you sign in. After a restart the PC will show its desktop until someone starts OpenLDR. See the app log.",
  serialTitle: "Choose a serial port",
  serialNone: "No serial port was found. Plug the cable in and try again.",
  serialLastNote: "used last time",
  serialUse: "Use this port",
  serialCancel: "Cancel",
};

const fr: AppStrings = {
  windowTitle: 'OpenLDR',
  startingTitle: "Démarrage d'OpenLDR",
  checkingNote: "Vérification si OpenLDR est déjà en cours d'exécution.",
  postgresNote: 'Démarrage de la base de données.',
  recoveringNote: 'La base de données est en cours de récupération après un arrêt brutal. Cela peut prendre quelques minutes.',
  serverNote: 'Démarrage du serveur.',
  stoppingTitle: "Arrêt d'OpenLDR",
  stoppingNote: "OpenLDR s'arrête. Veuillez patienter.",
  errorTitle: "OpenLDR n'est pas en cours d'exécution",
  logsLabel: 'Les journaux se trouvent dans :',
  retryLabel: 'Réessayer',
  trayTooltip: 'OpenLDR',
  trayOpen: 'Ouvrir OpenLDR',
  trayStartAtSignIn: 'Démarrer à la connexion',
  trayOpenLogs: 'Ouvrir le dossier des journaux',
  trayQuit: 'Quitter',
  trayShare: 'Partager sur le réseau du laboratoire',
  trayNoAddress: "Aucune adresse réseau n'a été trouvée",
  trayCopyAddress: "Copier l'adresse réseau",
  trayCopyFingerprint: "Copier l'empreinte du certificat",
  traySaveCertificate: 'Enregistrer le certificat...',
  shareConfirmTitle: 'Partager OpenLDR sur ce réseau ?',
  shareConfirmBody: "Les autres PC de ce réseau pourront ouvrir OpenLDR et s'y connecter. OpenLDR redémarre maintenant. Les personnes qui l'utilisent attendent un instant.",
  shareConfirmYes: 'Partager',
  shareConfirmNo: 'Annuler',
  shareNextStart: "OpenLDR a été démarré en dehors de cette application. Le changement s'appliquera au prochain démarrage par cette application.",
  shareRestartFailed: "OpenLDR ne s'est pas arrêté, donc le partage n'a pas été modifié. Quittez OpenLDR et rouvrez-le.",
  shareSaveFailed: "Le réglage n'a pas pu être enregistré, donc le partage n'a pas été modifié. Consultez le journal de l'application.",
  launcherEnded: "OpenLDR s'est arrêté de façon inattendue.",
  launcherGone: "OpenLDR n'est plus en cours d'exécution.",
  statusNoAnswer: "OpenLDR n'a pas répondu à une vérification d'état.",
  notBuilt: "OpenLDR n'est pas compilé. Compilez-le, puis relancez l'application.",
  lineHidden: "Une ligne du journal a été masquée, car elle contenait un secret.",
  chooseTitle: "Comment ce PC utilisera-t-il OpenLDR ?",
  chooseMessage: "Ce PC contient les données du laboratoire : OpenLDR et sa base de données fonctionnent ici. Se connecter au serveur du laboratoire : ce PC affiche seulement OpenLDR depuis un autre PC.",
  chooseLocal: "Ce PC contient les données du laboratoire",
  chooseConnect: "Se connecter au serveur du laboratoire",
  connectTitle: "Se connecter au serveur du laboratoire",
  connectLabel: "Adresse du serveur",
  connectPlaceholder: "labpc:3443",
  connectAction: "Se connecter",
  backAction: "Retour",
  problemEmpty: "Saisissez l'adresse du serveur.",
  problemNotHttps: "L'adresse doit commencer par https.",
  problemUnreadable: "Ce n'est pas une adresse qu'OpenLDR peut utiliser.",
  problemNoAnswer: "Rien n'a répondu à cette adresse. Vérifiez-la et que le serveur est allumé.",
  problemCertificate: "Le certificat du serveur n'a pas pu être accepté. Vérifiez l'adresse, ou demandez à la personne qui s'occupe du serveur.",
  problemNotSaved: "Le serveur n'a pas pu être enregistré sur ce PC. Réessayez.",
  certFirstTitle: "Vérifiez le certificat du serveur",
  certFirstMessage: "C'est la première fois que ce PC se connecte à {address}. Comparez cette empreinte avec celle affichée sur le serveur.",
  certChangedTitle: "Le certificat du serveur a changé",
  certChangedMessage: "Le certificat de {address} n'est pas celui que ce PC avait accepté. Comparez cette empreinte avec celle affichée sur le serveur. Si vous n'attendiez pas de changement, arrêtez-vous ici.",
  trustYes: "Elle correspond",
  trustNo: "Annuler",
  unreachableTitle: "Impossible de joindre le serveur",
  unreachableMessage: "{address} ne répond pas. OpenLDR reviendra de lui-même dès que le serveur répondra.",
  changeServer: "Changer de serveur",
  studioWillNotLoad: "Le serveur répond, mais OpenLDR ne s'est pas chargé depuis celui-ci.",
  trayChangeServer: "Changer de serveur...",
  trayUseLocal: "Utiliser ce PC pour les données du laboratoire...",
  trayUseConnect: "Se connecter à un serveur de laboratoire...",
  switchConfirmYes: "Changer et redémarrer",
  switchConfirmNo: "Annuler",
  switchToConnectBody: "Ce PC affichera OpenLDR depuis un autre PC. Les données de ce PC restent où elles sont et ne sont pas utilisées.",
  switchToLocalBody: "OpenLDR et sa base de données fonctionneront sur ce PC.",
  switchSaveFailed: "Le réglage n'a pas pu être enregistré, donc rien n'a changé. Consultez le journal de l'application.",
  pinSetTitle: "Verrouiller ce PC sur OpenLDR",
  pinSetMessage: "Choisissez un code PIN. Il sera demandé pour déverrouiller ce PC ou pour quitter OpenLDR. Appuyez sur Ctrl+Maj+L pour déverrouiller.",
  pinSetAction: "Verrouiller",
  pinUnlockTitle: "Déverrouiller ce PC",
  pinUnlockAction: "Déverrouiller",
  pinQuitTitle: "Quitter OpenLDR",
  pinQuitMessage: "Ce PC est verrouillé sur OpenLDR. Saisissez le code PIN pour quitter.",
  pinQuitAction: "Quitter",
  pinLabel: "Code PIN",
  pinCancel: "Annuler",
  pinWrong: "Ce code PIN n'est pas le bon.",
  pinTooShort: "Utilisez au moins 4 caractères.",
  pinNotSaved: "Le réglage n'a pas pu être enregistré, donc rien n'a changé. Consultez le journal de l'application.",
  trayLock: "Verrouiller ce PC sur OpenLDR...",
  trayUnlock: "Déverrouiller ce PC...",
  lockNoAutostart: "Ce PC est verrouillé, mais OpenLDR n'a pas pu être réglé pour démarrer à la connexion. Après un redémarrage, le PC affichera son bureau jusqu'à ce que quelqu'un démarre OpenLDR. Consultez le journal de l'application.",
  serialTitle: "Choisissez un port série",
  serialNone: "Aucun port série n'a été trouvé. Branchez le câble et réessayez.",
  serialLastNote: "utilisé la dernière fois",
  serialUse: "Utiliser ce port",
  serialCancel: "Annuler",
};

const pt: AppStrings = {
  windowTitle: 'OpenLDR',
  startingTitle: 'A iniciar o OpenLDR',
  checkingNote: 'A verificar se o OpenLDR já está em execução.',
  postgresNote: 'A iniciar a base de dados.',
  recoveringNote: 'A base de dados está a recuperar de uma paragem inesperada. Isto pode demorar alguns minutos.',
  serverNote: 'A iniciar o servidor.',
  stoppingTitle: 'A parar o OpenLDR',
  stoppingNote: 'O OpenLDR está a encerrar. Aguarde, por favor.',
  errorTitle: 'O OpenLDR não está em execução',
  logsLabel: 'Os registos estão em:',
  retryLabel: 'Tentar novamente',
  trayTooltip: 'OpenLDR',
  trayOpen: 'Abrir o OpenLDR',
  trayStartAtSignIn: 'Iniciar ao entrar na sessão',
  trayOpenLogs: 'Abrir a pasta de registos',
  trayQuit: 'Sair',
  trayShare: 'Partilhar na rede do laboratório',
  trayNoAddress: 'Não foi encontrado nenhum endereço de rede',
  trayCopyAddress: 'Copiar o endereço de rede',
  trayCopyFingerprint: 'Copiar a impressão digital do certificado',
  traySaveCertificate: 'Guardar o certificado...',
  shareConfirmTitle: 'Partilhar o OpenLDR nesta rede?',
  shareConfirmBody: 'Os outros PC desta rede poderão abrir o OpenLDR e iniciar sessão. O OpenLDR reinicia agora. Quem o estiver a usar espera um momento.',
  shareConfirmYes: 'Partilhar',
  shareConfirmNo: 'Cancelar',
  shareNextStart: 'O OpenLDR foi iniciado fora desta aplicação. A alteração aplica-se da próxima vez que esta aplicação o iniciar.',
  shareRestartFailed: 'O OpenLDR não parou, por isso a partilha não foi alterada. Saia do OpenLDR e volte a abri-lo.',
  shareSaveFailed: 'Não foi possível guardar a definição, por isso a partilha não foi alterada. Veja o registo da aplicação.',
  launcherEnded: 'O OpenLDR parou inesperadamente.',
  launcherGone: 'O OpenLDR já não está em execução.',
  statusNoAnswer: 'O OpenLDR não respondeu a uma verificação de estado.',
  notBuilt: 'O OpenLDR não está compilado. Compile-o e volte a abrir a aplicação.',
  lineHidden: 'Uma linha do registo foi ocultada porque continha um segredo.',
  chooseTitle: "Como é que este PC vai usar o OpenLDR?",
  chooseMessage: "Este PC guarda os dados do laboratório: o OpenLDR e a sua base de dados funcionam aqui. Ligar ao servidor do laboratório: este PC apenas mostra o OpenLDR de outro PC.",
  chooseLocal: "Este PC guarda os dados do laboratório",
  chooseConnect: "Ligar ao servidor do laboratório",
  connectTitle: "Ligar ao servidor do laboratório",
  connectLabel: "Endereço do servidor",
  connectPlaceholder: "labpc:3443",
  connectAction: "Ligar",
  backAction: "Voltar",
  problemEmpty: "Escreva o endereço do servidor.",
  problemNotHttps: "O endereço tem de começar por https.",
  problemUnreadable: "Não é um endereço que o OpenLDR possa usar.",
  problemNoAnswer: "Nada respondeu nesse endereço. Verifique-o e se o servidor está ligado.",
  problemCertificate: "Não foi possível aceitar o certificado do servidor. Verifique o endereço, ou pergunte a quem trata do servidor.",
  problemNotSaved: "Não foi possível guardar o servidor neste PC. Tente de novo.",
  certFirstTitle: "Verifique o certificado do servidor",
  certFirstMessage: "É a primeira vez que este PC se liga a {address}. Compare esta impressão digital com a que é mostrada no servidor.",
  certChangedTitle: "O certificado do servidor mudou",
  certChangedMessage: "O certificado de {address} não é o que este PC aceitou antes. Compare esta impressão digital com a que é mostrada no servidor. Se não esperava uma mudança, pare aqui.",
  trustYes: "Corresponde",
  trustNo: "Cancelar",
  unreachableTitle: "Não é possível alcançar o servidor",
  unreachableMessage: "{address} não responde. O OpenLDR volta sozinho quando o servidor responder.",
  changeServer: "Mudar de servidor",
  studioWillNotLoad: "O servidor responde, mas o OpenLDR não carregou a partir dele.",
  trayChangeServer: "Mudar de servidor...",
  trayUseLocal: "Usar este PC para os dados do laboratório...",
  trayUseConnect: "Ligar a um servidor de laboratório...",
  switchConfirmYes: "Mudar e reiniciar",
  switchConfirmNo: "Cancelar",
  switchToConnectBody: "Este PC vai mostrar o OpenLDR de outro PC. Os dados deste PC ficam onde estão e não são usados.",
  switchToLocalBody: "O OpenLDR e a sua base de dados vão funcionar neste PC.",
  switchSaveFailed: "Não foi possível guardar a definição, por isso nada mudou. Consulte o registo da aplicação.",
  pinSetTitle: "Bloquear este PC no OpenLDR",
  pinSetMessage: "Escolha um PIN. Será pedido para desbloquear este PC ou para sair do OpenLDR. Prima Ctrl+Shift+L para desbloquear.",
  pinSetAction: "Bloquear",
  pinUnlockTitle: "Desbloquear este PC",
  pinUnlockAction: "Desbloquear",
  pinQuitTitle: "Sair do OpenLDR",
  pinQuitMessage: "Este PC está bloqueado no OpenLDR. Escreva o PIN para sair.",
  pinQuitAction: "Sair",
  pinLabel: "PIN",
  pinCancel: "Cancelar",
  pinWrong: "Esse PIN não está certo.",
  pinTooShort: "Use pelo menos 4 caracteres.",
  pinNotSaved: "Não foi possível guardar a definição, por isso nada mudou. Consulte o registo da aplicação.",
  trayLock: "Bloquear este PC no OpenLDR...",
  trayUnlock: "Desbloquear este PC...",
  lockNoAutostart: "Este PC está bloqueado, mas não foi possível definir o OpenLDR para iniciar ao entrar na sessão. Depois de reiniciar, o PC mostra o ambiente de trabalho até alguém iniciar o OpenLDR. Consulte o registo da aplicação.",
  serialTitle: "Escolha uma porta série",
  serialNone: "Não foi encontrada nenhuma porta série. Ligue o cabo e tente de novo.",
  serialLastNote: "usada da última vez",
  serialUse: "Usar esta porta",
  serialCancel: "Cancelar",
};

export const STRINGS: Record<Lang, AppStrings> = { en, fr, pt };

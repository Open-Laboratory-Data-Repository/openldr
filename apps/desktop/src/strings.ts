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
  /** Error lines. */
  launcherEnded: string;
  launcherGone: string;
  /** `status` gave no answer in time. */
  statusNoAnswer: string;
  notBuilt: string;
  /** Shown and logged in place of a launcher line that held a secret. */
  lineHidden: string;
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
  launcherEnded: 'OpenLDR stopped unexpectedly.',
  launcherGone: 'OpenLDR is no longer running.',
  statusNoAnswer: 'OpenLDR did not respond to a status check.',
  notBuilt: 'OpenLDR is not built. Build it, then start the app again.',
  lineHidden: 'A log line was hidden because it contained a secret.',
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
  launcherEnded: "OpenLDR s'est arrêté de façon inattendue.",
  launcherGone: "OpenLDR n'est plus en cours d'exécution.",
  statusNoAnswer: "OpenLDR n'a pas répondu à une vérification d'état.",
  notBuilt: "OpenLDR n'est pas compilé. Compilez-le, puis relancez l'application.",
  lineHidden: "Une ligne du journal a été masquée, car elle contenait un secret.",
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
  launcherEnded: 'O OpenLDR parou inesperadamente.',
  launcherGone: 'O OpenLDR já não está em execução.',
  statusNoAnswer: 'O OpenLDR não respondeu a uma verificação de estado.',
  notBuilt: 'O OpenLDR não está compilado. Compile-o e volte a abrir a aplicação.',
  lineHidden: 'Uma linha do registo foi ocultada porque continha um segredo.',
};

export const STRINGS: Record<Lang, AppStrings> = { en, fr, pt };

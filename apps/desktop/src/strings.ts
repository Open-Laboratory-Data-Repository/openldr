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
  /** Error lines. */
  launcherEnded: string;
  launcherGone: string;
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
  launcherEnded: 'OpenLDR stopped unexpectedly.',
  launcherGone: 'OpenLDR is no longer running.',
  notBuilt: 'OpenLDR is not built. Build it, then start the app again.',
  lineHidden: 'A line from OpenLDR was hidden because it held a secret.',
};

const fr: AppStrings = {
  windowTitle: 'OpenLDR',
  startingTitle: "Démarrage d'OpenLDR",
  checkingNote: "Recherche d'un OpenLDR déjà en marche.",
  postgresNote: 'Démarrage de la base de données.',
  recoveringNote: 'La base de données se rétablit après un arrêt inattendu. Cela peut prendre quelques minutes.',
  serverNote: 'Démarrage du serveur.',
  stoppingTitle: "Arrêt d'OpenLDR",
  stoppingNote: "OpenLDR s'arrête. Veuillez patienter.",
  errorTitle: "OpenLDR n'est pas en marche",
  logsLabel: 'Les journaux se trouvent dans :',
  retryLabel: 'Réessayer',
  trayTooltip: 'OpenLDR',
  trayOpen: 'Ouvrir OpenLDR',
  trayStartAtSignIn: 'Démarrer à la connexion',
  trayOpenLogs: 'Ouvrir le dossier des journaux',
  trayQuit: 'Quitter',
  launcherEnded: "OpenLDR s'est arrêté de façon inattendue.",
  launcherGone: "OpenLDR n'est plus en marche.",
  notBuilt: "OpenLDR n'est pas compilé. Compilez-le, puis relancez l'application.",
  lineHidden: "Une ligne d'OpenLDR a été masquée, car elle contenait un secret.",
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
  launcherEnded: 'O OpenLDR parou inesperadamente.',
  launcherGone: 'O OpenLDR já não está em execução.',
  notBuilt: 'O OpenLDR não está compilado. Compile-o e volte a abrir a aplicação.',
  lineHidden: 'Uma linha do OpenLDR foi ocultada porque continha um segredo.',
};

export const STRINGS: Record<Lang, AppStrings> = { en, fr, pt };

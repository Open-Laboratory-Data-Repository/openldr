# Setup checks

## English

**Settings > Setup checks** lists what an install still needs before it is ready. CE runs seven checks when the page opens: services, sign-in, the secrets key, the laboratory name, the time zone, connectors, and sync with central. Each shows Passed, Warning, Failed or Skipped. A warning or failure says what to change and links to the settings page that fixes it.

A check shows a name or a count, never an error message, because error messages can hold server and user names. Each run is written to the audit log.

Headless servers print the same list with `openldr doctor`. Add `--json` for machine-readable output. The command exits with code 1 when a check failed. Warnings do not change the exit code.

## Français

**Paramètres > Vérifications d'installation** liste ce qu'il manque encore à une installation avant d'être prête. CE lance sept vérifications à l'ouverture de la page : les services, la connexion des utilisateurs, la clé des secrets, le nom du laboratoire, le fuseau horaire, les connecteurs et la synchronisation avec le central. Chacune affiche Réussi, Avertissement, Échec ou Ignoré. Un avertissement ou un échec indique quoi changer et renvoie à la page de paramètres qui le corrige.

Une vérification affiche un nom ou un nombre, jamais un message d'erreur, car les messages d'erreur peuvent contenir des noms de serveurs et d'utilisateurs. Chaque exécution est écrite dans le journal d'audit.

Sur un serveur sans écran, `openldr doctor` affiche la même liste. Ajoutez `--json` pour une sortie lisible par une machine. La commande renvoie le code 1 quand une vérification a échoué. Les avertissements ne changent pas le code de sortie.

## Português

**Definições > Verificações de instalação** lista o que ainda falta a uma instalação para estar pronta. O CE executa sete verificações quando a página abre: os serviços, o início de sessão, a chave dos segredos, o nome do laboratório, o fuso horário, os conectores e a sincronização com o central. Cada uma mostra Passou, Aviso, Falhou ou Ignorado. Um aviso ou uma falha indica o que mudar e liga à página de definições que o corrige.

Uma verificação mostra um nome ou uma contagem, nunca uma mensagem de erro, porque as mensagens de erro podem conter nomes de servidores e de utilizadores. Cada execução fica no registo de auditoria.

Num servidor sem ecrã, `openldr doctor` mostra a mesma lista. Adicione `--json` para uma saída legível por máquina. O comando termina com o código 1 quando uma verificação falhou. Os avisos não alteram o código de saída.

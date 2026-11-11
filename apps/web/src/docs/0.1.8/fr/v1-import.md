# Importer depuis OpenLDR v1

Le plugin **OpenLDR v1 import** copie les demandes, les patients, les résultats et les résultats AST d'une base SQL Server OpenLDR v1 vers CE. Le plugin n'ouvre jamais lui-même de connexion à une base. Il fournit des requêtes en lecture seule, et CE les exécute sur un connecteur qu'un administrateur autorise.

Autorisez d'abord le connecteur. Ouvrez **Paramètres > Connecteurs**, ouvrez le menu **⋯** du connecteur SQL Server v1, choisissez **Accès des plugins**, et activez l'interrupteur du plugin.

Ouvrez ensuite **OpenLDR v1 import** dans la barre latérale. La page compte cinq étapes : choisir le connecteur, régler les options, vérifier les tables v1, essayer quelques demandes sans enregistrer, et lancer l'import. Le fuseau horaire du site est obligatoire, sous la forme `+02:00`, car les dates v1 n'ont pas de fuseau.

L'import s'exécute sur le serveur CE, donc vous pouvez quitter la page. **Arrêter** le termine après la page de 500 demandes en cours. **Reprendre** continue à partir de la dernière demande traitée, même après un redémarrage du serveur. Une demande déjà importée est remplacée, pas dupliquée. Une demande en échec n'arrête pas l'import. CE la liste avec un code de raison et ne stocke jamais le contenu de la ligne. Chaque import apparaît sur la page Activité comme une seule entrée, et la page Audit enregistre qui l'a autorisé, lancé, arrêté et repris. CE écrit d'abord l'entrée d'audit et refuse de lancer l'import si elle ne peut pas être écrite.

Sur un serveur sans écran, utilisez `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, puis `openldr import status`, `stop`, `resume` et `failures`.

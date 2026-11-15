# Importer depuis OpenLDR v1

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les illustrations de fichiers montrent le texte à modifier dans le fichier indiqué. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

Le plugin d'import OpenLDR v1 lit une base SQL Server v1 et enregistre dans CE les demandes, patients, résultats et antibiogrammes associés. Il s'exécute sur le serveur par pages de demandes.

Utilisez votre base v1 avec un connecteur Microsoft SQL en lecture seule. Diagnostiquez-le d'abord. Le plugin doit être installé et un administrateur doit l'autoriser à lire ce connecteur.

Vous avez besoin de **Manage connectors** pour autoriser la source. La page du plugin exige le rôle administrateur du laboratoire. Connaissez le décalage UTC du laboratoire source.

La page du plugin a deux onglets. **Import** lit la source et enregistre des fiches dans CE. **Copie** garde une copie des lignes sources sur le serveur CE. Dans cette version, vous pouvez faire une copie et la garder, et rien ne la lit encore. L'import lit toujours la source elle-même.

Les captures utilisent une demande, un patient et un résultat texte fictifs sur un SQL Server isolé. Elles vérifient une simulation et un import réels de ce petit jeu. Elles ne prouvent pas la compatibilité avec toutes les anciennes bases v1. La pratique facultative se trouve à la fin.

## Autoriser le plugin à lire un connecteur

Installez le plugin dans Marketplace ou depuis son fichier approuvé. Créez un connecteur Microsoft SQL avec accès SELECT aux tables v1. Le compte ne doit pas modifier la source.

### 1. Ouvrir Connectors

Ouvrez **Settings**, puis **Connectors**. Vérifiez d'abord la source avec [Diagnostiquer les connexions](/docs/connector-diagnose).

![Ouvrir Settings puis Connectors.](/docs-images/operator/v1-import-guide-connectors.png)

### 2. Ouvrir Plugin access

Sur la ligne du connecteur v1, ouvrez les points et choisissez **Plugin access**.

![Choisir Plugin access pour le connecteur de base v1.](/docs-images/operator/v1-import-guide-access.png)

### 3. Autoriser l'importeur

Activez l'interrupteur près de `openldr-v1-import`. Chaque changement s'enregistre immédiatement.

![Autoriser openldr-v1-import à lire ce connecteur.](/docs-images/operator/v1-import-guide-allow.png)

### 4. Vérifier l'interrupteur enregistré

L'interrupteur reste activé. Désactivez-le ensuite pour révoquer l'accès du plugin à ce connecteur.

![L'interrupteur autorisé reste activé après l'enregistrement.](/docs-images/operator/v1-import-guide-allowed.png)

**Résultat attendu :** le plugin peut proposer ce connecteur comme source. Les autorisations et révocations apparaissent dans Audit.

## Choisir et vérifier la source

Une connexion réussie vérifie le réseau et l'authentification. L'étape Checks vérifie ensuite les tables attendues.

### 1. Ouvrir l'importeur

Sélectionnez **OpenLDR v1 import** dans le menu principal.

![Ouvrir OpenLDR v1 import depuis le menu principal.](/docs-images/operator/v1-import-guide-plugin-nav.png)

### 2. Choisir le connecteur source

Dans Source, choisissez le connecteur vers votre base v1.

![Choisir le connecteur v1 autorisé.](/docs-images/operator/v1-import-guide-source.png)

### 3. Vérifier la connexion

Sélectionnez **Check connection**. Lisez chaque étape et attendez **The connection works.** Corrigez les échecs avant de continuer.

![Check connection doit réussir avant l'import.](/docs-images/operator/v1-import-guide-connection.png)

**Résultat attendu :** la connexion choisie fonctionne depuis le serveur CE. Aucune donnée source n'a été importée.

## Définir l'heure source et les limites d'import

v1 stocke les dates et heures locales sans fuseau. Choisissez le décalage correspondant à ces horodatages.

### 1. Définir Site time zone

Choisissez Next pour ouvrir Options. Saisissez le décalage UTC du laboratoire source, comme `+02:00`. Utilisez `Z` seulement pour une source en UTC. L'exemple fictif utilise Z.

![Définir le vrai décalage UTC source. Cette source fictive utilise Z.](/docs-images/operator/v1-import-guide-timezone.png)

### 2. Choisir les limites facultatives

Database remplace la base du connecteur. From date et To date limitent les dates d'enregistrement. Panel codes est une liste séparée par des virgules. Laissez les limites vides seulement pour lire toute la source.

![Laisser les limites vides seulement pour importer toute la source.](/docs-images/operator/v1-import-guide-options.png)

### 3. Vérifier les tables

Choisissez Next pour ouvrir Checks. Lisez les nombres de tables et de lignes. Les **4 of 4** tables doivent exister : Requests, LabResults, Patients et ASTResults.

![Lire les nombres de tables et de lignes avant de continuer.](/docs-images/operator/v1-import-guide-checks.png)

**Résultat attendu :** Checks compte les tables et lignes sans importer. Si une table manque, vérifiez la base et le schéma source.

## Essayer une simulation

Une simulation lit et transforme un nombre limité de demandes sans enregistrer leurs données cliniques.

### 1. Définir la limite de demandes

Choisissez Next pour ouvrir Dry run. Saisissez une petite limite. L'exemple utilise `100` sur un jeu d'une demande.

![Dry run limite les demandes lues sans les enregistrer.](/docs-images/operator/v1-import-guide-dry-limit.png)

### 2. Lancer la simulation

Choisissez **Start dry run**.

![Choisir Start dry run.](/docs-images/operator/v1-import-guide-dry-start.png)

### 3. Lire le résultat

Attendez Finished. Vérifiez les demandes lues, transformées ou importées, et les échecs. Lisez les raisons avant de continuer.

![Lire les nombres transformés et échoués de la simulation.](/docs-images/operator/v1-import-guide-dry-result.png)

**Résultat attendu :** le jeu fictif termine avec une demande réussie et aucun échec. Un échantillon réussi ne garantit pas la transformation de toutes les demandes d'une grande source.

## Importer la source vérifiée

Un import réel enregistre des données dans CE. Conservez une sauvegarde source et convenez du périmètre avant de commencer.

### 1. Vérifier le résumé d'import

Choisissez Next pour ouvrir Import. Vérifiez le connecteur et les options.

![Vérifier le connecteur et les options avant l'import réel.](/docs-images/operator/v1-import-guide-import-summary.png)

### 2. Lancer l'import

Choisissez **Start import**. Le serveur lit les demandes page par page et enregistre les fiches transformées.

![Start import enregistre les fiches transformées.](/docs-images/operator/v1-import-guide-import-start.png)

### 3. Lire les comptes finaux

Attendez Finished ou examinez un résultat arrêté ou échoué. L'exemple enregistre une demande sans échec. Les compteurs changent par page et peuvent rester immobiles pendant son traitement.

![L'exemple termine avec une demande importée et aucun échec.](/docs-images/operator/v1-import-guide-complete.png)

### 4. Vérifier Activity

Ouvrez **Activity**. L'import apparaît avec son état et ses nombres de demandes. Une simulation n'apparaît pas comme activité d'import.

![L'exécution d'import apparaît dans Activity.](/docs-images/operator/v1-import-guide-activity.png)

**Résultat attendu :** les données transformées sont stockées dans CE. Les fiches conservent la provenance du plugin et de l'exécution. La base source reste inchangée.

## Lire un import sur téléphone

Lancer un long import est plus facile sur ordinateur. La page du plugin reste accessible sur téléphone.

### 1. Ouvrir la page d'import

Lisez l'étape actuelle et l'état d'exécution. Faites défiler la page pour les longs résumés.

![La page d'import s'adapte à la largeur du téléphone.](/docs-images/operator/v1-import-guide-phone.png)

## Arrêter, reprendre et répéter

Un import actif continue sur le serveur quand vous quittez la page. Au retour, elle ouvre l'exécution actuelle. **Stop** termine après la page en cours. **Resume** reprend après la dernière demande terminée après un arrêt, un échec ou un redémarrage serveur.

Une demande déjà importée est remplacée, pas dupliquée. Répéter un import met les données à jour. Vérifiez d'abord le périmètre et les options. Le petit jeu des captures s'est terminé trop vite pour montrer Stop et Resume. Ces commandes ont été vérifiées dans le code, sans capture pendant un long import.

Les échecs d'une demande n'arrêtent pas les autres. La page montre les 100 premières raisons. Elle conserve les codes de raison sans contenu des lignes sources. L'import n'émet pas data.persisted pour chaque demande. Les workflows écoutant cet événement ne s'exécutent donc pas pour ces fiches.

## Copier d'abord la source

Une copie lit les lignes de la base v1 et les garde sur le disque du serveur CE. Utilisez-la quand la connexion à la source est lente ou se coupe. Le serveur lit page par page, réessaie après une coupure et continue après un redémarrage. Personne n'a besoin de surveiller la page.

Rien ne lit encore la copie. L'import des sections précédentes lit toujours la source elle-même. Une copie ne change donc pas ce qu'un import enregistre.

La copie contient les données des patients en entier. Elle garde toutes les colonnes des lignes Requests, LabResults, Patients et ASTResults de chaque demande lue. Protégez le serveur CE et ses sauvegardes comme vous protégez la source. Il y a une copie par connecteur. Le plugin doit d'abord être autorisé à lire le connecteur.

### 1. Ouvrir l'onglet Copie

Ouvrez **OpenLDR v1 import** dans le menu principal, puis choisissez l'onglet **Copie** en haut de la page.

![L'onglet Copie se trouve à côté de l'onglet Import.](/docs-images/operator/v1-import-guide-copy-tab.png)

### 2. Choisir la source et les options

Choisissez le connecteur. Sous **Options de copie**, saisissez les mêmes valeurs que pour un import. **Base de données**, **Date de début**, **Date de fin** et **Codes de panel** décident des demandes que la copie lit. **Fuseau horaire du site** ne change rien à la copie, car la copie garde les dates telles que la source les a écrites.

![Choisir le connecteur et les options de copie.](/docs-images/operator/v1-import-guide-copy-options.png)

### 3. Lancer la copie

Choisissez **Lancer la copie**. L'état affiche **En file d'attente. Le serveur la lance dans quelques secondes.**, puis **Copie en cours**. Vous pouvez quitter la page. Pendant une copie, ses options sont verrouillées.

![Lancer la copie confie la copie au serveur.](/docs-images/operator/v1-import-guide-copy-start.png)

### 4. Lire le tableau des ensembles

Chaque ligne du tableau est un ensemble. Le plugin v1 copie un seul ensemble, `requests`, qui contient les lignes des quatre tables pour chaque demande. **Demandes lues** est le nombre de demandes enregistrées jusqu'ici. **Lignes** est le nombre de lignes sources enregistrées, dans les quatre tables. **Taille** est la taille de ces lignes telles que CE les stocke. **État** affiche Pas commencé, Copie en cours, En attente, Copié en partie, Terminé, À relire ou Suppression.

La ligne sous l'état compte les demandes "sur un total encore inconnu", car la copie ne compte pas la source avant de commencer. Une copie finie affiche **Terminée** et donne **Demandes copiées :** avec le nombre.

![Le tableau donne les demandes, les lignes, la taille et l'état.](/docs-images/operator/v1-import-guide-copy-sets.png)

Quand CE n'a pas pu copier certaines demandes, une ligne orange donne **Demandes laissées de côté :** et le nombre, et l'état affiche **Terminée, avec des demandes laissées de côté**. La résolution de problèmes explique pourquoi.

![Une copie avec des demandes laissées de côté n'est pas complète.](/docs-images/operator/v1-import-guide-copy-skipped.png)

### 5. Laisser faire une copie en attente

Quand la source ou la connexion est coupée, l'état affiche **En attente de la source. Elle réessaiera d'elle-même.** La page montre **Essais jusqu'ici :**, le début de l'attente et la dernière erreur. Vous n'avez rien à faire. La première attente dure 5 secondes. Chaque attente double, jusqu'à 5 minutes, jusqu'à ce que la source réponde ou qu'une personne arrête la copie.

Une copie continue aussi d'elle-même après un redémarrage du serveur CE. Personne n'appuie sur rien. Les compteurs peuvent rester immobiles jusqu'à deux minutes environ après le redémarrage avant de bouger à nouveau.

![Une copie en attente réessaie d'elle-même.](/docs-images/operator/v1-import-guide-copy-waiting.png)

### 6. Arrêter et reprendre

Ouvrez le menu à points à côté de l'état et choisissez **Arrêter**. L'état affiche **Arrêt après cette page**, puis **Arrêtée**. Les lignes déjà copiées restent. Pour continuer, choisissez **Reprendre la copie**. Chaque ensemble reprend là où il s'était arrêté.

![Arrêter se trouve dans le menu à points à côté de l'état.](/docs-images/operator/v1-import-guide-copy-stop.png)

Si vous avez changé **Base de données**, **Date de début**, **Date de fin** ou **Codes de panel**, Reprendre la copie demande **Relire depuis le début ?** et nomme les ensembles. **Relire** supprime les lignes déjà copiées pour ces ensembles, puis les relit depuis le début. Sur une connexion lente, cela peut prendre des jours. Pour garder la copie, choisissez **Annuler**, remettez les options d'avant, puis choisissez **Reprendre la copie**.

![Relire supprime ce qui a été copié pour les ensembles nommés.](/docs-images/operator/v1-import-guide-copy-reread.png)

### 7. Supprimer une copie

Arrêtez d'abord la copie. Ouvrez le menu à points et choisissez **Supprimer la copie**. L'étape nomme le connecteur et donne les lignes et la taille. Saisissez `openldr-v1-import`, puis choisissez **Supprimer la copie**.

L'état affiche **Suppression des lignes copiées**. Le serveur supprime les lignes par lots, en arrière-plan. Il continue quand vous quittez la page, et après un redémarrage du serveur. À la fin, la page affiche **La copie a été supprimée.**

![Saisir l'identifiant du plugin pour supprimer la copie.](/docs-images/operator/v1-import-guide-copy-delete.png)

**Résultat attendu :** la copie garde les lignes sources sur le serveur CE, et la base source reste inchangée. Rien dans CE ne lit encore la copie.

## Importer en ligne de commande

Consultez [Commencer ici](/docs/cli) pour configurer la CLI. Depuis `openldr_ce`, autorisez seulement le connecteur voulu. Faites une simulation avant l'import réel. Remplacez l'identifiant et le décalage source.

### 1. Autoriser seulement le connecteur prévu

```sh
{{operator:v1-allow}}
```

![Autoriser seulement le connecteur prévu.](guide:operator-v1-allow)

### 2. Lire un essai limité avant écriture

```sh
{{operator:v1-dry}}
```

![Lire un essai limité avant écriture.](guide:operator-v1-dry)

### 3. Lancer l’import réel après examen de l’essai

```sh
{{operator:v1-start}}
```

![Lancer l’import réel après examen de l’essai.](guide:operator-v1-start)

### 4. Lire l’état de l’exécution

```sh
{{operator:v1-status}}
```

![Lire l’état de l’exécution.](guide:operator-v1-status)

### 5. Arrêter une longue exécution après sa page

```sh
{{operator:v1-stop}}
```

![Arrêter une longue exécution après sa page.](guide:operator-v1-stop)

### 6. Reprendre la même exécution arrêtée

```sh
{{operator:v1-resume}}
```

![Reprendre la même exécution arrêtée.](guide:operator-v1-resume)

### 7. Lire les codes d’erreur avant une autre tentative

```sh
{{operator:v1-failures}}
```

![Lire les codes d’erreur avant une autre tentative.](guide:operator-v1-failures)

### 8. Lancer une copie et rendre la main tout de suite

```sh
{{operator:v1-copy-start}}
```

`start` enregistre la demande et rend la main tout de suite. Le serveur fait la copie. Sur une copie déjà en file d'attente, en cours ou en attente, il renvoie cette copie telle quelle. Sur une copie arrêtée, en échec ou terminée, elle reprend là où chaque ensemble s'était arrêté. Quand une option a changé ce que lit un ensemble, il nomme les ensembles et ne change rien. Relancez-le avec `--reread` pour relire ces ensembles depuis le début.

![Lancer une copie et rendre la main tout de suite.](guide:operator-v1-copy-start)

### 9. Lire l'état de la copie

```sh
{{operator:v1-copy-status}}
```

Il affiche une ligne par copie : l'identifiant de la copie, l'état, puis `keys`, `rows`, `bytes` et `skipped` pour chaque ensemble. Une copie en attente ou en échec finit sa ligne par l'erreur. L'identifiant de la copie est la première valeur de la ligne.

![Lire l'état de la copie.](guide:operator-v1-copy-status)

### 10. Arrêter une copie après sa page en cours

```sh
{{operator:v1-copy-stop}}
```

Les lignes déjà copiées restent. Relancez `start` pour continuer.

![Arrêter une copie après sa page en cours.](guide:operator-v1-copy-stop)

### 11. Supprimer une copie arrêtée ou terminée

```sh
{{operator:v1-copy-delete}}
```

`delete` refuse sans `--force`. Il rend la main avant que les lignes soient parties. Le serveur continue la suppression en arrière-plan.

![Supprimer une copie arrêtée ou terminée.](guide:operator-v1-copy-delete)



## Pratique facultative avec une source fictive

L'usage habituel exige une base v1 existante. Sur un SQL Server de test seulement, [example-source.sql](https://openldr.online/docs-samples/user-guide/v1-import/example-source.sql) crée une base distincte `guide_v1`, les quatre tables attendues, une demande, un patient et un résultat texte fictifs. ASTResults est vide. Ce jeu minimal n'est pas un schéma historique v1 complet.

Le fichier crée une base. Lisez-le avant de l'exécuter et utilisez un serveur de test sans base nommée guide_v1. Demandez à l'opérateur un compte en lecture seule. Le fichier ne fournit aucun identifiant de connexion.

Depuis les sources, `pnpm build:v1-import` prépare l'importeur de référence. Rust et la cible wasm32-wasip1 sont nécessaires. Installez le fichier avec `pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm`. Cette commande passe par l'API en marche, donc démarrez-la et connectez-vous d'abord. Cette compilation non signée sert aux tests. En usage habituel, utilisez le paquet signé approuvé par votre organisation.

## Résolution de problèmes

**L'importeur manque dans le menu principal.** Vérifiez l'installation, l'activation du plugin et l'accès administrateur.

**Plugin access est vide.** Vérifiez que le connecteur est Microsoft SQL et que l'importeur est installé.

**Aucune source proposée.** Autorisez le plugin sur le bon connecteur, puis rouvrez sa page.

**La connexion échoue.** Utilisez Diagnose du connecteur et corrigez la première étape en échec.

**Moins de quatre tables.** Vérifiez la base substituée, les noms de tables et les droits de lecture. Une connexion réussie ne prouve pas le schéma v1.

**Start ou Resume est refusé.** Lisez l'erreur et le journal API. Le service d'import exige une trace d'audit avant de démarrer.

**Les compteurs restent immobiles.** Attendez la page en cours. Une page peut contenir 500 demandes. Vérifiez les erreurs avant de conclure qu'un grand import est bloqué.

**La copie affiche En attente de la source.** CE ne joint pas la source, ou la connexion est coupée. La copie réessaie d'elle-même, avec au plus 5 minutes entre deux essais. Lisez la dernière erreur. Si l'attente dure, lancez Diagnose sur le connecteur. N'arrêtez la copie que si vous voulez qu'elle cesse d'essayer.

**Des demandes ont été laissées de côté.** La ligne orange **Demandes laissées de côté :** donne leur nombre. CE laisse une demande de côté pour l'une de deux raisons. Lue seule, elle a dépassé le délai trois fois (`SOURCE_TIMEOUT`). Ou l'une de ses lignes contient un texte que la base de CE ne peut pas stocker, comme un caractère NUL (`ROW_NOT_STORABLE`). La copie les réessaie à la fin de chaque passage et au lancement suivant. La page et la CLI ne montrent que le nombre. Une copie avec des demandes laissées de côté n'est pas complète.

**Lancer la copie demande de relire un ensemble.** Sur la page, la question vient de **Reprendre la copie**. Dans la CLI, `start` nomme les ensembles à la place. Une option qui décide des demandes lues a changé, ou le plugin a été mis à jour. Relire supprime les lignes copiées pour les ensembles nommés. Choisissez **Annuler** et remettez les options d'avant pour les garder.

**La copie est en échec.** Lisez la dernière erreur. Une authentification refusée, une base ou une table absente, une faute du plugin, ou une écriture refusée par la base de CE, par exemple sur un disque plein, met fin à la copie. Réessayer ne peut pas corriger cela. Corrigez la cause, puis choisissez **Reprendre la copie**. Les lignes déjà copiées restent.

**Supprimer la copie est grisé.** On ne peut supprimer qu'une copie arrêtée, en échec ou terminée. Arrêtez-la d'abord.

## Guides associés

[Diagnostiquer les connexions](/docs/connector-diagnose), [Connecteurs](/docs/connectors), [Marché](/docs/marketplace), [Activité](/docs/activity) et [Audit](/docs/audit).

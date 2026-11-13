# Importer depuis OpenLDR v1

Le plugin d'import OpenLDR v1 lit une base SQL Server v1 et enregistre dans CE les demandes, patients, résultats et antibiogrammes associés. Il s'exécute sur le serveur par pages de demandes.

Utilisez votre base v1 avec un connecteur Microsoft SQL en lecture seule. Diagnostiquez-le d'abord. Le plugin doit être installé et un administrateur doit l'autoriser à lire ce connecteur.

Vous avez besoin de **Manage connectors** pour autoriser la source. La page du plugin exige le rôle administrateur du laboratoire. Connaissez le décalage UTC du laboratoire source.

Les captures utilisent une demande, un patient et un résultat texte fictifs sur un SQL Server isolé. Elles vérifient une simulation et un import réels de ce petit jeu. Elles ne prouvent pas la compatibilité avec toutes les anciennes bases v1. La pratique facultative se trouve à la fin.

## Autoriser le plugin à lire un connecteur

Installez le plugin dans Marketplace ou depuis son fichier approuvé. Créez un connecteur Microsoft SQL avec accès SELECT aux tables v1. Le compte ne doit pas modifier la source.

### 1. Ouvrir Connectors

Ouvrez **Settings**, puis **Connectors**. Vérifiez d'abord la source avec [Diagnostiquer les connexions](/docs/connector-diagnose).

![Ouvrir Settings puis Connectors.](v1-import-guide-connectors.png)

### 2. Ouvrir Plugin access

Sur la ligne du connecteur v1, ouvrez les points et choisissez **Plugin access**.

![Choisir Plugin access pour le connecteur de base v1.](v1-import-guide-access.png)

### 3. Autoriser l'importeur

Activez l'interrupteur près de `openldr-v1-import`. Chaque changement s'enregistre immédiatement.

![Autoriser openldr-v1-import à lire ce connecteur.](v1-import-guide-allow.png)

### 4. Vérifier l'interrupteur enregistré

L'interrupteur reste activé. Désactivez-le ensuite pour révoquer l'accès du plugin à ce connecteur.

![L'interrupteur autorisé reste activé après l'enregistrement.](v1-import-guide-allowed.png)

**Résultat attendu :** le plugin peut proposer ce connecteur comme source. Les autorisations et révocations apparaissent dans Audit.

## Choisir et vérifier la source

Une connexion réussie vérifie le réseau et l'authentification. L'étape Checks vérifie ensuite les tables attendues.

### 1. Ouvrir l'importeur

Sélectionnez **OpenLDR v1 import** dans le menu principal.

![Ouvrir OpenLDR v1 import depuis le menu principal.](v1-import-guide-plugin-nav.png)

### 2. Choisir le connecteur source

Dans Source, choisissez le connecteur vers votre base v1.

![Choisir le connecteur v1 autorisé.](v1-import-guide-source.png)

### 3. Vérifier la connexion

Sélectionnez **Check connection**. Lisez chaque étape et attendez **The connection works.** Corrigez les échecs avant de continuer.

![Check connection doit réussir avant l'import.](v1-import-guide-connection.png)

**Résultat attendu :** la connexion choisie fonctionne depuis le serveur CE. Aucune donnée source n'a été importée.

## Définir l'heure source et les limites d'import

v1 stocke les dates et heures locales sans fuseau. Choisissez le décalage correspondant à ces horodatages.

### 1. Définir Site time zone

Choisissez Next pour ouvrir Options. Saisissez le décalage UTC du laboratoire source, comme `+02:00`. Utilisez `Z` seulement pour une source en UTC. L'exemple fictif utilise Z.

![Définir le vrai décalage UTC source. Cette source fictive utilise Z.](v1-import-guide-timezone.png)

### 2. Choisir les limites facultatives

Database remplace la base du connecteur. From date et To date limitent les dates d'enregistrement. Panel codes est une liste séparée par des virgules. Laissez les limites vides seulement pour lire toute la source.

![Laisser les limites vides seulement pour importer toute la source.](v1-import-guide-options.png)

### 3. Vérifier les tables

Choisissez Next pour ouvrir Checks. Lisez les nombres de tables et de lignes. Les **4 of 4** tables doivent exister : Requests, LabResults, Patients et ASTResults.

![Lire les nombres de tables et de lignes avant de continuer.](v1-import-guide-checks.png)

**Résultat attendu :** Checks compte les tables et lignes sans importer. Si une table manque, vérifiez la base et le schéma source.

## Essayer une simulation

Une simulation lit et transforme un nombre limité de demandes sans enregistrer leurs données cliniques.

### 1. Définir la limite de demandes

Choisissez Next pour ouvrir Dry run. Saisissez une petite limite. L'exemple utilise `100` sur un jeu d'une demande.

![Dry run limite les demandes lues sans les enregistrer.](v1-import-guide-dry-limit.png)

### 2. Lancer la simulation

Choisissez **Start dry run**.

![Choisir Start dry run.](v1-import-guide-dry-start.png)

### 3. Lire le résultat

Attendez Finished. Vérifiez les demandes lues, transformées ou importées, et les échecs. Lisez les raisons avant de continuer.

![Lire les nombres transformés et échoués de la simulation.](v1-import-guide-dry-result.png)

**Résultat attendu :** le jeu fictif termine avec une demande réussie et aucun échec. Un échantillon réussi ne garantit pas la transformation de toutes les demandes d'une grande source.

## Importer la source vérifiée

Un import réel enregistre des données dans CE. Conservez une sauvegarde source et convenez du périmètre avant de commencer.

### 1. Vérifier le résumé d'import

Choisissez Next pour ouvrir Import. Vérifiez le connecteur et les options.

![Vérifier le connecteur et les options avant l'import réel.](v1-import-guide-import-summary.png)

### 2. Lancer l'import

Choisissez **Start import**. Le serveur lit les demandes page par page et enregistre les fiches transformées.

![Start import enregistre les fiches transformées.](v1-import-guide-import-start.png)

### 3. Lire les comptes finaux

Attendez Finished ou examinez un résultat arrêté ou échoué. L'exemple enregistre une demande sans échec. Les compteurs changent par page et peuvent rester immobiles pendant son traitement.

![L'exemple termine avec une demande importée et aucun échec.](v1-import-guide-complete.png)

### 4. Vérifier Activity

Ouvrez **Activity**. L'import apparaît avec son état et ses nombres de demandes. Une simulation n'apparaît pas comme activité d'import.

![L'exécution d'import apparaît dans Activity.](v1-import-guide-activity.png)

**Résultat attendu :** les données transformées sont stockées dans CE. Les fiches conservent la provenance du plugin et de l'exécution. La base source reste inchangée.

## Lire un import sur téléphone

Lancer un long import est plus facile sur ordinateur. La page du plugin reste accessible sur téléphone.

### 1. Ouvrir la page d'import

Lisez l'étape actuelle et l'état d'exécution. Faites défiler la page pour les longs résumés.

![La page d'import s'adapte à la largeur du téléphone.](v1-import-guide-phone.png)

## Arrêter, reprendre et répéter

Un import actif continue sur le serveur quand vous quittez la page. Au retour, elle ouvre l'exécution actuelle. **Stop** termine après la page en cours. **Resume** reprend après la dernière demande terminée après un arrêt, un échec ou un redémarrage serveur.

Une demande déjà importée est remplacée, pas dupliquée. Répéter un import met les données à jour. Vérifiez d'abord le périmètre et les options. Le petit jeu des captures s'est terminé trop vite pour montrer Stop et Resume. Ces commandes ont été vérifiées dans le code, sans capture pendant un long import.

Les échecs d'une demande n'arrêtent pas les autres. La page montre les 100 premières raisons. Elle conserve les codes de raison sans contenu des lignes sources. L'import n'émet pas data.persisted pour chaque demande. Les workflows écoutant cet événement ne s'exécutent donc pas pour ces fiches.

## Importer en ligne de commande

Consultez [Commencer ici](/docs/start-here) pour configurer la CLI. Depuis `openldr_ce`, autorisez seulement le connecteur voulu. Faites une simulation avant l'import réel. Remplacez l'identifiant et le décalage source.

```shell
pnpm openldr import allow openldr-v1-import <connector-id>
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
pnpm openldr import status openldr-v1-import
pnpm openldr import allowed openldr-v1-import
```

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

## Guides associés

[Diagnostiquer les connexions](/docs/connector-diagnose), [Connecteurs](/docs/connectors), [Marché](/docs/marketplace), [Activité](/docs/activity) et [Audit](/docs/audit).

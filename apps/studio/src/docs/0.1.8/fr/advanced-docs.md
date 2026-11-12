# Documentation de déploiement et de développement

Utilisez le manuel intégré pour les tâches dans Studio. Consultez la documentation de déploiement et de développement pour l'installation, la configuration serveur, le développement et la CLI.

Cette page vous aide à trouver et enregistrer ces documents. Elle n'ajoute aucun éditeur de déploiement dans Studio et n'exécute aucune commande de maintenance. Aucun exemple de données n'est requis.

## Trouver les instructions de déploiement et de développement

Recherchez dans le manuel les références d'installation, de CLI ou de serveur.

### 1. Ouvrir Docs

Sélectionnez **Docs** dans le menu principal.

![Ouvrez Docs dans le menu principal.](advanced-docs-guide-docs.png)

### 2. Rechercher le sujet

Saisissez `Deployment` dans Search documentation. Vous pouvez rechercher un sujet plus précis.

![Recherchez la documentation par titre ou sujet.](advanced-docs-guide-search.png)

### 3. Ouvrir le guide correspondant

Choisissez **Deployment & developer docs**.

![Choisissez Deployment & Developer Docs dans les résultats.](advanced-docs-guide-guide-link.png)

### 4. Choisir les instructions nécessaires

Lisez le guide. L'installation, les variables d'environnement, Windows Server, le développement et la CLI sont des sujets distincts.

![Lisez la rubrique de déploiement et de développement.](advanced-docs-guide-guide.png)

### 5. Suivre la référence du projet

Utilisez le [site OpenLDR](https://openldr.online/docs) ou le [dépôt source](https://github.com/Open-Laboratory-Data-Repository/openldr). Le dépôt contient les fichiers de déploiement et la CLI. Vérifiez que les instructions correspondent à votre version.

![Utilisez le site du projet ou le dépôt source pour les documents de déploiement et de développement.](advanced-docs-guide-repository.png)

**Résultat attendu :** vous pouvez choisir la documentation adaptée sans traiter le manuel intégré comme une console d'administration serveur.

## Enregistrer les instructions avant une interruption

Enregistrez les instructions de mise à niveau ou de récupération hors de Studio avant d'arrêter les services qui fournissent ce manuel.

### 1. Ouvrir Download documentation

Sélectionnez le bouton de téléchargement en haut du guide.

![Téléchargez un guide avant de mettre Studio hors ligne.](advanced-docs-guide-download.png)

### 2. Choisir This page

Sélectionnez **This page**. Choisissez All docs si vous avez besoin du manuel complet.

![Choisissez This page pour ce guide uniquement.](advanced-docs-guide-this-page.png)

### 3. Choisir un format de fichier

Sélectionnez Markdown, PDF ou Word. L'exemple testé télécharge **Markdown (.md)**. Conservez le fichier à un endroit accessible lorsque Studio est hors ligne.

![Choisissez Markdown, PDF ou Word.](advanced-docs-guide-format.png)

**Résultat attendu :** le navigateur télécharge une copie autonome du contenu choisi. Un export de documentation n'est pas une sauvegarde des bases ou des fichiers.

## Lire le guide sur téléphone

Le manuel intégré s'adapte à la largeur du téléphone.

### 1. Lire le sujet sélectionné

Ouvrez le guide et faites défiler la zone de lecture. Utilisez les commandes d'en-tête pour naviguer et télécharger.

![Lisez le guide à la largeur d'un téléphone.](advanced-docs-guide-phone.png)

## Choisir le guide adapté

| Tâche | Guide |
| --- | --- |
| Installer OpenLDR ou choisir les ressources serveur | Rubriques Requirements et Install du site. |
| Définir les domaines, certificats ou stockages externes | [Variables d'environnement](/docs/environment) et documentation de déploiement. |
| Exécuter OpenLDR depuis les sources | Rubrique Development du site, puis instructions du dépôt source pour cette version. |
| Utiliser les commandes d'exploitation | [Commencer ici](/docs/start-here) et documentation de la CLI. |
| Changer de fournisseur d'identité ou d'adresse d'émetteur | [Fournisseurs d'authentification](/docs/auth-providers). |
| Mettre à niveau une installation existante | [Mises à niveau planifiées](/docs/upgrading). |
| Configurer le comportement de Studio | [Paramètres](/docs/settings). |

## Lire les faits du modèle et des sources

Le stockage FHIR canonique conserve les ressources cliniques. L'entrepôt les projette dans des tables pour les requêtes et les rapports. Les faits restent vides lorsque la source ne les fournit pas.

Les faits courants des demandes ont des colonnes typées dans lab_requests. Les attributs supplémentaires utilisent lab_request_attributes avec le système de codes request-attribute. Ce sont des lignes, pas des colonnes propres à un pays. Lisez-les avec Custom Queries.

Le fichier de terminologie `packages/terminology/codesystems/openldr-request-attribute.json` fournit les libellés. Importez-le depuis un dépôt source avec `pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json` si votre installation en a besoin. Les attributs peuvent exister sans ce dictionnaire de libellés.

Un résultat inférieur ou supérieur à une limite conserve cette limite numérique dans numeric_value et son comparateur dans numeric_comparator. L'état du résultat et les champs d'absence de données décrivent les résultats annulés ou indisponibles. Qualifiez status avec l'alias de table approprié si une jointure inclut plusieurs colonnes status.

Le texte libre clinical_info est masqué par défaut dans le créateur de tableaux de bord. Consultez Data exposure avant de le rendre disponible. Le SQL des connecteurs dépend des permissions de leur compte de base de données.

## Heure d'arrivée et reconstructions de l'entrepôt

Utilisez ingest_events lorsqu'un rapport demande quand une ressource clinique est arrivée dans OpenLDR. Les valeurs created_at des tables projetées décrivent les écritures de projection. Elles ne représentent pas chaque arrivée d'une version corrigée.

`pnpm openldr db reproject --force` reconstruit l'entrepôt depuis les ressources canoniques, y compris le journal des arrivées. La commande réécrit les lignes projetées et refuse sans --force. Prévoyez son coût et son créneau sur une grande installation. L'ancienne commande terminology reproject est obsolète et effectue la même reconstruction complète.

Après un échec temporaire de projection, les tentatives persistantes relisent la ressource canonique actuelle. Chaque cycle réessaie jusqu'à 100 ressources en attente et poursuit les nouvelles modifications. Les échecs répétés attendent davantage, jusqu'à cinq minutes. Une dépendance rétablie peut permettre la reprise sans intervention. Une reconstruction complète reste une opération de maintenance distincte.

## Limites des vérifications

Les captures viennent du véritable manuel intégré. L'export Markdown a été téléchargé et inspecté. Les vérifications de navigation n'ont pas exécuté l'installation externe, la configuration Windows Server, la compilation des sources ou les commandes de maintenance destructives.

Pour modifier un déploiement, suivez la documentation de sa version et vérifiez les services concernés. Un lien dans Studio ne prouve pas qu'une procédure externe a été testée sur votre serveur.

## Dépannage

**Un guide n'apparaît pas dans la recherche.** Vérifiez la langue et la version actuelles de la documentation, puis recherchez son titre ou son sujet.

**Le téléchargement contient le mauvais guide.** Ouvrez le guide voulu et choisissez This page dans Download documentation.

## Guides associés

[Commencer ici](/docs/start-here), [Variables d'environnement](/docs/environment), [Fournisseurs d'authentification](/docs/auth-providers) et [Mises à niveau planifiées](/docs/upgrading).

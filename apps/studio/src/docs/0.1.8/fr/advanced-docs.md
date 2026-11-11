# Déploiement et documentation technique

Ce manuel intégré couvre les tâches faites dans l'application par un utilisateur connecté. Le déploiement, la configuration et le développement sont documentés sur le **site OpenLDR**, dans sa section Docs :

- **Requirements & Install** : ce qu'il faut, et l'installeur en une ligne (y compris un domaine public avec un certificat Let's Encrypt).
- **Environment variables** : chaque valeur du fichier `.env` du déploiement.
- **Windows Server (WSL2)** : le déploiement sur Windows Server avec WSL2.
- **Development** : lancer OpenLDR depuis les sources, avec rechargement à chaud.
- **Command-line interface (CLI)** : la ligne de commande `openldr` de l'opérateur (base de données, terminologie, ingestion, plugins, rapports, utilisateurs, marketplace).
  - **`openldr db reproject --force`** reconstruit tout le modèle de lecture de l'entrepôt depuis le stockage FHIR canonique, y compris le registre des arrivées `ingest_events`. Il refuse sans `--force`, car il réécrit chaque ligne projetée.
  - **`openldr terminology reproject` est obsolète** et fait exactement la même chose. Il l'a toujours fait : malgré son nom, il n'a jamais reconstruit que `terminology_codes`. Utilisez `db reproject`.
  - **`ingest_events` est le registre de l'arrivée des données dans OpenLDR.** Une ligne par arrivée de chaque ressource clinique, par ressource et version, reconstruite depuis le stockage canonique. La colonne `created_at` de `lab_requests`, `specimens` et des autres tables projetées n'est **pas** une heure d'arrivée : elle note la première écriture de la ligne par la projection, garde un seul horodatage quel que soit le nombre de corrections, et repart à zéro pour toute ligne réinsérée. Pour savoir « quand ces données nous sont arrivées », lisez `ingest_events`.

Tout cela se trouve sur le site du projet et dans le dépôt des sources : <https://github.com/Open-Laboratory-Data-Repository/openldr>.

## Nouvelles tentatives de projection

Le service conserve les écritures échouées des ressources et du registre pour les réessayer automatiquement.
Ces tentatives survivent au redémarrage et relisent la ressource canonique actuelle, suppressions comprises.
Chaque cycle reprend au maximum 100 ressources en attente, puis traite les nouveaux changements.
Les échecs répétés attendent 1, 2, 4 secondes, puis davantage, jusqu'à cinq minutes.
Les tentatives continuent jusqu'au succès. Une ressource en échec ne bloque pas les changements valides suivants.
Un nouveau changement de cette ressource peut déclencher une tentative avant la fin du délai.
Si l'enregistrement d'une tentative échoue, le service conserve son curseur.
Le succès supprime la tentative en attente. Les erreurs de capture auxiliaire sont journalisées sans nouvelle tentative.
Après une panne temporaire, aucune intervention n'est nécessaire.
Pour reconstruire toutes les tables de lecture, utilisez `openldr db reproject --force`.

## Faits de la demande et attributs de la demande

Chaque demande de laboratoire porte, quand la source les envoie : le jeu OBR, l'heure d'analyse,
le point de soin, le type de demande, qui l'a enregistrée et testée, le médecin demandeur, l'âge à
la demande, l'information clinique, l'analyseur, et le code et le motif de rejet. Chaque rapport
porte sa section et qui l'a autorisé.

Les faits plus rares sont des lignes dans `lab_request_attributes`, une ligne par demande et
attribut. Les codes d'attribut forment le système de codage `urn:openldr:cs:request-attribute`.
Chargez-le une fois avec :

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Exécutez cette commande depuis un dépôt source d'OpenLDR CE, où le fichier se trouve à ce chemin.
Sans cet import, les lignes d'attribut sont quand même enregistrées. Seuls les noms d'affichage
des codes manquent.

Un fait que la source n'envoie pas reste vide. Rien n'est rempli à sa place.

Un résultat numérique hors de la plage de mesure de la méthode du laboratoire arrive sous la forme
de la limite avec un comparateur, par exemple `< 20`. `lab_results.numeric_comparator` contient `<`, `<=`, `>=`
ou `>`, et reste vide pour un nombre ordinaire. `numeric_value` contient alors la limite.

Chaque résultat porte son statut FHIR dans `lab_results.status`. Un test rejeté à la saisie des résultats est enregistré comme une ligne au statut `cancelled`, sans valeur, avec la raison dans `data_absent_code` et `data_absent_reason`, par exemple `HAEM` et `Haemolysed`. Pour compter les résultats, ajoutez `(l.status is null or l.status <> 'cancelled')` à la requête. Pour compter les tests rejetés, utilisez `l.status = 'cancelled'`. Préfixez `status` par l'alias de lab_results, car lab_requests, specimens et diagnostic_reports ont aussi une colonne `status` ; une requête plus ancienne qui les joint et utilise `status` seul doit être corrigée. Une installation mise à niveau depuis une version antérieure n'a pas de statut sur les lignes qu'elle contenait déjà. Lancez `openldr db reproject --force` une fois après la mise à niveau pour les remplir.

`clinical_info` est masqué du générateur de tableaux de bord par défaut, car il peut contenir du
texte libre ou un identifiant patient pseudonymisé. Démasquez-le dans Paramètres, puis Exposition
des données. La table `lab_request_attributes` n'est pas dans le générateur de tableaux de bord
du tout. Lisez-la avec des requêtes personnalisées.

## Guides associés

- [Paramètres](/docs/settings)

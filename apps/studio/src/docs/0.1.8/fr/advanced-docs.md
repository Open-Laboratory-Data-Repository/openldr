# Déploiement et documentation technique

Les guides de déploiement, de configuration et de développement se trouvent sur le
[site OpenLDR](https://github.com/Open-Laboratory-Data-Repository/openldr).

`openldr db reproject --force` reconstruit les tables de lecture depuis les ressources FHIR canoniques,
y compris le registre des arrivées `ingest_events`. La commande exige `--force`.
`openldr terminology reproject` est obsolète et effectue la même reconstruction.
Le registre conserve chaque arrivée par ressource et version.
Le champ `created_at` des tables de lecture indique leur première écriture, pas l'arrivée des données.

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

`clinical_info` est masqué du générateur de tableaux de bord par défaut, car il peut contenir du
texte libre ou un identifiant patient pseudonymisé. Démasquez-le dans Paramètres, puis Exposition
des données. La table `lab_request_attributes` n'est pas dans le générateur de tableaux de bord
du tout. Lisez-la avec des requêtes personnalisées.

## Guides associés

- [Paramètres](/docs/settings)

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

## Guides associés

- [Paramètres](/docs/settings)

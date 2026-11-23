# Le plugin laboratoire

Le plugin laboratoire ajoute une page **Lab** au studio. La réception du laboratoire trouve une demande par son numéro, l'enregistre si besoin, reçoit les échantillons, et renvoie ou rejette ce qu'elle ne peut pas utiliser. Le personnel d'un site saisit ses propres demandes et ne voit que les demandes de son établissement. La paillasse saisit les résultats, et un valideur les valide. Le plugin garde ses données dans ses propres tables, dans le schéma `plugin_lab`. CE fonctionne de la même façon sans lui.

Les résultats validés arrivent dans les rapports de CE. Tant qu'un résultat n'est pas validé, sa demande, son échantillon et ses valeurs restent dans les tables du plugin. Un patient nouvellement enregistré arrive dans CE tout de suite.

Le plugin n'est pas encore dans le marketplace. Cette page dit comment essayer un bundle signé sur une installation de test.

## Ce qu'il lui faut

- Cette version de CE. Le plugin lit les établissements, les analyses et les patients par les fonctions hôtes de CE.
- Des établissements dans le registre des établissements, et les analyses de votre laboratoire activées dans le catalogue des examens. Chaque analyse a besoin d'un type d'échantillon, sinon la réception ne peut pas recevoir d'échantillon pour elle.

## Installer un bundle signé

```sh
openldr artifact publish <bundle-directory> --to <registry-folder> --install --approve
```

Redémarrez ensuite le serveur. Une installation en ligne de commande n'atteint un serveur en marche qu'après un redémarrage. L'entrée **Lab** apparaît alors dans la barre latérale pour toute personne qui a l'une de ses permissions.

## Donner l'accès

Le plugin ajoute sept permissions. Le rôle Administrateur les reçoit toutes à l'installation. Donnez-les à d'autres rôles sur la page **Rôles**, ou avec `openldr roles grant <role> <key>`.

- `lab.receive`, **Recevoir les échantillons** : l'onglet **Réception**.
- `lab.reject`, **Rejeter et renvoyer** : renvoyer une demande à son site, et rejeter des échantillons et des analyses.
- `lab.orders.enter`, **Saisir les demandes** : l'onglet **Demandes**, et les nouvelles demandes dans cet onglet.
- `lab.worklist.view`, **Voir les demandes du laboratoire** : l'onglet **Demandes**, et les valeurs des résultats d'une demande, en lecture seule.
- `lab.results.enter`, **Saisir les résultats** : l'onglet **Résultats**.
- `lab.results.authorise`, **Valider les résultats** : l'onglet **Validation**, pour renvoyer ou valider des résultats.
- `lab.settings`, **Paramètres du laboratoire** : l'onglet **Paramètres**, qui active ou désactive l'auto-validation.

`lab.reject` n'ouvre aucun onglet à lui seul. Donnez-le avec `lab.receive` ou `lab.worklist.view`.

La réception et les sites ont aussi besoin de `patients.find` (**Find a patient**, trouver un patient ; la page Rôles la montre en anglais) pour trouver et enregistrer des patients.

Une demande ne garde qu'un lien vers son patient, jamais le nom. Le nom est lu dans CE chaque fois qu'une demande s'affiche, avec les droits de la personne qui regarde. Un rôle qui a `patients.find` ou `patients.view`, et aussi `patients.view_identifiers` (**View patient identifiers**, voir les identifiants des patients), voit le nom complet. Sans `patients.view_identifiers`, le nom est masqué, comme sur les pages de CE. Un rôle sans aucune permission patient, par exemple avec `lab.worklist.view` seul, voit **non disponible** à la place du nom. Un utilisateur de site limité à un établissement voit toujours les noms masqués, car la limite retire `patients.view_identifiers`.

Limitez chaque utilisateur de site à son établissement avec `openldr users scope <user> --facility <facility-id> --force`. Cet utilisateur ne voit alors que les demandes de cet établissement. Une demande d'un autre établissement est traitée comme introuvable.

## Ce qui arrive dans CE

Quand un valideur valide un résultat, le plugin envoie à CE un ServiceRequest pour l'analyse, un Specimen pour chaque échantillon, une Observation par paramètre de résultat, et une Provenance qui dit qui l'a validé. Chaque Observation est `final`. Elle porte la valeur et l'unité, le signalement dans `interpretation`, et l'intervalle dans `referenceRange`, avec le nom de l'intervalle comme `text`. Le `subject` de chaque enregistrement est la fiche du patient dans CE. CE les stocke comme les enregistrements de toute autre source, et son entrepôt remplit `lab_requests` et `lab_results`, donc les résultats apparaissent dans les rapports et tableaux de bord.

Une analyse rejetée arrive dans CE quand son rejet est définitif : tout de suite si elle est rejetée sans nouveau prélèvement, ou quand sa demande de nouveau prélèvement est liée. Elle arrive comme un ServiceRequest `revoked` avec le motif du rejet, qui remplit `lab_requests.rejection_code` et `rejection_reason`.

CE ne prend ces enregistrements que d'un utilisateur sans limite d'établissement, qui a aussi `patients.find` ou `patients.view`. Un valideur doit donc voir tous les établissements. Un rejet fait par un utilisateur de site limité à un établissement attend dans le plugin jusqu'à ce qu'un utilisateur sans limite agisse, ou qu'un valideur sélectionne **Réessayer** dans l'onglet **Validation**.

Par défaut, la personne qui a saisi un résultat ne peut pas le valider. Un détenteur de `lab.settings` peut activer **Autoriser l’auto-validation**. La Provenance enregistre alors `self-authorise`.

Un résultat validé est verrouillé. Le plugin ne peut pas encore le corriger.

L'onglet **Guide** de la page **Lab** montre chaque tâche pas à pas.

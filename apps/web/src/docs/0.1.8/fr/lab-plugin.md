# Le plugin laboratoire

Le plugin laboratoire ajoute une page **Lab** au studio. La réception du laboratoire trouve une demande par son numéro, l'enregistre si besoin, reçoit les échantillons, et renvoie ou rejette ce qu'elle ne peut pas utiliser. Le personnel d'un site saisit ses propres demandes et ne voit que les demandes de son établissement. Le plugin garde ses données dans ses propres tables, dans le schéma `plugin_lab`. CE fonctionne de la même façon sans lui.

Les demandes et les échantillons restent dans les tables du plugin et n'arrivent pas encore dans les rapports de CE. Seul un patient nouvellement enregistré arrive dans CE.

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

Le plugin ajoute quatre permissions. Le rôle Administrateur reçoit les quatre à l'installation. Donnez-les à d'autres rôles sur la page **Rôles**, ou avec `openldr roles grant <role> <key>`.

- `lab.receive`, **Recevoir les échantillons** : l'onglet **Réception**.
- `lab.reject`, **Rejeter et renvoyer** : renvoyer une demande à son site, et rejeter des échantillons et des analyses.
- `lab.orders.enter`, **Saisir les demandes** : l'onglet **Demandes**, et les nouvelles demandes dans cet onglet.
- `lab.worklist.view`, **Voir les demandes du laboratoire** : l'onglet **Demandes**.

`lab.reject` n'ouvre aucun onglet à lui seul. Donnez-le avec `lab.receive` ou `lab.worklist.view`.

La réception et les sites ont aussi besoin de `patients.find` (**Trouver un patient**) pour trouver et enregistrer des patients.

Une demande ne garde qu'un lien vers son patient, jamais le nom. Le nom est lu dans CE chaque fois qu'une demande s'affiche, avec les droits de la personne qui regarde. Un rôle qui a `patients.find` ou `patients.view`, et aussi `patients.view_identifiers` (**Voir les identifiants des patients**), voit le nom complet. Sans `patients.view_identifiers`, le nom est masqué, comme sur les pages de CE. Un rôle sans aucune permission patient, par exemple avec `lab.worklist.view` seul, voit **non disponible** à la place du nom. Un utilisateur de site limité à un établissement voit toujours les noms masqués, car la limite retire `patients.view_identifiers`.

Limitez chaque utilisateur de site à son établissement avec `openldr users scope <user> --facility <facility-id> --force`. Cet utilisateur ne voit alors que les demandes de cet établissement. Une demande d'un autre établissement est traitée comme introuvable.

L'onglet **Guide** de la page **Lab** montre chaque tâche pas à pas.

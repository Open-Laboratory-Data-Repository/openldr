# Permissions des plugins

Un plugin peut ajouter ses propres permissions à CE. Un administrateur les donne aux rôles sur la page Roles, comme les capacités de CE. CE les vérifie avant chaque action que le plugin lance.

Cette page s'adresse à la personne qui écrit le plugin. Les deux champs vont dans `payload` du manifeste signé. Un manifeste sans eux s'installe et fonctionne comme avant. L'administrateur voit chaque permission, et ce que demande chaque action, sur l'écran d'installation.

## Déclarer des permissions

```json
"permissions": [
  {
    "key": "sinkhost.run",
    "label": "Run the test sink",
    "description": "Run the actions of the test sink plugin.",
    "labels": {
      "fr": { "label": "Lancer le plugin de test", "description": "Lancer les actions du plugin de test." },
      "pt": { "label": "Executar o plugin de teste", "description": "Executar as ações do plugin de teste." }
    }
  }
]
```

- Une clé est en minuscules, avec au moins deux parties séparées par un point. Elle correspond à `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`.
- `label` (80 caractères au plus) et `description` (300 au plus) sont en anglais. `labels` peut ajouter le français et le portugais. La page Roles montre l'anglais quand une langue manque.
- Un plugin déclare jusqu'à 50 permissions, chaque clé une seule fois.
- Une clé ne peut pas être une capacité de CE. Un manifeste qui déclare `forms.edit` comme sa propre clé est refusé à l'installation. Un plugin ne peut pas se donner une capacité de CE.

## Groupes de permissions

La première partie d'une clé est son groupe. La clé `sinkhost.run` est dans le groupe `sinkhost`.

- Le premier plugin qui installe une clé dans un groupe possède ce groupe pour toujours. CE enregistre l'identifiant du plugin et la clé d'éditeur qui a signé le paquet. Une installation non signée n'enregistre aucun éditeur.
- Aucun autre identifiant de plugin ne peut déclarer de clé dans ce groupe. Le même identifiant signé par une autre clé d'éditeur non plus, ni non signé quand le propriétaire était signé. Cela vaut même après le retrait du propriétaire, pour qu'un nouveau plugin ne reprenne pas les droits laissés par l'ancien.
- CE garde ses propres groupes, comme `forms`, `patients` et `reports`. Une clé de plugin dans l'un d'eux est refusée, pour qu'aucun plugin ne détienne une permission que CE ajoutera plus tard.
- Une installation refusée ne change rien. La version installée avant reste active.
- Si vous signez avec une nouvelle clé d'éditeur, votre plugin perd ses groupes. Demandez à l'administrateur de déplacer le groupe à la main. CE n'a pas encore de commande pour cela.

## La permission que demande chaque action

`actionPermissions` associe un point d'entrée aux permissions qui l'ouvrent. L'appelant a besoin de l'une d'elles.

```json
"actionPermissions": {
  "health_check": ["sinkhost.run"],
  "host_ce_read": ["sinkhost.run", "patients.find"],
  "host_fhir_emit": ["forms.edit"]
}
```

- Chaque entrée nomme un point d'entrée de `payload.entrypoints` et liste de 1 à 10 permissions. Jusqu'à 100 entrées.
- Une permission listée est une clé du plugin ou une capacité de CE. Lister une capacité de CE la demande seulement à l'appelant. Le plugin ne la reçoit pas.
- **Fermé par défaut.** Dès qu'un plugin a `actionPermissions`, CE refuse chaque point d'entrée qu'il ne liste pas. Une page qui appelle un point d'entrée non listé reçoit une erreur, et le wasm ne s'exécute pas.
- Un plugin sans `actionPermissions` garde l'ancienne règle. Un appelant qui passe le contrôle des rôles du plugin peut lancer n'importe quel point d'entrée.
- CE lit ce champ dans le manifeste enregistré de la version active, jamais dans l'appel.
- Une action qui appelle `fhir_emit` demande sa propre permission, comme toute autre. `fhir_emit` refuse toujours un appelant limité à certains établissements.

Le refus nomme l'action et les permissions qui l'ouvrent. Il est en anglais, par exemple `the action host_fhir_emit of plugin test-sink-host needs one of these permissions: Edit forms`.

## Qui reçoit les permissions

- **Administrator.** Le rôle Administrator reçoit toutes les permissions d'un plugin quand le plugin est installé, activé ou ramené à une version antérieure. CE vérifie aussi à chaque démarrage, pour un plugin installé avant cette version.
- **Les autres rôles** ne reçoivent rien d'eux-mêmes. Un administrateur donne les permissions sur la page Roles, ou avec `openldr roles`. L'étape `role` d'un pack de profil peut aussi les lister, quand le plugin est installé avant.
- **Le retrait et la désactivation gardent les droits.** Le rôle garde la clé. `openldr roles doctor` la liste comme conservée. Le rôle reste modifiable, et un enregistrement garde la clé. La clé n'ouvre rien tant que le plugin est absent.
- **La réinstallation** rend les clés conservées à nouveau connues. Les rôles qui les avaient peuvent lancer les actions tout de suite.

## Pages et menu latéral

`payload.ui.requiredRoles` et `payload.ui.requiredCapabilities` décident qui voit le plugin. Un utilisateur voit l'entrée du menu latéral, et ouvre `/x/<id>`, seulement s'il a l'un des rôles ou l'une des capacités. Taper l'adresse ne contourne pas ce contrôle. Un plugin sans aucune des deux listes est ouvert à tous.

`requiredCapabilities` peut nommer les clés du plugin. Un utilisateur admis par une capacité peut lancer les actions du plugin quand le plugin a `actionPermissions`. Le contrôle des actions décide alors de chaque appel. Le stockage du plugin (`storage.*`) reste fermé à cet utilisateur. Il demande l'un des rôles du plugin.

La page reçoit les capacités de l'utilisateur connecté dans son contexte d'initialisation, clés du plugin comprises. Servez-vous-en seulement pour montrer ou cacher des onglets. C'est une copie pour l'affichage. Le broker du serveur vérifie chaque appel.

Une mise en page de profil peut lister une page de plugin par son chemin, par exemple `"pages": ["/forms", "/x/test-sink-host"]`. Quand une mise en page est active, l'entrée du plugin n'apparaît que si la mise en page la liste. Une mise en page ne fait que cacher. Elle n'ouvre jamais une page que les capacités de l'utilisateur n'ouvrent pas. `startPage` peut aussi valoir `/x/<id>`.

## Trouver un patient avec patients.find

`patients.find` est une capacité de CE pour les utilisateurs qui doivent trouver un patient sans parcourir la liste. Le studio l'affiche sous le nom **Find a patient**, en anglais dans toutes les langues. Un utilisateur limité à certains établissements la garde, et perd `patients.view`. Parmi les rôles prédéfinis, seul Administrator l'a.

Par `ce_read`, un appelant qui a `patients.find` sans `patients.view` :

- `patients.search` prend un identifiant exact, `{ "identifier": { "system": "...", "value": "..." } }`, où `system` est facultatif. Ou il prend ensemble `given`, `family` et une `birthDate` complète (`YYYY-MM-DD`). Un nom doit correspondre en entier, sans tenir compte de la casse. Une partie d'un nom ou d'un identifiant ne trouve rien. Une recherche libre `search` est refusée avec `FORBIDDEN`.
- Les résultats viennent seulement des établissements de l'appelant.
- `patients.get` ne rend un patient que dans les établissements de l'appelant. Tout autre répond `NOT_FOUND`.
- `patients.register` accepte `patients.view` ou `patients.find`.
- Les identifiants restent masqués sauf si l'appelant a `patients.view_identifiers`.

Un appelant qui a `patients.view` peut aussi chercher par identifiant, ou par nom avec date de naissance, mais pas dans le même appel que `search`.

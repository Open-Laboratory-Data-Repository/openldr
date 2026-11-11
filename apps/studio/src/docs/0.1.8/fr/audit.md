# Audit

**Audit** enregistre qui a modifié quoi, et quand : flux de travail, formulaires, utilisateurs, rôles, rapports, connecteurs, paramètres, patients consultés, et plus. Chaque événement a un acteur, une action, l'objet touché, et souvent une copie de cet objet avant et après.

Les connexions et déconnexions sont gérées par Keycloak, pas par OpenLDR, qui ne voit jamais le mot de passe. Vous les trouvez dans la console d'administration de Keycloak, sous **Realm**, **Events**. Ce journal enregistre les authentifications refusées (`auth.failed`) et chaque action d'opérateur, y compris en ligne de commande, avec le type d'acteur `cli`.

Ce guide prend environ 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Audit : les événements les plus récents d'abord, avec Quand, Acteur, Action, Type d'entité et ID d'entité.](audit-tour.png)

## Qui peut faire quoi

Une seule autorisation couvre cette page : **View audit log**. Elle ne fait que lire. Rien ici ne peut modifier ni supprimer un événement.

## Avant de commencer

L'exemple retrouve les modifications du flux **Ingest**. Si vous avez suivi [Flux de travail, exemple 1](/docs/workflows#exemple-1-preparer-le-webhook-ingest), il y en a au moins une. Sinon, prenez n'importe quel événement visible.

## Exemple 1 : qui a modifié le flux Ingest ?

![Filtrer sur ID d'entité wf-ingest et ouvrir l'événement le plus récent.](audit-filter-workflow.mp4)

1. Ouvrez **Audit**. Les événements les plus récents sont en haut.
2. Sélectionnez **Filtrer**, puis **Ajouter un filtre**.
3. Réglez la colonne sur **ID d'entité**, l'opérateur sur **Contient**, et la valeur sur `wf-ingest`.
4. Sélectionnez **Appliquer**. Une pastille sous la barre d'outils montre le filtre.
5. Sélectionnez la ligne la plus récente.

**Résultat attendu :** un événement `workflow.update` pour chaque enregistrement d'Ingest, par la personne qui l'a enregistré. La fiche montre l'identifiant de l'événement, l'heure, l'acteur, l'action, le type d'entité `workflow` et l'identifiant `wf-ingest`, puis **Before** : le flux tel qu'il était.

![Un événement : qui, quoi, quand, et le flux avant la modification.](audit-event.png)

Chaque valeur a un bouton de copie, pour coller un identifiant dans un autre filtre ou un autre écran.

## Filtrer, trier et colonnes

- **Filtrer** ajoute des règles : une colonne, un opérateur et une valeur. Les colonnes de texte proposent **Égal à**, **Différent de**, **Contient** et d'autres. **Quand** propose des dates et des plages.
- Chaque règle s'affiche en pastille sous la barre d'outils. Retirez une pastille pour enlever une règle, ou utilisez **Tout effacer**.
- **Trier** classe par n'importe quelle colonne, dans un sens ou l'autre.
- **Colonnes** masque et affiche des colonnes. **Réinitialiser** remet le tableau par défaut.
- Le filtrage, le tri et la pagination se font sur le serveur, donc un grand journal reste rapide.

Pour suivre une chaîne de modifications, partez de l'entité, ajoutez l'acteur, puis comparez les heures des événements de création, modification, exécution, publication et suppression.

## Actions utiles à connaître

| Action | Ce qui s'est passé |
| --- | --- |
| `workflow.create`, `workflow.update`, `workflow.delete` | Un flux a été créé, enregistré ou supprimé |
| `dashboard.create`, `dashboard.update`, `dashboard.delete` | Un tableau de bord a été créé, enregistré ou supprimé |
| `customQuery.create`, `customQuery.delete` | Une requête enregistrée a été créée ou supprimée |
| `role.create`, `role.delete`, `role.capability.backfill` | Un rôle a été créé ou supprimé, ou a reçu une nouvelle capacité à une mise à jour |
| `settings.flag.update` | Un réglage comme **SQL brut pour les tableaux de bord** a été changé |
| `patients.list`, `patients.view` | Quelqu'un a listé ou ouvert des patients |
| `user.status`, `user.status.failed` | Un compte a été activé ou désactivé, ou la tentative a échoué |
| `auth.failed` | Un jeton de connexion a été refusé |

## En ligne de commande

`openldr audit list` accepte les mêmes filtres et le même tri que la page, donc un script peut refaire n'importe quelle vue.

- `--where column:operator:value` peut être répété. Seuls les deux premiers deux-points séparent la valeur, donc une valeur peut contenir un deux-points, comme un identifiant ou une URL.
- `--sort column` trie croissant, `--sort -column` trie décroissant. Il peut être répété.
- Sur la colonne du temps, `eq` avec une date seule comme `2026-08-06` couvre toute la journée. `between` avec deux dates seules inclut tout le dernier jour.

La même recherche que l'exemple 1 :

```bash
./openldr audit list --where entityId:like:wf-ingest --sort -occurredAt
```

Tous les événements de formulaires, du plus récent au plus ancien :

```bash
./openldr audit list --where action:like:form. --sort -occurredAt
```

Une colonne inconnue, ou un opérateur que cette colonne n'accepte pas, est refusé avec un message qui nomme le problème. C'est la même vérification que sur la page.

## Dépannage

- **Aucun événement n'apparaît.** Élargissez la période, ou retirez un filtre à la fois.
- **L'acteur est inattendu.** Un flux planifié ou une action du système a peut-être fait la modification.
- **Avant et après sont vides.** Certains événements notent l'action sans copie complète.
- **Trop d'événements.** Combinez un filtre sur l'entité et un filtre sur l'acteur.
- **Je ne trouve pas une connexion.** Les connexions réussies sont dans les événements de Keycloak, pas ici.

## Guides associés

- [Utilisateurs et rôles](/docs/users)
- [Flux de travail](/docs/workflows)
- [Activité](/docs/activity)

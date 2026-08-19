# Audit

Audit aide les administrateurs et les responsables à retracer les changements visibles par les utilisateurs dans les flux de travail, les formulaires, les utilisateurs, les rapports, les connecteurs et les paramètres.

> **Historique des connexions :** Les connexions et déconnexions réussies sont gérées par Keycloak, pas par OpenLDR — l'application ne voit jamais le mot de passe. Retrouvez-les dans la console d'administration Keycloak sous **Realm → Events**. Ce journal enregistre les échecs d'authentification (`auth.failed`) et les actions des opérateurs — y compris les actions CLI, affichées avec le type d'acteur `cli`.

## Résultat

Vous pouvez ouvrir Audit, appliquer des filtres, inspecter un événement, interpréter les champs acteur/action/entité/heure, copier des identifiants et retracer un changement à travers des événements liés.

![Tableau Audit avec filtres et colonne d'horodatage](audit-filter.png)

## Avant de commencer

- Connaître approximativement l'heure, l'acteur, l'entité ou l'action à investiguer.
- Utiliser des filtres restreints d'abord quand le volume d'événements est élevé.

## Étapes

1. Ouvrir **Audit**.
2. Utiliser le bouton **Filtrer** de la barre d'outils pour ajouter une règle : choisir une colonne, un opérateur et une valeur.
3. Utiliser **Trier** pour ordonner le tableau par n'importe quelle colonne triable, en ordre croissant ou décroissant.
4. Utiliser **Colonnes** pour afficher ou masquer des colonnes ; utiliser **Réinitialiser** pour revenir aux réglages par défaut.
5. Les filtres actifs apparaissent sous forme de puces amovibles sous la barre d'outils — en retirer un sans rouvrir la fenêtre de filtre.
6. Le filtrage, le tri et la pagination s'exécutent tous côté serveur, ce qui garde les journaux d'audit volumineux rapides.
7. Sélectionner une ligne d'événement, par exemple une mise à jour de flux de travail ou de formulaire.
8. Examiner l'acteur, l'action, l'entité et l'heure.
9. Copier des identifiants quand une comparaison avec un autre écran est nécessaire.
10. Inspecter les détails avant/après quand ils sont disponibles.
11. Suivre les événements liés en réutilisant l'acteur, l'entité ou l'identifiant comme un autre filtre.

![Détail d'un événement Audit avec acteur, entité et données avant/après](audit-event-detail.png)

## Résultat attendu

Vous pouvez expliquer qui a changé quoi, quand cela s'est produit, quelle entité a été affectée et quels événements voisins peuvent faire partie de la même activité.

## Dépannage

- **Aucun événement n'apparaît :** élargir la plage de temps ou retirer les filtres un par un.
- **L'acteur est inattendu :** vérifier si un flux de travail planifié ou une action système a effectué le changement.
- **Les détails avant/après sont vides :** certains événements enregistrent l'action sans instantané complet de l'objet.
- **Trop d'événements liés :** combiner les filtres d'entité et d'acteur pour restreindre la séquence.

## Usage web avancé

Combiner les filtres pour suivre une activité en plusieurs étapes : commencer par l'entité, ajouter l'acteur, puis comparer les horodatages entre les événements de mise à jour, d'exécution, de publication ou de suppression.

## Ligne de commande

`openldr audit list` prend en charge la même grammaire de filtre et de tri que la barre d'outils web, ce qui permet à un script de reproduire n'importe quelle vue construite dans le navigateur.

- `--where column:operator:value` — répétable. Seuls les deux premiers deux-points sont des délimiteurs, une valeur peut donc elle-même contenir un deux-points (un identifiant d'entité ou une URL, par exemple).
- `--sort column` — croissant. `--sort -column` — décroissant (tiret en préfixe). Répétable.
- Sur la colonne d'horodatage, `eq` avec une date seule (`2026-08-06`, sans heure) correspond à toute la journée, pas à un seul instant. `between` avec deux dates seules inclut le dernier jour en entier.

```bash
openldr audit list --where action:like:form. --sort -occurredAt
```

Cette commande liste les événements d'audit dont `action` contient `form.`, du plus récent au plus ancien.

Une colonne inconnue ou un opérateur non autorisé sur cette colonne est rejeté avec un message qui nomme précisément l'erreur — la même validation que la barre d'outils web utilise, si bien qu'un indicateur mal saisi échoue de la même façon qu'un filtre mal saisi dans le navigateur.

## Guides associés

- [Utilisateurs et rôles](/docs/users)
- [Flux de travail](/docs/workflows)

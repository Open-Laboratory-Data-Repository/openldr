# Commencer ici

OpenLDR Studio est l'endroit où se rejoignent les résultats d'un laboratoire. Vous les lisez dans des tableaux de bord et des rapports, vous les interrogez, et vous réglez la façon dont les données arrivent. Cette page vous fait faire le tour et vous propose une première heure sur une nouvelle installation, avec les données d'exemple chargées.

Sélectionnez une image ou un clip pour l'agrandir.

![Studio après la connexion. 1 Menu principal. 2 Notifications. 3 Clair ou sombre. 4 Votre menu utilisateur. 5 Replier le menu.](start-here-tour.png)

1. **Menu principal.** Une entrée par domaine. Vous ne voyez que les domaines permis par votre rôle.
2. **Notifications.** La cloche ouvre vos dernières notifications.
3. **Clair ou sombre.** Change le thème de couleurs.
4. **Menu utilisateur.** Votre nom, en bas à gauche. Il contient **Langue**, **Paramètres** et **Se déconnecter**.
5. **Replier le menu.** Réduit le menu principal à des icônes, pour laisser plus de place aux pages.

Le bouclier jaune à côté de la cloche n'apparaît que sur une installation de test où la connexion est désactivée. Une vraie installation ne l'affiche pas.

## Le menu principal

| Entrée du menu | À quoi elle sert | Guide |
| --- | --- | --- |
| Tableau de bord | Des graphiques et des chiffres qui se mettent à jour seuls | [Tableaux de bord](/docs/dashboard) |
| Rapports | Des rapports imprimables à exécuter, exporter et planifier | [Rapports](/docs/reports) |
| Concepteur de rapports | Les modèles de ces rapports | [Concepteur de rapports](/docs/report-designer) |
| Requête | Parcourir l'entrepôt et écrire du SQL | [Requêtes personnalisées](/docs/query) |
| Flux de travail | Comment les données arrivent, sont vérifiées et enregistrées | [Flux de travail](/docs/workflows) |
| Terminologie | Les systèmes de codes, comme LOINC, et vos correspondances | [Terminologie](/docs/terminology) |
| Établissements | Le registre des établissements de santé | [Établissements](/docs/facilities) |
| Catalogue des examens | La liste nationale des examens, et ceux que ce laboratoire fait | [Catalogue des examens](/docs/test-catalog) |
| Patients | Trouver un patient et où il a été testé | [Patients](/docs/patients) |
| Formulaires | Saisir des données à la main, et créer les formulaires | [Formulaires](/docs/forms) |
| Utilisateurs | Qui peut se connecter, et avec quels rôles | [Utilisateurs et rôles](/docs/users) |
| Audit | Qui a changé quoi, et quand | [Audit](/docs/audit) |
| Activité | Chaque envoi de données pendant son traitement | [Activité](/docs/activity) |
| Documentation | Ce manuel | Cette page |

**Paramètres** est dans le menu utilisateur, pas dans le menu principal. Voir [Paramètres](/docs/settings).

Une entrée manquante veut dire que votre rôle ne la comprend pas. Demandez à un administrateur.

## Votre première heure

Faites-le sur une installation de test. Chaque étape renvoie au guide complet.

1. **Chargez les données d'exemple.** Une nouvelle installation n'a presque pas de données de laboratoire, donc chaque chiffre vaut 0. Chargez le fichier d'exemple. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).
2. **Lisez le tableau de bord d'exemple.** Ouvrez **Tableau de bord**. Total Orders affiche 60. Filtrez-le sur octobre 2026. Voir [Tableaux de bord](/docs/dashboard).
3. **Exécutez un rapport.** Ouvrez **Rapports** et exécutez **Test Volume Over Time** pour septembre et octobre 2026. Voir [Rapports](/docs/reports).
4. **Regardez les données brutes.** Ouvrez **Requête** et parcourez `lab_requests`. Voir [Requêtes personnalisées](/docs/query).
5. **Construisez quelque chose.** Créez votre propre tableau de bord avec un graphique en barres. Voir [Tableaux de bord](/docs/dashboard#exemple-2-creer-un-tableau-de-bord-et-un-graphique-en-barres).

## Exemple 1 : changer de langue

Studio parle anglais, français et portugais.

![Ouvrir le menu utilisateur, puis Langue, puis Français.](start-here-language.mp4)

1. Sélectionnez votre nom en bas à gauche.
2. Sélectionnez **Langue**.
3. Choisissez **English**, **Français** ou **Português**.

**Résultat attendu :** le menu et la plupart des écrans changent tout de suite. Certains libellés ne sont pas encore traduits et restent en anglais. Les guides écrivent chaque libellé tel qu'il s'affiche à l'écran. La documentation passe aussi dans cette langue. Une page pas encore traduite s'affiche en anglais, avec une note en haut.

Votre choix est gardé dans ce navigateur.

## Exemple 2 : trouver une réponse dans la documentation

![Chercher sample data dans la documentation, ouvrir Tableaux de bord et sauter à une section.](start-here-docs.mp4)

1. Ouvrez **Documentation**.
2. Tapez dans la zone de recherche, par exemple `sample data`. La liste de gauche se réduit aux guides qui correspondent.
3. Sélectionnez un guide. Les guides longs listent leurs sections à droite, sous **On this page**. Sélectionnez-en une pour y aller.

Sur un écran étroit, la liste des sections est un bouton avec une icône de liste, en haut à droite de la page.

### Télécharger la documentation

![Le menu de téléchargement : cette page ou toute la documentation.](start-here-docs-download.png)

Le bouton de téléchargement en haut à droite enregistre **This page** ou **All docs** en **Markdown**, **PDF** ou **Word**. Les clips s'impriment comme une image fixe en PDF et en Word.

**Version**, à côté, affiche la documentation d'une version plus ancienne.

## Filtrer n'importe quel tableau

La plupart des listes ont la même barre d'outils.

- **Rechercher** trouve au fil de la frappe.
- **Filtrer** permet de choisir une colonne, un opérateur et une valeur, puis **Appliquer**.
- **Trier** change l'ordre.
- **Colonnes** masque et affiche des colonnes.
- Retirez une pastille de filtre pour effacer une règle, ou utilisez **Tout effacer**.

Chaque tableau a une pagination en bas, avec le nombre de lignes par page.

## Les actions sont dans le menu à trois points

Studio range les actions dans un menu marqué de trois points, pas dans des boutons isolés. Cherchez-le en haut à droite d'une page, sur chaque ligne d'un tableau, et en haut d'un panneau latéral. **Enregistrer** dans un panneau latéral est en général dans ce menu aussi.

## Sur un téléphone

Des personnes utilisent Studio sur leur téléphone. Le menu principal est replié derrière le bouton de menu en haut à gauche.

![Le menu principal ouvert sur un téléphone.](start-here-phone-menu.png)

1. Sélectionnez le bouton de menu en haut à gauche.
2. Choisissez une page. Le menu se ferme.

Les pages avec une liste latérale, comme **Rapports** et **Requête**, commencent avec cette liste repliée. La section **Sur un téléphone** de chaque guide explique comment l'ouvrir.

## Dépannage

- **Une page manque dans le menu.** Votre rôle ne la comprend pas. Demandez à un administrateur de vérifier vos autorisations.
- **Chaque chiffre vaut 0.** L'installation n'a pas encore de données de laboratoire. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).
- **Un bouton est grisé.** Il lui manque quelque chose, souvent un filtre obligatoire ou un choix dans une liste.
- **Certains libellés sont en anglais après avoir choisi le français.** Ces libellés ne sont pas encore traduits.
- **Une image est trop petite.** Sélectionnez-la pour l'agrandir.
- **La recherche trouve trop de choses.** Cherchez la tâche, ou le texte exact de l'erreur.

## Déployer et faire tourner OpenLDR

L'installation, la configuration, les mises à jour et la ligne de commande sont décrites sur le site web d'OpenLDR. Voir [Documentation de déploiement et de développement](/docs/advanced-docs).

## Guides associés

- [Tableaux de bord](/docs/dashboard)
- [Rapports](/docs/reports)
- [Documentation de déploiement et de développement](/docs/advanced-docs)

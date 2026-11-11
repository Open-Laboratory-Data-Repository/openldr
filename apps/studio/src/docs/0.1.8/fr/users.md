# Utilisateurs et rôles

**Utilisateurs** liste les personnes qui peuvent se connecter, leur statut et leur rôle. Les administrateurs s'en servent pour ajouter des personnes, donner un rôle à chacune, et activer ou désactiver un accès.

La connexion elle-même est gérée par le fournisseur d'identité, en général Keycloak. OpenLDR décide de ce qu'une personne connectée peut faire, par son rôle. Les rôles sont décrits dans [Rôles](/docs/roles).

Ce guide prend environ 15 minutes. Sélectionnez une image pour l'agrandir.

![Utilisateurs : les comptes du fournisseur d'identité, avec recherche, statut et colonnes.](users-tour.png)

## Qui peut faire quoi

Les noms des autorisations s'affichent en anglais.

| Autorisation | Ce qu'elle permet |
| --- | --- |
| View users | Ouvrir **Utilisateurs** et voir les comptes. |
| Manage users | Créer, modifier, activer et désactiver des comptes. |
| Reset passwords | Réinitialiser un mot de passe ou envoyer un e-mail de réinitialisation. |
| Force logout | Fermer toutes les sessions actives d'une personne. |
| Manage roles | Nécessaire aussi pour enregistrer un rôle sur un utilisateur. |

L'administrateur les a toutes.

## La liste

1. Ouvrez **Utilisateurs**. La liste commence par les comptes actifs.
2. Tapez dans **Rechercher un identifiant, nom ou e-mail**. La recherche porte sur tout l'annuaire, pas seulement la page affichée.
3. **Statut** passe des comptes **Actif** aux comptes désactivés, ou à **Tous les statuts**.
4. **Colonnes** choisit ce que la liste affiche.

La liste suit l'ordre du fournisseur d'identité. Chaque page contient au plus 100 comptes. Le bas de page montre la plage affichée sans total, comme **1–2 (total inconnu)**, car le fournisseur n'en donne pas. Utilisez **Suivant** pour la suite. Les filtres et le tri par colonne ne sont pas disponibles, car le fournisseur ne les gère pas. Des comptes ajoutés ou retirés pendant que vous paginez peuvent décaler les pages.

Le menu à trois points en haut à droite a **Nouvel utilisateur** et **Actualiser**.

## Exemple 1 : donner un rôle à quelqu'un

![Le menu d'une ligne : Modifier, Désactiver, Réinitialiser le mot de passe, Envoyer un e-mail de réinitialisation, Forcer la déconnexion.](users-row-menu.png)

1. Sur la ligne de la personne, ouvrez le menu à trois points.
2. Sélectionnez **Modifier**. La fiche **Modifier l'utilisateur** s'ouvre.

![La fiche Modifier l'utilisateur : rôle, prénom, nom et e-mail.](users-edit-sheet.png)

3. Attendez le chargement de **Rôle**, puis choisissez un rôle. Chaque personne a un seul rôle. En choisir un autre le remplace.
4. Changez **Prénom**, **Nom de famille** ou **E-mail** si besoin.
5. Ouvrez le menu à trois points de la fiche et enregistrez.
6. Vérifiez le message de réussite. Rouvrez la personne pour voir le rôle enregistré.

Si la fiche affiche une erreur d'attribution de rôle, elle reste ouverte. Corrigez l'erreur avant de considérer le changement comme fait.

Choisissez le rôle qui a le moins de capacités tout en permettant à la personne de travailler. Si aucun rôle ne convient, créez-en un d'abord. Voir [Rôles, exemple 1](/docs/roles#exemple-1-creer-un-role-en-lecture-seule).

## Exemple 2 : ajouter une personne

1. Ouvrez le menu à trois points en haut à droite et sélectionnez **Nouvel utilisateur**.
2. Remplissez l'identifiant, le nom et l'e-mail.
3. Choisissez un rôle.
4. Enregistrez, et vérifiez le message de réussite.

Un nouveau compte sans rôle ne peut rien faire. Donnez-lui toujours un rôle.

## Désactiver ou activer un accès

Ouvrez le menu de la ligne et sélectionnez **Désactiver**, ou **Activer** sur un compte désactivé.

- La désactivation écrit d'abord un blocage local dans OpenLDR, puis met à jour le fournisseur d'identité.
- La requête suivante de la personne renvoie `403 account disabled`, même avec un jeton émis avant. Un écran déjà ouvert dans son navigateur peut rester visible.
- Les comptes qui ne se sont jamais connectés reçoivent aussi le blocage local.
- L'activation met d'abord à jour le fournisseur, puis lève le blocage local.
- Si une étape échoue, l'action signale une erreur. Une désactivation ratée peut laisser le fournisseur actif alors qu'OpenLDR bloque l'accès. Une activation ratée peut laisser le fournisseur actif alors que le blocage local reste. Réparez la connexion et refaites la même action.
- Si un autre changement de statut de ce compte est en cours, la réponse est `409`. Attendez et réessayez. C'est aussi le cas quand Studio et la ligne de commande changent le même compte en même temps.

Le journal d'audit note `user.status` en cas de réussite et `user.status.failed` en cas d'échec.

## Mots de passe et sessions

- **Réinitialiser le mot de passe** donne un nouveau mot de passe à la personne.
- **Envoyer un e-mail de réinitialisation** lui envoie un lien de réinitialisation.
- **Forcer la déconnexion** ferme toutes ses sessions d'un coup.

Ces actions dépendent du fournisseur d'identité. Elles peuvent manquer pour des comptes qu'il ne laisse pas gérer par OpenLDR.

## Sur un téléphone

La liste des utilisateurs marche sur un téléphone.

![Utilisateurs sur un téléphone.](users-phone.png)

## En ligne de commande

```bash
./openldr users list
./openldr user deactivate <local-id>
./openldr user activate <local-id>
./openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

- `users list` liste les comptes locaux et leurs identifiants locaux.
- `deactivate` et `activate` mettent à jour les deux systèmes pour un compte lié, par son identifiant chez le fournisseur. Un compte créé seulement dans OpenLDR change localement. Le journal d'audit nomme l'auteur `cli`.
- `directory-list` lit l'annuaire du fournisseur. Son JSON contient `rows`, `offset`, `limit`, `total: null` et `hasMore`. Ajoutez `limit` à `offset` tant que `hasMore` est vrai. Omettez `--enabled` pour les deux statuts.

Quand l'administration du fournisseur n'est pas configurée, la liste montre les comptes locaux. La recherche locale trouve l'identifiant, le nom affiché et l'e-mail n'importe où dans le texte, et les résultats sont triés par identifiant.

## Dépannage

- **Accès refusé.** Le rôle de la personne n'a pas la capacité demandée par la page ou l'action.
- **Une page manque dans le menu de quelqu'un.** Son rôle ne la comprend pas.
- **Les actions de réinitialisation manquent.** Le compte est peut-être géré par le fournisseur d'identité.
- **Une personne désactivée voit encore un ancien écran.** Le contenu déjà chargé reste. Sa requête suivante est bloquée.
- **Quelqu'un garde son ancien accès après un changement de rôle.** Demandez-lui de se déconnecter puis de se reconnecter, ou attendez que sa session se renouvelle.
- **Un nouveau compte ne peut rien faire.** Il n'a pas encore de rôle.

## Guides associés

- [Rôles](/docs/roles)
- [Audit](/docs/audit)
- [Paramètres](/docs/settings)

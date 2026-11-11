# Rôles

Un **rôle** est un ensemble nommé de **capacités**. Une capacité est une autorisation précise, comme **Run reports** ou **Edit workflows**. Chaque personne reçoit un rôle, et le serveur vérifie ses capacités avant chaque page et chaque action.

La connexion est gérée par le fournisseur d'identité, en général Keycloak. Les rôles, non. Chaque rôle, capacité et attribution vit dans la base d'OpenLDR, donc le contrôle d'accès marche de la même façon quel que soit le fournisseur d'identité.

Ce guide prend environ 10 minutes. Sélectionnez une image ou un clip pour l'agrandir. Les noms des rôles fournis et des capacités s'affichent en anglais.

![Paramètres, Rôles : les cinq rôles fournis.](roles-tour.png)

## Qui peut faire quoi

Il faut **Manage roles** pour créer, modifier ou supprimer des rôles. **View roles** permet de les ouvrir et de lire leurs capacités. L'administrateur a les deux.

## Les rôles fournis

| Rôle | À quoi il sert |
| --- | --- |
| Administrator | Toutes les capacités. **Verrouillé** : il ne peut être ni modifié ni supprimé, pour que quelqu'un puisse toujours rétablir l'accès. |
| Lab Manager | Tableaux de bord, rapports, formulaires, flux de travail, terminologie et requêtes. Ni utilisateurs ni paramètres. |
| Data Analyst | Voir les tableaux de bord, exécuter et exporter les rapports, utiliser les requêtes. Rien à modifier. |
| System Auditor | Lecture seule sur les grands domaines, plus le journal d'audit. |
| Lab Technician | Saisie à la paillasse : ouvrir et envoyer des formulaires, rien d'autre. |

Les capacités des rôles fournis, sauf Administrator, peuvent être changées. Un rôle ne peut pas être supprimé tant que des personnes l'ont.

Les capacités sont regroupées par domaine : Dashboards, Reports, Forms, Workflows, Query, Users, Facilities, Patients, Roles, Terminology, Marketplace, Connectors, Sync, Settings, Observability et Audit.

## Exemple 1 : créer un rôle en lecture seule

Créez un rôle pour une personne qui ne fait que lire les tableaux de bord et exécuter des rapports.

![Créer Dashboard viewer avec trois capacités.](roles-create.mp4)

1. Ouvrez **Paramètres**, puis **Rôles**.
2. Ouvrez le menu à trois points en haut à droite et sélectionnez **Créer un rôle**.
3. Dans **Nom**, tapez `Dashboard viewer`. **Identifiant** se remplit seul. Vous pouvez le changer avant d'enregistrer, il est fixé ensuite.
4. Dans **Description**, écrivez à quoi sert le rôle, par exemple `Reads dashboards and runs reports. Changes nothing.`
5. Sous **Capacités**, activez **View dashboards**, **View reports** et **Run reports**. Le compteur au-dessus de la liste montre combien sont actives.
6. Ouvrez le menu à trois points de la fiche et sélectionnez **Créer**.

**Résultat attendu :** un message de réussite, et le rôle dans la liste avec **0 membres**.

Pour donner ce rôle à quelqu'un, voir [Utilisateurs et rôles, exemple 1](/docs/users#exemple-1-donner-un-role-a-quelqu-un).

Pour changer un rôle plus tard, ouvrez le menu de sa ligne et sélectionnez **Modifier**. **Supprimer** retire un rôle sans membres. Changer un rôle partagé le change pour tous ceux qui l'ont.

## Comment les capacités arrivent sur une installation existante

Les nouvelles versions ajoutent des capacités. Les rôles vivent dans la base, donc un rôle créé par une ancienne version ne connaît pas seul une capacité plus récente. OpenLDR règle cela à chaque démarrage :

- **Administrator** reçoit toujours la liste complète au redémarrage suivant. Il est verrouillé et veut dire « toutes les capacités », il n'y a donc rien à préserver.
- **Les autres rôles fournis** reçoivent une nouvelle capacité seulement la première fois qu'elle existe. Ensuite, OpenLDR ne la redonne jamais. Si vous retirez une capacité à Lab Manager, elle reste retirée après les redémarrages et les mises à jour.
- **Les rôles que vous avez créés ne sont jamais modifiés.** Accordez-leur vous-même une nouvelle capacité.

Une capacité accordée ainsi est notée dans le journal d'audit comme `role.capability.backfill`.

Pour comparer votre installation aux définitions fournies :

```bash
./openldr roles doctor
```

Il liste, pour chaque rôle fourni, les capacités détenues, celles que vous avez retirées exprès et celles encore en attente, plus les clés de capacité laissées par une fonction retirée.

## En ligne de commande

```bash
./openldr roles list
./openldr roles show <slug>
./openldr roles create <name>
./openldr roles grant <slug> <capability>
./openldr roles revoke <slug> <capability>
./openldr roles delete <slug>
./openldr user assign-role <subject> <slug>
```

`roles create` accepte aussi `--slug`, `--desc`, et `--caps` avec des capacités séparées par des virgules. Par exemple, le rôle de l'exemple 1 :

```bash
./openldr roles create "Dashboard viewer" --slug dashboard_viewer \
  --desc "Reads dashboards and runs reports. Changes nothing." \
  --caps dashboards.view,reports.view,reports.run
```

## Dépannage

- **Les capacités d'un rôle ne peuvent pas être changées.** C'est Administrator, qui est verrouillé, ou il vous manque **Manage roles**. Vous pouvez quand même l'ouvrir pour lire ses capacités.
- **Un rôle ne peut pas être supprimé.** C'est un rôle fourni verrouillé, ou des personnes l'ont encore. Donnez-leur d'abord un autre rôle.
- **Quelqu'un garde son ancien accès après un changement de rôle.** Demandez-lui de se déconnecter puis de se reconnecter, ou attendez que sa session se renouvelle.
- **Un nouveau compte ne peut rien faire.** Il n'a pas encore de rôle. Un compte sans rôle n'a aucune capacité.

## Guides associés

- [Utilisateurs et rôles](/docs/users)
- [Audit](/docs/audit)
- [Paramètres](/docs/settings)

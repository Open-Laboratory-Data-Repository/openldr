# Exposition des données

**Paramètres → Exposition des données** décide quelles colonnes supplémentaires le **Builder** des tableaux de bord peut proposer quand quelqu'un joint une autre table, par exemple le sexe du patient ou le site de prélèvement de l'échantillon. Masquez une colonne ici et elle disparaît du Builder pour tout le monde.

Elle ne couvre pas tout. Lisez [Ce que la page ne couvre pas](#ce-que-la-page-ne-couvre-pas) avant de compter sur elle pour garder une colonne privée.

Comptez 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Exposition des données : la table Patient, chaque colonne avec son badge DPI et un interrupteur Visible ou Masquée.](data-exposure-tour.png)

## Qui peut faire quoi

Une seule capacité couvre cette page : **Manage data exposure**. Sans elle, la page n'apparaît pas dans les Paramètres.

## Ce que montre la page

La page liste sept tables. Chaque ligne est une colonne, avec un interrupteur : activé veut dire **Visible**, désactivé veut dire **Masquée**.

| Table | Colonnes | Masquées sur une installation neuve | Marquées DPI |
| --- | --- | --- | --- |
| Patient | 18 | 13 | 8 : noms, date de naissance, identifiant national, téléphone, e-mail, GUID du patient, clé de rapprochement |
| Specimen | 13 | 7 | aucune |
| Request | 30 | 8 | `clinical_info` |
| Facility | 12 | 3 | aucune |
| Report | 20 | 5 | aucune |
| Facility Map | 16 | 2 | aucune |
| Test Map | 9 | 1 | aucune |

**DPI** veut dire données à caractère personnel. Un badge rouge **DPI** marque ces colonnes. Elles sont masquées au départ.

## Exemple 1 : masquer une colonne

Masquez la colonne `sex` du patient, puis remettez-la.

![Désactiver sex dans la table Patient et enregistrer depuis le menu Exposition des données.](data-exposure-hide.mp4)

1. Ouvrez **Paramètres**, puis **Exposition des données**.
2. Sous **Patient**, trouvez `sex`. Elle est **Visible**.
3. Désactivez-la. Elle devient **Masquée**. **Modifications non enregistrées** s'affiche.
4. Ouvrez le menu à trois points de la page et sélectionnez **Enregistrer**. **Politique des colonnes enregistrée** s'affiche.

**Résultat attendu :** `sex` reste **Masquée** après un rechargement de la page.

Les changements restent sur votre écran seulement, jusqu'à **Enregistrer**. **Annuler les modifications**, dans le même menu, jette les changements non enregistrés et recharge les valeurs enregistrées. Si **Enregistrer** signale une erreur, ne supposez pas qu'un changement a été gardé. Rechargez et vérifiez.

Pour la remettre, activez `sex` et sélectionnez de nouveau **Enregistrer**.

## Exemple 2 : voir la colonne disparaître du Builder

Faites-le pendant que `sex` est encore masquée par l'Exemple 1.

1. Ouvrez **Tableaux de bord** et modifiez un widget, ou ajoutez-en un. Voir [Tableaux de bord, Exemple 1](/docs/dashboard#exemple-1-creer-un-widget-de-demandes-par-examen).
2. Dans le Builder, sélectionnez **Join data**. Réglez la table sur **Patient**.
3. Regardez les colonnes Patient proposées.

**Résultat attendu :** la liste propose `managing_organization`, `active`, `source_system` et `created_at`. `sex` a disparu. Rendez-la visible, enregistrez et rouvrez l'éditeur de widget : `sex` est de nouveau proposée.

Un widget enregistré avant avec `sex` cesse de s'exécuter dès que vous la masquez. Le serveur refuse sa requête, car la colonne n'est plus permise.

## Rendre visible une colonne DPI

Activer une colonne avec un badge **DPI** demande d'abord : **Rendre** *nom* **visible ?** Sélectionnez **Rendre visible** seulement si cette colonne est vraiment utile dans le Builder. Sélectionnez ensuite **Enregistrer**.

## Ce que la page ne couvre pas

Cette page contrôle les colonnes supplémentaires que le Builder propose dans **Join data**. Elle les contrôle quand la colonne est choisie, quand la requête s'exécute et quand la requête est convertie en SQL. Ce n'est pas un filtre sur tous les champs que renvoie OpenLDR.

Elle ne s'applique **pas** :

- **Aux champs intégrés du Builder.** Les champs que chaque modèle de données propose par défaut restent disponibles.
- **Aux widgets SQL.** Le SQL brut lit tout ce que le compte de base de données peut lire.
- **À une requête du Builder convertie en SQL.** Une fois convertie, elle ne suit plus les changements faits ensuite sur cette page.
- **Aux requêtes personnalisées, aux rapports qui en dépendent, aux données du Concepteur de rapports et aux nœuds de base de données des workflows.** Ils exécutent tous du SQL via les [Connecteurs](/docs/connectors). Ils ignorent cette page, même quand le connecteur pointe vers la base OpenLDR.

Pour garder une colonne privée sur ces chemins, limitez plutôt le compte de base de données. Donnez au compte de chaque connecteur, et au compte des widgets SQL, l'accès aux seules tables, colonnes ou vues approuvées. Les contrôles de lecture seule et les limites de lignes ne masquent aucune colonne.

Masquer une colonne ne supprime pas les données déjà stockées, ni les fichiers déjà exportés.

## Vérifier le bon chemin

- Testez avec des données non sensibles.
- Un état **Masquée** enregistré prouve seulement que le choix a été enregistré. Vérifiez le Builder à part, comme dans l'Exemple 2.
- Vérifiez à part les widgets SQL et les rapports sur connecteurs. Pour un connecteur, exécutez une requête avec son compte sur une vue approuvée et sur une colonne interdite.
- Vérifiez le rapport final avant de le partager.

## En ligne de commande

```bash
./openldr data-exposure list
./openldr data-exposure hide patients sex
./openldr data-exposure show patients sex
```

`hide` et `show` prennent un nom de table et un ou plusieurs noms de colonnes. Un serveur en marche ne voit un changement fait en ligne de commande qu'après le prochain enregistrement sur cette page, ou un redémarrage. Redémarrez le conteneur api pour l'appliquer tout de suite.

## Sur un téléphone

La page fonctionne sur un téléphone. Chaque ligne garde le nom de la colonne à gauche et son interrupteur à droite. Ouvrez **Exposition des données** depuis la rangée des pages des Paramètres en haut. C'est la dernière, donc faites glisser la rangée sur le côté.

## Dépannage

- **Une colonne masquée apparaît encore dans le Builder.** Fermez et rouvrez l'éditeur de widget. Si vous l'avez changée en ligne de commande, redémarrez le conteneur api.
- **Un widget échoue maintenant.** Il utilise une colonne que vous avez masquée. Rendez-la visible ou changez le widget.
- **Un rapport montre encore une colonne masquée.** Le rapport passe par un connecteur, que cette page ne couvre pas. Limitez le compte de base de données du connecteur.
- **L'enregistrement échoue.** Rechargez la page pour voir ce qui a été gardé, puis réessayez.
- **La page manque dans les Paramètres.** Il vous faut **Manage data exposure**.

## Guides associés

- [Paramètres](/docs/settings)
- [Tableaux de bord](/docs/dashboard)
- [Requêtes personnalisées](/docs/query)
- [Connecteurs](/docs/connectors)
- [Rapports](/docs/reports)

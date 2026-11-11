# Laboratoire

**Paramètres → Laboratoire** dit qui est votre laboratoire : le nom, l'adresse, le contact et le logo imprimés en en-tête de chaque rapport. La page règle aussi le registre des établissements proposé par défaut et le fuseau horaire du laboratoire.

Comptez 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **View settings** | Ouvrir la page Laboratoire |
| **Edit general settings** | Enregistrer ses modifications |

Toute personne qui peut voir les rapports voit l'en-tête qu'ils portent.

## Exemple 1 : régler l'en-tête

![Saisir le nom, l'adresse, le contact et le fuseau horaire du laboratoire, puis enregistrer depuis le menu à trois points.](laboratory-identity.mp4)

1. Ouvrez **Paramètres**, puis **Laboratoire**.
2. Dans **Nom du laboratoire**, tapez `Sample Central Laboratory`.
3. Dans **Adresse**, tapez `1 Sample Road, Sample City`. Appuyez sur Entrée pour aller à la ligne.
4. Dans **Contact**, tapez `lab@example.org`. Un numéro de téléphone ou une ligne d'accréditation convient aussi.
5. Dans **Fuseau horaire**, tapez `Africa/Dar_es_Salaam`. Mettez votre propre fuseau sur une vraie installation.
6. Ouvrez le menu à trois points de la page et sélectionnez **Enregistrer**. Le message **Enregistré.** s'affiche.
7. Rechargez la page et vérifiez que les valeurs sont toujours là.

Rien n'est enregistré avant **Enregistrer**. Cela vaut aussi pour un nouveau logo ou un logo effacé. Si **Enregistrer** signale une erreur, gardez la page ouverte, corrigez la valeur et enregistrez de nouveau.

### Le logo

1. Sélectionnez **Choisir un fichier…** et prenez une image PNG, JPEG ou WebP de moins de 256 Ko. Un aperçu s'affiche à côté du bouton.
2. Sélectionnez **Enregistrer** dans le menu à trois points.

**Effacer** retire le logo. Enregistrez pour garder ce changement. Le logo doit être un fichier image envoyé, pas une adresse web, car une image liée ne s'imprime pas dans le PDF. Il est lu à chaque rapport, d'où la limite de taille.

## Exemple 2 : voir l'en-tête sur un rapport

Cet exemple a besoin des données d'exemple de la documentation. Voir [Tableaux de bord, Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).

1. Ouvrez **Rapports** et sélectionnez **Test Volume Over Time**.
2. Ouvrez le menu à trois points, sélectionnez **Paramètres**, et réglez **Date range** du 1er septembre 2026 au 31 octobre 2026.
3. Sélectionnez **Exécuter**.

**Résultat attendu :** le rapport s'ouvre avec votre en-tête en haut : le logo, **Sample Central Laboratory**, l'adresse et le contact. En dessous viennent le titre, la période et un tableau de 10 lignes, une par examen et par mois.

![L'en-tête en haut de Test Volume Over Time : logo, nom, adresse et contact.](laboratory-letterhead.png)

| Month | Test | Count |
| --- | --- | --- |
| 2026-09 | Full blood count | 10 |
| 2026-09 | Malaria rapid test | 8 |
| 2026-10 | HIV viral load | 8 |

Ce sont 3 des 10 lignes. Ensemble, les lignes font 60, le nombre de demandes de l'exemple.

**Télécharger** enregistre un PDF avec le même en-tête. Les sorties CSV et XLSX ne contiennent que les données. Voir [Rapports, Exemple 1](/docs/reports#exemple-1-executer-un-rapport) pour toutes les étapes.

### L'en-tête dans vos propres modèles

Un modèle de rapport peut placer chaque partie de l'en-tête par son nom. La page liste les quatre noms sous son titre :

| Nom | Imprime |
| --- | --- |
| `{{lab.name}}` | Nom du laboratoire |
| `{{lab.address}}` | Adresse |
| `{{lab.contact}}` | Contact |
| `{{lab.logo}}` | Logo |

Voir le [Concepteur de rapports](/docs/report-designer) pour construire un modèle.

## Choisir un registre des établissements

**Registre des établissements** liste les sources actives enregistrées dans [Établissements](/docs/facilities). Celle que vous choisissez devient le **Système** de départ quand quelqu'un crée un établissement à la main.

Choisissez le registre auquel appartiennent vos codes d'établissement. Son adresse de système sépare ces codes de ceux d'un autre registre.

Enregistrer ce choix n'importe aucun établissement. Cela ne renomme pas, ne déplace pas et ne change pas les codes des établissements existants.

Si le registre voulu manque :

1. Ouvrez [Établissements](/docs/facilities), lancez **Importer des établissements** et enregistrez la source.
2. Revenez au Laboratoire et rechargez la page.
3. Sélectionnez-le dans **Registre des établissements** et enregistrez.

Une liste vide peut aussi vouloir dire que le chargement des sources a échoué. Vérifiez Établissements avant de conclure qu'il n'en existe aucune.

## Fuseau horaire

Le fuseau horaire décide du jour auquel un résultat appartient dans un rapport. Un résultat à 01:00 à Dar es Salaam tombe encore la veille en UTC.

- Tapez un fuseau nommé, comme `Africa/Dar_es_Salaam`. Les décalages fixes sont refusés. `+03:00` est refusé. `Etc/GMT+3` l'est aussi, car il veut dire UTC−3, l'inverse de ce qu'il semble dire.
- Il fixe la valeur de départ du filtre **Time zone** de chaque rapport. Vous pouvez encore la changer pour une exécution.
- Une exécution planifiée ou en ligne de commande ne le lit pas. Donnez le fuseau directement à la planification ou à la commande. Voir [Rapports](/docs/reports).
- Il ne règle pas l'heure à laquelle tournent les planifications.
- **Entrepôt SQL Server :** laissez-le vide. SQL Server attend des noms de fuseau Windows, que ce champ refuse. Tapez le fuseau Windows dans le filtre **Time zone** à chaque exécution du rapport.

## En ligne de commande

`openldr settings lab` lit et écrit les mêmes valeurs que la page.

```bash
./openldr settings lab show
./openldr settings lab set --name "Sample Central Laboratory" --timezone Africa/Dar_es_Salaam
./openldr settings lab set --logo-file ./logo.png
```

- `--address` accepte `\n` pour un retour à la ligne.
- Une valeur vide efface un champ, par exemple `--timezone ""`.
- `--logo-file` accepte un fichier PNG, JPEG ou WebP sous la même limite de 256 Ko.

Le registre des établissements se règle seulement sur la page.

## Sur un téléphone

La page fonctionne sur un téléphone. Les libellés restent à gauche des champs, et les champs se rétrécissent. **Choisir un fichier…** ouvre le sélecteur de fichiers du téléphone, donc le logo peut venir des photos ou des fichiers.

## Dépannage

- **Mes changements ont disparu après un rechargement.** Ils n'étaient pas enregistrés. Utilisez **Enregistrer** dans le menu à trois points et attendez **Enregistré.**
- **Le fuseau horaire ne s'enregistre pas.** Utilisez un fuseau nommé comme `Africa/Dar_es_Salaam`, pas un décalage.
- **Le logo est refusé.** Il doit être en PNG, JPEG ou WebP et faire moins de 256 Ko.
- **Le rapport affiche encore l'ancien nom.** Exécutez de nouveau le rapport. Un résultat déjà affiché ou exporté garde l'en-tête avec lequel il a été produit.
- **La liste des registres est vide.** Enregistrez une source dans Établissements, puis rechargez cette page.
- **Impossible d'enregistrer l'identité du laboratoire.** Lisez d'abord le message sous le champ. S'il n'y en a pas, votre rôle n'a peut-être pas **Edit general settings**.

## Guides associés

- [Paramètres](/docs/settings)
- [Rapports](/docs/reports)
- [Concepteur de rapports](/docs/report-designer)
- [Établissements](/docs/facilities)

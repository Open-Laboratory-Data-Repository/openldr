# Catalogue des examens

Le catalogue des examens est la liste nationale des examens. Chaque examen a un code, un nom, une catégorie, les types de prélèvement qu'il accepte et, s'il en a un, un code LOINC. Un examen sans code LOINC affiche **Sans LOINC**.

Ouvrez **Catalogue des examens** dans la barre latérale. Il faut la permission de consulter la Terminologie pour le voir, et celle de la gérer pour modifier quoi que ce soit.

## Qui modifie quoi

Une installation qui n'a pas reçu son catalogue du site central en est propriétaire. Elle peut ajouter des examens, les modifier, les retirer et les rétablir. Un laboratoire autonome est son propre site central.

Un laboratoire qui reçoit le catalogue du site central ne peut pas modifier ses examens. La page l'indique au-dessus du tableau. Le laboratoire peut toujours activer ou désactiver des examens, restreindre leurs prélèvements et définir un nom local. La synchronisation ne renvoie jamais ces réglages.

## Trouver des examens

La recherche porte sur le code, le nom, le nom court et le nom local. Utilisez **Filtrer** pour la catégorie, LOINC, **Activé ici** et le statut. Les examens retirés sont masqués, sauf si vous filtrez sur eux.

## Ajouter et modifier un examen

1. Choisissez **Ajouter un examen** dans le menu ⋯, ou **Modifier** dans le menu ⋯ d'une ligne.
2. Saisissez le code. Laissez-le vide pour utiliser le code LOINC. Un code ne change plus après l'enregistrement.
3. Saisissez le nom, et un nom court si vous le souhaitez.
4. Choisissez une catégorie et cochez les types de prélèvement que l'examen accepte.
5. Saisissez le code LOINC. Si LOINC est chargé ici, vous le recherchez. Sinon vous le tapez, et seul son format est vérifié.
6. Sous **Ce laboratoire**, activez l'examen, décochez les prélèvements que ce laboratoire ne prend pas et définissez un nom local.
7. Choisissez **Enregistrer** dans le menu ⋯ en haut du panneau.

Les types de prélèvement viennent de la liste des types de prélèvement de CE. Les catégories viennent de **Test categories** sur la page Terminologie.

## Actions sur une ligne

Le menu ⋯ de chaque ligne active ou désactive l'examen dans ce laboratoire. Si cette installation est propriétaire du catalogue, il retire ou rétablit aussi l'examen. Le retrait est réversible, il ne demande donc pas de confirmation.

En ligne de commande : `openldr test-catalog enable`, `disable`, `retire` ou `restore`, suivi du code.

## Importer une liste d'examens

Si cette installation est propriétaire du catalogue, choisissez **Importer** dans le menu ⋯. Le panneau a quatre étapes. Retour, Suivant, Appliquer et Fermer sont dans son menu ⋯. Rien n'est écrit avant **Appliquer**.

1. **Fichier.** Déposez un fichier CSV ou Excel (.xlsx), ou cliquez pour en choisir un. CE lit la première feuille d'un fichier Excel. Un fichier contient au plus 5 000 examens et 5 Mo.
2. **Colonnes.** CE associe les en-têtes aux champs. Vérifiez chacun. Le nom est obligatoire. Un champ réglé sur **Absent du fichier** ne change pas sur les examens déjà au catalogue. Une cellule vide dans une colonne choisie efface ce champ.
3. **Valeurs.** Les textes de catégorie et de prélèvement sont rapprochés des listes par code ou par nom, sans tenir compte de la casse ni des espaces. Une cellule de prélèvement peut en contenir plusieurs, séparés par `;`. Choisissez ce que signifie chaque texte sans correspondance. Une catégorie peut être ajoutée : son code part du texte, et vous pouvez le changer. Une ligne dont un texte reste sans choix est refusée.
4. **Vérification.** CE indique combien d'examens sont nouveaux, modifiés, inchangés et refusés, chaque refus avec sa ligne et son motif, et les catégories qu'il ajoutera. Choisissez **Appliquer** pour tout écrire en une fois.

Les examens sont rapprochés par leur code : importer deux fois le même fichier ne change rien. Un examen absent du fichier n'est pas retiré. Un import ne change jamais le statut d'un examen ni les réglages de ce laboratoire. Si LOINC n'est pas chargé ici, seul le format des codes LOINC est vérifié, et la vérification le signale.

## Exporter le catalogue

Choisissez **Exporter en CSV** dans le menu ⋯. Toute installation peut exporter, y compris un laboratoire qui reçoit le catalogue du site central. Le fichier contient les examens actifs dans les colonnes qu'un import lit : `code`, `name`, `short_name`, `loinc`, `category` et `specimen_types`. Modifiez-le dans un tableur et importez-le à nouveau. Une valeur qui commence par `=` ou `@` reçoit un `'` en tête, pour qu'un tableur ne l'exécute pas comme une formule.

En ligne de commande : `openldr test-catalog import <fichier>` montre ce qui changerait, et `--apply` l'écrit. `openldr test-catalog export` écrit le CSV.

## La demande d'examens

Le champ **Tests** de la demande d'examens liste les examens de ce laboratoire : les examens du catalogue activés ici, sous le nom local s'il y en a un. Un examen retiré quitte la liste. Activez des examens avant toute demande : le champ est obligatoire, et une liste vide ne laisse passer aucune demande.

Chaque examen porte son propre prélèvement. Ouvrez la ligne d'un examen et choisissez parmi les prélèvements que cet examen accepte, selon la liste plus courte de ce laboratoire s'il en a fixé une. La demande n'a plus de champ prélèvement séparé.

Une demande envoyée donne d'abord le code LOINC de chaque examen, s'il en a un, puis son code du catalogue. Les rapports qui lisent le premier code d'une demande continuent de trouver LOINC. Un examen sans code LOINC est envoyé sous son code du catalogue.

Une installation dont la demande d'examens a été modifiée dans l'éditeur de formulaires garde son propre champ Tests. Pour utiliser cette liste, choisissez le jeu de valeurs `urn:openldr:valueset:lab-tests` pour ce champ dans l'éditeur. En ligne de commande, `openldr terminology expand urn:openldr:valueset:lab-tests` affiche la liste que propose le champ Tests.


## Paramètres de résultat

Un examen peut nommer les paramètres de résultat qu'il produit : hémoglobine, numération CD4, lecture d'un TDR du paludisme. Les paramètres viennent du dictionnaire de résultats de cette installation, donc rien ne se saisit à la main. Cochez-en un dans le panneau de l'examen, puis indiquez si son résultat est un nombre, un code d'une liste, ou du texte libre.

Un paramètre numérique peut porter des intervalles de référence. Chaque intervalle a une borne basse, une borne haute, une unité, et un nom facultatif, par exemple Femmes des hauts plateaux. Il peut aussi nommer un sexe et une tranche d'âge. Le menu ⋯ de la ligne d'un intervalle le monte, le descend ou le supprime, et le menu ⋯ du paramètre en ajoute un. L'ordre décide quel intervalle est sélectionné au départ à la paillasse. Deux intervalles d'un même paramètre ne peuvent pas porter le même nom. Un examen sans paramètre fonctionne toujours : son panneau ne demande qu'un prélèvement.

En ligne de commande, `openldr test-catalog params <code>` affiche les paramètres d'un examen, et `--set <fichier>` les remplace depuis un fichier JSON.

## Associer les codes de test du laboratoire

Chaque système de laboratoire nomme ses tests à sa façon. DISA appelle la charge virale `HIVVL`, `POCVR` ou `POHVL`. Associez chacun de ces codes au test du catalogue qu'il désigne, et les rapports peuvent compter le test du catalogue quel que soit le nom donné par le laboratoire.

Ouvrez l'onglet **Observés**. Il liste tous les codes de test de l'entrepôt, avec leur description, le nombre de demandes et la date où ils ont été vus pour la dernière fois. Un code associé avant l'arrivée des données s'affiche avec 0 demande. Filtrez par **Sans correspondance**, **Avec correspondance** ou **Ambigu**.

Pour associer un code, ouvrez le menu ⋯ de sa ligne et choisissez **Associer à un test du catalogue**. Choisissez le test, puis **Enregistrer** dans le menu ⋯ du panneau. **Supprimer la correspondance**, dans le même menu, l'enlève.

Les codes sont comparés comme le fait la base de données de l'entrepôt. Sur Postgres, la comparaison est exacte : `HIVVL` et `HIVVL ` (avec une espace à la fin) sont deux codes. Sur MSSQL et MySQL avec leurs réglages par défaut, majuscules et minuscules comptent pour pareil, et MSSQL ignore aussi les espaces à la fin. Sur MSSQL et MySQL, deux correspondances dont les codes ne diffèrent que par la casse (`HIVVL` et `hivvl`) entrent en conflit dans `test_map`, et chaque reconstruction échoue tant que l'une n'est pas supprimée. N'associez qu'une seule des deux.

Un code est **Ambigu** quand il a deux correspondances avec le catalogue, par exemple une faite sur la page Terminologie et une faite ici. Les rapports l'ignorent tant que vous ne l'avez pas associé de nouveau. Quand le central a associé un code, c'est la correspondance du central que les rapports utilisent, et celle du laboratoire pour ce code est ignorée.

Un laboratoire ne peut pas modifier une correspondance envoyée par le central. Sa ligne indique **Du central**.

### Associer plusieurs codes à la fois

**Exporter en CSV**, dans le menu ⋯ de l'onglet, écrit tous les codes observés. Remplissez `catalog_code`, ou `loinc` quand vous ne connaissez que le code LOINC, puis **Importer un CSV**. L'import montre les lignes nouvelles, modifiées, inchangées et refusées avant d'écrire quoi que ce soit. Une ligne où les deux colonnes sont vides reste inchangée. Une ligne est refusée quand l'entrepôt ne contient ce code qu'avec des espaces autour, car le lecteur de fichier supprime les espaces des cellules. Associez ce code dans l'onglet Observés ou avec `openldr test-catalog map set`. Dans un laboratoire, une ligne dont le code est associé par le central est refusée, sauf si elle demande la correspondance que le central a déjà.

### Rapports

Les correspondances sont copiées dans la table d'entrepôt `test_map`. Un rapport la joint ainsi :

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
where tm.loinc = '25836-8'
group by tm.catalog_name
```

La copie se met à jour quand une correspondance ou un test du catalogue change, et au démarrage. Si une mise à jour échoue, l'onglet l'indique. Choisissez **Reconstruire la copie de l’entrepôt** dans son menu ⋯.

## Associer les codes de résultat du laboratoire

Un examen donne plusieurs résultats, et chaque système de laboratoire les nomme aussi à sa façon. Les résultats de charge virale de DISA arrivent sous `HIVVL`, `HIVVC`, `POCVR` et d'autres. Associez chaque code de résultat au champ de résultat qu'il désigne, et un rapport peut choisir le résultat d'après ce qu'il est.

Les champs de résultat viennent du dictionnaire de résultats du site. Importez-en un avec `openldr terminology import parameters <fichier>`. L'onglet **Champs de résultat** liste chaque champ avec son rôle, ses unités et son code LOINC. Pour lier un champ à LOINC, ouvrez le menu ⋯ de sa ligne, choisissez **Lier un LOINC**, choisissez ou saisissez le code, puis **Enregistrer** dans le menu ⋯ du panneau. **Exporter en CSV** et **Importer un CSV**, dans le menu ⋯ de l'onglet, lient plusieurs champs à la fois, avec les colonnes `code` et `loinc`. Un `loinc` vide laisse le lien inchangé. Un laboratoire qui reçoit son dictionnaire du central ne peut pas modifier les liens.

Dans l'onglet **Observés**, choisissez **Résultats** pour lister les codes de résultat de l'entrepôt, avec leur nombre de résultats. Associez un code depuis le menu ⋯ de sa ligne avec **Associer à un champ de résultat**. Sur un site DISA, la plupart des codes de résultat sont identiques aux codes du dictionnaire. **Associer les codes identiques**, dans le menu ⋯ de l'onglet, les associe tous d'un coup. Choisissez le système de laboratoire, vérifiez la liste, puis choisissez **Associer ces codes**. Seuls les codes sans correspondance sont associés. Un code que le central a associé, ou un code **Ambigu**, reste tel quel.

Le CSV des résultats a les colonnes `system, code, description, results, parameter_code, loinc`. Remplissez `parameter_code`, ou `loinc` quand vous ne connaissez que lui.

Les résultats saisis dans CE n'ont pas besoin de correspondance. Ils portent déjà les codes du dictionnaire, et la copie de l'entrepôt associe chaque champ à lui-même. Il en va de même pour les demandes saisies dans CE : chaque test du catalogue est associé à lui-même.

Un rapport qui compte les copies de charge virale entre laboratoires joint `test_map` ainsi :

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

Un pack de contenu peut fournir des correspondances de résultats avec une étape `result-mappings`. Chaque entrée nomme un code de laboratoire et un code LOINC, et l'installation associe le code au seul champ de résultat lié à ce code LOINC. Un code déjà associé ici est conservé.

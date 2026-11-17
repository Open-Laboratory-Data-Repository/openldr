# Mapper les données de laboratoire vers FHIR

<!-- operator-platform -->

Map to FHIR est un nœud de workflow. Dans le studio, ses paramètres ont pour titre « Mapper vers FHIR ». Il lit ce qu'un laboratoire envoie et en tire des enregistrements FHIR qu'OpenLDR stocke. Il reconnaît trois sortes d'entrée :

- Du FHIR, sous forme de Bundle, de liste de ressources ou de ressource seule. Le nœud le transmet sous forme de ressources.
- Des réponses à un formulaire accepté par le nœud. Le nœud les vérifie selon le formulaire et en tire des enregistrements.
- Les lignes propres à un laboratoire, comme celles d'un export CSV ou d'une liste JSON. Le nœud n'en tire des enregistrements que si une personne a enregistré dans le nœud un mappage pour ses colonnes.

Chaque ensemble d'enregistrements passe les contrôles d'OpenLDR au niveau de validation configuré. Ce que le nœud ne sait pas mapper, ou qui échoue à un contrôle, part sur sa sortie **retenus** avec une raison. Aucune donnée d'une ligne retenue n'est stockée.

## Quand l'utiliser

Utilisez-le quand un système de laboratoire envoie son propre export et ne sait pas envoyer du FHIR. Une personne mappe les colonnes une fois, dans le studio, sur un vrai échantillon. Ensuite, chaque nouveau fichier avec ces colonnes se mappe sans aide.

Sur une nouvelle installation, le workflow fourni **Ingest** l'utilise déjà. Son webhook, `/api/workflows/hooks/ingest`, envoie chaque requête vers Map to FHIR. **sortie** va vers **Persist store**. Rien n'est relié à **retenus**, et c'est voulu. Une installation mise en place avant cette version garde son ancien graphe Ingest. **Reset to default** sur le workflow Ingest donne le nouveau, et supprime toute modification faite à l'ancien.

Le guide intégré **Map to FHIR** montre pas à pas comment mapper un fichier.

Utilisez un nœud Map to FHIR par fichier de laboratoire. Une ligne n'est mappée que si un seul mappage enregistré du nœud connaît toutes ses colonnes. Quand deux mappages enregistrés conviennent à une ligne, le nœud la retient.

## Examiner un mappage avant de l'utiliser

Le studio montre chaque champ source et son exemple avant le libellé de destination et le chemin FHIR. Après **Tester**, le menu à points d'une ligne qui réussit propose **Voir le FHIR généré**. Il montre les ressources de cette ligne en JSON copiable, avec les valeurs converties et les liens entre ressources. Le test ne les enregistre pas. Modifier le mappage ou charger un autre échantillon efface les résultats précédents.

Le studio suggère une colonne pour un champ à partir du nom de la colonne. Une colonne imbriquée comme `patient.dob` est aussi lue par sa dernière partie, `dob`. Quand deux colonnes conviennent aussi bien à un champ, une colonne sous l'enregistrement du champ, comme `patient.dob` pour un champ du patient, l'emporte sur une colonne sous un autre, comme `mother.dob`. Une égalité que les noms ne tranchent pas ne donne aucune suggestion, et l'ordre des colonnes ne décide jamais. Une colonne nommée comme un nom complet, par exemple `nom_complet`, n'est jamais suggérée pour Prénom ou Nom de famille. Une suggestion ne sert que si vous l'acceptez.

## Un fichier avec une colonne par examen

Une feuille de laboratoire ou un export WHONET a souvent une colonne par examen, par exemple une colonne par antibiotique. Pour le mapper :

1. Dans le panneau de mappage, choisissez la première colonne d'examen sur le champ de résultat.
2. Sélectionnez **Ajouter une autre colonne** et cochez les autres colonnes d'examen.
3. Vérifiez l'examen à côté de chaque colonne. Il commence par le nom de la colonne.
4. Pour changer les examens en codes standard, ajoutez une règle **Liste de codes** sur **Examen**.
5. Enregistrez le mappage, puis le workflow.

Chaque ligne donne alors un résultat pour chaque colonne d'examen qui a une valeur, lié au patient, à l'échantillon et à la demande de la ligne. Une cellule vide ne donne pas de résultat. Le mappage garde l'examen de chaque colonne comme configuration, jamais une valeur d'une ligne.

## Ce que voit l'émetteur

Le webhook répond pour l'exécution entière. Le workflow par défaut **Ingest** refuse un message entier dès qu'une partie ne peut pas être stockée. Comme rien n'est relié à **retenus**, une seule ligne retenue fait échouer le nœud et l'exécution, et Persist store ne s'exécute pas. Rien de ce message n'est stocké. L'émetteur reçoit HTTP 500 avec `ok: false`, l'identifiant de l'exécution et l'erreur `workflow execution failed; inspect the recorded run before resubmitting`. Les raisons ne sont pas dans la réponse. Elles sont dans l'exécution, sur le nœud Map to FHIR, dans **History**.

Une exécution terminée répond HTTP 200 avec `ok: true` et son `runId`.

Certains laboratoires veulent stocker les bonnes lignes d'un message et mettre les mauvaises de côté. Créez alors votre propre workflow et reliez **retenus** à un nœud Log ou à un autre nœud. Une exécution de ce workflow se termine et répond `ok: true`, même si des lignes ont été retenues. Consultez le nœud relié à **retenus** dans **History** pour les retrouver. Quand des lignes sont mises en attente, la ligne du run dans **History** montre un nombre comme **3 en attente** à côté de son statut. Un run peut se terminer avec toutes ses lignes en attente. Les lignes mises en attente dans une boucle comptent aussi. L'en-tête du run montre combien de lignes ont été mappées et mises en attente, et combien d'enregistrements Persist store a stockés.

## Essayer un mappage enregistré en ligne de commande

`workflows map-test` applique les mappages enregistrés d'un nœud Map to FHIR à une liste `.json` ou à un fichier `.csv`. La commande ne stocke rien. Sans `--json`, elle affiche des comptes et les raisons des lignes retenues, jamais une valeur de ligne. Elle lit le workflow enregistré, donc enregistrez d'abord le workflow dans le studio. Dans le workflow fourni Ingest, l'identifiant du workflow est `wf-ingest` et celui du nœud est `map-1`.

```sh
{{operator:data-map-test}}
```

![Essayer les mappages enregistrés d'un nœud Map to FHIR sur un fichier.](guide:operator-data-map-test)

La commande se termine avec 0 quand chaque ligne passe, et avec 1 quand une ligne est retenue. Elle vérifie chaque ligne seule, comme **Tester** dans le studio. Deux lignes qui donnent le même résultat avec d'autres valeurs y réussissent toutes deux, alors qu'une exécution retient la seconde. Avec `--json`, elle affiche le résultat de chaque ligne, enregistrements compris, donc avec les valeurs de la ligne. Une exécution sur un CSV lit chaque cellule comme du texte, sans les espaces autour, et laisse de côté les cellules vides. **Extract from File** avec **Read every cell as text** activé donne les mêmes lignes, mais garde ces espaces.

## Limites

- Une ligne sans identifiant patient est retenue.
- La même ligne envoyée deux fois donne les mêmes enregistrements, pas des copies. Chaque identifiant d'enregistrement vient des identifiants de la ligne. Celui du patient utilise l'identifiant patient et son système. Celui de l'échantillon ajoute le numéro d'échantillon ou, à défaut, la date de prélèvement. Celui de la demande ajoute son code d'examen s'il est mappé. Celui du résultat ajoute l'examen et, si elle est mappée, la date du résultat. Quand le champ Examens demandés de la demande n'est pas mappé, la demande prend les codes d'examen de tous ses résultats de l'exécution, chacun une fois, et son identifiant ne change pas. Une exécution suivante les remplace par ses propres codes.
- Dans une même exécution, les lignes qui donnent le même patient, le même échantillon ou la même demande font un seul enregistrement, et une ligne suivante ne remplit que ce qu'une ligne précédente a laissé vide. Un fichier avec moins de colonnes envoyé lors d'une exécution suivante remplace l'enregistrement stocké, et les champs qu'il n'a pas deviennent vides. History garde l'ancienne version. Une deuxième ligne d'une même exécution qui donne le même résultat avec d'autres valeurs est retenue : `this row gives a result that an earlier row of this run already gave, with other values`.
- Un patient déjà stocké sous un autre identifiant avec le même identifiant patient, par exemple depuis un formulaire, reçoit un deuxième enregistrement Patient. Rien ne cherche un patient par son identifiant patient avant l'enregistrement.
- Si un fichier mappe le système de l'identifiant patient et un autre non, un même patient reçoit deux enregistrements Patient. Mappez-le de la même façon dans chaque fichier, par exemple en valeur fixe. Sans lui, la détection des doublons ne peut pas comparer les patients par leur identifiant.
- Activez **Read every cell as text** sur **Extract from File** avant un nœud Map to FHIR. Chaque cellule CSV arrive alors comme le texte du fichier, et les règles **Nombre** et **Date** la lisent. Un nœud ajouté depuis la bibliothèque de nœuds a l'option activée, et un nœud enregistré avant cette version l'a désactivée. Sans elle, `12,5` arrive comme 125, `007` comme 7, et une date comme `01/12/2024` comme un numéro de jour, que la règle **Date** retient.
- Dans un fichier Excel, une cellule de date arrive comme un numéro de jour. La règle **Date** le lit avec **Une cellule de date Excel**, dans le système de dates 1900 habituel d'Excel seulement. Un classeur enregistré dans le système de dates 1904, sur un ancien Mac, donne des dates quatre ans et un jour trop tôt.
- Un texte simple dans un champ codé est stocké comme le code propre au laboratoire, sans système. Une règle **Liste de codes** stocke un code standard, et un code choisi dans une règle **Valeurs** est stocké avec son système. La liste de codes du laboratoire demande un système source sur la règle ; sans lui, aucun code ne correspond.
- La règle **Date** lit une date seule, sans heure.
- Un nombre entier envoyé sans guillemets et trop long pour être gardé exactement, au-delà de 9 007 199 254 740 991, comme un numéro d'échantillon à 19 chiffres, garde tous ses chiffres : le webhook le lit comme du texte et nomme le champ sous `notes` dans l'entrée du webhook de l'exécution. Un champ texte comme **Numéro d'échantillon** le stocke tel qu'envoyé. **Résultat (nombre)** le refuse et retient la ligne, car un nombre ne peut pas garder autant de chiffres exactement. Demandez à l'émetteur de mettre ces identifiants entre guillemets.
- Une colonne qui mêle nombres et texte, comme `12,5` à côté de `1:320`, demande la règle **Nombre ou texte** sur **Résultat (nombre)**. **Nombre** seul met en attente une ligne dont la valeur n'est pas un nombre. **Nombre ou texte** stocke le nombre en nombre et tout le reste en texte, exactement comme envoyé. Une unité n'est stockée qu'avec un nombre.
- Un motif de mise en attente sur une entrée d'une colonne de liste, comme `results.value`, dit laquelle, par exemple `(entry 2 of 4)`. Il ne montre jamais la valeur.
- Deux résultats d'une ligne avec le même test sont mis en attente, car ils feraient un seul enregistrement de résultat. Le motif nomme les deux entrées de la liste, comme `entries 1 and 3 of 4 in results.code`, ou les deux colonnes. Quand **Date du résultat** n'est pas mappée, il dit de la mapper : deux résultats d'un test avec des dates de résultat différentes restent séparés.
- Sur **Résultat (nombre)**, un `<`, `<=`, `>=`, `>`, `≤` ou `≥` au début est gardé comme comparateur. `≤` et `≥` sont stockés comme `<=` et `>=`.
- Le nœud ne lit pas les messages HL7 v2.
- Les raisons sont en anglais.

## Dépannage

Voici les raisons de rétention les plus fréquentes. La raison d'une règle commence par le nom de la colonne, et celle d'un contrôle par l'enregistrement en faute.

- **no mapping for this shape.** La ligne a une colonne qu'aucun mappage enregistré du nœud ne connaît. Mappez un échantillon qui contient cette colonne.
- **more than one saved mapping fits this row.** Deux mappages enregistrés du nœud connaissent toutes ses colonnes. Gardez un mappage par fichier, ou utilisez un nœud par fichier.
- **Patient ID is required and has no value.** La cellule de l'identifiant patient est vide. Le libellé dans la raison nomme le champ.
- **expected a date in the format dd/MM/yyyy.** La cellule ne suit pas le format de la règle **Date**. La raison donne le format que vous avez saisi.
- **value is not in the translation list.** Une règle **Valeurs** n'a pas de ligne pour cette valeur. Ajoutez-en une.
- **value has no match in the code list.** La règle **Liste de codes** n'a trouvé aucune correspondance pour la valeur. Avec la liste de codes du laboratoire, vérifiez que la règle nomme un système source.
- **more than one match in the code list.** Le code donne deux cibles dans la liste de codes.
- **not a FHIR Bundle this node can unwrap.** Le corps ressemble à du FHIR mais ne peut pas être découpé.
- **laboratory result must reference a ServiceRequest (basedOn).** Un résultat de laboratoire FHIR est arrivé sans demande. Envoyez la demande dans la même requête.
- **basedOn ServiceRequest not found in batch or store.** Un résultat de laboratoire FHIR nomme une demande introuvable. Elle n'est ni dans la même exécution, ni stockée.
- **nothing at body.** L'élément ne contient rien sous `body`, ou seulement une liste vide ou une valeur unique. Après Extract from File, laissez le chemin source vide. Après un webhook, vérifiez que l'émetteur envoie bien un corps.
- **not a row.** La liste sous le chemin source contient autre chose qu'une ligne, par exemple un nombre ou un texte.
- **held port is not connected.** C'est un échec de l'exécution, pas une raison de rétention. L'erreur donne jusqu'à cinq raisons. Dans **Ingest**, c'est ainsi qu'un message impossible à stocker est refusé. Dans votre propre workflow, reliez **retenus** à un nœud Log pour garder les bonnes lignes.

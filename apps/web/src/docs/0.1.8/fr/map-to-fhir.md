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

## Ce que voit l'émetteur

Le webhook répond pour l'exécution entière. Le workflow par défaut **Ingest** refuse un message entier dès qu'une partie ne peut pas être stockée. Comme rien n'est relié à **retenus**, une seule ligne retenue fait échouer le nœud et l'exécution, et Persist store ne s'exécute pas. Rien de ce message n'est stocké. L'émetteur reçoit HTTP 500 avec `ok: false`, l'identifiant de l'exécution et l'erreur `workflow execution failed; inspect the recorded run before resubmitting`. Les raisons ne sont pas dans la réponse. Elles sont dans l'exécution, sur le nœud Map to FHIR, dans **History**.

Une exécution terminée répond HTTP 200 avec `ok: true` et son `runId`.

Certains laboratoires veulent stocker les bonnes lignes d'un message et mettre les mauvaises de côté. Créez alors votre propre workflow et reliez **retenus** à un nœud Log ou à un autre nœud. Une exécution de ce workflow se termine et répond `ok: true`, même si des lignes ont été retenues. Consultez le nœud relié à **retenus** dans **History** pour les retrouver.

## Essayer un mappage enregistré en ligne de commande

`workflows map-test` applique les mappages enregistrés d'un nœud Map to FHIR à une liste `.json` ou à un fichier `.csv`. La commande ne stocke rien. Sans `--json`, elle affiche des comptes et les raisons des lignes retenues, jamais une valeur de ligne. Elle lit le workflow enregistré, donc enregistrez d'abord le workflow dans le studio. Dans le workflow fourni Ingest, l'identifiant du workflow est `wf-ingest` et celui du nœud est `map-1`.

```sh
{{operator:data-map-test}}
```

![Essayer les mappages enregistrés d'un nœud Map to FHIR sur un fichier.](guide:operator-data-map-test)

La commande se termine avec 0 quand chaque ligne passe, et avec 1 quand une ligne est retenue. Avec `--json`, elle affiche le résultat de chaque ligne, enregistrements compris, donc avec les valeurs de la ligne. Une exécution sur un CSV lit chaque cellule comme du texte, sans les espaces autour, et laisse de côté les cellules vides. **Extract from File** avec **Read every cell as text** activé donne les mêmes lignes, mais garde ces espaces.

## Limites

- Une ligne sans identifiant patient est retenue.
- La même ligne envoyée deux fois donne les mêmes enregistrements, pas des copies. Chaque identifiant d'enregistrement vient des identifiants de la ligne. Celui du patient utilise l'identifiant patient et son système. Celui de l'échantillon ajoute le numéro d'échantillon ou, à défaut, la date de prélèvement. Celui de la demande ajoute son code d'examen s'il est mappé. Celui du résultat ajoute l'examen et, si elle est mappée, la date du résultat.
- Dans une même exécution, les lignes qui donnent le même patient, le même échantillon ou la même demande font un seul enregistrement, et une ligne suivante ne remplit que ce qu'une ligne précédente a laissé vide. Un fichier plus pauvre envoyé lors d'une exécution suivante remplace encore l'enregistrement stocké. Une deuxième ligne d'une même exécution qui donne le même résultat avec d'autres valeurs est retenue : `this row gives a result that an earlier row of this run already gave, with other values`.
- Si un fichier mappe le système de l'identifiant patient et un autre non, un même patient reçoit deux enregistrements Patient. Mappez-le de la même façon dans chaque fichier, par exemple en valeur fixe. Sans lui, la détection des doublons ne peut pas comparer les patients par leur identifiant.
- Activez **Read every cell as text** sur **Extract from File** avant un nœud Map to FHIR. Chaque cellule CSV arrive alors comme le texte du fichier, et les règles **Nombre** et **Date** la lisent. Un nœud ajouté depuis la bibliothèque de nœuds a l'option activée, et un nœud enregistré avant cette version l'a désactivée. Sans elle, `12,5` arrive comme 125, `007` comme 7, et une date comme `01/12/2024` comme un numéro de jour, que la règle **Date** retient.
- Dans un fichier Excel, une cellule de date arrive comme un numéro de jour, que l'option soit activée ou non, et la règle **Date** retient la ligne. Enregistrez la feuille en CSV, ou mettez les cellules de date au format texte.
- Un texte simple dans un champ codé est stocké comme le code propre au laboratoire, sans système. Une règle **Liste de codes** stocke un code standard. La liste de codes du laboratoire demande un système source sur la règle ; sans lui, aucun code ne correspond.
- Un fichier avec une colonne par examen, par exemple une colonne par antibiotique, ne peut pas être mappé tel quel. Plusieurs colonnes sur un même champ répété demandent un code d'examen pour chacune, et un code unique partagé est refusé avec `Test: two Observation records in this row have the same value, so they would share one id`.
- La règle **Date** lit une date seule, sans heure.
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

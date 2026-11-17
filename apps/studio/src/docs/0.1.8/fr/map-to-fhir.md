# Map to FHIR

Map to FHIR est un nœud de workflow qui transforme les lignes propres à un laboratoire en enregistrements FHIR qu'OpenLDR peut stocker. Il transmet aussi le FHIR, transforme les réponses à un formulaire accepté en enregistrements, et retient avec une raison ce qu'il ne sait pas mapper. Les responsables de laboratoire le configurent une fois pour chaque fichier de laboratoire.

## Ajouter Map to FHIR à un workflow

La bibliothèque de nœuds nomme le nœud **Map to FHIR**. Ses paramètres et son panneau de mappage ont pour titre **Mapper vers FHIR**. Placez le nœud après l'étape qui fournit les lignes, par exemple un déclencheur **Webhook** ou **Extract from File**.

1. Ouvrez le workflow.
2. Dans la bibliothèque de nœuds, recherchez `Map to FHIR`.
3. Glissez **Map to FHIR** à côté de l'étape qui fournit les lignes.
4. Glissez le point à droite de cette étape vers le point à gauche de **Map to FHIR**.
5. Sélectionnez **Map to FHIR**, puis l'engrenage **Configure** au-dessus.
6. Renseignez **Chemin source**. Après un webhook, saisissez `body`. Après **Extract from File**, laissez-le vide.
7. Choisissez la **Cible**. **Lab result** est la cible fournie par OpenLDR.
8. Sous **Formulaires acceptés**, ajoutez un formulaire seulement si des émetteurs envoient des réponses à ce formulaire.

**Résultat attendu :** le nœud affiche deux sorties, **sortie** et **retenus**.

## Obtenir un échantillon

Le panneau mappe les colonnes d'un vrai échantillon. Obtenez-en un avant de choisir les colonnes.

1. Enregistrez le workflow.
2. Dans les paramètres du nœud, ouvrez le menu à points **Actions du nœud** et sélectionnez **Ouvrir le mappage**.
3. Ouvrez le menu à points **Actions du mappage**, en haut à droite du panneau.
4. Sélectionnez **Écouter**.
5. Dans la minute qui suit, envoyez un message au workflow depuis le système du laboratoire.

**Résultat attendu :** la ligne sous **Cible** compte les lignes de l'échantillon.

Pour utiliser une exécution déjà reçue, sélectionnez **Utiliser la dernière exécution enregistrée** à la place des étapes 4 et 5. Quand l'éditeur a sa propre exécution, le panneau la charge comme échantillon à l'ouverture. **Utiliser la dernière exécution de cet éditeur** la recharge.

**Écouter** s'arrête à la première nouvelle exécution qui donne des lignes à ce nœud, ou au bout d'une minute. Pour envoyer un message, postez-le à l'adresse du webhook du workflow, comme l'indique le guide Workflows. Pour envoyer un fichier, postez-le avec l'en-tête `Content-Type: application/octet-stream` à un workflow qui commence par un **Webhook** et **Extract from File**. Réglez alors le format d'Extract from File sur `csv` et activez **Read every cell as text**. Sur un workflow webhook, une exécution lancée dans l'éditeur n'a pas de corps et ne donne donc aucune ligne.

Le panneau garde les 20 premières lignes de l'échantillon. Il liste toutes les colonnes trouvées dans les lignes de l'échantillon, même une colonne remplie seulement après la 20e ligne. Une telle colonne n'a pas d'exemple.

Sans échantillon, le panneau montre le mappage enregistré du nœud, le plus large s'il y en a plusieurs. La liste **Mappage enregistré** en choisit un autre. Aucun exemple ne s'affiche, et aucune colonne n'est marquée comme absente, puisqu'il n'y a pas d'échantillon. Vous pouvez modifier le mappage et l'enregistrer. **Tester** demande un échantillon.

## Choisir une colonne pour chaque champ

Chaque ligne présente le champ source et son exemple, puis sa **Destination**. La destination affiche un libellé de laboratoire et son chemin FHIR. Vous pouvez mapper par le libellé sans saisir de chemin FHIR.

Chaque ligne du panneau est un champ de la cible. Une étoile marque un champ obligatoire. **Lab result** en demande trois : **Identifiant patient**, **Date de prélèvement** et **Examen**.

1. Sur la ligne d'un champ, ouvrez la liste sous **Depuis vos données** et choisissez la colonne qui le remplit.
2. Choisissez plutôt **Valeur fixe** quand toutes les lignes ont la même valeur, puis saisissez-la.
3. Laissez **Non mappé** sur un champ absent de votre fichier.
4. Pour un champ qui se répète, sélectionnez **Ajouter une autre colonne**, puis cochez chaque colonne à ajouter. Tapez dans **Filtrer les colonnes** pour réduire une longue liste. **Sélectionner toutes les colonnes affichées** coche chaque colonne de la liste.
5. Quand une ligne grise **Suggestion** propose une colonne, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** le panneau compte les champs obligatoires mappés et montre un exemple de l'échantillon à côté de chaque colonne choisie.

Une suggestion n'apparaît que sur un champ sans colonne. Le champ reste sans colonne tant que vous n'avez pas sélectionné **Accepter**.

## Mapper un fichier avec une colonne par examen

Une feuille de laboratoire ou un export WHONET a souvent une colonne par examen, par exemple `AMP`, `CIP` et `GEN`. Chaque cellule contient le résultat de cet examen.

1. Sur **Résultat (texte)**, ou sur le champ de résultat qui convient à vos valeurs, choisissez la première colonne d'examen sous **Depuis vos données**.
2. Sélectionnez **Ajouter une autre colonne** et cochez les autres colonnes d'examen.
3. Vérifiez l'examen à côté de chaque colonne. Il commence par le nom de la colonne. Tapez un autre examen quand le nom n'est pas le code voulu.
4. Laissez **Examen** tel quel. Il affiche **Défini pour chaque colonne sur Résultat (texte)**, avec le nom du vrai champ.
5. Pour changer les examens en codes standard, ajoutez une règle **Liste de codes** sur **Examen**. Elle s'applique à l'examen de chaque colonne.

**Résultat attendu :** chaque colonne apparaît sur sa propre ligne, avec son examen à côté. Une ligne donne alors un résultat pour chaque colonne d'examen qui a une valeur, tous liés au patient, à l'échantillon et à la demande de la ligne. Une cellule vide ne donne pas de résultat.

Une règle sur le champ de résultat s'applique à chaque colonne. Le panneau refuse d'enregistrer tant qu'un examen est vide, ou que deux colonnes ont le même examen. Un seul champ de résultat porte les examens. Un autre champ de résultat à plusieurs colonnes prend les examens des mêmes lignes, il lui faut donc le même nombre de colonnes. Quand vous revenez à une seule colonne, **Examen** retrouve sa propre liste de colonnes.

Mappez **Système de l'identifiant patient** de la même façon dans chaque fichier, par exemple en **Valeur fixe** avec le même texte à chaque fois. Sans lui, l'identifiant de l'enregistrement Patient ne vient que de l'identifiant patient. La détection des doublons ne peut pas non plus comparer ces patients par leur identifiant.

## Ajouter une règle à un champ

Utilisez une règle quand la cellule ne contient pas la valeur sous la forme attendue par FHIR.

1. Sur la ligne du champ, ouvrez la liste sous **Règle**.
2. Choisissez le type de règle.
3. Remplissez les réglages qui s'affichent sous la ligne.
4. Quand une ligne grise **Règle suggérée** apparaît, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** les réglages de la règle s'affichent sous la ligne du champ.

Voici les types de règle.

- **Date** lit une date selon le **Format** saisi, par exemple `dd/MM/yyyy`. Pour une colonne de date d'un fichier Excel, mettez **La date est** sur **Une cellule de date Excel**. Excel garde une date sous forme de numéro de jour, et cette règle le lit.
- **Valeurs** traduit chaque valeur de votre fichier en un code, une ligne par valeur.
- **Liste de codes** cherche la valeur dans une liste de codes. **La liste de codes du laboratoire** contient les correspondances ajoutées dans l'onglet **Mappings** d'un terme, dans Terminologie. Elle contient des codes de plusieurs systèmes : choisissez aussi son **Système source**. Le panneau refuse d'enregistrer sans lui. Les autres listes sont les ressources ConceptMap stockées dans OpenLDR.
- **Découper** garde une partie de la cellule.
- **Retirer les espaces** enlève les espaces au début et à la fin.
- **Nombre** lit un nombre avec le **Séparateur décimal** choisi. Sur **Résultat (nombre)**, un `<`, `<=`, `>=` ou `>` au début est gardé comme comparateur, donc `>100000` est stocké comme plus de 100000. `≤` et `≥` veulent dire `<=` et `>=`, et sont stockés comme `<=` et `>=`. Cela marche avec ou sans la règle. Quand vous choisissez **Nombre**, le **Séparateur décimal** part de celui que montre l'échantillon : une virgule quand les exemples ont des virgules décimales et aucun point décimal, un point sinon. Changez-le s'il est faux.

Le panneau suggère une règle d'après la forme des valeurs d'exemple, par exemple une virgule décimale ou un format de date. Vérifiez une date suggérée quand le jour et le mois peuvent tous deux valoir 12 ou moins.

Quand les valeurs d'un champ codé ne sont pas ses codes, le panneau suggère **Valeurs**. **Accepter** ouvre la règle avec une ligne par valeur distincte de l'échantillon, 20 au plus. Quand une valeur est un code, ou le nom d'un code, sans tenir compte des majuscules, ce code est déjà choisi côté **Vers**. Indiquez ce que veulent dire les autres valeurs. Une ligne n'est enregistrée qu'une fois son côté **Vers** rempli. Un champ avec la liste propre de FHIR, comme **Sexe**, choisit dans cette liste. Quand chaque exemple d'une colonne de date est un numéro de jour, le panneau suggère la cellule de date Excel.

Un texte simple dans un champ codé, comme **Examen**, est stocké comme le code propre au laboratoire, sans système. Une règle **Liste de codes** stocke à la place un code standard. Un code choisi côté **Vers** d'une règle **Valeurs** est stocké avec son système.

## Ajouter un champ que la cible n'affiche pas

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Ajouter un chemin FHIR**.
3. Choisissez l'**Enregistrement**, par exemple Patient ou Observation.
4. Choisissez le **Chemin FHIR**.
5. Choisissez la colonne de la nouvelle ligne.

**Résultat attendu :** une nouvelle ligne, nommée d'après le chemin FHIR, apparaît dans le panneau.

## Tester le mappage

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Tester**.
3. Lisez les résultats dans le bloc en bas du panneau, un résultat pour chaque ligne de l'échantillon : **Ligne 1**, **Ligne 2**, et ainsi de suite.
4. Une ligne qui se termine par **réussit** donne des enregistrements conformes aux contrôles d'OpenLDR. Pour les autres, lisez la raison. Elle nomme le champ quand elle le peut. Quand une valeur ne fait pas partie de celles qu'un champ codé accepte, et que le champ n'a pas de règle **Valeurs** ni **Liste de codes**, la ligne demande d'ajouter une règle Valeurs.
5. Corrigez la colonne ou la règle de ce champ, puis sélectionnez de nouveau **Tester**.

**Résultat attendu :** chaque ligne de l'échantillon réussit, ou vous savez pourquoi elle échoue.

Le test envoie les lignes de l'échantillon, 20 au plus. Les raisons sont en anglais. Le test vérifie chaque ligne seule. Deux lignes qui donnent le même résultat avec d'autres valeurs réussissent toutes deux au test, alors qu'une exécution retient la seconde.

## Examiner les ressources générées

1. Ouvrez **Actions du mappage** et sélectionnez **Tester**.
2. Repérez une ligne qui réussit dans les résultats en bas du panneau.
3. Ouvrez le menu à points **Actions de la ligne** de cette ligne.
4. Sélectionnez **Voir le FHIR généré**.
5. Vérifiez les valeurs et les références dans **FHIR généré**.
6. Ouvrez **Actions des ressources générées** et sélectionnez **Copier le JSON**.

**Résultat attendu :** le panneau montre uniquement les ressources générées pour cette ligne de l'échantillon. Le test ne les enregistre pas.

Changer une source, une règle, une destination ou un échantillon efface les résultats du test précédent. Sélectionnez de nouveau **Tester** pour examiner le nouveau mappage.

## Enregistrer le mappage

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Enregistrer**.
3. Fermez le panneau.
4. Sélectionnez **Save** dans la barre d'outils du workflow.
5. Pour **Ingest**, lisez l'avertissement et sélectionnez **Save anyway**.

**Résultat attendu :** **Mappages enregistrés**, dans les paramètres du nœud, compte le nouveau mappage.

Le panneau refuse d'enregistrer tant qu'un champ obligatoire n'a ni colonne ni valeur fixe, qu'une règle n'est pas terminée, ou que l'examen d'une colonne est vide ou répété. L'enregistrement remplace un mappage enregistré du même nœud dont toutes les colonnes figurent dans le nouveau. Quand ce mappage a moins de colonnes que le nouveau, le panneau le signale avant l'enregistrement.

## Relier la sortie des lignes retenues

Sur une nouvelle installation, le workflow fourni **Ingest** utilise Map to FHIR. **sortie** va vers **Persist store**, et rien n'est relié à **retenus**, à dessein. Ingest refuse donc un message entier dès qu'une partie ne peut pas être stockée. L'exécution échoue, l'émetteur reçoit une erreur, et rien de ce message n'est stocké. Une installation mise en place avant cette version garde son ancien graphe Ingest. **Reset to default** donne le nouveau, et supprime toute modification faite à l'ancien.

Reliez **retenus** dans votre propre workflow, quand les bonnes lignes doivent être stockées et les mauvaises mises de côté. Laissez cette sortie libre dans **Ingest**.

1. Recherchez `Log` dans la bibliothèque de nœuds.
2. Glissez **Log** à côté de **Map to FHIR**.
3. Glissez le point **retenus** de **Map to FHIR** vers le point à gauche du nœud Log.
4. Dans les paramètres du nœud Log, réglez **Message** sur `Held: {{ $json.reason }}`.
5. Enregistrez le workflow.

**Résultat attendu :** dans **History**, le nœud Log montre la raison de la première ligne retenue de l'exécution.

Dans **History**, le résultat du nœud Map to FHIR liste jusqu'à 20 raisons. Ne journalisez que la raison, car un élément retenu contient aussi la ligne telle qu'elle est arrivée.

## Limites

- Une ligne correspond à un mappage enregistré quand chacune de ses colonnes est connue du mappage. **Extract from File** laisse de côté les cellules vides, qui ne comptent donc pas. Dans un envoi JSON, une clé compte même si sa valeur est vide. Quand deux mappages enregistrés d'un même nœud conviennent à une ligne, le nœud la retient. Utilisez un nœud Map to FHIR par fichier de laboratoire.
- Une ligne sans identifiant patient est retenue.
- Une unité n'est stockée qu'avec un nombre. Quand une ligne a une unité mais pas de nombre, par exemple un résultat en texte, le résultat est stocké sans l'unité, et l'exécution le note.
- Un nombre entier envoyé sans guillemets et trop long pour être gardé exactement, au-delà de 9 007 199 254 740 991, comme un numéro d'échantillon à 19 chiffres, garde tous ses chiffres. Le webhook le lit comme du texte, et la sortie du déclencheur dans **History** nomme le champ sous `notes`. Mappez-le sur un champ texte comme **Numéro d'échantillon**. **Résultat (nombre)** le refuse et retient la ligne, car un nombre ne peut pas garder autant de chiffres exactement. Demandez au laboratoire d'envoyer ces identifiants entre guillemets.
- Un motif de mise en attente sur une entrée d'une colonne de liste, comme `results.value`, dit laquelle, par exemple `(entry 2 of 4)`. Il ne montre jamais la valeur.
- Deux résultats d'une ligne avec le même test sont mis en attente, car ils feraient un seul enregistrement de résultat. Le motif nomme les deux entrées de la liste, comme `entries 1 and 3 of 4 in results.code`, ou les deux colonnes. Quand **Date du résultat** n'est pas mappée, il dit de la mapper : deux résultats d'un test avec des dates de résultat différentes restent séparés.
- Une analyse au résultat vide, absent ou null ne donne pas d'enregistrement de résultat. La demande garde l'analyse, et l'exécution le note. Un zéro est un résultat et est gardé.
- Un enregistrement de résultat a une seule valeur. Une ligne qui remplit **Résultat (nombre)** et **Résultat (texte)** pour une même analyse est retenue avec la raison qu'elle contient plus d'une valeur de résultat.
- Une ligne de JSON imbriqué est lue aplatie. `{ "patient": { "number": "P-1" } }` donne la colonne `patient.number`. Une liste d'objets donne une colonne liste par clé : `results: [{ code, value }, …]` donne `results.code` et `results.value`, et mapper **Examen** et **Résultat (nombre)** sur elles donne un résultat par entrée. Un seul niveau de liste est lu. Une liste dans une entrée de liste, comme les résultats d'antibiotiques de chaque isolat d'une culture, n'est pas stockée. **Test** affiche une note sous la ligne, et le résultat du nœud dans **History** la liste sous `notes`. Pour garder ces données, envoyez-les en FHIR. Deux colonnes qui finissent avec le même nom, comme une clé `patient.number` à côté d'un objet `patient`, retiennent la ligne.
- La même ligne envoyée deux fois donne les mêmes enregistrements, pas des copies. Chaque identifiant d'enregistrement vient des identifiants de la ligne. Celui du patient utilise l'identifiant patient et son système. Celui de l'échantillon ajoute le numéro d'échantillon ou, à défaut, la date de prélèvement. Celui de la demande ajoute son code d'examen s'il est mappé. Celui du résultat ajoute l'examen et, si elle est mappée, la date du résultat. Quand le champ **Examens demandés** de la demande n'est pas mappé, la demande prend les codes d'examen de tous ses résultats de l'exécution, chacun une fois, et son identifiant ne change pas. Une exécution suivante les remplace par ses propres codes.
- Dans une même exécution, les lignes qui donnent le même patient, le même échantillon ou la même demande font un seul enregistrement. Une ligne suivante ne remplit que ce qu'une ligne précédente a laissé vide.
- Un fichier avec moins de colonnes envoyé après un fichier plus complet remplace le patient stocké. Les champs que le fichier plus pauvre n'a pas deviennent vides. **History** garde l'ancienne version.
- Un patient déjà stocké sous un autre identifiant avec le même identifiant patient, par exemple depuis un formulaire, reçoit un deuxième enregistrement Patient. Rien ne cherche un patient par son identifiant patient avant l'enregistrement.
- Dans une même exécution, une deuxième ligne qui donne le même résultat avec d'autres valeurs est retenue, avec la raison `this row gives a result that an earlier row of this run already gave, with other values`.
- Si un fichier mappe **Système de l'identifiant patient** et un autre non, un même patient reçoit deux enregistrements Patient.
- La détection des doublons de patients ne compare les identifiants patient que si **Système de l'identifiant patient** est mappé. Elle ne compare les noms et dates de naissance que si le patient a un nom de famille, un prénom et une date de naissance. Un patient qui n'a ni l'un ni l'autre est stocké, mais jamais signalé comme doublon.
- Sans rien sur **retenus**, une seule ligne retenue fait échouer le nœud et l'exécution. Les étapes suivantes ne s'exécutent pas.
- Dans une boucle, la boucle ne transmet que ce que donnent les derniers nœuds de son corps. Reliez **sortie** et **retenus** chacun à un nœud placé dans le corps de la boucle.
- OpenLDR n'enregistre jamais de valeur d'échantillon dans le workflow. Le panneau oublie l'échantillon quand vous le fermez.
- La règle **Date** lit une date seule. Une cellule avec une heure après la date ne correspond pas au format, et la ligne est retenue.
- Activez **Read every cell as text** sur **Extract from File** avant un nœud Map to FHIR. Chaque cellule CSV arrive alors comme le texte du fichier : `12,5`, `007` et `03/11/2026` arrivent tels qu'écrits. Lisez-les avec les règles **Nombre** et **Date**. Un nœud ajouté depuis la bibliothèque de nœuds a l'option activée. Un nœud enregistré avant cette version l'a désactivée. Sans elle, `12,5` arrive comme le nombre 125, `007` comme 7, et une date comme `01/12/2024` comme un numéro de jour, que la règle **Date** retient. Les réglages de Map to FHIR avertissent quand le nœud précédent a l'option désactivée.
- Dans un fichier Excel, une cellule de date arrive comme un numéro de jour. Utilisez la règle **Date** avec **Une cellule de date Excel**. Elle ne lit que le système de dates 1900 habituel d'Excel. Un classeur enregistré dans le système de dates 1904, sur un ancien Mac, donne des dates quatre ans et un jour trop tôt.
- **La liste de codes du laboratoire** demande un **Système source**. Sans lui, aucun code ne correspond. Quand un code donne deux cibles, la ligne est retenue avec `more than one match in the code list`.
- Ce nœud ne lit pas les messages HL7 v2.

## Dépannage

- **no mapping for this shape.** La ligne a une colonne qu'aucun mappage enregistré du nœud ne connaît. Obtenez un échantillon avec cette ligne et enregistrez un mappage pour elle.
- **more than one saved mapping fits this row.** Deux mappages enregistrés connaissent toutes ses colonnes. Gardez un mappage par fichier, ou utilisez un nœud par fichier.
- **L'exécution échoue avec « held port is not connected ».** Dans **Ingest**, c'est ainsi qu'un message impossible à stocker est refusé. L'erreur donne les premières raisons. Corrigez les données ou le mappage, puis renvoyez le message. Dans votre propre workflow, reliez **retenus** à un nœud Log pour stocker les bonnes lignes et mettre les mauvaises de côté.
- **nothing at body.** L'élément ne contient rien sous `body`, ou seulement une liste vide ou une valeur unique. Après **Extract from File**, laissez **Chemin source** vide. Après un webhook, vérifiez que l'émetteur envoie bien un corps.
- **not a row.** La liste sous le chemin source contient autre chose qu'une ligne, par exemple un nombre ou un texte. Chaque élément de la liste doit être un objet avec des colonnes.
- **Écouter ne trouve rien.** Enregistrez d'abord le workflow. Sélectionnez ensuite **Écouter** et envoyez le message dans la minute.

## Guides associés

- [Workflows](/docs/workflows)
- [Formulaires](/docs/forms)
- [Terminologie](/docs/terminology)

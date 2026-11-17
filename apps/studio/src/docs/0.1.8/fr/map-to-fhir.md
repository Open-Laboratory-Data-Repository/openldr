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

Sans échantillon, le panneau montre le mappage enregistré du nœud, le plus large s'il y en a plusieurs. La liste **Mappage enregistré** en choisit un autre. Chaque colonne est marquée comme absente de l'échantillon, et aucun exemple ne s'affiche. Vous pouvez modifier le mappage et l'enregistrer. **Tester** demande un échantillon.

## Choisir une colonne pour chaque champ

Chaque ligne du panneau est un champ de la cible. Une étoile marque un champ obligatoire. **Lab result** en demande trois : **Identifiant patient**, **Date de prélèvement** et **Examen**.

1. Sur la ligne d'un champ, ouvrez la liste sous **Depuis vos données** et choisissez la colonne qui le remplit.
2. Choisissez plutôt **Valeur fixe** quand toutes les lignes ont la même valeur, puis saisissez-la.
3. Laissez **Non mappé** sur un champ absent de votre fichier.
4. Pour un champ qui se répète, sélectionnez **Ajouter une autre colonne** pour ajouter une deuxième colonne.
5. Quand une ligne grise **Suggestion** propose une colonne, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** le panneau compte les champs obligatoires mappés et montre un exemple de l'échantillon à côté de chaque colonne choisie.

Une suggestion n'apparaît que sur un champ sans colonne. Le champ reste sans colonne tant que vous n'avez pas sélectionné **Accepter**.

Mappez **Système de l'identifiant patient** de la même façon dans chaque fichier, par exemple en **Valeur fixe** avec le même texte à chaque fois. Sans lui, l'identifiant de l'enregistrement Patient ne vient que de l'identifiant patient. La détection des doublons ne peut pas non plus comparer ces patients par leur identifiant.

## Ajouter une règle à un champ

Utilisez une règle quand la cellule ne contient pas la valeur sous la forme attendue par FHIR.

1. Sur la ligne du champ, ouvrez la liste sous **Règle**.
2. Choisissez le type de règle.
3. Remplissez les réglages qui s'affichent sous la ligne.
4. Quand une ligne grise **Règle suggérée** apparaît, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** les réglages de la règle s'affichent sous la ligne du champ.

Voici les types de règle.

- **Date** lit une date selon le **Format** saisi, par exemple `dd/MM/yyyy`.
- **Valeurs** traduit chaque valeur de votre fichier en un code, une ligne par valeur.
- **Liste de codes** cherche la valeur dans une liste de codes. **La liste de codes du laboratoire** contient les correspondances ajoutées dans l'onglet **Mappings** d'un terme, dans Terminologie. Elle contient des codes de plusieurs systèmes : choisissez aussi son **Système source**. Le panneau refuse d'enregistrer sans lui. Les autres listes sont les ressources ConceptMap stockées dans OpenLDR.
- **Découper** garde une partie de la cellule.
- **Retirer les espaces** enlève les espaces au début et à la fin.
- **Nombre** lit un nombre avec le **Séparateur décimal** choisi.

Le panneau suggère une règle d'après la forme des valeurs d'exemple, par exemple une virgule décimale ou un format de date. Vérifiez une date suggérée quand le jour et le mois peuvent tous deux valoir 12 ou moins.

Quand les valeurs d'un champ codé ne sont pas ses codes, le panneau suggère **Valeurs**. **Accepter** ouvre la règle avec une ligne par valeur distincte de l'échantillon, 20 au plus, et un côté **Vers** vide. Indiquez ce que veut dire chaque valeur. Une ligne n'est enregistrée qu'une fois son côté **Vers** rempli.

Un texte simple dans un champ codé, comme **Examen**, est stocké comme le code propre au laboratoire, sans système. Une règle **Liste de codes** stocke à la place un code standard.

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

Le test envoie les lignes de l'échantillon, 20 au plus. Les raisons sont en anglais.

## Enregistrer le mappage

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Enregistrer**.
3. Fermez le panneau.
4. Sélectionnez **Save** dans la barre d'outils du workflow.
5. Pour **Ingest**, lisez l'avertissement et sélectionnez **Save anyway**.

**Résultat attendu :** **Mappages enregistrés**, dans les paramètres du nœud, compte le nouveau mappage.

Le panneau refuse d'enregistrer tant qu'un champ obligatoire n'a ni colonne ni valeur fixe, ou qu'une règle n'est pas terminée. L'enregistrement remplace un mappage enregistré du même nœud dont toutes les colonnes figurent dans le nouveau. Quand ce mappage a moins de colonnes que le nouveau, le panneau le signale avant l'enregistrement.

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
- La même ligne envoyée deux fois donne les mêmes enregistrements, pas des copies. Chaque identifiant d'enregistrement vient des identifiants de la ligne. Celui du patient utilise l'identifiant patient et son système. Celui de l'échantillon ajoute le numéro d'échantillon ou, à défaut, la date de prélèvement. Celui de la demande ajoute son code d'examen s'il est mappé. Celui du résultat ajoute l'examen et, si elle est mappée, la date du résultat.
- Dans une même exécution, les lignes qui donnent le même patient, le même échantillon ou la même demande font un seul enregistrement. Une ligne suivante ne remplit que ce qu'une ligne précédente a laissé vide. Un fichier plus pauvre envoyé lors d'une exécution suivante remplace encore l'enregistrement stocké.
- Dans une même exécution, une deuxième ligne qui donne le même résultat avec d'autres valeurs est retenue, avec la raison `this row gives a result that an earlier row of this run already gave, with other values`.
- Si un fichier mappe **Système de l'identifiant patient** et un autre non, un même patient reçoit deux enregistrements Patient.
- La détection des doublons de patients ne compare les identifiants patient que si **Système de l'identifiant patient** est mappé. Elle ne compare les noms et dates de naissance que si le patient a un nom de famille, un prénom et une date de naissance. Un patient qui n'a ni l'un ni l'autre est stocké, mais jamais signalé comme doublon.
- Sans rien sur **retenus**, une seule ligne retenue fait échouer le nœud et l'exécution. Les étapes suivantes ne s'exécutent pas.
- Dans une boucle, la boucle ne transmet que ce que donnent les derniers nœuds de son corps. Reliez **sortie** et **retenus** chacun à un nœud placé dans le corps de la boucle.
- OpenLDR n'enregistre jamais de valeur d'échantillon dans le workflow. Le panneau oublie l'échantillon quand vous le fermez.
- La règle **Date** lit une date seule. Une cellule avec une heure après la date ne correspond pas au format, et la ligne est retenue.
- Activez **Read every cell as text** sur **Extract from File** avant un nœud Map to FHIR. Chaque cellule CSV arrive alors comme le texte du fichier : `12,5`, `007` et `03/11/2026` arrivent tels qu'écrits. Lisez-les avec les règles **Nombre** et **Date**. Un nœud ajouté depuis la bibliothèque de nœuds a l'option activée. Un nœud enregistré avant cette version l'a désactivée. Sans elle, `12,5` arrive comme le nombre 125, `007` comme 7, et une date comme `01/12/2024` comme un numéro de jour, que la règle **Date** retient. Les réglages de Map to FHIR avertissent quand le nœud précédent a l'option désactivée.
- Dans un fichier Excel, une cellule de date arrive comme un numéro de jour, que l'option soit activée ou non. La règle **Date** retient une telle ligne. Enregistrez la feuille en CSV, ou mettez les cellules de date au format texte.
- Un fichier avec une colonne par examen, par exemple une colonne par antibiotique, ne peut pas être mappé tel quel. Plusieurs colonnes sur un même champ répété demandent un code d'examen pour chaque colonne, et un code unique partagé est refusé avec `Test: two Observation records in this row have the same value, so they would share one id`.
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

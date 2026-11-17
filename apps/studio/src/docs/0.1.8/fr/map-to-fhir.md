# Map to FHIR

Map to FHIR est un nœud de workflow. Il transforme les lignes propres à un laboratoire en enregistrements FHIR qu'OpenLDR peut stocker. Il transmet aussi le FHIR tel quel, et transforme les réponses à un formulaire accepté en enregistrements. Ce qu'il ne sait pas mapper part sur sa sortie **retenus**, avec une raison. Les responsables de laboratoire le configurent une fois pour chaque fichier de laboratoire.

Sur une nouvelle installation, le workflow fourni **Ingest** l'utilise. Son webhook envoie vers **Map to FHIR**, et **sortie** va vers **Persist store**. Rien n'est relié à **retenus**, et c'est voulu. Ingest refuse donc un message entier dès qu'une partie ne peut pas être stockée. L'exécution échoue, l'émetteur reçoit une erreur, et rien de ce message n'est stocké. Une installation mise en place avant cette version garde son ancien graphe Ingest. **Reset to default** donne le nouveau, et supprime toute modification faite à l'ancien.

## Ajouter Map to FHIR à un workflow

Placez le nœud après l'étape qui fournit les lignes, par exemple un déclencheur **Webhook** ou **Extract from File**.

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

La feuille mappe les colonnes d'un vrai échantillon. Obtenez-en un avant de choisir les colonnes.

1. Enregistrez le workflow.
2. Dans les paramètres du nœud, ouvrez le menu à points **Actions du nœud** et sélectionnez **Ouvrir le mappage**.
3. Ouvrez le menu à points **Actions du mappage**, en haut à droite de la feuille.
4. Sélectionnez **Écouter**, puis envoyez un message ou un fichier au workflow depuis le système du laboratoire.
5. Ou sélectionnez **Utiliser la dernière exécution enregistrée** pour lire une exécution déjà reçue.

**Résultat attendu :** la ligne sous **Cible** compte les lignes de l'échantillon.

**Écouter** s'arrête à la première nouvelle exécution qui donne des lignes à ce nœud, ou au bout d'une minute. **Utiliser la dernière exécution de cet éditeur** lit la dernière exécution lancée dans l'éditeur. Sur un workflow webhook, une exécution lancée dans l'éditeur n'a pas de corps. Utilisez alors **Écouter** ou **Utiliser la dernière exécution enregistrée**.

## Choisir une colonne pour chaque champ

Chaque ligne de la feuille est un champ de la cible. Une étoile marque un champ obligatoire. **Lab result** en demande trois : **Identifiant patient**, **Date de prélèvement** et **Examen**.

1. Sur la ligne d'un champ, ouvrez la liste sous **Depuis vos données** et choisissez la colonne qui le remplit.
2. Choisissez plutôt **Valeur fixe** quand toutes les lignes ont la même valeur, puis saisissez-la.
3. Laissez **Non mappé** sur un champ absent de votre fichier.
4. Pour un champ qui se répète, sélectionnez **Ajouter une autre colonne** pour ajouter une deuxième colonne.
5. Quand une ligne grise **Suggestion** propose une colonne, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** la feuille compte les champs obligatoires mappés et montre un exemple de l'échantillon à côté de chaque colonne choisie.

Une suggestion ne compte qu'après **Accepter**. D'ici là, le champ garde la colonne que vous avez choisie, ou aucune.

## Ajouter une règle à un champ

Utilisez une règle quand la cellule ne contient pas la valeur sous la forme attendue par FHIR.

1. Sur la ligne du champ, ouvrez la liste sous **Règle**.
2. Choisissez **Date** et saisissez le **Format**, par exemple `dd/MM/yyyy`.
3. Ou choisissez **Valeurs** pour traduire chaque valeur de votre fichier en un code, une ligne par valeur.
4. Ou choisissez **Liste de codes** pour chercher la valeur dans une liste de codes de Terminology.
5. Ou choisissez **Découper** pour garder une partie de la cellule, **Retirer les espaces**, ou **Nombre** avec son **Séparateur décimal**.
6. Quand une ligne grise **Règle suggérée** apparaît, sélectionnez **Accepter** pour l'utiliser.

**Résultat attendu :** les réglages de la règle s'affichent sous la ligne du champ.

La feuille suggère une règle d'après la forme des valeurs d'exemple, comme une virgule décimale ou un format de date. Vérifiez une date suggérée quand le jour et le mois peuvent tous deux valoir 12 ou moins.

## Ajouter un champ que la cible n'affiche pas

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Ajouter un chemin FHIR**.
3. Choisissez l'**Enregistrement**, par exemple Patient ou Observation.
4. Choisissez le **Chemin FHIR**.
5. Choisissez la colonne de la nouvelle ligne.

**Résultat attendu :** une nouvelle ligne, nommée d'après le chemin FHIR, apparaît sur la feuille.

## Tester le mappage

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Tester**.
3. Lisez le résultat sous chaque ligne. Une ligne qui passe donne des enregistrements conformes aux contrôles d'OpenLDR.
4. Pour une ligne qui ne passe pas, lisez la raison. Elle nomme le champ quand elle le peut.
5. Corrigez la colonne ou la règle de ce champ, puis sélectionnez de nouveau **Tester**.

**Résultat attendu :** chaque ligne de l'échantillon passe, ou vous savez pourquoi elle ne passe pas.

Le test envoie au plus 20 lignes de l'échantillon. Les raisons sont en anglais.

## Enregistrer le mappage

1. Ouvrez le menu à points **Actions du mappage**.
2. Sélectionnez **Enregistrer**.
3. Fermez la feuille.
4. Sélectionnez **Save** dans la barre d'outils du workflow.
5. Pour **Ingest**, lisez l'avertissement et sélectionnez **Save anyway**.

**Résultat attendu :** **Mappages enregistrés**, dans les paramètres du nœud, compte le nouveau mappage.

La feuille refuse d'enregistrer tant qu'un champ obligatoire n'a ni colonne ni valeur fixe, ou qu'une règle n'est pas terminée. Un mappage qui couvre plus de colonnes remplace un mappage enregistré du même nœud qui en couvre moins. La feuille le signale avant l'enregistrement.

## Relier la sortie des lignes retenues

Faites-le dans votre propre workflow, quand les bonnes lignes doivent être stockées et les mauvaises mises de côté. Laissez **retenus** non relié dans **Ingest**, pour qu'il continue de refuser un message qu'il ne peut pas stocker.

1. Recherchez `Log` dans la bibliothèque de nœuds.
2. Glissez **Log** à côté de **Map to FHIR**.
3. Glissez le point **retenus** de **Map to FHIR** vers le point à gauche du nœud Log.
4. Dans les paramètres du nœud Log, réglez **Message** sur `Held: {{ $json.reason }}`.
5. Enregistrez le workflow.

**Résultat attendu :** dans **History**, une ligne retenue montre sa raison dans ce nœud Log.

Ne journalisez que la raison. Un élément retenu contient aussi la ligne telle qu'elle est arrivée.

## Limites

- Une ligne correspond à un mappage enregistré quand chacune de ses colonnes est connue du mappage. Les cellules vides ne comptent pas. Quand deux mappages enregistrés d'un même nœud conviennent à une ligne, le nœud la retient. Utilisez un nœud Map to FHIR par fichier de laboratoire.
- Une ligne sans identifiant patient est retenue.
- La même ligne envoyée deux fois donne les mêmes enregistrements, pas des copies. Les identifiants des enregistrements viennent de l'identifiant patient, du numéro d'échantillon ou, à défaut, de la date de prélèvement, et de l'examen.
- Si un fichier mappe **Système de l'identifiant patient** et un autre non, un même patient reçoit deux enregistrements Patient.
- Un patient sans nom ou sans date de naissance est stocké. La détection des doublons de patients ne le trouve alors que par un identifiant partagé, pas par le nom et la date de naissance.
- Sans rien sur **retenus**, une seule ligne retenue fait échouer le nœud et l'exécution. Les étapes suivantes ne s'exécutent pas.
- Dans une boucle, la boucle ne transmet que ce que donnent les derniers nœuds de son corps. Reliez **sortie** et **retenus** chacun à un nœud placé dans le corps de la boucle.
- La feuille ne garde l'échantillon que tant qu'elle est ouverte. OpenLDR n'enregistre jamais de valeur d'échantillon dans le workflow. Obtenez un nouvel échantillon à chaque ouverture de la feuille.
- La règle **Date** lit une date seule. Une cellule avec une heure après la date ne correspond pas au format, et la ligne est retenue.
- **Extract from File** lit une cellule CSV comme `12,5` comme le nombre 125. La règle **Nombre** garde alors 125. Envoyez plutôt ces données en JSON à un webhook. Là, `"12,5"` reste du texte, et la règle **Nombre** avec la virgule lit 12,5.
- **Extract from File** lit aussi certaines dates CSV, comme `01/12/2024`, comme des nombres. La règle **Date** retient alors la ligne.
- Ce nœud ne lit pas les messages HL7 v2.

## Dépannage

- **no mapping for this shape.** La ligne a une colonne qu'aucun mappage enregistré du nœud ne connaît. Obtenez un échantillon avec cette ligne et enregistrez un mappage pour elle.
- **more than one saved mapping fits this row.** Deux mappages enregistrés connaissent toutes ses colonnes. Gardez un mappage par fichier, ou utilisez un nœud par fichier.
- **L'exécution échoue avec "held port is not connected".** Dans **Ingest**, c'est ainsi qu'un message impossible à stocker est refusé. L'erreur donne les premières raisons. Corrigez les données ou le mappage et renvoyez-les. Dans votre propre workflow, reliez **retenus** à un nœud Log pour stocker les bonnes lignes et mettre les mauvaises de côté.
- **nothing at body.** Le chemin source ne pointe pas vers les lignes. Après un webhook, réglez **Chemin source** sur `body`.
- **Écouter ne trouve rien.** Enregistrez d'abord le workflow. Sélectionnez ensuite **Écouter** et envoyez le message dans la minute.

## Guides associés

- [Workflows](/docs/workflows)
- [Formulaires](/docs/forms)
- [Terminologie](/docs/terminology)

# Terminologie

Retrouvez les codes de votre laboratoire, ajoutez vos propres listes et choisissez les codes acceptés par un formulaire. Commencez par consulter les listes déjà installées.

Un **éditeur** regroupe les listes selon l'organisme qui les maintient. Un **système de codes** contient des termes codés. Un **jeu de valeurs** sélectionne les codes autorisés pour un usage précis, comme un champ de formulaire.

Les données d'exemple de la documentation ne sont pas nécessaires. Les captures utilisent une liste intégrée et un exemple temporaire appelé `DOCS-GUIDE-REVIEW`. Utilisez vos propres noms, codes et URL pour créer les listes de votre laboratoire.

La lecture nécessite l'autorisation de consulter la terminologie. La création, la modification et l'import nécessitent l'autorisation de gérer la terminologie.

## Trouver un code et lire ses détails

Recherchez un code existant avant d'en créer un autre. Cet exemple retrouve un motif de rejet de test dans le système intégré REJECT-TEST.

### 1. Ouvrir Terminologie

Sélectionnez **Terminologie** dans le menu principal à gauche.

![Capture de Studio : Ouvrir Terminologie](terminology-guide-open-terminology.png)

### 2. Choisir l'éditeur

Sélectionnez l'éditeur qui maintient la liste. Dans cet exemple, choisissez **System**.

![Capture de Studio : Choisir l'éditeur](terminology-guide-choose-publisher.png)

### 3. Sélectionner Code systems

Si l'éditeur propose les deux types de listes, sélectionnez **Code systems** à côté de son nom.

![Capture de Studio : Sélectionner Code systems](terminology-guide-code-systems-tab.png)

### 4. Ouvrir un système de codes

Sélectionnez la liste à consulter. Cet exemple ouvre **REJECT-TEST**.

![Capture de Studio : Ouvrir un système de codes](terminology-guide-choose-code-system.png)

### 5. Rechercher un code ou un nom

Saisissez une partie du code ou du nom dans **Search terms…**. Cet exemple utilise `HAEM`.

![Capture de Studio : Rechercher un code ou un nom](terminology-guide-search-terms.png)

**Résultat attendu :** la liste affiche les termes correspondants de ce système de codes. Le filtre de statut permet de réduire les résultats.

![Capture de Studio : Rechercher un code ou un nom](terminology-guide-search-result.png)

### 6. Ouvrir le terme

Sélectionnez sa ligne. Le panneau **Edit term** affiche son code, son nom, son statut et ses autres détails.

![Capture de Studio : Ouvrir le terme](terminology-guide-open-term.png)

![Capture de Studio : Ouvrir le terme](terminology-guide-term-details.png)

### 7. Fermer le panneau

Sélectionnez **Close** en haut à droite pour quitter sans enregistrer de modification.

![Capture de Studio : Fermer le panneau](terminology-guide-close-term.png)

## Créer un système de codes pour votre liste

Créez un système de codes si la liste nécessaire n'existe pas encore. Choisissez d'abord son éditeur. Les captures utilisent System et laissent Active coché.

**System code** est l'identifiant court. Il ne peut plus être modifié après la création. **System name** est le nom lisible. **Canonical URL** identifie la liste lors des échanges avec d'autres systèmes. Ce champ peut rester vide pour une liste personnalisée.

### 1. Ouvrir le menu de la page

Sélectionnez les trois points à droite du fil d'Ariane de l'éditeur, au-dessus du tableau.

![Capture de Studio : Ouvrir le menu de la page](terminology-guide-system-actions.png)

### 2. Ouvrir Code system

Sélectionnez **Code system** dans le menu.

![Capture de Studio : Ouvrir Code system](terminology-guide-code-system-menu.png)

### 3. Choisir New

Sélectionnez **New**. Le panneau **New coding system** s'ouvre.

![Capture de Studio : Choisir New](terminology-guide-new-code-system.png)

### 4. Saisir un code de système

Saisissez un code unique dans **System code**. L'exemple utilise `DOCS-GUIDE-REVIEW`.

![Capture de Studio : Saisir un code de système](terminology-guide-system-code.png)

### 5. Saisir son nom

Saisissez le nom à afficher dans **System name**.

![Capture de Studio : Saisir son nom](terminology-guide-system-name.png)

### 6. Saisir son URL canonique si nécessaire

Saisissez l'identifiant utilisé par votre organisation dans **Canonical URL**. Pour une liste personnalisée, vous pouvez laisser ce champ vide.

![Capture de Studio : Saisir son URL canonique si nécessaire](terminology-guide-system-url.png)

### 7. Créer le système de codes

Sélectionnez **Create** au bas de ce panneau.

![Capture de Studio : Créer le système de codes](terminology-guide-create-system.png)

**Résultat attendu :** le nouveau système apparaît sous l'éditeur choisi. Ouvrez sa ligne pour ajouter des termes.

![Capture de Studio : Créer le système de codes](terminology-guide-system-created-step-0.png)

## Ajouter un terme

Ajoutez un code et son nom lisible à un système de codes existant. Le code doit être unique dans ce système. Les nouveaux termes ont le statut Active. Le nom court, la classe, l'unité et les métadonnées sont facultatifs.

### 1. Ouvrir le système de destination

Sélectionnez le système qui doit contenir votre terme. Utilisez une liste existante ou celle créée plus haut.

![Capture de Studio : Ouvrir le système de destination](terminology-guide-system-created-step-1.png)

### 2. Ouvrir le menu des termes

Sélectionnez les trois points à côté de **Search terms…** et du filtre de statut.

![Capture de Studio : Ouvrir le menu des termes](terminology-guide-term-actions-step-2.png)

### 3. Choisir New term

Sélectionnez **New term**.

![Capture de Studio : Choisir New term](terminology-guide-new-term.png)

### 4. Saisir le code

Saisissez la valeur à enregistrer dans **Code**. L'exemple utilise `EXAMPLE-1`.

![Capture de Studio : Saisir le code](terminology-guide-term-code.png)

### 5. Saisir le nom affiché

Saisissez un libellé lisible dans **Display name**.

![Capture de Studio : Saisir le nom affiché](terminology-guide-term-display.png)

### 6. Ouvrir le menu de l'éditeur de terme

Sélectionnez les trois points à côté des onglets **Details** et **Mappings**.

![Capture de Studio : Ouvrir le menu de l'éditeur de terme](terminology-guide-term-sheet-actions-step-6.png)

### 7. Choisir Create

Sélectionnez **Create** pour enregistrer le nouveau terme.

![Capture de Studio : Choisir Create](terminology-guide-create-term.png)

**Résultat attendu :** le panneau se ferme et le terme apparaît dans le système de codes.

![Capture de Studio : Choisir Create](terminology-guide-term-created.png)

## Modifier le nom affiché d'un terme

Corrigez le libellé lisible si nécessaire. Le code enregistré reste identique.

### 1. Ouvrir le terme

Sélectionnez sa ligne dans le système de codes.

![Capture de Studio : Ouvrir le terme](terminology-guide-edit-term-row.png)

### 2. Modifier Display name

Remplacez le texte de **Display name**. L'exemple utilise `Updated example label`.

![Capture de Studio : Modifier Display name](terminology-guide-edit-term-name.png)

### 3. Ouvrir le menu de l'éditeur de terme

Sélectionnez les trois points à côté de **Details** et **Mappings**.

![Capture de Studio : Ouvrir le menu de l'éditeur de terme](terminology-guide-term-sheet-actions-step-3.png)

### 4. Choisir Save

Sélectionnez **Save**. Les termes existants utilisent Save et les nouveaux termes utilisent Create.

![Capture de Studio : Choisir Save](terminology-guide-save-term.png)

**Résultat attendu :** la liste affiche le nouveau nom à côté du même code.

![Capture de Studio : Choisir Save](terminology-guide-term-updated.png)

## Importer plusieurs termes depuis un fichier

Utilisez l'import si vous disposez déjà d'une liste de codes et de noms. Ouvrez d'abord le système de destination.

Le modèle téléchargé utilise **JSON Lines**, soit un objet JSON par ligne. Chaque terme nécessite `code` et `displayName`. La ligne de métadonnées identifie le système de codes. Par exemple :

```jsonl
{"type":"meta","codingSystem":"DOCS-GUIDE-REVIEW","version":"2026-01-01"}
{"code":"EXAMPLE-2","displayName":"Imported example label"}
```

Utilisez l'identifiant de votre propre système et vos termes. Les lignes vides et celles commençant par `//` sont acceptées.

### 1. Ouvrir le menu des termes

Sélectionnez les trois points à côté de **Search terms…**.

![Capture de Studio : Ouvrir le menu des termes](terminology-guide-term-actions-step-1.png)

### 2. Télécharger le modèle si nécessaire

Sélectionnez **Download template**. Préparez votre fichier à partir de ses champs et de ses exemples.

![Capture de Studio : Télécharger le modèle si nécessaire](terminology-guide-download-template.png)

### 3. Choisir Import terms

Rouvrez le menu des termes et sélectionnez **Import terms**.

![Capture de Studio : Choisir Import terms](terminology-guide-import-terms.png)

### 4. Sélectionner le fichier préparé

Choisissez le fichier dans la fenêtre de votre ordinateur. L'import commence dès la sélection. La capture montre le résultat après la sélection du fichier d'exemple.

![Capture de Studio : Sélectionner le fichier préparé](terminology-guide-import-result.png)

**Résultat attendu :** les codes importés apparaissent dans ce système. La recherche permet de retrouver un code précis.

## Consulter les codes autorisés par un jeu de valeurs

Consultez un jeu de valeurs pour connaître les réponses proposées par un champ de formulaire. Les règles **Include** et **Exclude** définissent la liste. **Expansion** affiche les codes obtenus.

### 1. Revenir à la liste des systèmes

Si une liste de termes est ouverte, sélectionnez **← Code systems**.

![Capture de Studio : Revenir à la liste des systèmes](terminology-guide-back-to-systems.png)

### 2. Sélectionner Value sets

Sélectionnez **Value sets** à côté du nom de l'éditeur. Cet exemple utilise System.

![Capture de Studio : Sélectionner Value sets](terminology-guide-value-sets-tab.png)

### 3. Ouvrir un jeu de valeurs

Sélectionnez sa ligne. Cet exemple ouvre **Test rejection reasons**.

![Capture de Studio : Ouvrir un jeu de valeurs](terminology-guide-open-value-set.png)

### 4. Lire Expansion

Descendez jusqu'à **Expansion** pour lire les codes produits par les règles.

![Capture de Studio : Lire Expansion](terminology-guide-value-set-expansion.png)

**Résultat attendu :** vous pouvez lire les codes autorisés sans modifier le jeu de valeurs. Leur nombre dépend des systèmes et des règles de votre installation.

## Créer une liste de codes autorisés

Créez un jeu de valeurs pour proposer une liste contrôlée de codes. Cet exemple inclut tous les codes d'un système. Laissez la liste de concepts vide pour inclure le système entier. L'exemple reste Draft pendant sa préparation.

### 1. Ouvrir le menu de la page

Fermez d'abord tout panneau de modification. Sélectionnez les trois points à côté du fil d'Ariane de l'éditeur.

![Capture de Studio : Ouvrir le menu de la page](terminology-guide-value-set-page-actions.png)

### 2. Ouvrir Value set

Sélectionnez **Value set** dans le menu.

![Capture de Studio : Ouvrir Value set](terminology-guide-value-set-menu.png)

### 3. Choisir New

Sélectionnez **New** pour ouvrir l'éditeur.

![Capture de Studio : Choisir New](terminology-guide-new-value-set.png)

### 4. Saisir l'URL du jeu de valeurs

Saisissez une **Canonical URL** unique. Utilisez une URL différente de celle du système de codes.

![Capture de Studio : Saisir l'URL du jeu de valeurs](terminology-guide-value-set-url.png)

### 5. Saisir un titre lisible

Saisissez le nom de votre liste de codes autorisés dans **Title**.

![Capture de Studio : Saisir un titre lisible](terminology-guide-value-set-title.png)

### 6. Choisir le système de codes source

Sous **Include**, ouvrez **System** et choisissez la liste contenant vos termes.

![Capture de Studio : Choisir le système de codes source](terminology-guide-value-set-system.png)

![Capture de Studio : Choisir le système de codes source](terminology-guide-value-set-system-selection.png)

### 7. Ouvrir le menu de l'éditeur

Sélectionnez les trois points en haut à droite de l'éditeur de jeu de valeurs.

![Capture de Studio : Ouvrir le menu de l'éditeur](terminology-guide-value-set-actions.png)

### 8. Choisir Save

Sélectionnez **Save**. L'éditeur calcule l'expansion après l'enregistrement.

![Capture de Studio : Choisir Save](terminology-guide-save-value-set.png)

**Résultat attendu :** Expansion affiche les codes actifs du système choisi. L'exemple contient deux codes.

![Capture de Studio : Choisir Save](terminology-guide-value-set-created.png)

Un jeu de valeurs peut aussi inclure des concepts précis, exclure des codes ou importer un autre jeu de valeurs. Sa création ne le lie pas automatiquement à un formulaire. Consultez le [guide Formulaires](/docs/forms) pour configurer les champs.

## Ouvrir l'import d'une distribution standard

LOINC, SNOMED CT et RxNorm proposent un import de distributions ZIP dans le navigateur. Utilisez-le pour le paquet fourni par l'éditeur, plutôt que pour une petite liste de termes locaux.

### 1. Choisir l'éditeur externe

Sélectionnez **LOINC**, **SNOMED CT** ou **RxNorm**. La capture utilise LOINC.

![Capture de Studio : Choisir l'éditeur externe](terminology-guide-standard-publisher.png)

### 2. Ouvrir le menu de la page

Sélectionnez les trois points à droite du fil d'Ariane de l'éditeur.

![Capture de Studio : Ouvrir le menu de la page](terminology-guide-standard-actions.png)

### 3. Choisir Import distribution...

Sélectionnez **Import distribution...**.

![Capture de Studio : Choisir Import distribution...](terminology-guide-import-distribution.png)

**Résultat attendu :** le panneau d'import s'ouvre. Il comporte un champ ZIP, une version facultative et une confirmation de licence. L'import se poursuit en arrière-plan après l'envoi.

![Capture de Studio : Choisir Import distribution...](terminology-guide-distribution-importer.png)

Vous fournissez le paquet de distribution et gérez sa licence.

## Choisir un éditeur sur téléphone

La liste des éditeurs est repliée au départ pour laisser plus de place au tableau.

### 1. Afficher les éditeurs

Sélectionnez **Show publishers** en haut à gauche du panneau Terminologie.

![Capture de Studio : Afficher les éditeurs](terminology-guide-phone-show-publishers.png)

### 2. Choisir l'éditeur

Sélectionnez l'éditeur souhaité.

![Capture de Studio : Choisir l'éditeur](terminology-guide-phone-choose-publisher.png)

### 3. Replier la liste des éditeurs

Sélectionnez **Hide publishers** pour redonner la largeur au tableau.

![Capture de Studio : Replier la liste des éditeurs](terminology-guide-phone-hide-publishers.png)

**Résultat attendu :** l'éditeur choisi reste dans le fil d'Ariane. Faites défiler le tableau horizontalement pour atteindre les colonnes hors écran.

## Dépannage

### L'import indique displayName required

Le message indique la ligne sans nom lisible. Ajoutez `displayName` à ce terme, puis choisissez le fichier corrigé. L'exemple ci-dessous a échoué à la ligne 2.

![Capture de Studio : L'import indique displayName required](terminology-guide-import-error.png)

### Les options Term sont désactivées

Ouvrez d'abord un système de codes. Les actions sur les termes nécessitent une liste de destination.

### Le code d'un terme existant ne peut pas être modifié

L'éditeur conserve le code après la création. Le nom affiché et les autres champs modifiables peuvent encore être changés.

### Le jeu de valeurs est indiqué comme immuable

Certains jeux de valeurs standard sont en lecture seule. L'éditeur précise qu'il faut les dupliquer avant de les modifier.

### L'expansion du jeu de valeurs est vide

Vérifiez les règles Include, le système choisi et le statut des termes. Un jeu de valeurs des tests du laboratoire dépend aussi des tests activés.

## Guides associés

[Commencer ici](/docs/start-here) explique le CLI installé et le CLI de développement, avec les dossiers d'exemple `openldr_ce`. Consultez ce guide avant d'exécuter les commandes de terminologie dans un terminal.

[Formulaires](/docs/forms) · [Catalogue de tests](/docs/test-catalog) · [Établissements](/docs/facilities) · [Vos préférences](/docs/user-preferences)

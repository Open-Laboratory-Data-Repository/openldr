# Terminologie

Retrouvez les codes de votre laboratoire, ajoutez vos propres listes et choisissez les codes acceptés par un formulaire. Commencez par consulter les listes déjà installées.

Un **éditeur** regroupe les listes selon l'organisme qui les maintient. Un **système de codes** contient des termes codés. Un **jeu de valeurs** sélectionne les codes autorisés pour un usage précis, comme un champ de formulaire.

Les données d'exemple de la documentation ne sont pas nécessaires. Les captures utilisent une liste intégrée et un exemple temporaire appelé `DOCS-GUIDE-REVIEW`. Utilisez vos propres noms, codes et URL pour créer les listes de votre laboratoire.

La lecture nécessite l'autorisation de consulter la terminologie. La création, la modification et l'import nécessitent l'autorisation de gérer la terminologie.

## Trouver un code et lire ses détails

Recherchez un code existant avant d'en créer un autre. Cet exemple retrouve un motif de rejet de test dans le système intégré REJECT-TEST.

### 1. Ouvrir Terminologie

Sélectionnez **Terminologie** dans le menu principal à gauche.

__SHOT:open-terminology:1__

### 2. Choisir l'éditeur

Sélectionnez l'éditeur qui maintient la liste. Dans cet exemple, choisissez **System**.

__SHOT:choose-publisher:2__

### 3. Sélectionner Code systems

Si l'éditeur propose les deux types de listes, sélectionnez **Code systems** à côté de son nom.

__SHOT:code-systems-tab:3__

### 4. Ouvrir un système de codes

Sélectionnez la liste à consulter. Cet exemple ouvre **REJECT-TEST**.

__SHOT:choose-code-system:4__

### 5. Rechercher un code ou un nom

Saisissez une partie du code ou du nom dans **Search terms…**. Cet exemple utilise `HAEM`.

__SHOT:search-terms:5__

**Résultat attendu :** la liste affiche les termes correspondants de ce système de codes. Le filtre de statut permet de réduire les résultats.

__SHOT:search-result:0__

### 6. Ouvrir le terme

Sélectionnez sa ligne. Le panneau **Edit term** affiche son code, son nom, son statut et ses autres détails.

__SHOT:open-term:6__

__SHOT:term-details:0__

### 7. Fermer le panneau

Sélectionnez **Close** en haut à droite pour quitter sans enregistrer de modification.

__SHOT:close-term:7__

## Créer un système de codes pour votre liste

Créez un système de codes si la liste nécessaire n'existe pas encore. Choisissez d'abord son éditeur. Les captures utilisent System et laissent Active coché.

**System code** est l'identifiant court. Il ne peut plus être modifié après la création. **System name** est le nom lisible. **Canonical URL** identifie la liste lors des échanges avec d'autres systèmes. Ce champ peut rester vide pour une liste personnalisée.

### 1. Ouvrir le menu de la page

Sélectionnez les trois points à droite du fil d'Ariane de l'éditeur, au-dessus du tableau.

__SHOT:system-actions:1__

### 2. Ouvrir Code system

Sélectionnez **Code system** dans le menu.

__SHOT:code-system-menu:2__

### 3. Choisir New

Sélectionnez **New**. Le panneau **New coding system** s'ouvre.

__SHOT:new-code-system:3__

### 4. Saisir un code de système

Saisissez un code unique dans **System code**. L'exemple utilise `DOCS-GUIDE-REVIEW`.

__SHOT:system-code:4__

### 5. Saisir son nom

Saisissez le nom à afficher dans **System name**.

__SHOT:system-name:5__

### 6. Saisir son URL canonique si nécessaire

Saisissez l'identifiant utilisé par votre organisation dans **Canonical URL**. Pour une liste personnalisée, vous pouvez laisser ce champ vide.

__SHOT:system-url:6__

### 7. Créer le système de codes

Sélectionnez **Create** au bas de ce panneau.

__SHOT:create-system:7__

**Résultat attendu :** le nouveau système apparaît sous l'éditeur choisi. Ouvrez sa ligne pour ajouter des termes.

__SHOT:system-created:0__

## Ajouter un terme

Ajoutez un code et son nom lisible à un système de codes existant. Le code doit être unique dans ce système. Les nouveaux termes ont le statut Active. Le nom court, la classe, l'unité et les métadonnées sont facultatifs.

### 1. Ouvrir le système de destination

Sélectionnez le système qui doit contenir votre terme. Utilisez une liste existante ou celle créée plus haut.

__SHOT:system-created:1__

### 2. Ouvrir le menu des termes

Sélectionnez les trois points à côté de **Search terms…** et du filtre de statut.

__SHOT:term-actions:2__

### 3. Choisir New term

Sélectionnez **New term**.

__SHOT:new-term:3__

### 4. Saisir le code

Saisissez la valeur à enregistrer dans **Code**. L'exemple utilise `EXAMPLE-1`.

__SHOT:term-code:4__

### 5. Saisir le nom affiché

Saisissez un libellé lisible dans **Display name**.

__SHOT:term-display:5__

### 6. Ouvrir le menu de l'éditeur de terme

Sélectionnez les trois points à côté des onglets **Details** et **Mappings**.

__SHOT:term-sheet-actions:6__

### 7. Choisir Create

Sélectionnez **Create** pour enregistrer le nouveau terme.

__SHOT:create-term:7__

**Résultat attendu :** le panneau se ferme et le terme apparaît dans le système de codes.

__SHOT:term-created:0__

## Modifier le nom affiché d'un terme

Corrigez le libellé lisible si nécessaire. Le code enregistré reste identique.

### 1. Ouvrir le terme

Sélectionnez sa ligne dans le système de codes.

__SHOT:edit-term-row:1__

### 2. Modifier Display name

Remplacez le texte de **Display name**. L'exemple utilise `Updated example label`.

__SHOT:edit-term-name:2__

### 3. Ouvrir le menu de l'éditeur de terme

Sélectionnez les trois points à côté de **Details** et **Mappings**.

__SHOT:term-sheet-actions:3__

### 4. Choisir Save

Sélectionnez **Save**. Les termes existants utilisent Save et les nouveaux termes utilisent Create.

__SHOT:save-term:4__

**Résultat attendu :** la liste affiche le nouveau nom à côté du même code.

__SHOT:term-updated:0__

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

__SHOT:term-actions:1__

### 2. Télécharger le modèle si nécessaire

Sélectionnez **Download template**. Préparez votre fichier à partir de ses champs et de ses exemples.

__SHOT:download-template:2__

### 3. Choisir Import terms

Rouvrez le menu des termes et sélectionnez **Import terms**.

__SHOT:import-terms:3__

### 4. Sélectionner le fichier préparé

Choisissez le fichier dans la fenêtre de votre ordinateur. L'import commence dès la sélection. La capture montre le résultat après la sélection du fichier d'exemple.

__SHOT:import-result:4__

**Résultat attendu :** les codes importés apparaissent dans ce système. La recherche permet de retrouver un code précis.

## Consulter les codes autorisés par un jeu de valeurs

Consultez un jeu de valeurs pour connaître les réponses proposées par un champ de formulaire. Les règles **Include** et **Exclude** définissent la liste. **Expansion** affiche les codes obtenus.

### 1. Revenir à la liste des systèmes

Si une liste de termes est ouverte, sélectionnez **← Code systems**.

__SHOT:back-to-systems:1__

### 2. Sélectionner Value sets

Sélectionnez **Value sets** à côté du nom de l'éditeur. Cet exemple utilise System.

__SHOT:value-sets-tab:2__

### 3. Ouvrir un jeu de valeurs

Sélectionnez sa ligne. Cet exemple ouvre **Test rejection reasons**.

__SHOT:open-value-set:3__

### 4. Lire Expansion

Descendez jusqu'à **Expansion** pour lire les codes produits par les règles.

__SHOT:value-set-expansion:4__

**Résultat attendu :** vous pouvez lire les codes autorisés sans modifier le jeu de valeurs. Leur nombre dépend des systèmes et des règles de votre installation.

## Créer une liste de codes autorisés

Créez un jeu de valeurs pour proposer une liste contrôlée de codes. Cet exemple inclut tous les codes d'un système. Laissez la liste de concepts vide pour inclure le système entier. L'exemple reste Draft pendant sa préparation.

### 1. Ouvrir le menu de la page

Fermez d'abord tout panneau de modification. Sélectionnez les trois points à côté du fil d'Ariane de l'éditeur.

__SHOT:value-set-page-actions:1__

### 2. Ouvrir Value set

Sélectionnez **Value set** dans le menu.

__SHOT:value-set-menu:2__

### 3. Choisir New

Sélectionnez **New** pour ouvrir l'éditeur.

__SHOT:new-value-set:3__

### 4. Saisir l'URL du jeu de valeurs

Saisissez une **Canonical URL** unique. Utilisez une URL différente de celle du système de codes.

__SHOT:value-set-url:4__

### 5. Saisir un titre lisible

Saisissez le nom de votre liste de codes autorisés dans **Title**.

__SHOT:value-set-title:5__

### 6. Choisir le système de codes source

Sous **Include**, ouvrez **System** et choisissez la liste contenant vos termes.

__SHOT:value-set-system:6__

__SHOT:value-set-system-selection:6__

### 7. Ouvrir le menu de l'éditeur

Sélectionnez les trois points en haut à droite de l'éditeur de jeu de valeurs.

__SHOT:value-set-actions:7__

### 8. Choisir Save

Sélectionnez **Save**. L'éditeur calcule l'expansion après l'enregistrement.

__SHOT:save-value-set:8__

**Résultat attendu :** Expansion affiche les codes actifs du système choisi. L'exemple contient deux codes.

__SHOT:value-set-created:0__

Un jeu de valeurs peut aussi inclure des concepts précis, exclure des codes ou importer un autre jeu de valeurs. Sa création ne le lie pas automatiquement à un formulaire. Consultez le [guide Formulaires](/docs/forms) pour configurer les champs.

## Ouvrir l'import d'une distribution standard

LOINC, SNOMED CT et RxNorm proposent un import de distributions ZIP dans le navigateur. Utilisez-le pour le paquet fourni par l'éditeur, plutôt que pour une petite liste de termes locaux.

### 1. Choisir l'éditeur externe

Sélectionnez **LOINC**, **SNOMED CT** ou **RxNorm**. La capture utilise LOINC.

__SHOT:standard-publisher:1__

### 2. Ouvrir le menu de la page

Sélectionnez les trois points à droite du fil d'Ariane de l'éditeur.

__SHOT:standard-actions:2__

### 3. Choisir Import distribution...

Sélectionnez **Import distribution...**.

__SHOT:import-distribution:3__

**Résultat attendu :** le panneau d'import s'ouvre. Il comporte un champ ZIP, une version facultative et une confirmation de licence. L'import se poursuit en arrière-plan après l'envoi.

__SHOT:distribution-importer:0__

Vous fournissez le paquet de distribution et gérez sa licence.

## Choisir un éditeur sur téléphone

La liste des éditeurs est repliée au départ pour laisser plus de place au tableau.

### 1. Afficher les éditeurs

Sélectionnez **Show publishers** en haut à gauche du panneau Terminologie.

__SHOT:phone-show-publishers:1__

### 2. Choisir l'éditeur

Sélectionnez l'éditeur souhaité.

__SHOT:phone-choose-publisher:2__

### 3. Replier la liste des éditeurs

Sélectionnez **Hide publishers** pour redonner la largeur au tableau.

__SHOT:phone-hide-publishers:3__

**Résultat attendu :** l'éditeur choisi reste dans le fil d'Ariane. Faites défiler le tableau horizontalement pour atteindre les colonnes hors écran.

## Dépannage

### L'import indique displayName required

Le message indique la ligne sans nom lisible. Ajoutez `displayName` à ce terme, puis choisissez le fichier corrigé. L'exemple ci-dessous a échoué à la ligne 2.

__SHOT:import-error:0__

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

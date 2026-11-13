# Marketplace

Utilisez Marketplace pour examiner et installer des plugins, modèles de formulaire, rapports et packs de contenu. Les paquets viennent de registres, des listes de fichiers fournies par un éditeur.

**View marketplace** permet de parcourir les paquets disponibles et installés. **Manage marketplace** permet d'installer, désactiver, retirer et gérer les registres.

Commencez par le registre approuvé par votre organisation. Une installation neuve inclut Default registry sur GitHub. Le serveur doit pouvoir le joindre pour lire les paquets.

Les images utilisent un plugin de destination d'entraînement signé depuis un registre local d'exercice. Suivez les mêmes tâches avec votre paquet approuvé. Aucun exemple de documentation n'est nécessaire. La configuration facultative d'exercice se trouve à la fin.

## Trouver votre paquet

Vérifiez sa source et son usage avant de le choisir. Installer un plugin lui accorde les capacités déclarées.

### 1. Ouvrir Marketplace

Ouvrez **Settings**, puis **Marketplace**.

![Ouvrez Settings, puis Marketplace.](marketplace-guide-open.png)

### 2. Choisir Browse

Utilisez **Browse** pour voir les paquets des registres activés.

![Browse liste les paquets proposés par les registres activés.](marketplace-guide-browse.png)

### 3. Rechercher le paquet

Saisissez son identifiant dans Search. L'exemple fictif d'exercice utilise `test-sink`.

![Recherchez par identifiant de paquet.](marketplace-guide-search.png)

### 4. Choisir un type si nécessaire

Utilisez **All types** pour limiter la liste aux plugins, modèles de formulaire, rapports ou packs de contenu.

![Filtrez par type pour trouver un plugin, un formulaire, un rapport ou un pack de contenu.](marketplace-guide-filter.png)

### 5. Vérifier la carte

Lisez l'identifiant, la version, l'éditeur et le registre. Ouvrez la bonne carte de paquet.

![Lisez l'identifiant, la version, l'éditeur et le registre du paquet.](marketplace-guide-card.png)

**Résultat attendu :** le détail s'ouvre. Son ouverture récupère les informations nécessaires aux contrôles de signature, de droits et de compatibilité.

## Lire le paquet avant de l'installer

Le contrôle de signature établit si le fichier correspond à la clé de l'éditeur. Décidez si vous faites confiance à cet éditeur et aux actions du paquet.

### 1. Vérifier la signature

Lisez **Verified** ou l'échec de vérification. Une carte distante non ouverte peut rester Unverified jusqu'au chargement du détail.

![L'ouverture du détail vérifie la signature de l'éditeur.](marketplace-guide-signature.png)

### 2. Lire la description

Lisez ce que fait le paquet et les réglages nécessaires. Ce paquet d'entraînement n'a aucune destination réelle.

![Lisez la description du paquet avant de l'installer.](marketplace-guide-readme.png)

### 3. Lire les droits et exigences

Vérifiez l'éditeur, la version sélectionnée, les droits et la compatibilité. Loading permissions ou Permissions unavailable ne signifie pas qu'aucun droit n'est demandé. Attendez des détails confirmés.

![Lisez la version sélectionnée, les droits et la compatibilité.](marketplace-guide-permissions.png)

**Résultat attendu :** Install devient disponible seulement lorsque la version choisie réussit les contrôles requis. Choisir une autre version relance ses contrôles.

## Approuver et installer un paquet

Effectuez cette tâche uniquement après avoir examiné le paquet choisi et ses capacités.

### 1. Choisir Install

Ouvrez les points du détail du paquet et sélectionnez **Install**.

![Choisissez Install après avoir examiné les détails.](marketplace-guide-install.png)

### 2. Examiner l'approbation

Vérifiez la version et **Requested capabilities**. Un pack de contenu montre plutôt ses étapes incluses.

![Examinez la version et les capacités demandées avant d'approuver.](marketplace-guide-consent.png)

### 3. Approuver cette installation

Sélectionnez **Approve & install** pour continuer. Cancel ferme l'approbation sans installer.

![Approve & install autorise uniquement cette installation examinée.](marketplace-guide-approve.png)

### 4. Vérifier Installed

Utilisez les points du détail puis Back, et choisissez **Installed**. Vérifiez l'identifiant installé et l'état Active.

![Installed liste le plugin enregistré avec son état actif.](marketplace-guide-installed.png)

**Résultat attendu :** le paquet est installé dans cette instance OpenLDR. L'installation ne configure pas toutes les dépendances externes et ne prouve pas que le plugin importe vos données.

## Désactiver ou activer un plugin installé

La désactivation conserve les fichiers et la fiche installés. Elle arrête le chargement du plugin.

### 1. Choisir Disable

Dans Installed, ouvrez le plugin. Ouvrez ses points et sélectionnez **Disable**.

![Disable garde le plugin installé, mais arrête son chargement.](marketplace-guide-disable.png)

### 2. Le réactiver si nécessaire

Après désactivation, ouvrez les mêmes points du panneau et sélectionnez **Enable**. L'action est actualisée après chaque modification réussie ; le panneau peut rester ouvert.

![Enable autorise à nouveau le chargement du plugin installé.](marketplace-guide-enable.png)

**Résultat attendu :** le plugin installé peut se charger à nouveau après activation. Ses paramètres de connexion externes ne changent pas.

## Retirer un plugin installé

Vérifiez les workflows et importations dépendants avant de retirer un plugin.

### 1. Choisir Remove

Ouvrez les points du détail du plugin installé et sélectionnez **Remove**.

![Remove désinstalle ce plugin.](marketplace-guide-remove.png)

### 2. Confirmer l'identifiant du plugin

Dans la confirmation, choisissez **Remove** pour désinstaller ou Cancel pour conserver le plugin. La capture d'exercice retire test-sink.

![Confirmez l'identifiant avant de retirer le plugin.](marketplace-guide-remove-confirm.png)

**Résultat attendu :** le plugin retiré n'est plus installé. Sa carte disponible peut rester dans Browse.

## Ajouter un registre

Utilisez l'URL de registre ou le dossier serveur fourni par votre organisation. Un dossier de registre local contient des répertoires de paquets. Le serveur OpenLDR doit pouvoir y accéder.

### 1. Ouvrir Registries

Choisissez l'onglet **Registries**. Vérifiez les sources existantes pour éviter un doublon.

![Registries liste les sources de paquets.](marketplace-guide-registries.png)

### 2. Choisir Add registry

Ouvrez les points de la barre d'onglets et sélectionnez **Add registry**.

![Choisissez Add registry dans les points de la barre d'onglets.](marketplace-guide-add-registry.png)

### 3. Nommer la source

Saisissez un **Name** utile. L'exemple utilise Example local registry.

![Utilisez un nom identifiant le propriétaire du registre.](marketplace-guide-registry-name.png)

### 4. Choisir son type

Choisissez **Local directory** pour un dossier du serveur API ou **Remote (HTTP)** pour un registre web.

![Un registre local est un dossier du serveur OpenLDR.](marketplace-guide-registry-type.png)

### 5. Saisir son emplacement

Remplissez **Location** avec le dossier serveur ou l'URL de base du registre. L'image utilise un dossier d'exercice isolé.

![Saisissez le dossier visible par le serveur API, pas celui de votre ordinateur.](marketplace-guide-registry-location.png)

### 6. Enregistrer la source

Ouvrez les points du panneau et sélectionnez **Save**.

![Save ajoute le registre.](marketplace-guide-registry-save.png)

**Résultat attendu :** le registre activé apparaît dans la liste. Ses paquets disponibles apparaissent dans Browse. Un dossier de votre ordinateur n'est pas automatiquement visible par un serveur ou un conteneur.

![Le registre local est listé et activé.](marketplace-guide-registry-saved.png)

## Modifier un registre

Un registre désactivé ne fournit plus de paquets disponibles. Il ne désinstalle pas les paquets déjà installés.

### 1. Choisir Edit

Ouvrez les points de la ligne du registre et sélectionnez **Edit**.

![Edit modifie le nom, le type, l'emplacement ou l'activation d'un registre.](marketplace-guide-registry-edit.png)

### 2. Vérifier les paramètres et Enabled

Modifiez le nom, le type, l'emplacement ou l'état Enabled. Enregistrez par les points du panneau. Fermez sans Save pour abandonner les modifications.

![Vérifiez l'emplacement enregistré et Enabled avant de modifier un registre.](marketplace-guide-registry-settings.png)

## Examiner les paquets sur un téléphone

Les mêmes onglets et actions de paquet sont disponibles sur un téléphone.

### 1. Lire une carte de paquet

Recherchez dans Browse et ouvrez la bonne carte. Les cartes s'empilent verticalement.

![Les cartes de Browse s'empilent à la largeur du téléphone.](marketplace-guide-phone.png)

### 2. Examiner la version et les droits

Lisez les détails au-dessus de la description, puis descendez vers les sections restantes.

![La version et les droits apparaissent avant la description sur un téléphone.](marketplace-guide-phone-details.png)

## Packs de contenu et autres types de paquet

Un pack applique ses étapes de données de référence dans l'ordre déclaré. Examinez leur liste et leurs nombres avant l'installation. Un pack peut modifier des systèmes de codes, jeux de valeurs, établissements, associations et requêtes nommées. Une nouvelle tentative peut écraser une requête modifiée localement.

Si l'application d'un pack échoue, les étapes précédentes peuvent rester enregistrées. Lisez Failed at step N et l'erreur, corrigez la cause, puis choisissez de nouveau Install. Un pack refuse les signatures invalides et les contrôles préalables en échec avant toute écriture.

**Detach** oublie la fiche d'un pack ou modèle de formulaire installé en conservant les données créées. Ce n'est pas une désinstallation. Les plugins proposent Remove. Une ancienne version de plugin installée peut proposer Rollback. Ces options dépendent du type choisi et des versions installées.

Un paquet dont les détails ne chargent pas garde l'installation désactivée. Vérifiez la disponibilité du registre avant de réessayer. Le test documenté a suivi le parcours plugin. Il n'a appliqué aucun pack et n'a restauré aucune ancienne version de plugin.

## Utiliser un paquet local depuis la CLI

Suivez [Commencer ici](/docs/start-here) pour configurer la CLI. Depuis `openldr_ce`, l'installation CLI envoie un répertoire de paquet de votre machine au serveur en marche, donc connectez-vous d'abord. Elle ne parcourt pas les registres Studio. Vérifiez et simulez avant d'appliquer un paquet approuvé.

```shell
pnpm openldr market list
pnpm openldr market verify <bundle-directory>
pnpm openldr market install <bundle-directory> --dry-run
pnpm openldr market install <bundle-directory>
pnpm openldr market disable <plugin-id>
pnpm openldr market remove <plugin-id>
```

## Exercice facultatif avec une destination d'entraînement locale

Utilisez vos registres et paquets approuvés pour le travail normal. Le [manifeste d'exercice](https://openldr.online/docs-samples/user-guide/marketplace/manifest.json) facultatif appartient à un paquet d'entraînement signé. Il ne contient pas de données cliniques et n'envoie rien à une destination réelle.

Dans une copie du dépôt sur une installation temporaire, `pnpm build:test-sink` et `pnpm make:docs-marketplace-bundle` créent le paquet d'entraînement du dépôt. Utilisez le dossier généré sur ce serveur comme registre local. Les racines locales contiennent directement les répertoires des paquets. Le format d'index HTTP est différent.

Les images utilisent un dossier d'exercice généré distinct. Ne considérez pas la clé de son éditeur de test comme un choix de confiance en production.

## Résolution des problèmes

**Browse est vide.** Effacez Search et le filtre de type. Vérifiez les registres activés et l'accès du serveur API au dossier ou à l'URL. Utilisez les points de la barre d'onglets puis Refresh après modification des sources.

**Un paquet local manque.** Indiquez le répertoire dont les enfants directs sont les dossiers lisibles des paquets, chacun avec son manifeste et son contenu.

**Permissions unavailable.** Les détails du paquet n'ont pas pu être récupérés. Cela ne prouve pas une liste de droits vide.

**L'approbation reste ouverte après une erreur.** Lisez la notification. Corrigez les exigences signalées de stockage, compatibilité, signature ou autre avant de réessayer.

**Un plugin est installé, mais absent ailleurs.** Vérifiez son activation et la déclaration de la capacité attendue, importateur, page ou autre. Pour les cartes et panneaux, lisez [Cartes et panneaux de plugins](/docs/plugin-sites).

## Guides associés

[Connecteurs](/docs/connectors) décrit les destinations des plugins. [Formulaires](/docs/forms) décrit l'édition des formulaires. [Cartes et panneaux de plugins](/docs/plugin-sites) décrit les emplacements facultatifs des plugins.

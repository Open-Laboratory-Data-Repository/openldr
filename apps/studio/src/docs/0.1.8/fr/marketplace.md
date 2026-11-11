# Marketplace

Le **Marketplace** est l'endroit où les administrateurs trouvent et installent des compléments pour OpenLDR : des **plugins** qui lisent ou envoient des données (un import CSV, un lecteur HL7 v2, un envoi vers DHIS2), des **modèles de formulaires**, et des **packs de contenu** de données de référence comme des systèmes de codes, un registre d'établissements et des requêtes de rapports. Tout vient d'un **registre**, une liste publiée d'artefacts. Une installation neuve en a un, **Default registry**, sur GitHub.

Comptez 10 minutes, avec un accès réseau à GitHub. Sélectionnez une image ou un clip pour l'agrandir.

![Marketplace, Parcourir : les artefacts du registre par défaut, avec leur type, éditeur, version et état de signature.](marketplace-tour.png)

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **View marketplace** | Ouvrir Paramètres, Marketplace, et parcourir les artefacts disponibles et installés |
| **Manage marketplace** | Installer, activer, désactiver, supprimer, et gérer les registres |

## Les trois onglets

- **Parcourir** liste ce que proposent les registres. **Tous les types** filtre par plugin, formulaire ou pack de contenu.
- **Installés (N)** liste ce qu'a cette installation, avec l'état de chaque artefact.
- **Registres** liste d'où viennent les artefacts.

Chaque carte affiche **Non vérifié** tant que sa signature n'a pas été contrôlée. L'ouvrir contrôle la signature, et la carte passe à **Vérifié**.

## Exemple 1 : lire un plugin avant de l'installer

![Ouvrir tabular. Les détails, permissions et prérequis se chargent et il passe à Vérifié.](marketplace-read.mp4)

1. Ouvrez **Paramètres**, puis **Marketplace**. **Parcourir** est ouvert.
2. Sélectionnez **tabular**.

**Résultat attendu :** après quelques secondes, la page affiche **Vérifié**, avec la description **CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)**. Elle montre :

| Champ | Valeur |
| --- | --- |
| Entry point | `convert` |
| Checksum (sha256) | l'empreinte du fichier, contrôlée avant exécution |
| Sandbox | WASI enabled |
| Memory limit | 256 MB |
| Time limit | 30000 ms |
| Permissions | `read-input`, `emit-fhir` (Patient, Specimen, Observation) |
| Prérequis | Compatible with CE 0.1.11 |

![Les détails de tabular : ce qu'il exécute, ce qu'il peut faire et ce dont il a besoin.](marketplace-read-full.png)

Un plugin tourne dans un bac à sable avec une mémoire et un temps fixes. Ses permissions disent ce qu'il peut faire : `tabular` peut lire le fichier qu'on lui donne et écrire des patients, prélèvements et observations FHIR, rien d'autre.

## Exemple 2 : l'installer

![Ouvrir le menu, sélectionner Installer, lire les capacités et approuver.](marketplace-install.mp4)

1. Sur la page **tabular**, ouvrez **⋯** et sélectionnez **Installer**.
2. **Vérifier et approuver : tabular** liste la version et les **Capacités demandées**. Lisez-les.
3. Sélectionnez **Approuver et installer**.

**Résultat attendu :** l'onglet affiche **Installés (1)**, et **tabular** y est listé **Actif**.

![tabular installé et Actif.](marketplace-installed.png)

L'approbation porte sur les capacités de la version choisie. Choisir une autre version relance le contrôle.

## Exemple 3 : le supprimer

![Ouvrir le plugin installé, choisir Supprimer et confirmer.](marketplace-remove.mp4)

1. Sur **Installés**, sélectionnez **tabular**. Ouvrez **⋯**. Il propose **Désactiver**, **Supprimer** et **Retour**.
2. Sélectionnez **Supprimer**, puis **Supprimer** de nouveau dans **Supprimer tabular ?**. Cela désinstalle l'artefact de cette installation.

**Résultat attendu :** **Installés (0)**.

**Désactiver** garde un plugin installé mais l'empêche de se charger. **Rollback**, quand une version plus ancienne est installée, la remet active.

## Registres

![L'onglet Registres : Default registry, Distant (HTTP), sur GitHub.](marketplace-registry-list.png)

1. Ouvrez l'onglet **Registres**. **Default registry** est un registre **Distant (HTTP)** à l'adresse `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main`.
2. Pour en ajouter un, ouvrez le menu **⋯** de la page et sélectionnez **Ajouter un registre**. Remplissez **Nom**, **Type** et **Emplacement (URL ou répertoire)**, puis choisissez **Enregistrer** dans le menu **⋯** du panneau. Fermez le panneau sans enregistrer pour abandonner.

![Le panneau Ajouter un registre.](marketplace-add-registry.png)

Un registre peut être une adresse web ou un dossier du serveur. Un laboratoire sans Internet peut faire pointer un registre dossier vers une copie du marketplace.

## Comprendre les permissions

**Chargement des permissions** signifie que les détails sont en cours de récupération. L'installation reste désactivée.

**Permissions indisponibles** signifie que les permissions n'ont pas pu être établies. Cela ne signifie pas que le paquet ne demande aucune permission. Quittez les détails, vérifiez la disponibilité du registre, puis rouvrez le paquet.

**Aucune permission particulière demandée** apparaît seulement lorsque les détails chargés confirment une liste vide. Pour un paquet déjà installé sans référence au registre, les permissions proviennent de son enregistrement local.

Un changement de version relance cette vérification. L'approbation d'installation utilise les permissions de la version sélectionnée. Elle n'accorde rien avant votre confirmation.

## Gérer les paquets et les registres

Dans **Installés**, utilisez le menu du paquet pour les actions disponibles, notamment l'activation, la désactivation et la suppression.

Dans **Registres**, ouvrez le menu et choisissez **Ajouter un registre**. Renseignez le nom, le type et l'emplacement. Enregistrez, puis vérifiez la ligne créée. Vous pouvez modifier le registre ou le désactiver depuis la liste.

![Liste et formulaire des registres](marketplace-registries.png)

## Packs de contenu

Un pack de contenu est un lot signé de données de référence. Il installe, dans cet ordre, des systèmes de codes, des jeux de valeurs, un registre d'établissements, la mise en correspondance des liens et des requêtes personnalisées. Un paquet ne déclare aucune capacité.

Dans **Parcourir**, filtrez sur **Pack de contenu**. Les détails d'un paquet listent ses étapes avec leurs nombres. La confirmation d'installation affiche la même liste. Il faut la permission de gérer le Marketplace, comme pour les extensions.

L'installation vérifie d'abord chaque étape. Un pack sans signature d'éditeur est refusé. Elle contrôle la signature et la clé de l'éditeur, l'empreinte du fichier et la liste des étapes. Elle contrôle aussi que chaque requête est en lecture seule (SELECT), que le fichier du registre s'aperçoit sans erreur et que le registre n'est pas désactivé. Si un contrôle échoue, rien n'est écrit.

La première installation d'un éditeur épingle sa clé. Un paquet ultérieur signé avec une autre clé est refusé.

Ensuite, l'installation applique les étapes dans l'ordre. Si une étape échoue, les étapes précédentes restent écrites. Le paquet affiche **Échec à l'étape N** avec l'erreur sur sa carte et dans ses détails. Choisissez **Installer à nouveau** dans le menu `⋯` pour la terminer.

Installer deux fois est sans risque :

- Les systèmes de codes et les jeux de valeurs sont remplacés selon leur URL.
- La source du registre est réutilisée et ses lignes sont mises à jour selon leur code.
- La mise en correspondance des liens est relancée.
- Les requêtes sont remplacées selon leur nom. Une requête modifiée par un administrateur est écrasée à la nouvelle installation du paquet.

Les lignes absentes du registre d'un paquet plus récent sont signalées. Elles ne sont jamais retirées.

Une étape de registre peut lister des colonnes supplémentaires. Leurs valeurs vont dans les `extras` de chaque établissement, sous le nom de la colonne en minuscules. Les requêtes personnalisées les lisent dans la table `facility_registry` de l'entrepôt. Toute autre colonne inconnue du registre fait toujours refuser le paquet. Une version plus ancienne de CE refuse un paquet qui liste des colonnes supplémentaires, et n'écrit rien.

Un pack peut associer des codes de test de laboratoire à des tests du catalogue (**Correspondances de tests**). Il indique le code LOINC de chaque code, et CE l'associe au test du catalogue lié à ce LOINC. Un code que le pack ne peut pas résoudre est ignoré et listé : aucun test du catalogue n'a ce LOINC, ou deux l'ont. Un code déjà associé ici est conservé. La simulation en ligne de commande (`openldr market install <dir> --dry-run`) liste ce qu'elle associerait, conserverait et ignorerait.

Choisissez **Détacher** pour oublier l'enregistrement d'installation. Tout ce que le paquet a écrit est conservé. Il n'existe pas de désinstallation.

Dans la ligne de commande, `openldr market install <bundle-dir> --dry-run` exécute les contrôles et affiche les étapes, avec le nombre de codes que chaque étape de mise en correspondance des liens lierait. Elle n'écrit rien.

## En ligne de commande

La CLI installe depuis un dossier de bundle sur le serveur, pas depuis un registre.

```bash
./openldr market list
./openldr market verify <bundle-dir>
./openldr market install <bundle-dir> --dry-run
./openldr market disable tabular
./openldr market remove tabular
```

`verify` contrôle le manifeste, le fichier et la clé de l'éditeur d'un bundle. `install --dry-run` lance tous les contrôles sans rien écrire. `update` n'installe un pack de contenu que si le bundle est plus récent que celui installé. `rollback <id> <version>` réactive une version plus ancienne d'un plugin.

## Sur un téléphone

Le Marketplace fonctionne sur un téléphone. Les cartes s'empilent en une colonne. Sur la page d'un artefact, les détails, permissions et prérequis viennent d'abord, au-dessus de la description.

## Dépannage

- **Parcourir est vide.** Le registre est injoignable ou désactivé. Vérifiez **Registres**, et que le serveur joint l'adresse du registre.
- **La carte reste Non vérifié.** Ouvrez-la. La signature se contrôle au chargement des détails.
- **Les permissions affichent Permissions indisponibles.** Les détails n'ont pas pu être lus. Cela ne veut pas dire que l'artefact n'a besoin d'aucune permission. L'installation reste désactivée.
- **L'installation échoue.** Vérifiez la compatibilité, les capacités et la disponibilité du registre.
- **Un artefact installé n'apparaît pas ailleurs.** Vérifiez qu'il est actif et pris en charge par cette partie de l'application.

## Guides associés

- [Paramètres](/docs/settings)
- [Connecteurs](/docs/connectors)
- [Formulaires](/docs/forms)
- [Établissements](/docs/facilities)

# Terminologie

La **Terminologie** contient les codes qu'OpenLDR comprend : codes d'examens, types de prélèvement, motifs de refus, pays, types d'établissement, et les grands systèmes externes comme LOINC et SNOMED CT quand vous les chargez. Les formulaires, le catalogue des examens, les établissements et les rapports lisent leurs codes ici, donc un code modifié ici change ce qu'ils proposent.

La page a trois niveaux. Les **éditeurs** (Publishers), à gauche, regroupent les systèmes de codes selon qui les maintient. Un **système de codes** (code system) est une liste de codes, comme les motifs de refus d'un examen. Un **terme** (term) est un code de cette liste, avec son nom affiché. Les **value sets** choisissent des codes dans un ou plusieurs systèmes pour un usage précis, comme les réponses qu'accepte un champ de formulaire.

La page Terminologie et ses panneaux sont en anglais uniquement, ce guide garde donc leurs libellés anglais. Comptez 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Terminologie, éditeur System : les systèmes de codes de cette installation, avec leur URL et leur source.](terminology-tour.png)

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **Browse terminology** | Ouvrir la Terminologie et lire éditeurs, systèmes de codes, termes et value sets |
| **Manage terminology** | Ajouter, modifier et supprimer éditeurs, systèmes de codes, termes et value sets, et importer |

## Ce qu'a une installation neuve

L'éditeur **System** contient les systèmes de codes qu'OpenLDR installe et maintient, comme **REJECT-TEST** (motifs de refus d'un examen), **REJECT-ORDER** (motifs de refus d'une demande), **TEST-CATALOG**, **TEST-CATEGORY**, **FACILITY-TYPE** et **ISO-3166** (pays). D'autres apparaissent au fil du travail. Importer un registre d'établissements, comme dans [Établissements](/docs/facilities), ajoute deux listes des niveaux et statuts observés de ce registre.

**HL7 FHIR** contient les value sets standard de FHIR. **LOINC**, **SNOMED CT**, **WHO · ICD-10**, **WHO · ICD-11**, **UCUM** et **RxNorm** sont vides tant que vous ne les chargez pas. Chacun affiche **No code systems or value sets yet**.

## Exemple 1 : parcourir un système de codes

![Ouvrir REJECT-TEST depuis l'éditeur System.](terminology-browse.mp4)

1. Ouvrez **Terminologie**. L'éditeur **System** est sélectionné, sur l'onglet **Code systems**.
2. Sélectionnez la ligne **REJECT-TEST**.

**Résultat attendu :** quatre termes, tous **ACTIVE** : `CLOTTED` Clotted, `CONTAINER` Wrong container, `HAEM` Haemolysed, et `QNS` Insufficient volume. Ce sont les motifs qu'un laboratoire peut donner pour refuser un examen d'un Lab order.

La recherche filtre les termes par code ou nom. La liste des statuts montre aussi les termes retirés. **← Code systems** revient à la liste.

## Exemple 2 : ajouter un motif de refus

Ajoutez **Unlabelled specimen** comme motif de refus d'un examen, puis voyez-le dans le Lab order.

![Ajouter UNLABELLED, Unlabelled specimen, à REJECT-TEST.](terminology-add-term.mp4)

1. Avec **REJECT-TEST** ouvert, ouvrez le menu **⋯** de la page. Sélectionnez **Term**, puis **New**. Le panneau **New term** s'ouvre.
2. Dans **Code**, tapez `UNLABELLED`. Dans **Display name**, tapez `Unlabelled specimen`. Laissez **Status** sur **Active**.
3. Ouvrez le menu **⋯** du panneau et enregistrez.

**Résultat attendu :** **5 terms**, avec **UNLABELLED** Unlabelled specimen à la fin.


Ouvrez maintenant le Lab order : **Formulaires**, **Lab order**, **View/Run**. Choisissez un examen, ouvrez le menu **⋯** de sa ligne et sélectionnez **Refuser avec un motif**. **Unlabelled specimen** figure dans la liste, avec son code.

![La liste de refus du Lab order propose maintenant Unlabelled specimen.](terminology-reason-in-order.png)

Pour retirer le motif, ouvrez le menu **⋯** de sa ligne dans la Terminologie et sélectionnez **Delete**. L'autre entrée de ce menu est **View**.

## Exemple 3 : lire les value sets

![L'onglet Value sets de l'éditeur System.](terminology-value-sets.png)

1. Ouvrez **Terminologie** et sélectionnez l'onglet **Value sets**.

**Résultat attendu :** 17 value sets, comme **Biological Sex** (4 codes), **Country** (249), **Facility Type** (63), **Test rejection reasons** et **This lab's tests**.

Un value set qui prend un système de codes entier, ou qu'OpenLDR calcule à la volée, affiche **0** sous **Codes** dans cette version, et son panneau dit **Expansion is empty**. **Test rejection reasons** et **This lab's tests** sont dans ce cas. Lisez la vraie liste en ligne de commande :

```bash
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology expand urn:openldr:valueset:lab-tests
```

Avec le catalogue d'exemple activé, comme dans [Catalogue des examens, Exemple 2](/docs/test-catalog#exemple-2-activer-des-examens-dans-ce-laboratoire), la seconde affiche `5 total; CREAT, FBC, GLU, HIV-VL, MAL-RDT`. C'est la liste que propose le champ **Tests** du Lab order.

Un value set standard est en lecture seule. Son panneau dit de le dupliquer pour le modifier.

## Importer des termes

Le menu **⋯** de la page, sous **Term**, propose **Import terms…** et **Download template**. Le modèle est un fichier texte avec un objet JSON par ligne :

```text
{"type":"meta","codingSystem":"REJECT-TEST","version":"2026-01-01"}
{"code":"LEAKED","displayName":"Leaking container"}
```

`code` et `displayName` sont obligatoires. `shortName`, `class`, `unit`, `status` et `metadata` sont facultatifs. Les lignes vides et celles qui commencent par `//` sont ignorées. Un CSV avec les colonnes `code` et `display` est aussi lu.

Une ligne sans `code` ou sans `displayName` arrête l'import. Le message indique la ligne, et rien n'est importé.

Les grands systèmes externes se chargent en ligne de commande :

```bash
./openldr terminology import loinc <path> --accept-license
./openldr terminology distribution import snomed --file <snomed.zip> --accept-license
```

## D'où vient un système de codes

Le tableau des systèmes de codes affiche une description sous chaque nom, quand le système en a une, et une colonne **Source** :

- **OpenLDR** : CE l'installe et le maintient. Il ne peut pas être supprimé.
- **Received data** : CE l'a créé en projetant des données reçues, par exemple les codes de laboratoire vus dans les résultats.
- **Imported** : un administrateur l'a importé, depuis cette page ou avec `openldr terminology import resource`.
- **Content pack** : un pack de contenu l'a installé. Le pack et sa version s'affichent sous l'étiquette.
- **Facility register** : un registre d'établissements. Ses établissements sont dans Établissements.
- **Created here** : un administrateur l'a créé sur cette page.

Un système importé prend son nom et sa description dans le `title` (ou `name`) et la `description` de la ressource. `openldr terminology system list` affiche la même source dans sa dernière colonne.

## Catalogue des examens et catégories

Chaque installation a deux systèmes de codes sous l'éditeur System. **Test catalog** contient la liste nationale des examens. **Test categories** contient les catégories possibles d'un examen, d'abord Chemistry, Haematology, Microbiology, Serology et Molecular. Ajoutez ou renommez des catégories ici.

Un examen du catalogue porte aussi une catégorie et des types de prélèvement que cette page n'affiche pas. Son code LOINC est une correspondance, visible dans l'onglet Mappings du terme. Modifier un examen ici garde sa catégorie, ses prélèvements et son lien LOINC. Un terme ajouté ici n'a ni catégorie ni prélèvement. Sur un laboratoire qui reçoit le catalogue du central, le prochain changement du central remplace toute modification faite ici.

## En ligne de commande

```bash
./openldr terminology system list
./openldr terminology term list urn:openldr:cs:reject-test
./openldr terminology lookup urn:openldr:cs:reject-test HAEM
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology valueset list
```

`system list` affiche la source de chaque système dans sa dernière colonne. `term list` affiche les quatre termes de REJECT-TEST et leur statut. `lookup` affiche un code, ici `HAEM: Haemolysed`. `validate-code --code HAEM --valueset urn:openldr:valueset:test-reject-reason` affiche `true: HAEM is in urn:openldr:valueset:test-reject-reason`.

## Quoi utiliser quand

- Utilisez des **termes** pour des valeurs codées seules.
- Utilisez des **value sets** quand un champ de formulaire a besoin d'une liste fermée de réponses.
- Utilisez des **index d'ontologie** quand il faut une hiérarchie, des relations ou l'exploration de concepts. Ils viennent avec les distributions LOINC, SNOMED CT et RxNorm.
- Liez tôt les formulaires à la terminologie, pour que les données envoyées soient assez cohérentes pour les rapports et les workflows.

## Sur un téléphone

Sur un téléphone, la liste des éditeurs reste ouverte et prend presque la moitié de l'écran, avec des noms coupés. Repliez-la avec le bouton à côté de **PUBLISHERS** pour donner de la place au tableau. Le tableau défile sur le côté jusqu'au menu **⋯** de chaque ligne.

## Dépannage

- **Import terms s'arrête avec `line 3: displayName required`.** Cette ligne n'a pas de nom. Corrigez-la et importez à nouveau. Rien du fichier n'a été enregistré.
- **Un value set affiche 0 code.** Il prend un système entier ou est calculé à la volée. Utilisez `openldr terminology expand <url>`.
- **Un nouveau terme n'apparaît pas dans un formulaire.** Rechargez le formulaire. Un value set avec une liste fixe de codes doit aussi recevoir le nouveau code.
- **Forme de fichier non prise en charge.** Comparez votre fichier au modèle téléchargé.
- **Code ou nom affiché manquant.** Corrigez le fichier source : les deux sont nécessaires.
- **Une source est indisponible.** Vérifiez la licence et la disponibilité de la source avant d'attendre qu'elle s'affiche.
- **Un index d'ontologie est vide.** Le système n'a peut-être pas de hiérarchie, ou l'index n'a pas été construit pour cette source.
- **Une entrée a perdu des propriétés après modification.** Avant le 2026-09-15, enregistrer un terme ici effaçait toutes les propriétés que la page n'affiche pas, comme les parties LOINC, le type d'un organisme ou le rôle d'un paramètre de résultat. Ce n'est plus le cas. Les entrées abîmées avant restent abîmées jusqu'à la réimportation de leur source : `openldr terminology import loinc <path> --accept-license` pour LOINC, `openldr terminology import organisms <file>` pour les organismes, et `openldr terminology import parameters <file>` pour les paramètres de résultat.

## Guides associés

- [Formulaires](/docs/forms)
- [Catalogue des examens](/docs/test-catalog)
- [Établissements](/docs/facilities)
- [Audit](/docs/audit)

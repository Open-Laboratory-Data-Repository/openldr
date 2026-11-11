# Importer depuis OpenLDR v1

## Résultat

Vous pouvez copier les demandes, les patients, les résultats et les résultats AST d'une base SQL Server OpenLDR v1 vers CE. L'import s'exécute sur le serveur CE. Vous pouvez l'arrêter et le reprendre plus tard.

## Avant de commencer

- Il vous faut le rôle `lab_admin`, et la capacité `connectors.manage` pour autoriser le connecteur.
- Le plugin **OpenLDR v1 import** est installé. Installez-le depuis **Paramètres > Marketplace**, ou avec `openldr plugin install` pour un fichier de plugin.
- Un connecteur Microsoft SQL pointe vers la base v1. Voir [Se connecter à SQL Server et diagnostiquer une connexion](/docs/connector-diagnose).
- Connaissez le décalage UTC du laboratoire qui a écrit les données v1, par exemple `+02:00`.

Le plugin n'ouvre jamais lui-même de connexion à une base. Il fournit des requêtes en lecture seule. CE les exécute sur un connecteur que vous autorisez, et enregistre ce que le plugin convertit.

## Autoriser le connecteur

1. Ouvrez **Paramètres > Connecteurs**.
2. Ouvrez le menu **⋯** du connecteur SQL Server v1 et choisissez **Accès des plugins**.
3. Activez l'interrupteur de `openldr-v1-import`.

Désactivez l'interrupteur pour que le plugin ne lise plus ce connecteur. Les deux changements sont écrits dans le journal d'audit.

## Lancer l'import

Ouvrez **OpenLDR v1 import** dans la barre latérale. La page compte cinq étapes.

| Étape | Ce que vous faites |
| --- | --- |
| 1. Source | Choisissez le connecteur. **Vérifier la connexion** le teste étape par étape. |
| 2. Options | Indiquez le fuseau horaire du site. Les autres options sont facultatives. |
| 3. Vérifications | CE compte les tables et les lignes v1. Rien n'est importé. |
| 4. Essai à blanc | CE lit et convertit quelques demandes et n'enregistre rien. |
| 5. Import | Lancez l'import, suivez-le, arrêtez-le ou reprenez-le. |

### Options

| Option | Signification |
| --- | --- |
| Fuseau horaire du site | Obligatoire. Les dates v1 n'ont pas de fuseau, donc cette valeur fixe l'heure enregistrée. Utilisez la forme `+02:00`, ou `Z`. |
| Base de données | Laissez vide pour utiliser la base définie sur le connecteur. |
| Date de début, Date de fin | Limitent l'import par date d'enregistrement. Laissez les deux vides pour tout importer. |
| Codes de panel | Codes de panel v1 séparés par des virgules. Laissez vide pour tous les panels. |

### Vérifications

L'import a besoin de quatre tables : `Requests`, `LabResults`, `Patients` et `ASTResults`. Si la page affiche moins de 4 sur 4, vérifiez le nom de la base à l'étape Options.

### Essai à blanc

Saisissez le nombre de demandes à essayer, de 1 à 5000, et choisissez **Lancer l'essai**. La page affiche combien de demandes seraient enregistrées et combien ont échoué. Chaque demande en échec est listée avec une raison. Vous pouvez continuer une fois l'essai terminé.

### Import

Choisissez **Lancer l'import**. La page affiche les demandes lues, enregistrées et en échec, le nombre d'enregistrements et la vitesse.

- Les compteurs avancent une page à la fois. Une page compte 500 demandes, donc les chiffres peuvent rester immobiles un moment.
- Vous pouvez quitter la page. L'import continue sur le serveur. La page s'ouvre sur l'import en cours à votre retour.
- **Arrêter** termine l'import après la page en cours de traitement.
- **Reprendre** continue à partir de la dernière demande traitée. Utilisez-le après un arrêt, un échec ou un redémarrage du serveur.
- Une demande déjà importée est remplacée, pas dupliquée. Relancer l'import est sans risque.

## Demandes en échec

Une demande en échec n'arrête pas l'import. La page liste les 100 premières avec une raison. CE ne stocke qu'un code de raison, jamais le contenu de la ligne.

| Code | Signification |
| --- | --- |
| `NO_REQUEST_ROWS` | La demande n'a aucune ligne dans la table Requests. |
| `NO_OBR_SET_ID` | Une ligne de demande n'a pas d'OBRSetID. |
| `NO_OBX_ID` | Une ligne de résultat n'a pas d'OBXSetID ou d'OBXSubID. |
| `BAD_REQUEST_ID` | Le RequestID ne peut pas servir d'identifiant d'enregistrement. |
| `SAVE_FAILED` | CE n'a pas pu enregistrer la demande. |
| `INVALID_RESOURCE` | Le plugin a renvoyé un enregistrement que CE n'accepte pas. |

## En ligne de commande

Un serveur sans écran lance le même import :

```bash
openldr import allow openldr-v1-import <connector-id>
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
```

`Ctrl+C` arrête l'import à la page suivante. Autres commandes : `openldr import status`, `stop`, `resume`, `failures`, `allowed` et `revoke`. Ajoutez `--json` pour une sortie lisible par une machine.

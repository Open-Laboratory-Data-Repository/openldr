# Importer depuis OpenLDR v1

Le plugin **OpenLDR v1 import** copie les demandes, patients, résultats et résultats d'antibiogramme d'une base SQL Server OpenLDR v1 vers CE. L'import tourne sur le serveur CE, page par page. Vous pouvez l'arrêter et le reprendre plus tard, et le relancer remplace les enregistrements au lieu de les dupliquer.

Le plugin n'ouvre jamais lui-même de connexion à une base. Il fournit des requêtes en lecture seule. CE les exécute sur un connecteur que vous autorisez, et enregistre ce que le plugin convertit.

Comptez 10 minutes de lecture. L'import d'une grande base v1 prend bien plus longtemps. Ce guide n'a pas encore d'images : le bundle du plugin n'est pas publié sur le marketplace, et il faut une base v1 pour le montrer en action.

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **Manage connectors** | Autoriser ou retirer l'accès du plugin à un connecteur |
| Rôle Lab Admin | Ouvrir la page du plugin, lancer vérifications, essais et imports |

## Avant de commencer

- Le plugin **OpenLDR v1 import** est installé. Installez-le depuis **Paramètres**, **Marketplace**, ou avec `openldr plugin install` pour un fichier de plugin. Voir [Marketplace](/docs/marketplace).
- Un connecteur Microsoft SQL pointe vers la base v1. Voir [Se connecter à SQL Server et diagnostiquer une connexion](/docs/connector-diagnose). Lancez d'abord **Diagnostiquer** dessus : chaque étape doit réussir.
- Connaître le décalage UTC du laboratoire qui a écrit les données v1, par exemple `+02:00`.

## Exemple 1 : autoriser le plugin à lire le connecteur v1

1. Ouvrez **Paramètres**, puis **Connecteurs**.
2. Sur le connecteur SQL Server v1, ouvrez **⋯** et choisissez **Accès des plugins**.
3. Activez l'interrupteur de `openldr-v1-import`.

**Résultat attendu :** l'interrupteur reste activé. L'autorisation et le retrait sont tous deux écrits dans le journal d'audit, avec leur auteur. Désactivez l'interrupteur pour que le plugin ne lise plus ce connecteur.

Si le panneau dit qu'aucun plugin installé n'importe depuis ce type de connecteur, le plugin n'est pas installé, ou le connecteur n'est pas Microsoft SQL.

## Exemple 2 : vérifier, essayer, puis importer

Ouvrez **OpenLDR v1 import** dans la barre latérale. La page compte cinq étapes.

| Étape | Ce que vous faites |
| --- | --- |
| 1. Source | Choisissez le connecteur. **Vérifier la connexion** le teste étape par étape. |
| 2. Options | Indiquez le fuseau horaire du site. Les autres options sont facultatives. |
| 3. Vérifications | CE compte les tables et les lignes v1. Rien n'est importé. |
| 4. Essai à blanc | CE lit et convertit quelques demandes et n'enregistre rien. |
| 5. Import | Lancez l'import, suivez-le, arrêtez-le ou reprenez-le. |

1. **Source.** Choisissez le connecteur v1 et sélectionnez **Vérifier la connexion**. Chaque étape doit réussir.
2. **Options.** Réglez **Fuseau horaire du site**, par exemple `+02:00`. Laissez le reste vide pour tout importer.
3. **Vérifications.** Il faut trouver **4 sur 4** tables : `Requests`, `LabResults`, `Patients` et `ASTResults`. S'il en manque, vérifiez le nom de la base à l'étape Options.
4. **Essai à blanc.** Saisissez `100` et choisissez **Lancer l'essai**. La page affiche combien de demandes seraient enregistrées et combien ont échoué, chaque échec avec une raison. Vous pouvez continuer une fois l'essai terminé.
5. **Import.** Choisissez **Lancer l'import**.

**Résultat attendu :** la page affiche les demandes lues, enregistrées et en échec, le nombre d'enregistrements et la vitesse. Les compteurs avancent une page à la fois. Une page compte 500 demandes, donc les chiffres peuvent rester immobiles un moment.

- Vous pouvez quitter la page. L'import continue sur le serveur. La page s'ouvre sur l'import en cours à votre retour.
- **Arrêter** termine l'import après la page en cours de traitement.
- **Reprendre** continue à partir de la dernière demande traitée. Utilisez-le après un arrêt, un échec ou un redémarrage du serveur.
- Une demande déjà importée est remplacée, pas dupliquée. Relancer l'import est sans risque.

### Options

| Option | Signification |
| --- | --- |
| Fuseau horaire du site | Obligatoire. Les dates v1 n'ont pas de fuseau, donc cette valeur fixe l'heure enregistrée. Utilisez la forme `+02:00`, ou `Z`. |
| Base de données | Laissez vide pour utiliser la base définie sur le connecteur. |
| Date de début, Date de fin | Limitent l'import par date d'enregistrement. Laissez les deux vides pour tout importer. |
| Codes de panel | Codes de panel v1 séparés par des virgules. Laissez vide pour tous les panels. |

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

## Audit et Activité

- Chaque import apparaît sur la page **Activité** comme une seule entrée. Elle indique le plugin, qui l'a lancé, et combien de demandes ont été importées ou ont échoué. Son état est En cours, Arrêtée, Terminée ou Échec. Un essai à blanc n'enregistre rien et n'est pas listé.
- La page **Audit** enregistre chaque autorisation, retrait, lancement, arrêt, reprise et fin, avec son auteur.
- CE écrit d'abord l'entrée d'audit. Si elle ne peut pas être écrite, CE refuse d'autoriser un connecteur, de lancer ou de reprendre un import.
- Chaque enregistrement importé garde l'identifiant de l'import, le plugin et sa version, et le système source.

Un import ne lance pas un flux de travail pour chaque demande. Les flux qui réagissent à l'événement `data.persisted` ne s'exécutent pas pour les enregistrements importés.

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

## Sur un téléphone

La page du plugin a été conçue pour tenir sur un téléphone. Lancer un long import reste plus simple depuis un ordinateur.

## Dépannage

- **Le plugin n'est pas dans la barre latérale.** Installez-le depuis le Marketplace.
- **Accès des plugins ne liste rien.** Le connecteur n'est pas Microsoft SQL, ou le plugin n'est pas installé.
- **Vérifier la connexion échoue.** Lancez **Diagnostiquer** sur le connecteur et corrigez l'étape indiquée.
- **Les vérifications trouvent moins de 4 sur 4 tables.** Le nom de la base est faux. Réglez-le à l'étape Options, ou sur le connecteur.
- **Les compteurs ne bougent pas.** Une page compte 500 demandes. Attendez la page suivante avant de conclure à un blocage.
- **L'import refuse de démarrer.** CE n'a pas pu écrire son entrée d'audit, et refuse d'autoriser, de lancer ou de reprendre sans elle. Consultez le journal du serveur.
- **Les workflows n'ont pas tourné pour les enregistrements importés.** C'est normal. Un import n'émet pas `data.persisted`.

## Guides associés

- [Se connecter à SQL Server et diagnostiquer une connexion](/docs/connector-diagnose)
- [Connecteurs](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Activité](/docs/activity)
- [Audit](/docs/audit)

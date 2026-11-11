# Connecteurs

Un **connecteur** est une connexion enregistrée vers un autre système : une base de données, un serveur de messagerie, un serveur de fichiers, ou une destination fournie par une extension installée. Les nœuds de workflow, les requêtes personnalisées et les rapports utilisent un connecteur **par son nom**. Aucun d'eux ne stocke de mot de passe. Le serveur le fournit au moment de l'exécution.

Comptez 15 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Paramètres, Connecteurs sur une installation neuve : un connecteur, Target Warehouse (Postgres).](connectors-tour.png)

## Qui peut faire quoi

Une seule capacité couvre cette page : **Manage connectors**. Sans elle, Connecteurs n'apparaît pas dans les Paramètres. Le rôle intégré **Administrator** l'a.

## Ce qu'a une installation neuve

Un connecteur, **Target Warehouse (Postgres)**. Il pointe vers l'entrepôt du laboratoire, la base où OpenLDR écrit les données de laboratoire. Les rapports intégrés et les requêtes personnalisées lisent par lui. Ne le supprimez pas.

La liste montre pour chaque connecteur son **Nom**, son **Type**, l'**Hôte autorisé du plugin** et un interrupteur **Activé**. **Hôte autorisé du plugin** est le seul hôte réseau qu'un connecteur d'extension peut joindre. Ce n'est pas l'adresse de connexion enregistrée, et les connecteurs hôtes le laissent vide. Ouvrez **Modifier** pour voir l'adresse d'un connecteur hôte.

## Exemple 1 : tester le connecteur de l'entrepôt

![Ouvrir le menu de la ligne Target Warehouse et sélectionner Tester. Connexion réussie s'affiche.](connectors-test.mp4)

1. Ouvrez **Paramètres**, puis **Connecteurs**.
2. Sur la ligne **Target Warehouse (Postgres)**, ouvrez le menu **⋯** et sélectionnez **Tester**.

**Résultat attendu :** **Connexion réussie** sous le menu de la ligne. Le test part du serveur OpenLDR, pas de votre navigateur. Il prouve donc que le serveur joint la base.

Chaque test est écrit dans l'[Audit](/docs/audit) sous `connector.test`, avec son résultat.

## Exemple 2 : ajouter un connecteur en lecture seule pour les rapports

Un rapport ou une requête personnalisée doit lire les données, pas les changer, et a rarement besoin du nom des patients. Donnez-lui un compte de base de données qui ne lit que les tables utiles. Même une requête fausse ne peut alors ni changer les données, ni lire le nom d'un patient.

Cet exemple crée un compte qui lit les demandes, les résultats, les échantillons, les comptes rendus et les établissements, mais pas les patients.

### Créer le compte de base de données

Sur le serveur, avec l'utilisateur qui fait tourner OpenLDR, lancez ceci depuis le dossier d'installation. Remplacez le mot de passe par le vôtre.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target <<'SQL'
CREATE ROLE report_reader LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE openldr_target TO report_reader;
GRANT USAGE ON SCHEMA public TO report_reader;
GRANT SELECT ON lab_requests, lab_results, specimens, diagnostic_reports, facilities TO report_reader;
SQL
```

### Ajouter le connecteur

![Ajouter Warehouse (read only) : Hôte, Postgres, l'adresse, la base, l'utilisateur et le mot de passe, puis Enregistrer et Tester.](connectors-add.mp4)

1. Sur **Connecteurs**, ouvrez le menu **⋯** de la page et sélectionnez **Ajouter un connecteur**.
2. Dans **Nom**, tapez `Warehouse (read only)`. C'est le nom choisi dans les nœuds de workflow et les requêtes.
3. Réglez **Catégorie** sur **Hôte**. Gardez **Extension** pour les destinations fournies par une extension installée.
4. Réglez **Type de base de données** sur **Postgres**.
5. Remplissez la connexion :

   | Champ | Valeur |
   | --- | --- |
   | Hôte | `postgres` |
   | Port | `5432` |
   | Base de données | `openldr_target` |
   | Utilisateur | `report_reader` |
   | Mot de passe | le mot de passe choisi |

6. Ouvrez le menu **⋯** du formulaire et sélectionnez **Enregistrer**. **Enregistré Warehouse (read only)** s'affiche, avec la nouvelle ligne. Elle est activée au départ.
7. Sur sa ligne, ouvrez **⋯** et sélectionnez **Tester**.

**Résultat attendu :** **Connexion réussie**.

Le clip vient d'une installation de développement, où la base est à `localhost` port `5433`. Sur une installation standard, le serveur la joint à `postgres` port `5432`, comme dans le tableau.

### Voir ce qu'il peut lire, et ce qu'il ne peut pas lire

![Une requête sur Warehouse (read only) : 60 demandes, puis la table patients refusée.](connectors-readonly-query.mp4)

1. Ouvrez **Requête** et ouvrez un nouvel onglet. Voir [Requêtes personnalisées, Exemple 2](/docs/query#exemple-2-ecrire-une-requete).
2. Choisissez le connecteur **Warehouse (read only)**.
3. Tapez `SELECT COUNT(*) AS orders FROM lab_requests` et sélectionnez **Exécuter**.
4. Remplacez-le par `SELECT COUNT(*) AS patients FROM patients` et sélectionnez **Exécuter**.

**Résultat attendu :** la première requête renvoie **60**, les demandes de l'exemple. La seconde échoue. Une marque rouge s'affiche à gauche du connecteur. Pointez-la pour lire **permission denied for table patients**. Le tableau en dessous garde le dernier résultat réussi, donc regardez la marque, pas le tableau. Le compte ne peut pas lire le nom des patients, quelle que soit la requête écrite.

![Le message de la marque rouge : permission denied for table patients.](connectors-readonly-denied.png)

C'est la façon de garder des colonnes privées sur les chemins des connecteurs. L'[Exposition des données](/docs/data-exposure) ne couvre pas les connecteurs.

## Exemple 3 : changer un mot de passe

Quand le mot de passe d'une base change, mettez à jour le connecteur. Ici, le mot de passe de `report_reader` change d'abord. Le connecteur cesse donc de fonctionner jusqu'à sa mise à jour.

1. Changez le mot de passe dans la base :

   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target \
     -c "ALTER ROLE report_reader PASSWORD 'the-new-password'"
   ```

2. Testez de nouveau **Warehouse (read only)**. Il échoue avec **Échec du test : password authentication failed for user "report_reader"**, car le connecteur garde l'ancien mot de passe.

![Le test qui échoue après le changement de mot de passe.](connectors-test-failed.png)

![Modifier le connecteur, taper le nouveau mot de passe, enregistrer et tester de nouveau.](connectors-rotate.mp4)

3. Sur sa ligne, ouvrez **⋯** et sélectionnez **Modifier**. **Mot de passe** est vide et affiche **••• défini (laisser vide pour conserver)**. L'ancien mot de passe n'est jamais affiché.
4. Tapez le nouveau mot de passe dans **Mot de passe**. Laissez les autres champs tels quels.
5. Ouvrez le menu **⋯** du formulaire et sélectionnez **Enregistrer**.
6. Testez de nouveau.

**Résultat attendu :** **Connexion réussie**. Les workflows, requêtes et rapports qui utilisent le connecteur prennent le nouveau mot de passe à leur prochaine exécution. Rien d'autre à changer.

## Comment les workflows utilisent les connecteurs

Un nœud de workflow **Postgres**, **MySQL** ou **Microsoft SQL**, ou un nœud **Send Email**, affiche une liste de connecteurs, pas de champs de mot de passe. La liste est filtrée par type :

- Un nœud **Postgres** ne liste que les connecteurs Postgres.
- Un nœud **Send Email (SMTP)** ne liste que les connecteurs SMTP.

Créez donc le connecteur d'abord, puis ouvrez le nœud et choisissez-le. Si un connecteur manque dans la liste d'un nœud, il n'a pas le bon type ou il est désactivé.

**Le type du connecteur fixe le dialecte SQL.** Le libellé du nœud n'est qu'un libellé. Le dialecte vient du connecteur attaché. Choisissez donc un connecteur dont le type correspond à votre vraie base.

Voir [Workflows](/docs/workflows) pour un exemple complet avec le connecteur de l'entrepôt.

## Sécurité

- Les mots de passe et jetons sont chiffrés au repos avec la clé de chiffrement du serveur. Après l'enregistrement, ils ne sont plus jamais affichés.
- Pour changer un secret, modifiez le connecteur, tapez le nouveau, enregistrez et testez, comme dans l'Exemple 3. Laissez un secret vide pour garder celui enregistré.
- Coupez **Activé** pour empêcher toute utilisation d'un connecteur, sans le supprimer.
- **Supprimer**, dans le menu de la ligne, efface le connecteur et ses secrets. Tout ce qui le visait échoue jusqu'à ce que vous le redirigiez.
- Donnez à chaque connecteur un compte de base de données avec les seuls droits utiles, comme dans l'Exemple 2.
- Ne mettez jamais de secret dans un nom, une note, une capture d'écran ou un libellé de workflow.
- Gardez un connecteur par destination réelle. Le modifier ou le désactiver a alors un seul effet clair.

## Les adresses sont vues depuis le serveur

L'hôte et le port doivent être joignables **depuis le serveur OpenLDR**, pas depuis votre ordinateur.

- Dans une installation standard, OpenLDR tourne dans Docker Compose. Utilisez le nom du service et son port interne, par exemple `postgres` et `5432`.
- Si OpenLDR tourne directement sur une machine, utilisez l'adresse et le port publié que vous utiliseriez sur cette machine, par exemple `localhost` et `5433`.

## Types de connecteurs

Réglez **Catégorie** sur **Hôte** pour ceux-ci. La liste **Type de base de données** contient aussi les services de messagerie et de fichiers, malgré son nom.

| Type | Utilisé par | Champs |
| --- | --- | --- |
| Postgres | Nœud Postgres, requêtes personnalisées, rapports | Hôte, Port (5432), Base de données, Utilisateur, Mot de passe, Utiliser SSL |
| MySQL / MariaDB | Nœud MySQL, requêtes personnalisées, rapports | Hôte, Port (3306), Base de données, Utilisateur, Mot de passe, Utiliser SSL |
| Microsoft SQL | Nœud Microsoft SQL, requêtes personnalisées, rapports | Hôte, Port (1433), Base de données, Utilisateur, Mot de passe, Chiffrer, Faire confiance au certificat serveur |
| MongoDB | Nœud MongoDB | Détails de connexion et base de données |
| Redis | Nœud Redis | Hôte, Port, Mot de passe, Index de base de données |
| SMTP Email | Nœud Send Email | Hôte, Port, Utilisateur, Mot de passe, Utiliser TLS |
| IMAP Email | Nœud Email Trigger | Hôte, Port, Utilisateur, Mot de passe, Utiliser TLS |
| Gmail, Microsoft Outlook | Nœud Send Email | ID client, Secret client, Jeton de rafraîchissement, et Locataire pour Outlook |
| SFTP | Nœuds de transfert de fichiers | Hôte, Port, Utilisateur, Mot de passe |

Pour Microsoft SQL, activez **Chiffrer** pour exiger TLS. N'activez **Faire confiance au certificat serveur** que pour un certificat autosigné sur une installation de test.

Réglez **Catégorie** sur **Extension** pour une destination fournie par une extension de sortie installée, comme un envoi vers DHIS2. Choisissez l'extension sous **Extension de sortie**, puis remplissez **URL de base**, **Nom d'utilisateur** et **Mot de passe**. Si la liste dit qu'aucune extension de sortie n'est installée, installez-en une depuis le [Marketplace](/docs/marketplace).

## Connecteurs de messagerie

Utilisez **SMTP Email** pour le nœud **Send Email**. Il fonctionne avec tout fournisseur SMTP, y compris Gmail avec un mot de passe d'application, Outlook et Office 365, et les relais comme smtp2go ou Mailtrap.

N'utilisez **Gmail** ou **Microsoft Outlook** que si vous avez déjà une application Google Cloud ou Microsoft Entra avec un ID client, un secret client et un jeton de rafraîchissement. C'est plus de travail que ce dont la plupart des laboratoires ont besoin. Pour Gmail, SMTP est plus simple.

| Champ | Valeur |
| --- | --- |
| Hôte | Le serveur de messagerie, par exemple `smtp.gmail.com` |
| Port | `587` avec **Utiliser TLS** désactivé (STARTTLS), ou `465` avec **Utiliser TLS** activé |
| Utilisateur | Le compte d'envoi. C'est aussi l'adresse de l'expéditeur |
| Mot de passe | Le mot de passe du compte, ou un mot de passe d'application pour Gmail |

Le destinataire se règle plus tard, dans le champ **To** du nœud Send Email.

### Envoyer depuis Gmail avec un mot de passe d'application

Une fois la validation en deux étapes activée, Gmail refuse votre mot de passe normal en SMTP avec `534-5.7.9 Application-specific password required`. Utilisez plutôt un **mot de passe d'application** : un mot de passe de 16 caractères que Gmail crée pour une seule application. Il évite la deuxième étape pour cette application seulement, protège votre vrai mot de passe, et peut être révoqué à tout moment.

1. Activez la **validation en deux étapes** sur `myaccount.google.com`, dans Sécurité. Les mots de passe d'application en ont besoin.
2. Allez sur `myaccount.google.com/apppasswords`, donnez-lui un nom, par exemple `OpenLDR`, et sélectionnez **Créer**. Copiez le code de 16 caractères, affiché comme `abcd efgh ijkl mnop`.
3. Ajoutez un connecteur avec **Catégorie** **Hôte** et **Type de base de données** **SMTP Email** :

   | Champ | Valeur |
   | --- | --- |
   | Hôte | `smtp.gmail.com` |
   | Port | `587` |
   | Utilisateur | `you@gmail.com` |
   | Mot de passe | le mot de passe d'application de 16 caractères |
   | Utiliser TLS | Désactivé |

4. Enregistrez, testez, et choisissez ce connecteur dans le nœud Send Email.

Si la page des mots de passe d'application dit qu'ils ne sont pas disponibles, la validation en deux étapes n'est pas complètement activée, ou un administrateur Google Workspace les a désactivés. Utilisez un relais comme **Mailtrap** pour les tests, ou **smtp2go**.

| Fournisseur | Hôte | Port | Utiliser TLS |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 587 | Désactivé, avec un mot de passe d'application |
| Outlook / Office 365 | `smtp.office365.com` | 587 | Désactivé |
| smtp2go | `mail.smtp2go.com` | 2525 ou 587 | Désactivé |
| Mailtrap (tests) | `sandbox.smtp.mailtrap.io` | 587 | Désactivé |

## En ligne de commande

La ligne de commande peut lire et changer un connecteur hôte. Ajouter, tester et supprimer un connecteur se fait dans le studio.

```bash
./openldr connectors inspect <id>
./openldr connectors update <id> --file patch.json
```

- `inspect` affiche du JSON avec la `config` ordinaire et un `secretsSet` vrai ou faux pour chaque secret. Il n'affiche jamais de secret.
- `update` prend un correctif JSON. Les champs absents restent tels qu'enregistrés, et un secret vide garde celui enregistré. Exemple : `{"config":{"host":"db.internal","port":"5432"}}`. Un simple renommage : `{"name":"Lab database"}`.
- La sortie et les enregistrements d'audit ne contiennent jamais de valeur de secret. Protégez tout fichier qui contient un nouveau secret, et supprimez-le ensuite.

L'id du connecteur figure dans `GET /api/connectors`.

## Modifier les paramètres enregistrés

**Modifier** montre les champs ordinaires enregistrés d'un connecteur hôte : hôte, port, base de données et utilisateur quand le type les a. Un secret déjà défini reste vide. Laissez-le vide pour le garder, même si vous changez l'hôte. Les URL, les champs inconnus et les paramètres d'extension ne sont pas affichés.

Pour un connecteur d'extension, saisissez **URL de base**, **Nom d'utilisateur** et **Mot de passe** ensemble, ou laissez les trois vides pour garder les valeurs enregistrées.

## Délai des requêtes

Les requêtes des connecteurs PostgreSQL, MySQL et Microsoft SQL ont une limite de 30 secondes. Une requête lente échoue au lieu de faire attendre un workflow ou un rapport sans fin. La connexion a sa propre limite de 30 secondes. Le formulaire du connecteur n'a pas de champ de délai.

- PostgreSQL et Microsoft SQL annulent la requête en cours.
- MySQL ouvre une seconde connexion avec le même compte pour arrêter la requête. Cela peut prendre une seconde de plus, et le compte doit pouvoir ouvrir une autre connexion et terminer ses propres sessions.

Si une requête atteint la limite, réduisez sa période ou ses filtres et vérifiez son plan dans la base. Si l'erreur dit `server cancellation failed`, OpenLDR a fermé sa propre connexion sans pouvoir confirmer que la base a arrêté la requête. Demandez à l'opérateur de la base de vérifier les requêtes actives.

## Arrêt du serveur

Sur SIGTERM ou SIGINT, l'API cesse d'accepter des requêtes et d'interroger la file. Elle attend les requêtes actives, le lot de file réservé et le cycle de projection en cours, puis ferme ses bases. Un second signal ne lance pas un second arrêt.

Un gestionnaire qui ne rend jamais la main peut faire attendre l'arrêt sans fin. Laissez assez de temps aux importations en cours avant que le gestionnaire de services force l'arrêt. Après l'arrêt du worker, les vidages manuels restent possibles jusqu'à la fermeture du contexte.

## Sur un téléphone

Sur un téléphone, le tableau des connecteurs est plus large que l'écran. Faites-le défiler sur le côté pour atteindre le menu **⋯** de chaque ligne, au bout de la ligne. Le formulaire **Ajouter un connecteur** remplit l'écran, avec les libellés à gauche de chaque champ.

## Dépannage

- **`534-5.7.9 Application-specific password required` (Gmail).** Utilisez un mot de passe d'application, pas votre mot de passe de connexion.
- **Identifiants invalides, ou échec d'authentification.** L'utilisateur ou le mot de passe est faux. Modifiez le connecteur et retapez le secret.
- **Connexion refusée, ou délai dépassé.** L'hôte ou le port est faux, ou le serveur ne le joint pas. Comparez le nom du service Docker et `localhost`.
- **Erreur TLS ou SSL.** Réglez **Utiliser SSL**, **Utiliser TLS** ou **Chiffrer** comme le demande le serveur. Pour SMTP, 587 veut dire **Utiliser TLS** désactivé et 465 activé.
- **permission denied for table.** Le compte de base de données n'a pas de droits sur cette table. C'est peut-être voulu, comme dans l'Exemple 2.
- **Une requête échoue mais l'ancien résultat reste affiché.** La page Requête garde le dernier résultat réussi. La marque rouge à gauche du connecteur contient l'erreur. Pointez-la pour la lire.
- **Un connecteur manque dans la liste d'un nœud.** Son type ne correspond pas au nœud, ou il est désactivé.
- **Le test réussit mais un workflow échoue.** Ouvrez l'onglet des exécutions du workflow et lisez l'erreur du nœud. Voir [Workflows, Exemple 3](/docs/workflows#exemple-3-lire-l-execution). La requête ou ses droits sont la cause habituelle.

## Guides associés

- [Workflows](/docs/workflows)
- [Requêtes personnalisées](/docs/query)
- [Exposition des données](/docs/data-exposure)
- [Rapports planifiés](/docs/report-pipeline)
- [Marketplace](/docs/marketplace)
- [Paramètres](/docs/settings)

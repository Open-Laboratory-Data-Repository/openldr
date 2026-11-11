# Se connecter à SQL Server et diagnostiquer une connexion

CE peut se connecter à une **instance nommée** SQL Server et avec un **compte Windows**, comme beaucoup de systèmes de laboratoire le demandent. Quand une connexion à une base échoue, **Diagnostiquer** la vérifie étape par étape et dit quelle étape a échoué et quoi changer.

Comptez 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

## Qui peut faire quoi

Il faut **Manage connectors**. Les administrateurs du laboratoire l'ont.

## Avant de commencer

- Connaître le nom du serveur, et celui de l'instance s'il y en a une. SQL Server Management Studio les affiche sous la forme `SERVER\INSTANCE`.
- Savoir si le compte est une connexion SQL ou un compte Windows.

## Exemple 1 : diagnostiquer une connexion qui fonctionne

![Choisir Diagnostiquer sur Target Warehouse (Postgres). Chaque étape réussit.](connector-diagnose-ok.mp4)

1. Ouvrez **Paramètres**, puis **Connecteurs**.
2. Sur la ligne **Target Warehouse (Postgres)**, ouvrez **⋯** et sélectionnez **Diagnostiquer**.

**Résultat attendu :** **Toutes les vérifications ont réussi.** Chaque étape montre ce qu'elle a trouvé : l'adresse, le nom résolu en `127.0.0.1`, le port ouvert, la connexion et la version du serveur.

![Le diagnostic du connecteur de l'entrepôt.](connector-diagnose-passed.png)

Sur cette installation de test, l'étape **Paramètres** affiche un avertissement : l'hôte est `localhost`. Quand CE tourne dans Docker, `localhost` désigne le conteneur CE lui-même, pas la machine qui fait tourner la base. Utilisez le nom ou l'adresse IP du serveur.

## Exemple 2 : une instance nommée qui ne répond pas

Ajoutez un connecteur vers une base v1 sur une instance nommée, et voyez le diagnostic trouver l'étape cassée.

![Ajouter un connecteur Microsoft SQL avec localhost\SQLEXPRESS comme hôte.](connector-diagnose-add.mp4)

1. Sur **Connecteurs**, ouvrez le menu **⋯** de la page et sélectionnez **Ajouter un connecteur**.
2. Réglez **Catégorie** sur **Hôte** et **Type de base de données** sur **Microsoft SQL**.
3. Remplissez le formulaire :

   | Champ | Valeur d'exemple |
   | --- | --- |
   | Nom | `v1 database (example)` |
   | Hôte | `localhost\SQLEXPRESS` |
   | Base de données | `OpenLDRData` |
   | Utilisateur | `v1_reader` |
   | Mot de passe | le mot de passe du compte |

   ![Le formulaire Microsoft SQL.](connector-diagnose-form.png)

4. Ouvrez le menu **⋯** du formulaire et sélectionnez **Enregistrer**.
5. Sur la nouvelle ligne, ouvrez **⋯** et sélectionnez **Diagnostiquer**.

![Diagnostiquer le nouveau connecteur. Il s'arrête à SQL Server Browser.](connector-diagnose-browser.mp4)

**Résultat attendu :** **La vérification a échoué à l'étape : SQL Server Browser.** Le nom du serveur a réussi. SQL Server Browser affiche **no reply from SQL Server Browser within 3000 ms**, avec la correction : démarrer le service SQL Server Browser, ouvrir UDP 1434 dans le pare-feu, ou vider le nom d'instance et saisir le port TCP fixe. Port, Connexion et Version du serveur n'ont pas été tentés.

![Le diagnostic, arrêté à SQL Server Browser.](connector-diagnose-failed.png)

La case Hôte garde `localhost\SQLEXPRESS` tel que saisi. CE le sépare en serveur et instance au moment de se connecter, c'est pourquoi l'étape SQL Server Browser a eu lieu. Corrigez l'instance ou le pare-feu, puis choisissez **Relancer** dans le menu **⋯** du diagnostic.

Pour retirer l'exemple, ouvrez le menu **⋯** de sa ligne et sélectionnez **Supprimer**.

## Le formulaire SQL Server

| Champ | Quoi saisir |
| --- | --- |
| Hôte | Le nom ou l'adresse IP du serveur. Vous pouvez aussi taper `SERVER\INSTANCE`. CE le sépare pour vous. |
| Nom d'instance | La partie après la barre oblique inverse, par exemple `SQLEXPRESS`. Laissez vide pour l'instance par défaut. |
| Port | En général `1433`. CE ignore le port quand un nom d'instance est défini, car SQL Server Browser donne le port de l'instance. |
| Base de données | Le nom de la base. |
| Domaine Windows | Laissez vide pour une connexion SQL. Remplissez-le pour un compte Windows, par exemple `LAB`. |
| Utilisateur | La connexion SQL, ou le nom d'utilisateur Windows sans le domaine. |
| Mot de passe | Le mot de passe. Il est stocké chiffré. |
| Chiffrer | Activé par défaut. Désactivez-le pour un ancien SQL Server (2008 ou 2012) qui ne propose qu'un ancien TLS. |
| Faire confiance au certificat serveur | Activez-le pour un serveur du réseau du laboratoire qui utilise son propre certificat. |

Quand CE tourne dans Docker, `localhost` désigne le conteneur CE, pas votre serveur. Utilisez le nom ou l'adresse IP du serveur.

## Les étapes d'un diagnostic

CE les lance dans l'ordre et s'arrête au premier échec. Les étapes suivantes s'affichent comme ignorées.

| Étape | Ce qu'elle vérifie |
| --- | --- |
| Paramètres | Un hôte est défini et le port est un nombre valide. |
| Nom du serveur | Le nom se résout en adresse depuis le serveur CE. |
| SQL Server Browser | Seulement pour une instance nommée. SQL Server Browser, sur le port UDP 1434, liste l'instance et son port TCP. |
| Port | Le port TCP répond. |
| Connexion | CE peut se connecter et ouvrir la base. |
| Version du serveur | CE peut lancer une requête, et affiche la version du serveur. |

Chaque étape en échec dit quoi changer.

## Dépannage

- **Le nom du serveur ne se résout pas.** Utilisez l'adresse IP, ou ajoutez le nom au DNS ou au fichier hosts du serveur CE.
- **Port : aucune réponse.** Un pare-feu bloque le port. Ouvrez-le sur le serveur de base, ou sur le réseau entre les deux machines.
- **Port : rien n'écoute.** TCP/IP est désactivé, ou le port est faux. Activez TCP/IP dans SQL Server Configuration Manager.
- **SQL Server Browser : aucune réponse.** Démarrez le service SQL Server Browser et ouvrez UDP 1434. Ou videz le nom d'instance et saisissez le port TCP fixe de l'instance.
- **SQL Server Browser a répondu, mais l'instance n'est pas listée.** Vérifiez le nom d'instance, et activez TCP/IP pour elle.
- **Connexion refusée.** Vérifiez l'utilisateur et le mot de passe. SQL Server peut n'accepter que des comptes Windows. Remplissez alors le domaine Windows.
- **La base ne s'ouvre pas.** La connexion a réussi, mais la base manque ou l'utilisateur ne peut pas l'ouvrir. Vérifiez le nom et les droits.
- **Certificat non approuvé.** Activez **Faire confiance au certificat serveur**.
- **Ancien TLS refusé.** Désactivez **Chiffrer**, ou mettez à jour SQL Server.

## En ligne de commande

Lancez les mêmes vérifications sur un serveur sans interface :

```bash
openldr connectors diagnose <connector-id>
```

Pour le connecteur de l'entrepôt de l'Exemple 1, il affiche :

```text
WARN  config   localhost:5433
      When CE runs in Docker, localhost is the CE container itself. Use the server name or IP address of the machine that runs the database.
PASS  dns      localhost resolved to 127.0.0.1
PASS  tcp      port 5433 is open
PASS  login
PASS  version  PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

All checks passed.
```

Ajoutez `--json` pour une sortie lisible par machine. La commande sort avec le code 1 quand une étape échoue. L'id vient de `GET /api/connectors`.

## Sur un téléphone

Le diagnostic couvre presque tout l'écran d'un téléphone, et le message de chaque étape passe sous elle. Le tableau des connecteurs est plus large que l'écran : faites-le défiler sur le côté pour atteindre le menu **⋯** de chaque ligne.

## Guides associés

- [Connecteurs](/docs/connectors)
- [Vérifications d'installation](/docs/setup-checks)
- [Importer depuis OpenLDR v1](/docs/v1-import)

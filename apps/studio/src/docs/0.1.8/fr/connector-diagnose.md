# Se connecter à SQL Server et diagnostiquer une connexion

## Résultat

Vous pouvez connecter CE à une instance nommée de SQL Server, ou avec un compte Windows. Quand une connexion échoue, vous voyez quelle étape a échoué et quoi changer.

## Avant de commencer

- Il vous faut la capacité `connectors.manage` (les administrateurs du laboratoire l'ont).
- Connaissez le nom du serveur, et le nom d'instance s'il y en a un. SQL Server Management Studio les affiche sous la forme `SERVEUR\INSTANCE`.
- Sachez si le compte est une connexion SQL ou un compte Windows.

## Remplir le formulaire SQL Server

Ouvrez **Paramètres > Connecteurs**, ouvrez le menu **⋯** et choisissez **Ajouter un connecteur**. Choisissez la catégorie hôte et **Microsoft SQL**.

| Champ | Que saisir |
| --- | --- |
| Hôte | Le nom ou l'adresse IP du serveur. Vous pouvez aussi saisir `SERVEUR\INSTANCE`. CE le sépare pour vous. |
| Nom d'instance | La partie après la barre oblique inverse, par exemple `SQLEXPRESS`. Laissez vide pour l'instance par défaut. |
| Port | En général `1433`. CE ignore le port quand un nom d'instance est saisi, car SQL Server Browser donne le port de l'instance. |
| Base de données | Le nom de la base. |
| Domaine Windows | Laissez vide pour une connexion SQL. Remplissez-le pour un compte Windows, par exemple `LAB`. |
| Utilisateur | La connexion SQL, ou le nom d'utilisateur Windows sans le domaine. |
| Mot de passe | Le mot de passe. Il est stocké chiffré. |
| Chiffrer | Activé par défaut. Désactivez-le pour un ancien SQL Server (2008 ou 2012) qui ne propose qu'un ancien TLS. |
| Faire confiance au certificat serveur | Activez-le pour un serveur du réseau du laboratoire qui utilise son propre certificat. |

Quand CE tourne dans Docker, `localhost` désigne le conteneur CE, pas votre serveur. Utilisez le nom ou l'adresse IP du serveur.

## Diagnostiquer une connexion

Ouvrez le menu **⋯** de la ligne du connecteur et choisissez **Diagnostiquer**. CE fait ces vérifications dans l'ordre et s'arrête au premier échec. Les étapes après un échec sont marquées comme ignorées.

| Étape | Ce qu'elle vérifie |
| --- | --- |
| Paramètres | Un hôte est saisi et le port est un nombre valide. |
| Nom du serveur | Le nom est résolu en adresse depuis le serveur CE. |
| SQL Server Browser | Seulement pour une instance nommée. SQL Server Browser, sur le port UDP 1434, liste l'instance et son port TCP. |
| Port | Le port TCP répond. |
| Connexion | CE peut se connecter et ouvrir la base. |
| Version du serveur | CE peut lancer une requête, et affiche la version du serveur. |

Chaque étape en échec indique quoi changer. Corrigez, puis choisissez **Relancer** dans le menu **⋯** du panneau.

## Corrections courantes

- **Port : aucune réponse.** Un pare-feu bloque le port. Ouvrez-le sur le serveur de base de données, ou sur le réseau entre les deux machines.
- **Port : rien n'écoute.** TCP/IP est désactivé, ou le port est faux. Activez TCP/IP dans le Gestionnaire de configuration SQL Server.
- **SQL Server Browser : aucune réponse.** Démarrez le service SQL Server Browser et ouvrez UDP 1434. Ou videz le nom d'instance et saisissez le port TCP fixe de l'instance.
- **Connexion refusée.** Vérifiez l'utilisateur et le mot de passe. SQL Server peut n'accepter que les comptes Windows. Renseignez alors le domaine Windows.
- **Certificat non reconnu.** Activez **Faire confiance au certificat serveur**.
- **Ancien TLS refusé.** Désactivez **Chiffrer**, ou mettez à jour SQL Server.

## En ligne de commande

Lancez les mêmes vérifications sur un serveur sans écran :

```bash
openldr connectors diagnose <connector-id>
```

Ajoutez `--json` pour une sortie lisible par une machine. La commande renvoie le code 1 quand une étape échoue.

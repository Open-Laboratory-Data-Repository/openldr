# Connexions SQL Server et diagnostic

Un connecteur Microsoft SQL accepte une instance nommée et un compte Windows. Saisissez l'hôte sous la forme `SERVEUR\INSTANCE`, ou mettez l'instance dans **Nom d'instance**. CE demande alors le port de l'instance à SQL Server Browser sur le port UDP 1434 et ignore le champ **Port**. Remplissez **Domaine Windows** pour vous connecter avec un compte Windows. Laissez-le vide pour une connexion SQL.

**Chiffrer** reste activé sauf si vous le désactivez. Un ancien SQL Server (2008 ou 2012) peut ne proposer qu'une version de TLS que CE refuse. Désactivez Chiffrer pour ce serveur.

Quand CE tourne dans Docker, `localhost` est le conteneur CE. Utilisez le nom ou l'adresse IP du serveur de base de données.

Pour savoir pourquoi une connexion échoue, ouvrez le menu **⋯** de la ligne du connecteur et choisissez **Diagnostiquer**. CE vérifie dans l'ordre : les paramètres, le nom du serveur, SQL Server Browser (instances nommées seulement), le port TCP, la connexion et la version du serveur. Il s'arrête au premier échec et indique quoi changer. Sur un serveur sans écran, lancez les mêmes vérifications avec `openldr connectors diagnose <connector-id>`. Ajoutez `--json` pour une sortie lisible par une machine. La commande renvoie le code 1 quand une étape échoue.

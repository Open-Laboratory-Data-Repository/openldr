# Vérifications d'installation

## Résultat

Vous voyez ce qu'il manque encore à cette installation avant d'être prête, et vous ouvrez la page qui corrige chaque point.

## Avant de commencer

- Il vous faut la capacité `settings.view` (les administrateurs du laboratoire l'ont).

## Ouvrir les vérifications

Ouvrez **Paramètres > Vérifications d'installation**. CE lance les vérifications à l'ouverture de la page. Pour les relancer, ouvrez le menu **⋯** et choisissez **Relancer**.

Chaque vérification affiche un état :

| État | Signification |
| --- | --- |
| Réussi | Rien à faire. |
| Avertissement | CE fonctionne, mais un réglage n'est pas celui dont un vrai laboratoire a besoin. |
| Échec | Quelque chose est cassé ou dangereux. Corrigez-le avant un usage réel. |
| Ignoré | La vérification ne concerne pas cette installation. |

Un avertissement ou un échec indique quoi changer. Quand une page de paramètres le corrige, un lien ouvre cette page.

## Les vérifications

| Vérification | Ce qu'elle regarde | Si elle n'est pas remplie |
| --- | --- | --- |
| Services | La connexion, le stockage de fichiers, les événements et l'entrepôt répondent. | CE ne peut ni servir ni stocker les données. Lancez `openldr health` sur le serveur pour voir quel service est arrêté. |
| Connexion des utilisateurs | La connexion est activée. | Avec `AUTH_DEV_BYPASS` activé, toute personne qui atteint le serveur est administrateur. C'est un échec en production et un avertissement ailleurs. |
| Clé des secrets | `SECRETS_ENCRYPTION_KEY` est défini. | Un connecteur qui contient un mot de passe ne peut être ni enregistré ni lu. |
| Nom du laboratoire | Le nom est défini, et n'est pas celui fourni par défaut. | Les rapports impriment le nom du produit comme laboratoire émetteur. |
| Fuseau horaire | Un fuseau horaire est défini. | Le rapport mensuel de transmission compte les jours en UTC, donc les arrivées du soir tombent le mauvais jour. |
| Connecteurs | Chaque connecteur hôte activé répond. | Les imports et les requêtes sur ce connecteur échouent. La vérification nomme le connecteur. |
| Synchronisation avec le central | La synchronisation a une URL du central et un identifiant de site, et son dernier cycle a réussi. | Les résultats n'arrivent pas au central. |

Trois vérifications peuvent afficher Ignoré :

- **Fuseau horaire** avec un entrepôt SQL Server. Le réglage prend des noms de fuseau IANA, que SQL Server ne peut pas utiliser. Laissez-le vide et saisissez le nom de fuseau Windows à chaque exécution de rapport.
- **Connecteurs** quand aucun connecteur hôte n'est activé.
- **Synchronisation avec le central** quand la synchronisation est désactivée.

## Ce que les vérifications ne montrent pas

Une vérification affiche un nom ou un nombre, jamais un message d'erreur. Les messages d'erreur peuvent contenir des noms de serveurs et d'utilisateurs. Pour le détail d'un connecteur en échec, ouvrez **Paramètres > Connecteurs** et choisissez **Diagnostiquer**.

Chaque exécution est écrite dans le journal d'audit avec les noms des vérifications en échec ou en avertissement.

## En ligne de commande

Un serveur sans écran affiche la même liste :

```bash
openldr doctor
```

Ajoutez `--json` pour une sortie lisible par une machine. La commande renvoie le code 1 quand une vérification a échoué. Les avertissements ne changent pas le code de sortie.

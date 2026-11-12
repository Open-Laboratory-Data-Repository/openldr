# Vérifications d'installation

**Vérifications d'installation** montre ce qu'il manque encore à cette installation avant un usage réel, et ouvre la page qui règle chaque point. C'est le premier endroit à regarder après une installation, et après tout changement sur le serveur.

Comptez 5 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Les vérifications sur une installation de test neuve : trois avertissements, pour la connexion, le nom du laboratoire et le fuseau horaire.](setup-checks-tour.png)

## Qui peut faire quoi

Il faut **View settings**. Les administrateurs du laboratoire l'ont. Régler un point demande la capacité de la page concernée, par exemple **Edit general settings** pour la page Laboratoire.

## Ouvrir les vérifications

Ouvrez **Paramètres**, puis **Vérifications d'installation**, deuxième de la liste. CE lance les vérifications à l'ouverture de la page. Pour les relancer, ouvrez le menu **⋯** et choisissez **Relancer**.

Chaque vérification affiche un état :

| État | Sens |
| --- | --- |
| Réussi | Rien à faire. |
| Avertissement | CE fonctionne, mais un réglage n'est pas celui dont un vrai laboratoire a besoin. |
| Échec | Quelque chose est cassé ou dangereux. Corrigez-le avant un usage réel. |
| Ignoré | La vérification ne s'applique pas à cette installation. |

Un avertissement ou un échec dit quoi changer. Quand une page de paramètres le règle, un lien comme **Ouvrir Laboratoire** ouvre cette page. Le haut de la page compte les avertissements et les échecs, ou affiche **Toutes les vérifications ont réussi.**

## Exemple 1 : lire les vérifications d'une installation neuve

1. Ouvrez **Paramètres**, puis **Vérifications d'installation**.

**Résultat attendu** sur une installation de test neuve avec `AUTH_DEV_BYPASS` activé : **3 avertissements**.

| Vérification | État | Pourquoi |
| --- | --- | --- |
| Services | Réussi | |
| Connexion des utilisateurs | Avertissement | La connexion est désactivée (`AUTH_DEV_BYPASS`). Toute personne qui joint ce serveur est traitée comme administrateur. |
| Clé des secrets | Réussi | |
| Nom du laboratoire | Avertissement | Le nom est vide ou encore celui fourni par défaut. |
| Fuseau horaire | Avertissement | Aucun fuseau horaire n'est défini. |
| Connecteurs | Réussi, 1 sur 1 | Le connecteur de l'entrepôt fourni répond. |
| Synchronisation avec le central | Ignoré | La synchronisation est désactivée. |

Sur une installation de production, la connexion des utilisateurs est en **Échec**, et non en avertissement.

## Exemple 2 : régler deux avertissements

![Ouvrir Laboratoire depuis la vérification, saisir le nom et le fuseau horaire, enregistrer et relancer.](setup-checks-fix.mp4)

1. Sous **Nom du laboratoire**, sélectionnez **Ouvrir Laboratoire**.
2. Dans **Nom du laboratoire**, tapez le nom de votre laboratoire, par exemple `Sample Central Laboratory`.
3. Dans **Fuseau horaire**, tapez votre fuseau, par exemple `Africa/Dar_es_Salaam`.
4. Ouvrez le menu à trois points de la page et sélectionnez **Enregistrer**.
5. Revenez à **Vérifications d'installation**, ouvrez **⋯** et sélectionnez **Relancer**.

**Résultat attendu :** **1 avertissement**. Le nom du laboratoire et le fuseau horaire passent à **Réussi** et montrent ce qui est réglé. Il ne reste que la connexion des utilisateurs, qui reste un avertissement sur une installation de test.

![Les vérifications après correction : un avertissement restant.](setup-checks-after.png)

Voir [Laboratoire](/docs/laboratory) pour le nom, le logo et le fuseau horaire.

## Les vérifications

| Vérification | Ce qu'elle regarde | Si ce n'est pas le cas |
| --- | --- | --- |
| Services | La connexion, le stockage des fichiers, les événements et l'entrepôt répondent. | CE ne peut ni servir ni stocker de données. Lancez `openldr health` sur le serveur pour voir quel service est arrêté. |
| Connexion des utilisateurs | La connexion est activée. Avec la connexion propre à OpenLDR, un administrateur existe. | Avec `AUTH_DEV_BYPASS` activé, toute personne qui joint le serveur est administrateur. C'est un échec en production et un avertissement ailleurs. Avec la connexion propre à OpenLDR, la vérification avertit aussi tant qu'aucun administrateur n'existe. |
| Clé des secrets | `SECRETS_ENCRYPTION_KEY` est défini. | Un connecteur qui contient un mot de passe ne peut être ni enregistré ni lu. |
| Nom du laboratoire | Le nom est défini, et n'est pas celui fourni par défaut. | Les rapports impriment le nom du produit comme laboratoire émetteur. |
| Fuseau horaire | Un fuseau horaire est défini. | Le rapport mensuel de transmission compte les jours en UTC, donc les arrivées du soir tombent le mauvais jour. |
| Connecteurs | Chaque connecteur hôte actif répond. | Les imports et requêtes sur ce connecteur échouent. La vérification nomme le connecteur. |
| Synchronisation avec le central | La synchronisation a une URL du central et un site id, et son dernier cycle a réussi. | Les résultats n'arrivent pas au central. |

Trois vérifications peuvent être ignorées :

- **Fuseau horaire** sur un entrepôt SQL Server. Le réglage prend des noms de fuseau IANA, que SQL Server ne sait pas utiliser. Laissez-le vide et tapez le nom de fuseau Windows à chaque exécution de rapport.
- **Connecteurs** quand aucun connecteur hôte n'est actif.
- **Synchronisation avec le central** quand la synchronisation est désactivée.

## Ce que les vérifications ne montrent pas

Une vérification montre un nom ou un nombre, jamais un message d'erreur. Les messages d'erreur peuvent contenir des noms de serveurs et d'utilisateurs. Pour le détail d'un connecteur en échec, ouvrez **Paramètres**, **Connecteurs** et choisissez **Diagnostiquer** dessus. Voir [Connexions SQL Server et diagnostic](/docs/connector-diagnose).

Chaque exécution est écrite dans le journal d'audit, avec les noms des vérifications en échec ou en avertissement.

## En ligne de commande

Un serveur sans interface affiche la même liste :

```bash
openldr doctor
```

Sur l'installation de test de l'Exemple 1, il affiche :

```text
PASS  Services
WARN  Sign-in
      Sign-in is switched off (AUTH_DEV_BYPASS). Anyone who can reach this server is treated as an administrator. Turn it off before real use.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central

3 warnings.
```

Ajoutez `--json` pour une sortie lisible par machine. La commande sort avec le code 1 quand une vérification est en échec. Les avertissements ne changent pas le code, donc cet exemple sort avec 0.

## Sur un téléphone

La page fonctionne sur un téléphone. Le message de chaque vérification passe sous son nom, et l'état reste à côté du nom.

## Dépannage

- **Services en échec.** Lancez `openldr health` sur le serveur pour voir quel service est arrêté.
- **Connecteurs en échec.** La vérification nomme le connecteur. Lancez **Diagnostiquer** dessus.
- **Synchronisation avec le central en échec.** Le dernier cycle a échoué. **Paramètres**, **Synchronisation distribuée**, **Activité** dit pourquoi. Voir [Synchronisation distribuée](/docs/sync).
- **La connexion des utilisateurs avertit qu'aucun administrateur n'existe.** L'installation utilise la connexion propre à OpenLDR, et personne n'a terminé la configuration. `openldr doctor` affiche `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Jusque-là, Studio affiche sa page **Créer l'administrateur**, et non cette page. Voir [Connexion et mots de passe](/docs/sign-in).
- **Une vérification n'a pas pu s'exécuter.** Le journal du serveur en donne la raison.

## Guides associés

- [Paramètres](/docs/settings)
- [Laboratoire](/docs/laboratory)
- [Connecteurs](/docs/connectors)
- [Connexions SQL Server et diagnostic](/docs/connector-diagnose)

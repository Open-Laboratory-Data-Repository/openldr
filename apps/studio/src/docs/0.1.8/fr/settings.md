# Paramètres

**Paramètres** regroupe les choix qu'un administrateur fait une fois pour toute l'installation, puis touche rarement : la version et la vérification des mises à jour, les indicateurs de fonctionnalités, les limites, l'en-tête des rapports, la synchronisation, les connecteurs, la marketplace, les rôles et les colonnes supplémentaires que le Builder des tableaux de bord peut proposer.

Ce guide couvre la page **Général** et renvoie au guide de chaque autre page. Comptez 5 minutes.


## Qui peut faire quoi

Chaque page des Paramètres a sa propre capacité. Une page pour laquelle vous n'avez pas la capacité n'apparaît pas dans le menu latéral.

| Capacité | Ce qu'elle ouvre sur Général |
| --- | --- |
| **View settings** | Ouvre Paramètres, Général et Laboratoire. Affiche la carte **À propos** |
| **Edit general settings** | L'interrupteur **Vérification automatique des mises à jour**, **Limites et réglages**, **Validation des données**, et l'enregistrement de la page Laboratoire |
| **Manage feature flags** | La carte **Indicateurs de fonctionnalités** |
| **Danger zone** | Les trois actions de réinitialisation. Donnez-la au moins de personnes possible |

Une carte pour laquelle vous n'avez pas la capacité n'est pas affichée du tout.

## Les pages des Paramètres

| Page | À quoi elle sert | Guide |
| --- | --- | --- |
| Général | Version, vérification des mises à jour, indicateurs, limites, zone dangereuse | Cette page |
| Laboratoire | En-tête de chaque rapport, registre des établissements par défaut, fuseau horaire | [Laboratoire](/docs/laboratory) |
| Notifications | Les notifications que vous recevez | Pas encore documentée |
| Sites | Les sites pour lesquels cette installation rapporte | Pas encore documentée |
| Synchronisation distribuée | Relier un laboratoire à un serveur central. L'onglet **Paramètres** règle la connexion et le sens. L'onglet **Activité** montre l'état en direct et les événements récents | [Synchronisation distribuée](/docs/sync) |
| Connecteurs | Bases de données externes et intégrations fournies par des plugins | [Connecteurs](/docs/connectors) |
| Marketplace | Parcourir les artefacts installables, gérer les registres, voir les paquets installés | [Marketplace](/docs/marketplace) |
| Rôles | Rôles fondés sur les capacités et rôles système intégrés | [Rôles](/docs/roles) |
| Exposition des données | Les colonnes supplémentaires que le Builder des tableaux de bord peut proposer | [Exposition des données](/docs/data-exposure) |

Les réglages lus au démarrage du serveur, comme l'adresse publique, TLS, la base de données, le stockage et les secrets, ne sont pas ici. Voir [Variables d'environnement](/docs/environment).

Ce manuel couvre les pages ci-dessus. Une page de paramètres absente d'ici sort du périmètre actuel de la documentation intégrée.

## Version et vérification des mises à jour

1. Ouvrez **Paramètres**. La page s'ouvre sur **Général**.
2. Lisez la carte **À propos**. **Version** est ce que cette installation exécute. La ligne en dessous, **Dernière version**, dit où en est cette version.
3. Lisez **Dernière vérification** sous l'interrupteur **Vérification automatique des mises à jour** pour savoir de quand date cette réponse.

**Résultat attendu sur une installation neuve :** votre numéro de version suivi de *à jour*, ou *pas encore vérifié* si l'installation a démarré il y a moins d'un jour sans réseau.

La ligne **Dernière version** prend l'une de six formes :

| Elle affiche | Sens |
| --- | --- |
| une version et *à jour* | Vous exécutez la dernière version |
| une version plus récente, sa date de publication et **Notes de version** | Une mise à jour existe. Un lien vers la [procédure de mise à jour planifiée](/docs/upgrading) suit |
| *aucune mise à jour trouvée* | La dernière vérification a vu une version plus ancienne que la vôtre. Voir plus bas |
| *vérification des mises à jour désactivée* | **Vérification automatique des mises à jour** est désactivée |
| *impossible de confirmer* | La dernière vérification a échoué, ou la version en cours n'a pas pu être lue |
| *pas encore vérifié* | Aucune vérification depuis le démarrage de l'installation |

*Aucune mise à jour trouvée* veut dire que la dernière vérification réussie a vu une version **plus ancienne** que celle que vous exécutez. Elle n'a donc rien à vous dire. **Aucun numéro de version n'est affiché dans ce cas, exprès.** Un numéro inférieur au vôtre n'appelle aucune action, et le lire comme une invitation à revenir en arrière serait une erreur.

Cela arrive quand vous mettez à jour peu après une publication. La vérification tourne une fois par jour, et la réponse en cache date d'avant votre version. Elle se corrige à la vérification suivante, ou tout de suite si vous redémarrez le conteneur api.

### Ce que fait la vérification

La vérification est **active par défaut**. Une fois par jour, elle télécharge un petit fichier depuis GitHub, avec un délai de 10 secondes pour cette seule requête, et compare les numéros de version. Elle ne télécharge jamais d'image et ne redémarre rien. La mise à jour est toujours une action que vous faites vous-même.

**Ce qu'elle envoie :** une requête web ordinaire pour un fichier public. Aucun nom de site, aucune version, aucun identifiant. Comme pour toute requête web, le serveur qui répond voit l'adresse IP de votre réseau et l'heure de la demande.

**Pour la désactiver,** coupez **Vérification automatique des mises à jour**. L'installation ne fait alors plus aucune requête sortante, et la ligne de version n'affiche que ce que vous exécutez. Un laboratoire sans accès Internet peut la laisser active. Un échec est silencieux, et la dernière réponse connue est conservée. Il n'existe pas d'option en ligne de commande pour cela. C'est un réglage du studio uniquement.

**En ligne de commande,** `openldr update check` affiche les mêmes informations :

```bash
./openldr update check
```

Elle sort avec **1** quand une mise à jour existe et **0** dans tous les autres cas, y compris une vérification échouée ou non confirmée. Le code 1 veut dire « une mise à jour existe », pas une erreur, donc un script peut s'en servir directement. Le code **2** vient seulement d'une vérification qui n'a pas pu tourner du tout, par exemple une base de données injoignable. Une vérification cassée ne ressemble donc jamais à une nouvelle version.

## Activer les widgets SQL

Les widgets de tableau de bord écrits en SQL sont désactivés sur une installation neuve. Activez-les quand quelqu'un en a besoin, comme dans [Tableaux de bord, Exemple 5](/docs/dashboard#exemple-5-un-widget-ecrit-en-sql).

1. Sur **Général**, trouvez **Indicateurs de fonctionnalités**.
2. Activez **SQL brut pour les tableaux de bord**. Le message **Enregistré** s'affiche. Le changement prend effet tout de suite, sans redémarrage.

**Résultat attendu :** l'éditeur de widget des Tableaux de bord propose maintenant SQL. Désactivez-le, et les widgets SQL cessent de s'exécuter. Les requêtes enregistrées approuvées s'exécutent encore quand il est désactivé.

La même chose en ligne de commande :

```bash
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

## Indicateurs de fonctionnalités

| Indicateur | Clé en ligne de commande | Par défaut | Ce qu'il fait |
| --- | --- | --- | --- |
| SQL brut pour les tableaux de bord | `dashboard.raw_sql` | Désactivé | Permet aux widgets d'exécuter du SQL en lecture seule sur l'entrepôt PostgreSQL, MySQL ou SQL Server. Le nœud **SQL Query** des workflows en a aussi besoin |
| Déclencheurs d'écoute de workflow | `workflow.listeners_enabled` | Activé | Fait tourner les déclencheurs d'écoute (Postgres LISTEN, lecture des e-mails IMAP). Désactivé, il arrête tous les écouteurs à la vérification suivante |
| Publier les jeux de données de workflow | `workflow.dataset_publish_enabled` | Désactivé | Publie les jeux de données des workflows comme vraies tables dans l'entrepôt Postgres, pour que le nœud SQL et les tableaux de bord puissent les interroger |

## Limites et réglages

Ces valeurs changent tout de suite, sans redémarrage. Une valeur hors de la plage permise est ramenée à la borne la plus proche.

| Limite | Clé en ligne de commande | Par défaut | Plage permise |
| --- | --- | --- | --- |
| Délai SQL des tableaux de bord (ms) | `dashboard.sql_timeout_ms` | 5000 | 100 à 600000 |
| Plafond de lignes SQL des tableaux de bord | `dashboard.sql_row_cap` | 10000 | 1 à 1000000 |
| Charge utile maximale de la marketplace (octets) | `marketplace.max_payload_bytes` | 67108864 (64 Mo) | 1024 à 536870912 |

Le plafond de lignes agit de deux façons. Le SQL brut renvoie au plus ce nombre de lignes. Une requête du Builder compte d'abord ses groupes dans la base, et renvoie une erreur s'il y en a plus que le plafond.

```bash
./openldr settings numbers list
./openldr settings numbers set dashboard.sql_timeout_ms 10000
```

## Zone dangereuse

Le bas de **Général** contient des actions irréversibles. Elles ne touchent que la base de données interne. Les données de l'entrepôt et les comptes Keycloak ne sont jamais touchés.

| Action | Ce qu'elle fait | Ligne de commande |
| --- | --- | --- |
| Validation des données | Règle la rigueur du contrôle des données de laboratoire entrantes : Faible, Moyen ou Élevé. Plus bas, des données incomplètes sont stockées. Plus haut, des données acceptées avant peuvent être refusées | `./openldr settings validation set medium` |
| Réinitialiser les tableaux de bord | Supprime tous les tableaux de bord et recrée l'exemple | `./openldr settings danger reset-dashboards --force` |
| Vider le journal d'audit | Supprime tous les événements d'audit et l'historique des exécutions de workflows | `./openldr settings danger clear-audit --force` |
| Réinitialisation usine | Efface la base interne (formulaires, connecteurs, tableaux de bord, workflows, terminologie, utilisateurs, audit) et recrée les valeurs par défaut | `./openldr settings danger factory-reset --force` |

Dans le studio, chaque réinitialisation vous demande de taper une phrase avant de s'exécuter. En ligne de commande, chacune refuse de s'exécuter sans `--force`.

## Sur un téléphone

Sur un écran étroit, la liste des pages des Paramètres passe en rangée en haut. Faites-la glisser sur le côté pour atteindre les dernières pages, comme **Exposition des données**.

## Dépannage

- **Une page manque dans le menu latéral.** Votre rôle n'a pas sa capacité. Demandez à un administrateur de vérifier votre rôle dans [Rôles](/docs/roles).
- **Une carte manque sur Général.** Votre rôle n'a pas sa capacité. Voir le tableau de Qui peut faire quoi.
- **La ligne Dernière version affiche *impossible de confirmer*.** L'installation n'a pas pu joindre GitHub, ou la version en cours était illisible. Rien d'autre n'est touché.
- **Une limite a été enregistrée avec un autre nombre.** Elle était hors de la plage permise et a été ramenée à la borne la plus proche.
- **Les widgets SQL refusent toujours de s'exécuter.** Vérifiez que **SQL brut pour les tableaux de bord** est activé. Vérifiez ensuite que la requête du widget est en lecture seule.

## Guides associés

- [Laboratoire](/docs/laboratory)
- [Exposition des données](/docs/data-exposure)
- [Rôles](/docs/roles)
- [Synchronisation distribuée](/docs/sync)
- [Connecteurs](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Variables d'environnement](/docs/environment)
- [Mises à jour planifiées](/docs/upgrading)

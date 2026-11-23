# Configurer un laboratoire

Cette page dit ce qu'OpenLDR offre à un laboratoire dans cette version, et ce qu'il faut vérifier après une mise à niveau. Le guide intégré **Configuration du laboratoire** montre les étapes à l'écran.

Un plugin de laboratoire est prévu pour la réception et la vérification des résultats. Il ne fait pas partie de cette version.

## Ce qu'un laboratoire a dans cette version

- Le formulaire **Lab order** commande des examens et saisit leurs résultats. Il peut aussi enregistrer un **Order rejection**. Le guide intégré **Formulaires** montre chaque étape.
- Les intervalles de référence d'un examen peuvent porter des seuils critiques, dans **Seuil critique bas** et **Seuil critique haut**. OpenLDR les enregistre. Rien dans cette version ne signale encore un résultat par rapport à eux. Les fixer exige **Gérer la terminologie**.
- Un index trouve une demande par son numéro de demande. OpenLDR le tient à jour tout seul. La commande `openldr lab requisitions rebuild` le répare.

## Reconstruire l'index des numéros de demande

La commande passe par le serveur OpenLDR en marche, en tant que personne qui détient **Zone de danger**. Sous Linux et macOS, connectez-vous d'abord avec `./openldr login`, ou définissez une clé d'accès dans `OPENLDR_KEY`. Sous Windows, `.\openldr.ps1` se connecte uniquement avec une clé d'accès, donc définissez d'abord `OPENLDR_KEY`. La commande n'a pas été lancée sous Windows. [Connexion du CLI et clés d'accès](/docs/cli-access) explique la connexion.

```sh
openldr lab requisitions rebuild --force
```

Reconstruisez-le seulement si une erreur a laissé une demande hors de l'index, ou après la suppression de demandes du stockage. La commande affiche `Indexed <n> orders by requisition number.` Elle refuse sans `--force`, car elle réécrit tout l'index. Chaque reconstruction est inscrite dans le journal d'audit sous votre compte. Dans une copie des sources, ajoutez `pnpm` devant : `pnpm openldr lab requisitions rebuild --force`.

## Après une mise à niveau depuis une version de développement

Une version de développement avait une page Réception, des sections de laboratoire, un interrupteur d'auto-validation et sept permissions de laboratoire. Cette version ne les a pas.

- Un rôle **Reception** créé par cette version de développement reste. C'est maintenant un rôle ordinaire. Un administrateur peut le supprimer sur la page **Rôles** quand personne n'en a plus besoin.
- Un rôle garde toute ancienne permission de laboratoire qu'il détient. CE ne la liste pas et ne peut ni l'accorder ni la retirer. `openldr roles doctor` liste ces permissions sous `kept` et se termine avec le code 0.
- Un formulaire **Lab order** que personne n'a modifié retrouve ses champs **Results** et **Order rejection** au premier démarrage. Un formulaire modifié par votre laboratoire reste tel quel.

## Résolution des problèmes

- **La reconstruction dit que le compte n'a pas la capacité.** Le compte ne détient pas **Zone de danger**. Utilisez un compte dont le rôle l'a.
- **Le formulaire Lab order n'a pas de champ Results.** Votre laboratoire a modifié le formulaire, donc la mise à niveau l'a laissé tel quel. Ajoutez de nouveau le champ dans le constructeur de formulaires.

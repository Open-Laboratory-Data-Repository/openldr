# Premier démarrage

Le premier démarrage, ce sont trois courtes étapes que Studio affiche juste après la création du premier administrateur. Vous nommez votre laboratoire, chargez des données d'exemple si vous le souhaitez, et revoyez les vérifications d’installation qui demandent votre attention. Il s'adresse à la personne qui met en place une nouvelle installation.

Le premier démarrage n'apparaît qu'une fois, et seulement sur une installation qui utilise la connexion propre à OpenLDR. Seule la personne qui a créé le premier administrateur le voit, dans la fenêtre ou l'onglet du navigateur où elle l'a créé. Vous pouvez passer les deux premières étapes. Plus tard, vous pouvez revoir les mêmes vérifications et charger les données d'exemple dans Paramètres → Vérifications d’installation.

## Nommer votre laboratoire

Le nom du laboratoire figure sur les rapports comme laboratoire émetteur. Les rapports comptent chaque jour selon le fuseau horaire que vous sélectionnez. La page affiche **Étape 1 sur 3** et **Nommez votre laboratoire**.

1. Dans **Nom du laboratoire**, tapez le nom de votre laboratoire, par exemple `Laboratoire de l'hôpital central`.
2. Sélectionnez **Fuseau horaire**. Studio part du fuseau de votre ordinateur.
3. Dans **Rechercher un fuseau horaire**, tapez une partie du nom du fuseau, par exemple `Dar`.
4. Choisissez le fuseau, par exemple `Africa/Dar_es_Salaam`.
5. Sélectionnez **Enregistrer**.

**Résultat attendu :** l'étape suivante s'ouvre. C'est **Données d'exemple**, ou **OpenLDR est prêt** quand Studio ne propose pas de données d'exemple.

Pour laisser le nom et le fuseau tels quels, sélectionnez **Passer** au lieu de **Enregistrer**. Vous pourrez définir les deux plus tard. Voir [Laboratoire](/docs/laboratory).

## Charger les données d'exemple

La page indique ce que contiennent les données d'exemple : **Les données d'exemple ajoutent 60 demandes fictives, dont 39 avec leurs résultats, ainsi que des exemples de formulaires, de flux de travail et un tableau de bord, pour que vous puissiez essayer OpenLDR avant l'arrivée de vos propres données. OpenLDR ne peut pas supprimer ces données d'exemple par la suite, donc passez cette étape sur une installation destinée à de vraies données de patients.**

1. Sur **Données d'exemple**, sélectionnez **Charger les données d'exemple**.
2. Attendez pendant que la page affiche **Chargement des données d'exemple…**.

**Résultat attendu :** **OpenLDR est prêt** s'ouvre.

Pour continuer sans elles, sélectionnez **Passer**.

Studio ne propose les données d'exemple que tant que l'installation ne contient aucune donnée de laboratoire. Un patient, une demande d'analyse, un échantillon, un résultat ou une réponse de formulaire enregistrée comptent comme données de laboratoire. Une organisation ou un site aussi. Dès qu'il en existe un, cette étape n'apparaît plus, et un second chargement est refusé.

Si vous passez cette étape, vous pourrez charger les données plus tard depuis le menu à points de Paramètres → Vérifications d’installation, tant que l'installation ne contient toujours aucune donnée de laboratoire. Voir [Vérifications de configuration](/docs/setup-checks).

## Revoir les vérifications d’installation

La dernière étape liste les vérifications qui affichent un avertissement ou un échec. Les vérifications réussies ou ignorées n'y figurent pas.

1. Attendez pendant que la page affiche **Vérifications d’installation en cours…**.
2. Lisez chaque vérification, son état et son conseil.
3. Pour en corriger une tout de suite, sélectionnez son lien, par exemple **Ouvrir Laboratoire**.
4. Sinon, sélectionnez **Continuer vers OpenLDR**.

**Résultat attendu :** Studio s'ouvre. Un lien ouvre plutôt sa page. Dans les deux cas, le premier démarrage se termine et ne revient plus.

Quand aucune vérification n'affiche d'avertissement ni d'échec, la page affiche **Toutes les vérifications d’installation ont réussi. Vous pouvez les revoir à tout moment dans Paramètres → Vérifications d’installation.**

## Limites

- Le premier démarrage n'apparaît qu'avec la connexion propre à OpenLDR. Une installation qui se connecte par Keycloak ou par un autre fournisseur ne l'affiche jamais. Utilisez alors [Vérifications de configuration](/docs/setup-checks).
- Il n'apparaît qu'une fois. Après **Continuer vers OpenLDR**, un lien ou une déconnexion, il ne revient pas.
- Recharger la page en cours de route relance le premier démarrage à l'étape 1. Un nom déjà enregistré reste enregistré. Fermer cet onglet en cours de route met fin au premier démarrage pour de bon.
- Les données d'exemple ne sont proposées que tant que l'installation ne contient aucune donnée de laboratoire.
- Une fois chargées, les 60 demandes d'exemple et leurs résultats restent en place. OpenLDR ne permet pas de les supprimer. **Réinitialisation usine**, dans **Zone dangereuse**, ne les supprime pas non plus.

## Résolution de problèmes

- **L'étape des données d'exemple n'est pas apparue.** L'installation contient déjà des données de laboratoire, ou Studio n'a pas pu interroger le serveur. Ouvrez Paramètres → Vérifications d’installation, et cherchez **Charger les données d'exemple** dans son menu à points.
- **Impossible d'enregistrer les informations du laboratoire :** suivi d'une raison. Sélectionnez de nouveau **Enregistrer**. Ou sélectionnez **Passer** et définissez le nom plus tard dans Paramètres → Laboratoire.
- **Impossible de charger les données d'exemple :** suivi d'une raison. Le chargement ne s'est pas terminé. Une partie des données d'exemple peut déjà être en place. Un second essai est alors refusé, donc sélectionnez **Passer**. Le journal du serveur nomme l'erreur.
- **Impossible d'exécuter les vérifications d’installation :** suivi d'une raison. Sélectionnez **Continuer vers OpenLDR**. Ouvrez ensuite Paramètres → Vérifications d’installation et sélectionnez **Relancer** dans son menu à points.

## Guides associés

- [Connexion et mots de passe](/docs/sign-in)
- [Vérifications de configuration](/docs/setup-checks)
- [Laboratoire](/docs/laboratory)

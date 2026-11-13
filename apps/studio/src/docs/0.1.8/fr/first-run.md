# Premier démarrage

Le premier démarrage, ce sont trois courtes étapes que Studio affiche juste après la création du premier administrateur. Vous nommez le laboratoire, chargez des données d'exemple si vous le souhaitez, et voyez quelles vérifications demandent encore votre attention. Il s'adresse à la personne qui met en place une nouvelle installation.

Le premier démarrage n'apparaît qu'une fois, et seulement sur une installation qui utilise la connexion propre à OpenLDR. Seule la personne qui a créé le premier administrateur le voit, dans la fenêtre ou l'onglet du navigateur où elle l'a créé. Vous pouvez passer les deux premières étapes. Ensuite, Paramètres, Vérifications d’installation garde la même liste et peut charger les données d'exemple plus tard.

## Nommer le laboratoire

Les rapports impriment ce nom comme laboratoire émetteur. Les jours sont comptés selon ce fuseau horaire. La page affiche **Étape 1 sur 3** et **Nommer le laboratoire**.

1. Dans **Nom**, tapez le nom de votre laboratoire, par exemple `Laboratoire de l'hôpital central`.
2. Sélectionnez **Fuseau horaire**. Le fuseau de votre ordinateur est choisi au départ.
3. Dans **Rechercher un fuseau horaire**, tapez une partie du nom du fuseau, par exemple `Dar`.
4. Choisissez le fuseau, par exemple `Africa/Dar_es_Salaam`.
5. Sélectionnez **Enregistrer**.

**Résultat attendu :** l'étape suivante s'ouvre. C'est **Données d'exemple**, ou **Tout est prêt** quand Studio ne propose pas de données d'exemple.

Pour laisser le nom et le fuseau tels quels, sélectionnez **Passer** au lieu de **Enregistrer**. Vous pourrez définir les deux plus tard. Voir [Laboratoire](/docs/laboratory).

## Charger les données d'exemple

La page explique ce que sont les données d'exemple : **Les données d'exemple ajoutent un patient et un laboratoire fictifs, avec des formulaires, des flux de travail et des tableaux de bord, pour essayer OpenLDR avant l'arrivée des vraies données.**

1. Sur **Données d'exemple**, sélectionnez **Charger les données d'exemple**.
2. Attendez pendant que la page affiche **Chargement des données d'exemple…**.

**Résultat attendu :** **Tout est prêt** s'ouvre.

Pour continuer sans elles, sélectionnez **Passer**.

Studio ne propose les données d'exemple que tant que l'installation ne contient aucune donnée de laboratoire. Un patient, une demande d'analyse, un échantillon, un résultat ou une réponse de formulaire enregistrée comptent comme données de laboratoire. Une organisation ou un site aussi. Dès qu'il en existe un, cette étape n'apparaît plus, et un second chargement est refusé.

Si vous passez cette étape, vous pourrez charger les données plus tard depuis le menu à points de Paramètres, Vérifications d’installation, tant que l'installation ne contient toujours aucune donnée de laboratoire. Voir [Vérifications de configuration](/docs/setup-checks).

## Voir ce qui demande encore votre attention

La dernière étape liste les vérifications qui affichent un avertissement ou un échec. Les vérifications réussies ou ignorées n'y figurent pas.

1. Attendez pendant que la page affiche **Vérifications en cours…**.
2. Lisez chaque vérification, son état et son conseil.
3. Pour en corriger une tout de suite, sélectionnez son lien, par exemple **Ouvrir Laboratoire**.
4. Sinon, sélectionnez **Ouvrir OpenLDR**.

**Résultat attendu :** Studio s'ouvre. Un lien ouvre plutôt sa page. Dans les deux cas, le premier démarrage se termine et ne revient plus.

Quand rien ne demande votre attention, la page affiche **Rien ne demande votre attention pour l'instant. La liste complète reste dans Paramètres, Vérifications d’installation.**

## Limites

- Le premier démarrage n'apparaît qu'avec la connexion propre à OpenLDR. Une installation qui se connecte par Keycloak ou par un autre fournisseur ne l'affiche jamais. Utilisez alors [Vérifications de configuration](/docs/setup-checks).
- Il n'apparaît qu'une fois. Après **Ouvrir OpenLDR**, un lien ou une déconnexion, il ne revient pas.
- Recharger la page en cours de route relance le premier démarrage à l'étape 1. Un nom déjà enregistré reste enregistré. Fermer cet onglet en cours de route met fin au premier démarrage pour de bon.
- Les données d'exemple ne sont proposées que tant que l'installation ne contient aucune donnée de laboratoire.

## Résolution de problèmes

- **L'étape des données d'exemple n'est pas apparue.** L'installation contient déjà des données de laboratoire, ou Studio n'a pas pu interroger le serveur. Ouvrez Paramètres, Vérifications d’installation, et cherchez **Charger les données d'exemple** dans son menu à points.
- **Le laboratoire n'a pas pu être enregistré :** suivi d'une raison. Sélectionnez de nouveau **Enregistrer**. Ou sélectionnez **Passer** et définissez le nom plus tard dans Paramètres, Laboratoire.
- **Les données d'exemple n'ont pas pu être chargées :** suivi d'une raison. Le chargement ne s'est pas terminé. Une partie des données d'exemple peut déjà être en place. Un second essai est alors refusé, donc sélectionnez **Passer**. Le journal du serveur nomme l'erreur.
- **Les vérifications n’ont pas pu s’exécuter :** suivi d'une raison. Sélectionnez **Ouvrir OpenLDR**. Ouvrez ensuite Paramètres, Vérifications d’installation et sélectionnez **Relancer** dans son menu à points.

## Guides associés

- [Connexion et mots de passe](/docs/sign-in)
- [Vérifications de configuration](/docs/setup-checks)
- [Laboratoire](/docs/laboratory)

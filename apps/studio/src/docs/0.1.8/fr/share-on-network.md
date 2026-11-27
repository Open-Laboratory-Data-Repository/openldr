# Ouvrir OpenLDR depuis un autre PC

Un laboratoire a besoin d'un seul OpenLDR, pas d'un par PC. Partagez-le sur le réseau du laboratoire. Les autres PC l'ouvrent alors dans un navigateur et se connectent aux mêmes utilisateurs et aux mêmes données. Ce guide s'adresse à la personne qui s'occupe du PC où tourne OpenLDR.

Il concerne l'application de bureau et le lanceur autonome. Une installation Docker est déjà accessible par le réseau, à sa propre adresse.

Ce guide n'a pas de clip. Les étapes se passent dans la zone de notification et sur un autre PC, hors de Studio.

## Partager l'OpenLDR de ce PC

À faire une fois, sur le PC où tourne OpenLDR.

1. Ouvrez l'icône OpenLDR dans la zone de notification, la partie de la barre des tâches qui contient les petites icônes.
2. Sélectionnez **Partager sur le réseau du laboratoire**.
3. Lisez la question, puis sélectionnez **Partager**.
4. Attendez pendant que la fenêtre affiche **Arrêt d'OpenLDR**, puis **Démarrage d'OpenLDR**.
5. Ouvrez de nouveau l'icône et sélectionnez **Copier l'adresse réseau**.

**Résultat attendu :** le menu affiche une adresse qui commence par `https://`, et cette adresse est copiée.

Si OpenLDR a été démarré en dehors de l'application, rien ne redémarre. L'application dit que le changement s'appliquera la prochaine fois qu'elle démarrera OpenLDR.

Sur un PC sans application de bureau, démarrez le lanceur avec `openldr-standalone start --share`. Il affiche l'adresse, une seconde adresse avec des chiffres, et l'empreinte du certificat.

## L'ouvrir sur un autre PC

1. Sur l'autre PC, ouvrez un navigateur comme Chrome ou Edge.
2. Dans la barre d'adresse, saisissez l'adresse du premier PC, par exemple `https://labpc:3443/studio/`.
3. Quand le navigateur avertit au sujet du certificat, vérifiez-le d'abord. Voir **Vérifier le certificat** plus bas.
4. Acceptez le certificat.
5. Connectez-vous avec votre nom d'utilisateur et votre mot de passe OpenLDR.

**Résultat attendu :** Studio s'ouvre, avec les mêmes données que sur le premier PC.

Si l'adresse avec le nom du PC ne s'ouvre pas, utilisez celle avec des chiffres, par exemple `https://192.168.1.20:3443/studio/`. Le lanceur affiche les deux. La zone de notification en affiche une. Pour les autres, lancez `openldr-standalone status --json` sur le premier PC et lisez `share.addresses`.

## Vérifier le certificat

Le premier PC crée son propre certificat, donc un navigateur ne le connaît pas. Vérifiez que c'est le bon avant de l'accepter.

1. Sur le premier PC, ouvrez l'icône et sélectionnez **Copier l'empreinte du certificat**. Avec le lanceur, lisez la ligne qui commence par `Certificate fingerprint (SHA-256):` dans son terminal.
2. Collez-la à un endroit où vous pouvez la lire, ou lisez-la à voix haute à la personne devant l'autre PC.
3. Sur l'autre PC, ouvrez les détails du certificat depuis l'avertissement du navigateur.
4. Trouvez l'empreinte **SHA-256**.
5. Comparez les deux, paire par paire.

**Résultat attendu :** les deux empreintes sont identiques. Acceptez alors le certificat. Si elles diffèrent, arrêtez et ne vous connectez pas.

## Utiliser l'application OpenLDR sur un autre PC

Faites ceci sur l'autre PC quand vous y voulez l'application OpenLDR plutôt qu'un navigateur. L'application affiche alors l'OpenLDR de ce laboratoire et n'exécute aucune base de données de laboratoire.

1. Installez l'application de bureau OpenLDR sur l'autre PC et démarrez-la.
2. Sur le premier écran, sélectionnez **Se connecter au serveur du laboratoire**.
3. Dans **Adresse du serveur**, saisissez l'adresse du premier PC, par exemple `https://labpc:3443/studio/`.
4. Sélectionnez **Se connecter**.
5. Si l'application affiche **Vérifiez le certificat du serveur**, comparez son empreinte avec celle du premier PC. Voir **Vérifier le certificat** plus haut.
6. Sélectionnez **Elle correspond** seulement si les deux sont identiques.
7. Connectez-vous avec votre nom d'utilisateur et votre mot de passe OpenLDR.

**Résultat attendu :** Studio s'ouvre dans l'application, avec les mêmes données que sur le premier PC. L'application y va directement au démarrage suivant.

Un PC qui contient déjà des données OpenLDR n'affiche pas le premier écran. Utilisez **Se connecter à un serveur de laboratoire...** dans son menu de la zone de notification.

## Verrouiller un PC sur OpenLDR

Faites ceci sur un PC d'une salle partagée qui doit afficher OpenLDR et rien d'autre.

1. Ouvrez l'icône OpenLDR dans la zone de notification.
2. Sélectionnez **Verrouiller ce PC sur OpenLDR...**.
3. Saisissez un code PIN d'au moins 4 caractères.
4. Sélectionnez **Verrouiller**.

**Résultat attendu :** la fenêtre occupe tout l'écran, la fermer ne fait rien, et les liens vers d'autres sites ne s'ouvrent pas.

Pour déverrouiller, appuyez sur `Ctrl+Maj+L`, saisissez le code PIN et sélectionnez **Déverrouiller**. Quitter l'application demande aussi le code PIN. Le guide web de l'application de bureau indique ce que le verrou n'empêche pas, et quoi faire si le code PIN est oublié.

## Limites

- Le premier PC doit être allumé, avec OpenLDR en marche, chaque fois que les autres l'utilisent.
- Une nouvelle adresse réseau ou un nouveau nom pour le premier PC crée un nouveau certificat. Les autres PC voient alors l'avertissement une fois de plus. Donnez une adresse fixe au premier PC pour l'éviter.
- Ne l'utilisez que sur le réseau du laboratoire. Ne l'ouvrez jamais à Internet.

## Dépannage

- **Le menu affiche « Aucune adresse réseau n'a été trouvée ».** Le PC n'est sur aucun réseau. Rejoignez-en un, quittez OpenLDR et rouvrez-le.
- **L'application dit que le port 3443 est déjà utilisé.** Un autre programme l'utilise. Le guide web de l'application de bureau montre comment choisir un autre port.
- **L'autre PC ne peut pas ouvrir l'adresse.** Vérifiez que les deux PC sont sur le même réseau, et que le pare-feu du premier PC autorise le port 3443.
- **L'application affiche « Impossible de joindre le serveur » au démarrage.** Le premier PC est éteint, ou le réseau est coupé. L'application revient d'elle-même quand le premier PC répond.
- **L'application affiche « Le certificat du serveur a changé ».** Le certificat n'est pas celui que ce PC avait accepté. Comparez la nouvelle empreinte avec celle du premier PC, et sélectionnez **Elle correspond** seulement si elles sont identiques. Si personne ne peut expliquer le changement, sélectionnez **Annuler**.

## Guides associés

- [Connexion et mots de passe](/docs/sign-in)
- [Premier démarrage](/docs/first-run)

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

Sur un PC sans application de bureau, démarrez le lanceur avec `openldr-standalone start --share`. Il affiche la même adresse.

## L'ouvrir sur un autre PC

1. Sur l'autre PC, ouvrez un navigateur comme Chrome ou Edge.
2. Dans la barre d'adresse, saisissez l'adresse du premier PC, par exemple `https://labpc:3443/studio/`.
3. Quand le navigateur avertit au sujet du certificat, vérifiez-le d'abord. Voir **Vérifier le certificat** plus bas.
4. Acceptez le certificat.
5. Connectez-vous avec votre nom d'utilisateur et votre mot de passe OpenLDR.

**Résultat attendu :** Studio s'ouvre, avec les mêmes données que sur le premier PC.

Si l'adresse avec le nom du PC ne s'ouvre pas, utilisez celle avec des chiffres, par exemple `https://192.168.1.20:3443/studio/`. Le lanceur affiche les deux.

## Vérifier le certificat

Le premier PC crée son propre certificat, donc un navigateur ne le connaît pas. Vérifiez que c'est le bon avant de l'accepter.

1. Sur le premier PC, ouvrez l'icône et sélectionnez **Copier l'empreinte du certificat**.
2. Collez-la à un endroit où vous pouvez la lire, ou lisez-la à voix haute à la personne devant l'autre PC.
3. Sur l'autre PC, ouvrez les détails du certificat depuis l'avertissement du navigateur.
4. Trouvez l'empreinte **SHA-256**.
5. Comparez les deux, paire par paire.

**Résultat attendu :** les deux empreintes sont identiques. Acceptez alors le certificat. Si elles diffèrent, arrêtez et ne vous connectez pas.

## Limites

- Le premier PC doit être allumé, avec OpenLDR en marche, chaque fois que les autres l'utilisent.
- Une nouvelle adresse réseau ou un nouveau nom pour le premier PC crée un nouveau certificat. Les autres PC voient alors l'avertissement une fois de plus. Donnez une adresse fixe au premier PC pour l'éviter.
- Ne l'utilisez que sur le réseau du laboratoire. Ne l'ouvrez jamais à Internet.

## Dépannage

- **Le menu affiche « Aucune adresse réseau n'a été trouvée ».** Le PC n'est sur aucun réseau. Rejoignez-en un, quittez OpenLDR et rouvrez-le.
- **L'application dit que le port 3443 est déjà utilisé.** Un autre programme l'utilise. Le guide web de l'application de bureau montre comment choisir un autre port.
- **L'autre PC ne peut pas ouvrir l'adresse.** Vérifiez que les deux PC sont sur le même réseau, et que le pare-feu du premier PC autorise le port 3443.

## Guides associés

- [Connexion et mots de passe](/docs/sign-in)
- [Premier démarrage](/docs/first-run)

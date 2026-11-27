# Réseau

Réseau contient deux listes que tient un administrateur. La première regroupe les certificats auxquels cet OpenLDR fait confiance quand il appelle un autre serveur en HTTPS, par exemple un serveur central qui a son propre certificat. La seconde regroupe les hôtes qu'un workflow peut appeler. Il vous faut l'autorisation **Gérer la confiance réseau**.

Ce guide n'a pas encore de clip. Chaque tâche tient en quelques étapes sur une seule page.

## Faire confiance au certificat d'un autre OpenLDR

Faites-le quand la synchronisation vers un serveur central échoue sur une erreur de certificat, ou quand un workflow doit appeler un serveur qui a créé son propre certificat.

1. Demandez l'empreinte du certificat à la personne qui gère l'autre serveur. Obtenez-la par téléphone ou en personne, pas depuis la page du serveur.
2. Ouvrez **Paramètres**, puis **Réseau**.
3. Ouvrez le menu à points en haut à droite et sélectionnez **Ajouter un certificat**.
4. Dans **Adresse**, saisissez l'adresse de l'autre serveur, par exemple `hub.example.org` ou `hub.example.org:8443`.
5. Ouvrez le menu à points du volet et sélectionnez **Lire le certificat**.
6. Comparez l'**Empreinte** affichée avec celle que vous avez reçue, paire par paire.
7. Si elles sont identiques, ouvrez le menu à points du volet et sélectionnez **Enregistrer**.
8. Redémarrez OpenLDR. Voir **Redémarrer OpenLDR** ci-dessous.

**Résultat attendu :** après le redémarrage, l'**État** du certificat est **Utilisé**. Avant, l'état est **Après redémarrage**.

Si les deux empreintes diffèrent, arrêtez-vous. N'enregistrez pas.

Si vous avez le certificat sous forme de fichier, collez son texte dans **Ou collez-le** à l'étape 4 au lieu de saisir une adresse. Ne collez jamais une clé privée. OpenLDR la refuse et n'enregistre rien.

En ligne de commande, avec l'application de bureau ou le lanceur autonome :

```
openldr-standalone cli -- trust add --address hub.example.org:8443 --fingerprint <SHA-256>
```

Sur une installation Docker, la commande `openldr` ne peut pas poser de question. Donnez l'empreinte, et elle n'enregistre que si le certificat correspond :

```
openldr trust add --address hub.example.org:8443 --fingerprint <SHA-256>
openldr trust add data/hub.pem --fingerprint <SHA-256>
```

Avec un fichier et sans `--fingerprint`, la commande affiche l'empreinte du certificat et n'enregistre rien. Comparez-la, puis relancez la commande avec elle. Avec `--address`, `--fingerprint` est toujours nécessaire. Sans cela, la commande s'arrête avant de contacter le serveur.

## Redémarrer OpenLDR

OpenLDR ne lit ses certificats de confiance qu'au démarrage. Un certificat ajouté ou retiré prend effet après un redémarrage.

- **Application de bureau :** ouvrez l'icône OpenLDR dans la zone de notification, sélectionnez **Quitter**, puis rouvrez OpenLDR.
- **Lanceur autonome :** exécutez `openldr-standalone stop`, puis `openldr-standalone start`. Donnez à `stop` le même `--data-dir`, si vous en avez utilisé un. Répétez ensuite votre commande `start` d'origine, avec ses options de partage et de port. Sans elles, `stop` peut regarder dans un autre dossier, et `start` peut démarrer sans le partage.
- **Installation Docker :** dans le dossier d'installation, exécutez `docker compose restart api`.

**Résultat attendu :** la colonne **État** passe de **Après redémarrage** à **Utilisé**.

## Retirer un certificat de confiance

1. Ouvrez **Paramètres**, puis **Réseau**.
2. Sur la ligne du certificat, ouvrez le menu à points et sélectionnez **Retirer**.
3. Lisez la question, puis sélectionnez **Retirer**.
4. Redémarrez OpenLDR.

**Résultat attendu :** un certificat que le serveur a chargé affiche **Retiré après redémarrage** jusqu'au redémarrage, puis la ligne disparaît. Un certificat qui attendait encore un redémarrage disparaît tout de suite.

Le retrait ne supprime que cette entrée. Un serveur reconnu autrement, par exemple par une autorité de certification publique, reste de confiance.

En ligne de commande : `openldr trust remove <empreinte> --force`.

## Laisser un workflow appeler un autre hôte

L'étape HTTP d'un workflow ne peut appeler que les hôtes de cette liste, et cet OpenLDR lui-même quand son interrupteur est activé. Voir **Laisser un workflow appeler cet OpenLDR** ci-dessous.

1. Ouvrez **Paramètres**, puis **Réseau**.
2. Sélectionnez l'onglet **Hôtes des workflows**.
3. Ouvrez le menu à points en haut à droite et sélectionnez **Ajouter un hôte**.
4. Dans **Hôte**, saisissez le nom d'hôte ou l'adresse IP, par exemple `hub.example.org`. Ne donnez ni port ni chemin.
5. Ouvrez le menu à points du volet et sélectionnez **Enregistrer**.

**Résultat attendu :** l'hôte est dans la liste avec la source **Défini ici**. Un workflow peut l'appeler tout de suite. Aucun redémarrage n'est nécessaire.

Un hôte ici couvre tous les services web de cet hôte, sur n'importe quel port.

En ligne de commande : `openldr workflows hosts add hub.example.org`. Pour en retirer un : `openldr workflows hosts remove hub.example.org --force`.

## Laisser un workflow appeler cet OpenLDR

Faites-le quand un workflow doit appeler l'adresse web de cet OpenLDR lui-même, par exemple pour récupérer des résultats à heure fixe.

1. Ouvrez **Paramètres**, puis **Réseau**.
2. Sélectionnez l'onglet **Hôtes des workflows**.
3. Activez **Laisser les workflows appeler cet OpenLDR**.

**Résultat attendu :** l'interrupteur est activé. L'adresse à côté est la seule que cela autorise. Les autres programmes du même ordinateur restent hors d'atteinte.

En ligne de commande : `openldr workflows hosts self on`, et `off` pour le désactiver.

## Déverrouiller la liste

Une coupure de courant ou un plantage pendant une modification peut laisser la liste des certificats verrouillée. La page indique alors qu'une modification a été interrompue, et plus aucune modification ne passe.

1. Vérifiez que personne d'autre ne modifie la liste en ce moment.
2. Ouvrez le menu à points en haut à droite et sélectionnez **Déverrouiller**.
3. Lisez la question, puis sélectionnez **Déverrouiller**.

**Résultat attendu :** la note a disparu et vous pouvez de nouveau ajouter ou retirer un certificat.

**Déverrouiller** apparaît dès que le verrou a 30 secondes. Cet âge ne prouve pas que la modification s'est arrêtée. C'est pourquoi l'étape 1 vient en premier.

En ligne de commande : `openldr trust unlock --force`.

## Limites

- Un certificat ajouté ou retiré ne prend effet qu'après un redémarrage. Un hôte de workflow prend effet tout de suite.
- Un hôte dont la source est **Réglage du serveur** vient de `WORKFLOW_HTTP_ALLOWLIST` sur le serveur. Modifiez-le là-bas.
- La page peut afficher la liste sans vous laisser la modifier. Elle dit alors pourquoi en haut. Une installation faite avant l'existence de cette page peut demander une modification par la personne qui gère le serveur. Le guide d'environnement du site web explique `TRUSTED_CA_FILE`.

## Dépannage

- **Rien n'a répondu à cette adresse.** Vérifiez l'adresse et le port, et que l'autre serveur est allumé. Cet ordinateur doit pouvoir l'atteindre.
- **Ce certificat est déjà de confiance.** Il est dans la liste. Vérifiez son **État** : il attend peut-être un redémarrage.
- **La liste est en cours de modification.** Quelqu'un d'autre enregistre une modification. Réessayez dans un instant. Si la page indique qu'une modification a été interrompue, voir **Déverrouiller la liste**.
- **La page n'a pas pu être actualisée.** Ce que vous voyez est peut-être dépassé. Ouvrez le menu à points en haut à droite et sélectionnez **Actualiser**.
- **La synchronisation échoue encore après l'ajout du certificat.** Redémarrez OpenLDR, puis vérifiez que l'état est **Utilisé**. Vérifiez aussi que le certificat nomme l'adresse que vous utilisez pour le serveur central.

## Guides associés

- [Connecteurs](/docs/connectors)
- [Synchronisation distribuée](/docs/sync)
- [Workflows](/docs/workflows)

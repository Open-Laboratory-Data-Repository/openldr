# Cartes et panneaux latéraux des extensions

## Résultat

Certaines extensions montrent plus que leur propre page. Une extension peut ajouter une carte au tableau de bord d'accueil, un panneau latéral qui reste ouvert quand vous changez de page, ou les deux. Un administrateur peut désactiver l'un ou l'autre.

## Cartes du tableau de bord

Les cartes des extensions sont sur leur propre rangée, sous les widgets du tableau de bord. Elles apparaissent sur chaque tableau de bord. Vous ne pouvez pas les déplacer ni les redimensionner dans l'éditeur.

Chaque carte est la page de l'extension, en petit. Son contenu dépend de l'extension.

## Panneaux latéraux

1. Sélectionnez le bouton des panneaux dans l'en-tête, à côté de la cloche des notifications. Il n'apparaît que si au moins une extension propose un panneau.
2. Choisissez un panneau dans la liste.
3. Le panneau s'ouvre à droite. Continuez à travailler dans la page à côté. Si vous changez de page, le panneau reste ouvert et garde son contenu.
4. Sélectionnez le bouton de fermeture en haut du panneau pour le fermer.

Sur un téléphone, le panneau prend tout l'écran sous l'en-tête. Fermez-le pour revoir la page.

Le panneau se ferme quand vous vous déconnectez, et quand son extension est désactivée ou que son panneau est désactivé.

## Qui les voit

Vous voyez la carte et le panneau d'une extension seulement si vous voyez l'extension elle-même. Si une extension est réservée à certains rôles, les autres rôles ne voient ni l'une ni l'autre.

## Pour les administrateurs : désactiver une carte ou un panneau

1. Ouvrez **Paramètres**, puis **Marketplace**, puis **Installé**.
2. Ouvrez l'extension.
3. Ouvrez le menu ⋯ et choisissez **Emplacements**. Cet élément n'apparaît que pour une extension qui a une carte ou un panneau.
4. Désactivez **Carte du tableau de bord** ou **Panneau latéral**. Chaque interrupteur enregistre dès que vous le basculez.

Ce réglage vaut pour tout le laboratoire. Il masque la carte ou le panneau pour tous. La page de l'extension, son entrée dans la barre latérale et ses autres tâches continuent. Pour arrêter toute l'extension, utilisez **Désactiver** dans le même menu.

Le journal d'audit inscrit chaque changement sous `plugin.sites.update`.

En ligne de commande :

```bash
openldr market sites <plugin-id>
```

```bash
openldr market sites <plugin-id> widget off
```

La première commande liste la carte et le panneau de l'extension et indique si chacun est actif. La seconde en change un. Utilisez `widget` ou `panel`, et `on` ou `off`.

## Essayer avec l'extension de test

Le dépôt contient une extension de référence avec une carte et un panneau. Utilisez-la sur une installation de test, depuis une copie du code source. Sa construction demande Rust et la cible `wasm32-wasip1`. Voir **Construire des extensions** sur la page Développement du site web.

1. Dans le dossier du dépôt, lancez `pnpm build:ui-reference`. La commande construit l'extension test-sink et place `plugin.wasm` et `manifest.json` dans `reference-plugins/ui-reference/`.
2. Lancez `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`.
3. Rechargez le studio.
4. Ouvrez **Tableau de bord**. Une carte nommée **Reference card** apparaît sous les widgets.
5. Sélectionnez **Panneaux latéraux**, le bouton des panneaux à côté de la cloche des notifications, puis choisissez **Reference panel**.

**Résultat attendu :** la carte affiche **Drawn in: widget** et le panneau affiche **Drawn in: panel**. La barre latérale a aussi une entrée **Reference Plugin**, qui ouvre la page de l'extension.

L'extension de référence ne nomme aucun éditeur, elle s'installe donc sans signature. Sa page utilise un texte foncé, difficile à lire avec le thème sombre. Pour la retirer, lancez `pnpm openldr plugin remove ui-reference`.

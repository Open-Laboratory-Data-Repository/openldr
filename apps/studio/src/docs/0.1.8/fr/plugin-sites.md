# Cartes et panneaux latéraux des plugins

Certains plugins installés ajoutent une carte au tableau de bord ou un panneau latéral. Un panneau permet de garder le plugin visible en passant entre les pages.

La carte et le panneau sont visibles seulement si vous avez accès au plugin. Les restrictions de rôles du plugin s'appliquent aussi ici.

Les administrateurs disposant de la gestion du marché peuvent masquer une carte ou un panneau pour tout le laboratoire. La page du plugin et ses autres fonctions restent actives.

Utilisez un plugin déjà installé par votre organisation. Les captures utilisent Reference Plugin, facultatif, dans une installation de test. Le thème clair rend cet exemple lisible. Aucune donnée clinique d'exemple n'est nécessaire.

## Lire une carte de plugin

Un plugin doit déclarer une carte avant qu'elle puisse apparaître. Son contenu provient du plugin.

### 1. Ouvrir Dashboard

Lisez la carte sous les widgets du tableau de bord. Les cartes apparaissent hors de l'éditeur de widgets habituel. Vous ne pouvez pas les y déplacer ni les redimensionner.

![Une carte déclarée apparaît sous les widgets du tableau de bord.](plugin-sites-guide-dashboard.png)

**Résultat attendu :** l'exemple indique Drawn in: widget. Votre plugin affiche son propre contenu.

## Ouvrir un panneau pendant votre travail

Un panneau est disponible seulement si un plugin actif le déclare et si vous avez accès à ce plugin.

### 1. Ouvrir Side panels

Sélectionnez **Side panels** près de la cloche de notifications. Ce bouton apparaît seulement si un panneau est disponible.

![Side panels apparaît lorsqu'un plugin accessible déclare un panneau.](plugin-sites-guide-panel-button.png)

### 2. Choisir un panneau

Sélectionnez son titre. L'exemple utilise **Reference panel**.

![Choisir le panneau par son titre.](plugin-sites-guide-panel-choice.png)

### 3. Lire le panneau

Le panneau s'ouvre à droite. Sur ordinateur, la page principale reste accessible à côté.

![Le panneau s'ouvre à côté de la page actuelle.](plugin-sites-guide-panel-open.png)

### 4. Passer à une autre page

Choisissez une autre page dans le menu principal. Le panneau reste ouvert avec son contenu actuel. L'exemple passe à Forms.

![Le panneau reste ouvert pendant le changement de page.](plugin-sites-guide-navigate.png)

### 5. Fermer le panneau

Sélectionnez **Close** en haut à droite du panneau.

![Close rend l'espace à la page principale.](plugin-sites-guide-close.png)

**Résultat attendu :** la fermeture rend l'espace à la page principale. La déconnexion ou la désactivation du plugin ou de son panneau le ferme aussi.

## Masquer une carte ou un panneau

Ces interrupteurs s'appliquent à tout le laboratoire. Chaque changement s'enregistre immédiatement. Aucune action Save distincte n'est nécessaire.

### 1. Ouvrir Marketplace

Ouvrez **Settings**, puis **Marketplace**.

![Ouvrir Settings puis Marketplace.](plugin-sites-guide-marketplace.png)

### 2. Choisir Installed

Utilisez l'onglet **Installed**.

![Choisir Installed pour trouver le plugin.](plugin-sites-guide-installed.png)

### 3. Ouvrir le plugin

Choisissez le plugin installé qui fournit la carte ou le panneau.

![Ouvrir la carte du plugin installé.](plugin-sites-guide-plugin.png)

### 4. Ouvrir ses actions

Sélectionnez les points du détail du plugin.

![Ouvrir les points du détail du plugin.](plugin-sites-guide-actions.png)

### 5. Choisir Places

Sélectionnez **Places**. Cette action apparaît seulement si le plugin déclare une carte ou un panneau.

![Places apparaît seulement pour un plugin déclarant une carte ou un panneau.](plugin-sites-guide-places.png)

### 6. Modifier Dashboard card

Désactivez **Dashboard card** pour masquer cette carte. Réactivez-le pour la rétablir.

![Dashboard card enregistre chaque changement immédiatement.](plugin-sites-guide-card-switch.png)

## Contrôler le panneau séparément

Continuez dans Places. Chaque interrupteur contrôle son emplacement. Il ne désactive pas le plugin entier.

### 1. Vérifier l'état enregistré

Un interrupteur désactivé indique une carte masquée. En cas d'échec d'enregistrement, un message apparaît et l'état précédent reste conservé.

![L'interrupteur de la carte est maintenant désactivé pour tout le laboratoire.](plugin-sites-guide-card-off.png)

### 2. Modifier Side panel séparément

Désactivez **Side panel** pour masquer ce panneau. Il possède son propre interrupteur.

![Side panel se règle séparément.](plugin-sites-guide-panel-switch.png)

### 3. Vérifier le résultat

Fermez Places et revenez à Dashboard. L'exemple masque les deux emplacements, mais Reference Plugin reste dans le menu principal.

![Les emplacements désactivés disparaissent et la page du plugin reste accessible.](plugin-sites-guide-hidden.png)

**Résultat attendu :** la page du plugin et ses autres fonctions restent actives. Chaque changement apparaît dans Audit sous plugin.sites.update.

## Utiliser un panneau sur téléphone

Sur téléphone, le panneau recouvre la page principale sous l'en-tête de l'application.

### 1. Choisir le panneau

Ouvrez Side panels dans l'en-tête et choisissez le panneau.

![Utiliser Side panels dans l'en-tête sur téléphone.](plugin-sites-guide-phone-menu.png)

### 2. Lire le panneau

Utilisez le contenu du panneau. La page sous-jacente est recouverte.

![Sur téléphone, le panneau recouvre la page sous l'en-tête.](plugin-sites-guide-phone-panel.png)

### 3. Revenir à la page principale

Sélectionnez **Close** en haut à droite du panneau.

![Fermer le panneau pour revenir à la page principale.](plugin-sites-guide-phone-close.png)

**Résultat attendu :** les captures vérifient la disposition à 375 pixels. Seul un vrai téléphone peut confirmer l'accès autour des barres rétractables du navigateur.

## Consulter ou modifier les emplacements en ligne de commande

Consultez [Commencer ici](/docs/start-here) pour configurer la CLI. Depuis `openldr_ce`, utilisez l'identifiant du plugin. `widget` désigne Dashboard card et `panel` désigne Side panel.

```shell
pnpm openldr market sites <plugin-id>
pnpm openldr market sites <plugin-id> widget off
pnpm openldr market sites <plugin-id> widget on
pnpm openldr market sites <plugin-id> panel off
pnpm openldr market sites <plugin-id> panel on
```

## Pratique facultative avec Reference Plugin

Utilisez votre plugin installé pour le travail habituel. Dans une installation de test depuis les sources, le plugin de référence montre une carte, un panneau et une page distincte. La compilation exige Rust et la cible `wasm32-wasip1`.

Depuis `openldr_ce`, lancez `pnpm build:ui-reference`, puis `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`. Rechargez Studio. Dashboard affiche Reference card et Side panels propose Reference panel. Le plugin ne déclare aucune signature d'éditeur. Utilisez-le seulement dans une installation de test.

La capture indique Drawn in: widget ou Drawn in: panel selon l'emplacement. Sa note de test est fictive. Retirez ensuite le plugin avec `pnpm openldr plugin remove ui-reference`.

## Résolution de problèmes

**Le bouton Side panels manque.** Vérifiez qu'un plugin actif et accessible déclare un panneau et que son interrupteur Side panel est activé.

**L'action Places manque.** Le plugin peut ne déclarer aucune carte ni panneau. Places n'ajoute pas de fonction au plugin.

**La carte manque.** Vérifiez Dashboard card dans Places, l'activation du plugin et les accès de votre rôle.

**L'exemple de référence est difficile à lire.** Utilisez le thème clair. Son texte sombre est fixe.

## Guides associés

[Marché](/docs/marketplace) explique l'installation et l'état des plugins. [Tableaux de bord](/docs/dashboard) explique les widgets habituels.

# Vos préférences

Votre thème, l'état de la barre latérale, votre page de démarrage et votre langue sont enregistrés dans votre compte. Ils vous suivent sur chaque navigateur, ordinateur ou téléphone où vous vous connectez.

Comptez 5 minutes. Sélectionnez une image ou un clip pour l'agrandir.

## Qui peut faire quoi

Tout le monde. Les préférences appartiennent à chaque utilisateur. Ce n'est pas un réglage du laboratoire, et aucun rôle ni aucune capacité n'est nécessaire pour changer les siennes.

## Ce qui est enregistré

| Préférence | Comment la changer |
| --- | --- |
| Thème | Le bouton soleil ou lune dans l'en-tête, ou la touche `d`. |
| Barre latérale ouverte ou repliée | Le bouton de repli en haut de la barre latérale (ordinateur seulement). |
| Page de démarrage | Ouvrez le menu utilisateur en bas de la barre latérale, choisissez **Page de démarrage**, puis une page. |
| Langue | Ouvrez le menu utilisateur en bas de la barre latérale, choisissez **Langue**, puis une langue. |

Chaque changement est enregistré tout de suite. Il n'y a pas de bouton Enregistrer.

## Exemple 1 : ouvrir sur Rapports après la connexion

![Ouvrir le menu utilisateur, pointer Page de démarrage et choisir Rapports.](user-preferences-start-page.mp4)

1. Sélectionnez votre nom en bas de la barre latérale. Le menu utilisateur s'ouvre : **Langue**, **Page de démarrage**, **Paramètres**, **Se déconnecter**.
2. Pointez **Page de démarrage**. La liste montre les pages de votre barre latérale.
3. Sélectionnez **Rapports**. Un message dit **Rapports s'ouvrira en premier après la connexion.**
4. Ouvrez OpenLDR à son adresse principale, ou déconnectez-vous et reconnectez-vous.

**Résultat attendu :** **Rapports** s'ouvre, et non le tableau de bord.

![OpenLDR qui s'ouvre sur Rapports.](user-preferences-reports-first.png)

Fonctionnement de la page de démarrage :

- C'est le tableau de bord, sauf si vous en choisissez une autre. Choisissez **Tableau de bord** pour revenir au défaut.
- La liste ne montre que les pages de votre barre latérale. Votre rôle décide lesquelles.
- Elle s'ouvre une fois, à la connexion ou à l'adresse principale d'OpenLDR. Ensuite, le lien **Tableau de bord** ouvre toujours le tableau de bord.
- Un lien vers une page précise ouvre toujours cette page.
- Si votre rôle change et que vous ne pouvez plus ouvrir votre page de démarrage, le tableau de bord s'ouvre.

## Exemple 2 : passer au thème clair

![Sélectionner le bouton soleil dans l'en-tête.](user-preferences-theme.mp4)

1. Sélectionnez le bouton soleil en haut à droite, ou appuyez sur `d` en dehors d'un champ de saisie.

**Résultat attendu :** le studio passe en clair, et le reste à la prochaine connexion et sur vos autres appareils. Appuyez de nouveau sur `d` pour revenir.

![Le studio en thème clair.](user-preferences-light.png)

## Exemple 3 : travailler en français

![Ouvrir le menu utilisateur, pointer Langue et choisir Français.](user-preferences-language.mp4)

1. Ouvrez le menu utilisateur et pointez **Langue**.
2. Sélectionnez **Français**.

**Résultat attendu :** les menus et les pages passent en français tout de suite. La barre latérale affiche **Tableau de bord**, **Rapports**, etc. Choisissez **English** ou **Português** de la même façon.

![Le studio en français.](user-preferences-french.png)

La documentation intégrée suit aussi votre langue, quand une traduction existe.

## Sur un nouvel appareil

À votre première connexion sur un nouveau navigateur, OpenLDR charge vos préférences enregistrées et les applique. Si vous n'avez jamais enregistré de thème, le thème de ce navigateur devient votre thème enregistré.

La langue fonctionne de même, à une différence près. Une langue déjà choisie dans ce navigateur devient votre langue enregistrée. Un navigateur où vous n'en avez jamais choisi affiche l'anglais, et ce choix n'est pas enregistré : il ne peut donc pas remplacer la langue choisie sur un autre appareil.

## En ligne de commande

Un administrateur peut lire ou corriger les préférences d'un utilisateur :

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

Les clés sont `theme` (`light` ou `dark`), `sidebarCollapsed` (`true` ou `false`), `startPage` (un chemin de page comme `/reports`) et `language` (`en`, `fr` ou `pt`). La valeur `none` efface une clé. L'id de l'utilisateur vient de `openldr user list`.

## Sur un téléphone

Le menu utilisateur, le bouton de thème et la langue fonctionnent de même sur un téléphone. La barre latérale n'y a pas de bouton de repli : elle s'ouvre par le bouton de menu en haut à gauche.

## Dépannage

- **La page de démarrage ne s'ouvre pas.** Elle ne s'ouvre qu'à l'adresse principale ou après la connexion. Un favori vers une autre page ouvre cette page.
- **La page de démarrage n'a pas pu être enregistrée.** Vérifiez la connexion et choisissez-la de nouveau.
- **Un autre appareil montre un autre thème.** Il avait un thème avant que vous en enregistriez un. Changez le thème une fois sur n'importe quel appareil, et il est enregistré pour tous.
- **Un collègue reste bloqué sur une page qu'il ne peut plus ouvrir.** Le tableau de bord s'ouvre à la place. Pour effacer : `openldr user preferences set <user-id> startPage none`.

## Guides associés

- [Commencer ici](/docs/start-here)
- [Utilisateurs et rôles](/docs/users)

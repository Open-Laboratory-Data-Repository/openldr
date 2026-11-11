# Vos préférences

## Résultat

Votre thème, l'état de votre barre latérale et votre page de démarrage sont enregistrés dans votre compte. Ils vous suivent sur chaque navigateur, ordinateur ou téléphone où vous vous connectez.

## Ce qui est enregistré

| Préférence | Comment la changer |
| --- | --- |
| Thème | Utilisez le bouton soleil ou lune dans l'en-tête de la page, ou appuyez sur `d`. |
| Barre latérale ouverte ou réduite | Utilisez le bouton de réduction en haut de la barre latérale (ordinateur seulement). |
| Page de démarrage | Ouvrez le menu utilisateur en bas de la barre latérale, choisissez **Page de démarrage**, puis une page. |

Chaque changement est enregistré au moment où vous le faites. Il n'y a pas de bouton Enregistrer.

## Page de démarrage

La page de démarrage est la page qui s'ouvre après la connexion. C'est le Tableau de bord, sauf si vous en choisissez une autre.

- La liste ne montre que les pages de votre barre latérale. Votre rôle décide de ces pages.
- La page de démarrage s'ouvre une fois, quand vous vous connectez ou ouvrez OpenLDR à son adresse principale. Ensuite, le lien **Tableau de bord** ouvre toujours le Tableau de bord.
- Un lien vers une page précise ouvre toujours cette page.
- Si votre rôle change et que vous ne pouvez plus ouvrir votre page de démarrage, le Tableau de bord s'ouvre.
- Choisissez **Tableau de bord** pour revenir au réglage par défaut.

## Sur un nouvel appareil

La première fois que vous vous connectez sur un nouveau navigateur, OpenLDR charge vos préférences enregistrées et les applique. Si vous n'avez jamais enregistré de thème, le thème affiché par ce navigateur devient votre thème enregistré.

## Pour les administrateurs

Les préférences appartiennent à chaque utilisateur. Ce n'est pas un réglage du laboratoire, et aucun rôle ni aucune capacité n'est nécessaire pour les utiliser. Un administrateur peut lire ou corriger les préférences d'un utilisateur en ligne de commande :

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

Les clés sont `theme` (`light` ou `dark`), `sidebarCollapsed` (`true` ou `false`) et `startPage` (un chemin de page comme `/reports`). La valeur `none` efface une clé. Trouvez l'identifiant de l'utilisateur avec `openldr user list`.

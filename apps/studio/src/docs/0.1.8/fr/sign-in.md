# Connexion et mots de passe

Votre compte OpenLDR a un nom d'utilisateur et un mot de passe. Ce guide explique comment se connecter, changer son mot de passe, et que faire après un verrouillage ou un oubli. Les dernières tâches sont pour les administrateurs, qui ajoutent les personnes et réinitialisent leurs mots de passe.

Ce guide s'applique quand votre laboratoire utilise la connexion propre à OpenLDR. Vous le reconnaissez à deux signes : la page de connexion s'intitule **Connexion à OpenLDR**, et votre menu utilisateur contient **Changer le mot de passe**. Si votre laboratoire se connecte par Keycloak ou un autre fournisseur, votre mot de passe est géré là-bas. Demandez à votre administrateur comment le changer.

## Se connecter

1. Ouvrez l'adresse que vous utilisez pour Studio.
2. Dans **Nom d'utilisateur ou e-mail**, tapez votre nom d'utilisateur ou votre adresse e-mail.
3. Dans **Mot de passe**, tapez votre mot de passe.
4. Sélectionnez **Se connecter**.

**Résultat attendu :** Studio s'ouvre. Si un administrateur vous a donné un mot de passe temporaire, la page **Choisissez un nouveau mot de passe** s'ouvre à la place.

Les majuscules ne comptent pas dans le nom d'utilisateur ni dans l'e-mail. L'e-mail fonctionne seulement si aucun autre compte n'a le même. Le mot de passe doit être exact.

Vous restez connecté tant que vous utilisez Studio. Une session se termine après 12 heures sans utilisation, ou 7 jours après la connexion, selon ce qui arrive en premier. Il faut alors vous reconnecter.

Fermer le navigateur vous déconnecte de ce navigateur, sauf s'il est réglé pour rouvrir sa dernière session. Les limites de 12 heures et de 7 jours s'appliquent toujours.

## Choisir un nouveau mot de passe à la première connexion

Un administrateur qui vous ajoute ou réinitialise votre mot de passe vous donne un mot de passe temporaire. Studio vous demande de le remplacer la première fois que vous l'utilisez.

1. Connectez-vous avec le mot de passe temporaire.
2. Dans **Mot de passe actuel**, tapez le mot de passe temporaire.
3. Dans **Nouveau mot de passe**, tapez le mot de passe que vous voulez.
4. Dans **Répéter le mot de passe**, tapez-le de nouveau.
5. Sélectionnez **Changer le mot de passe**.

**Résultat attendu :** Studio s'ouvre. Tant que cette page n'est pas terminée, Studio n'affiche rien d'autre. Pour partir sans changer le mot de passe, sélectionnez **Se déconnecter**.

Un mot de passe compte de 10 à 128 caractères, et ne peut pas être votre nom d'utilisateur. Aucune règle n'impose de chiffres ou de symboles, et un mot de passe n'expire jamais. Une longue phrase facile à retenir convient bien.

Le nouveau mot de passe ne peut pas être le mot de passe temporaire. Si vous saisissez à nouveau le mot de passe temporaire, Studio affiche **Choisissez un mot de passe différent du mot de passe temporaire.**

## Changer votre mot de passe

1. Sélectionnez votre nom en bas à gauche du menu principal. Sur un téléphone, ouvrez d'abord le menu principal en haut à gauche.
2. Sélectionnez **Changer le mot de passe**. Un panneau s'ouvre.
3. Dans **Mot de passe actuel**, tapez le mot de passe que vous utilisez aujourd'hui.
4. Dans **Nouveau mot de passe**, tapez le nouveau.
5. Dans **Répéter le mot de passe**, tapez-le de nouveau.
6. Ouvrez le menu à trois points en haut à droite du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** le message **Mot de passe modifié.** s'affiche et le panneau se ferme. Vous restez connecté ici. Tous les autres navigateurs ou appareils où vous étiez connecté sont déconnectés.

Un mot de passe actuel faux compte comme un essai faux, comme à la connexion.

## Se déconnecter

1. Sélectionnez votre nom en bas à gauche du menu principal.
2. Sélectionnez **Se déconnecter**.

**Résultat attendu :** la page **Connexion à OpenLDR** s'ouvre.

Parfois, Studio ne joint pas le serveur au moment de la déconnexion. La page de connexion affiche alors **La déconnexion n'a pas atteint le serveur. Votre session est peut-être encore ouverte dans ce navigateur.** Quand la connexion revient, sélectionnez **Réessayer la déconnexion**. Sur un ordinateur partagé, attendez que ce message disparaisse avant de partir.

## Si votre compte est verrouillé

Cinq mots de passe faux de suite verrouillent le compte pendant cinq minutes. Pendant le verrouillage, même le bon mot de passe est refusé.

La page de connexion affiche un seul message pour un mot de passe faux et pour un compte verrouillé : **Ces informations sont incorrectes, ou le compte est verrouillé pour quelques minutes.** Elle ne dit pas lequel, pour qu'un inconnu ne puisse pas savoir si un compte existe.

1. Attendez cinq minutes.
2. Reconnectez-vous, en tapant le mot de passe avec soin.

**Résultat attendu :** Studio s'ouvre.

Un verrouillage se termine toujours tout seul. Personne ne peut bloquer un compte pour de bon en devinant. Une connexion réussie remet le compte à zéro, tout comme une réinitialisation du mot de passe par un administrateur.

**Trop de tentatives. Attendez une minute et réessayez.** est une autre limite. Elle autorise 30 tentatives de connexion par minute depuis une même adresse, quel que soit le compte. Attendez une minute, puis réessayez.

## Si vous oubliez votre mot de passe

Demandez à un administrateur de le réinitialiser. La connexion propre à OpenLDR ne peut pas vous envoyer de lien de réinitialisation par e-mail.

L'administrateur vous donne un mot de passe temporaire. Connectez-vous avec, puis choisissez-en un nouveau, comme dans [Choisir un nouveau mot de passe à la première connexion](#choisir-un-nouveau-mot-de-passe-a-la-premiere-connexion).

## Créer le premier administrateur

Cette tâche et les suivantes sont pour les administrateurs.

Une nouvelle installation n'a aucun compte. Tant que personne n'a créé le premier administrateur, Studio affiche la page **Créer l'administrateur** à quiconque l'ouvre. Le code de configuration prouve que cette personne a aussi accès au serveur.

1. Sur le serveur, lancez `openldr auth setup-code`. La commande affiche un code valable 30 minutes.
2. Ouvrez Studio. La page **Créer l'administrateur** s'ouvre.
3. Dans **Code de configuration**, tapez le code.
4. Dans **Nom d'utilisateur**, tapez le nom d'utilisateur de l'administrateur. Utilisez 3 à 64 lettres, chiffres, points, tirets ou traits de soulignement.
5. Dans **Mot de passe** et **Répéter le mot de passe**, tapez le mot de passe.
6. Sélectionnez **Créer l'administrateur**.

**Résultat attendu :** vous êtes connecté au nom du nouvel administrateur, avec le rôle **Administrator**, et le [Premier démarrage](/docs/first-run) s'ouvre. La page ne revient plus sur cette installation.

Relancer la commande remplace le code précédent. Tant que le premier administrateur n'existe pas, `openldr doctor` affiche un avertissement sur sa ligne Sign-in. Voir [Vérifications d'installation](/docs/setup-checks).

Dans l'application OpenLDR, vous sautez les étapes 1 et 3. L'application remplit **Code de configuration**, et l'indication sous le champ dit **Rempli par l'application OpenLDR.**

## Ajouter une personne avec un mot de passe temporaire

Il faut l'autorisation **Manage users**. Le rôle Administrator l'a.

1. Ouvrez **Utilisateurs** dans le menu principal.
2. Ouvrez le menu à trois points en haut à droite et sélectionnez **Nouvel utilisateur**.
3. Dans **Nom d'utilisateur**, tapez le nom d'utilisateur de la personne.
4. Dans **Mot de passe**, tapez un mot de passe temporaire de 10 caractères ou plus.
5. Dans **Confirmer le mot de passe**, tapez-le de nouveau.
6. Dans **Rôle**, choisissez un rôle.
7. Ouvrez le menu à trois points du panneau et sélectionnez **Créer**.

**Résultat attendu :** un message comme **amina enregistré** s'affiche, et la personne apparaît dans la liste. À la première connexion, elle doit choisir son propre mot de passe.

Donnez le mot de passe temporaire directement à la personne, en face à face ou par téléphone. Si vous laissez **Mot de passe** vide, le compte ne peut pas se connecter tant que vous n'avez pas réinitialisé son mot de passe.

## Réinitialiser le mot de passe de quelqu'un

Faites-le quand une personne a oublié son mot de passe, ou quand vous pensez que quelqu'un d'autre le connaît. Il faut l'autorisation **Reset passwords**.

1. Ouvrez **Utilisateurs** dans le menu principal.
2. Sur la ligne de la personne, ouvrez le menu à trois points et sélectionnez **Réinitialiser le mot de passe**.
3. Sélectionnez **Générer**. Un nouveau mot de passe de 16 caractères remplit les deux champs.
4. Sélectionnez le bouton de copie à côté du mot de passe, ou lisez-le dans le champ.
5. Laissez **Exiger le changement du mot de passe à la prochaine connexion** coché.
6. Sélectionnez **Réinitialiser le mot de passe**.

**Résultat attendu :** un message comme **Mot de passe réinitialisé pour amina** s'affiche. La personne est déconnectée partout d'un coup. À la prochaine connexion, elle doit choisir un nouveau mot de passe. La réinitialisation met aussi fin à un verrouillage.

Un mot de passe que vous tapez vous-même au lieu de **Générer** suit les mêmes règles : 10 à 128 caractères, et pas le nom d'utilisateur.

## Fermer les sessions de quelqu'un

Faites-le quand une personne perd un téléphone ou un portable, ou laisse un ordinateur partagé connecté. Il faut l'autorisation **Force logout**.

1. Ouvrez **Utilisateurs** dans le menu principal.
2. Sur la ligne de la personne, ouvrez le menu à trois points et sélectionnez **Forcer la déconnexion**.
3. Sélectionnez de nouveau **Forcer la déconnexion** pour confirmer.

**Résultat attendu :** un message comme **Toutes les sessions déconnectées pour amina** s'affiche. Chacun de ses navigateurs et appareils perd l'accès à sa requête suivante. Son mot de passe ne change pas.

Vous ne pouvez pas le faire sur votre propre ligne. Utilisez **Se déconnecter** à la place.

## En ligne de commande

Un serveur de laboratoire sans navigateur dispose des mêmes actions sous forme de commandes `openldr`. Lancez-les sur le serveur.

```bash
openldr auth setup-code
openldr user create --username amina --name "Amina Hassan" --role lab_technician
openldr users list
openldr user assign-role <user-id> data_analyst
openldr user reset-password <username> --force
openldr user end-sessions <username>
```

- `auth setup-code` affiche un code de configuration pour le premier administrateur, valable 30 minutes. La commande refuse dès qu'un administrateur existe.
- `user create` affiche l'ID du nouvel utilisateur et un mot de passe temporaire, une seule fois. Copiez le mot de passe à ce moment-là, car rien ne l'affiche de nouveau. La commande refuse un rôle qui n'existe pas. Elle refuse aussi tant que le premier administrateur n'existe pas.
- `users list` affiche l'ID de chaque utilisateur en début de ligne.
- `user assign-role` ajoute un rôle. Elle prend l'ID de l'utilisateur, pas le nom d'utilisateur. Avec un nom d'utilisateur, elle annonce un succès et n'accorde rien.
- `user reset-password` affiche une seule fois un nouveau mot de passe temporaire et ferme les sessions de la personne. Sans `--force`, elle ne change rien.
- `user end-sessions` déconnecte la personne partout.

`reset-password` et `end-sessions` comparent le nom d'utilisateur exactement, majuscules comprises.

## Limites

- En HTTP simple, un mot de passe traverse le réseau sans chiffrement. Toute personne qui peut observer le réseau entre votre ordinateur et le serveur peut le lire. HTTPS, ou un réseau privé comme Tailscale, règle ce problème. Demandez à votre administrateur ce que votre laboratoire utilise.
- Il n'y a pas de second facteur, comme un code d'une application de téléphone.
- Il n'y a pas de réinitialisation du mot de passe par e-mail. Un administrateur réinitialise les mots de passe.
- Les personnes ne peuvent pas créer leur propre compte. Un administrateur les ajoute.
- Les cinq essais, le verrouillage de cinq minutes et les durées de session sont fixes. Ce ne sont pas des paramètres.

## Dépannage

- **La page dit que les informations sont incorrectes, mais j'en suis sûr.** Le compte est peut-être verrouillé. Attendez cinq minutes. Un compte désactivé reçoit le même message, donc si l'échec continue, demandez à un administrateur.
- **Studio m'a renvoyé à la page de connexion.** La session s'est terminée. Cela arrive après 12 heures sans utilisation, après 7 jours, quand un administrateur la ferme, ou quand vous changez votre mot de passe sur un autre appareil. Reconnectez-vous.
- **Impossible de joindre le serveur. Réessayez.** Studio ne joint pas le serveur. Vérifiez votre connexion, puis réessayez.
- **La page de configuration dit que le code est incorrect ou a expiré.** Un code dure 30 minutes, et chaque nouveau code remplace le précédent. Relancez `openldr auth setup-code` et tapez le code le plus récent.
- **Dans l'application OpenLDR, le champ du code de configuration est vide.** L'application ne le remplit que pour un OpenLDR qu'elle a démarré elle-même. Sélectionnez **Quitter** dans le menu de l'icône de notification de l'application, puis relancez l'application. Elle remplit alors le code. Vous pouvez aussi lancer la commande `openldr-standalone` de l'application avec `cli -- auth setup-code`, et taper le code. Sous Linux, la commande est `~/.local/share/openldr-desktop/openldr-standalone`. Sous macOS, c'est `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone`. Sous Windows, dans PowerShell, lancez `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" cli -- auth setup-code`. Une installation de bureau n'a pas de commande `openldr`, donc l'indication sous le champ ne s'y applique pas.
- **La page de configuration dit que le nom d'utilisateur est déjà utilisé.** Choisissez un autre nom d'utilisateur.
- **La page de configuration dit qu'un administrateur existe déjà.** Quelqu'un a terminé la configuration avant vous. Sélectionnez **Se connecter**.
- **Le dernier administrateur a oublié son mot de passe.** Une personne qui a accès au serveur lance `openldr user reset-password <username> --force`. La commande affiche un mot de passe temporaire.

## Guides associés

- [Vos préférences](/docs/user-preferences)
- [Utilisateurs et rôles](/docs/users)
- [Vérifications d'installation](/docs/setup-checks)
- [Premier démarrage](/docs/first-run)

# Packs de profil

Un pack de profil est un pack de contenu signé qui prépare cette installation pour un métier précis, par exemple un site de prélèvement. En une seule installation, il crée un rôle, une disposition de la barre latérale et des formulaires. Les administrateurs l'installent et le suppriment dans Marketplace.

## Installer un pack de profil

Faites-le quand votre organisation vous fournit un pack de profil signé pour préparer un métier, par exemple un site de prélèvement. Il vous faut **Gérer la place de marché** et **Gérer les rôles**. Un pack ne peut pas donner à son rôle une capacité que vous n'avez pas vous-même.

1. Ouvrez **Paramètres**, puis **Marketplace**.
2. Sélectionnez **Parcourir**, puis ouvrez la fiche du pack.
3. Ouvrez le menu à points en haut à droite et sélectionnez **Installer**.
4. Lisez la version et chaque ligne sous **Étapes**. La tâche suivante explique ces lignes.
5. Sélectionnez la flèche à droite de chaque ligne **Rôle** et lisez ses capacités.
6. Sélectionnez **Approuver et installer**.

**Résultat attendu :** le message **installé** s'affiche avec l'identifiant du pack. Le pack figure sous **Installés**. Le nouveau rôle apparaît sur la page **Rôles** et la nouvelle disposition sur la page **Dispositions**. Chacun porte la mention **Du pack** suivie de l'identifiant du pack. Les formulaires sont publiés dans Formulaires.

Le nouveau rôle n'a encore aucun membre. Attribuez-le dans Utilisateurs. Une personne qui a ce rôle voit par défaut la disposition du pack, si le pack l'a définie par défaut pour ce rôle.

OpenLDR vérifie chaque étape avant d'écrire quoi que ce soit. Si une vérification échoue, un message nomme le problème et rien n'est installé. La section Dépannage liste les cas courants. Si une étape échoue en cours de route, le pack affiche **Échec à l'étape** avec son numéro et l'erreur. Corrigez la cause, puis ouvrez le menu à points et sélectionnez **Installer à nouveau**.

## Lire les lignes du résumé

La fenêtre d'installation affiche une ligne par étape, dans l'ordre où le pack les installe. Chaque ligne donne le type d'étape et son nom. La plupart se terminent par un nombre.

- **Dépend de** liste les plugins et les packs qui doivent être installés avant, et combien. S'il en manque un, ou si sa version sort de l'intervalle indiqué, l'installation s'arrête avant toute écriture.
- **Rôle** donne le nom du rôle et le nombre de capacités qu'il accorde. Sélectionnez la flèche à droite de la ligne pour voir chaque capacité par son nom.
- **Disposition** donne le nom de la barre latérale, ses pages et les rôles pour lesquels elle est la disposition par défaut. Un serveur plus ancien n'affiche que le nombre de pages.
- **Formulaire** donne le titre du formulaire, sans nombre.

Les étapes plus anciennes, comme **Système de codes** ou **Jeux de données**, affichent un simple nombre. Le guide [Marketplace](/docs/marketplace) les explique.

Lisez toutes les capacités de chaque rôle avant d'approuver. Toute personne à qui vous donnerez ce rôle les recevra toutes.

## Supprimer un pack de profil

Faites-le quand l'installation n'a plus besoin du métier que le pack a préparé. Il vous faut **Gérer la place de marché**, et **Gérer les rôles** si le pack a créé un rôle.

1. Ouvrez **Paramètres**, puis **Marketplace**.
2. Sélectionnez **Installés**, puis ouvrez le pack.
3. Ouvrez le menu à points en haut à droite et sélectionnez **Supprimer**.
4. Lisez les trois listes : **Rôles supprimés**, **Dispositions supprimées** et **Formulaires conservés**.
5. Sélectionnez **Supprimer**.

**Résultat attendu :** le message **supprimé** s'affiche avec l'identifiant du pack. Le pack ne figure plus sous **Installés**. Ses rôles et ses dispositions ont disparu.

La suppression laisse les formulaires du pack publiés, avec toutes leurs réponses. Archivez un formulaire dans Formulaires si vous n'en voulez plus. Si ces formulaires étaient réservés aux rôles du pack, toute personne autorisée à consulter les formulaires pourra les ouvrir après la suppression. Elle ne touche pas non plus aux listes de codes, requêtes, jeux de données et correspondances installés par le pack, ni aux plugins et packs dont il dépendait.

Si quelqu'un a encore l'un des rôles du pack, la fenêtre l'indique en rouge et liste chaque rôle avec ses utilisateurs. **Supprimer** reste inactif. Retirez ce rôle à ces personnes dans Utilisateurs, puis rouvrez la fenêtre.

## Ce que signifie « Du pack »

Sur la page **Rôles** et sur la page **Dispositions**, un rôle ou une disposition créé par un pack affiche **Du pack** et l'identifiant du pack sous son nom.

Vous pouvez toujours modifier ce rôle ou cette disposition. La prochaine mise à jour du pack remet ce que le pack prévoit, et votre modification est perdue. Si vous le supprimez, la prochaine installation du pack le recrée.

Un pack ne modifie jamais un rôle ou une disposition qu'il n'a pas créé. Si vous avez créé à la main un rôle ou une disposition avec le même identifiant ou le même nom, le pack refuse de s'installer.

Une mise à jour du pack supprime un rôle ou une disposition que la nouvelle version ne contient plus. Elle refuse tant que quelqu'un a encore ce rôle, comme la suppression.

## Limites

- La disposition et les formulaires d'un pack ne peuvent nommer que des rôles créés par ce même pack. Un pack ne peut pas les rattacher à un rôle que vous avez créé.
- Une disposition ne fait que masquer des pages. Les capacités du rôle décident de ce qu'une personne peut ouvrir.
- Sur un serveur central, un pack crée son rôle et sa disposition sur ce serveur seulement. Les rôles et les dispositions ne partent pas vers les laboratoires. Ses formulaires les rejoignent comme n'importe quel formulaire.

## Dépannage

Les messages ci-dessous viennent du serveur, en anglais. Un mot entre chevrons remplace un nom.

- **Le message dit `installing this pack needs the roles.manage capability`.** Vous n'avez pas **Gérer les rôles**. Demandez à un administrateur qui l'a d'installer le pack.
- **Le message dit `you cannot install a role that grants <capability>, because you do not hold it`.** Installez le pack avec un compte qui a cette capacité.
- **Le message dit `a role with the slug <slug> already exists and this pack did not make it`.** Quelqu'un a créé ce rôle à la main. Il en va de même pour `a layout named <name>`. Supprimez le vôtre si personne n'en a besoin, ou demandez à l'éditeur un pack qui utilise un autre nom.
- **Le message dit `this pack needs <id> <range>, which is not installed`.** Installez d'abord ce plugin ou ce pack, dans une version comprise dans l'intervalle indiqué.
- **Le message dit `this pack needs <id> <range>; <version> is installed`.** La version installée sort de l'intervalle. Installez une version comprise dans l'intervalle indiqué.
- **La fenêtre affiche `removing this pack needs the roles.manage capability`.** Le pack a créé un rôle, donc sa suppression demande **Gérer les rôles**. Demandez à un administrateur qui l'a de supprimer le pack.
- **Supprimer reste inactif.** Quelqu'un a encore l'un des rôles du pack. Retirez-le-lui d'abord dans Utilisateurs.

## Guides associés

- [Marketplace](/docs/marketplace)
- [Rôles](/docs/roles)
- [Dispositions](/docs/layouts)
- [Formulaires](/docs/forms)

# Dispositions

## Résultat

Une disposition est une barre latérale nommée. Elle fixe les pages affichées dans la barre latérale et la page ouverte en premier après la connexion. Un administrateur crée les dispositions et en choisit une par défaut pour chaque rôle. Chaque utilisateur peut en choisir une autre, ou la barre latérale complète.

Une disposition ne fait que masquer des pages. Elle n'affiche jamais une page que votre rôle ne peut pas ouvrir, et une page masquée s'ouvre toujours depuis un lien. La documentation reste toujours affichée.

## Choisir votre disposition

1. Ouvrez le menu utilisateur en bas de la barre latérale.
2. Choisissez **Disposition**. Cet élément n'apparaît que s'il existe au moins une disposition.
3. Choisissez :
   - **Par défaut du rôle** utilise la disposition que votre administrateur a fixée pour votre rôle. Le nom entre parenthèses l'indique.
   - Une disposition par son nom utilise celle-ci, quelle que soit la valeur par défaut de votre rôle.
   - **Barre latérale complète** affiche toutes les pages que votre rôle peut ouvrir.

Votre choix est enregistré dans votre compte et vous suit sur chaque navigateur ou téléphone.

## Quelle page s'ouvre en premier

1. Votre propre page de démarrage, si vous en avez choisi une sous **Page de démarrage** dans le menu utilisateur.
2. Sinon, la page de démarrage de votre disposition.
3. Sinon, le Tableau de bord.

La page de démarrage ne s'ouvre que si elle figure dans votre barre latérale. La liste **Page de démarrage** ne propose que les pages affichées par votre disposition.

## Pour les administrateurs : créer une disposition

1. Ouvrez **Paramètres**, puis **Dispositions**.
2. Ouvrez le menu ⋯ en haut à droite et choisissez **Nouvelle disposition**.
3. Donnez-lui un **Nom**.
4. Cochez les **Pages** affichées.
5. Choisissez une **Page de démarrage** parmi les pages cochées, ou laissez Tableau de bord.
6. Sous **Par défaut pour les rôles**, cochez chaque rôle qui doit recevoir cette disposition par défaut. Un rôle n'a qu'une valeur par défaut. Cocher un rôle ici le retire de toute autre disposition.
7. Ouvrez le menu ⋯ de la fenêtre latérale et choisissez **Enregistrer**.

Pour modifier ou supprimer une disposition, utilisez le menu ⋯ de sa ligne. La suppression demande une confirmation. Les utilisateurs qui avaient choisi une disposition supprimée reviennent à la valeur par défaut de leur rôle.

Un utilisateur avec plusieurs rôles reçoit la valeur par défaut du premier de ces rôles, dans l'ordre de la page Rôles.

Il faut la capacité `settings.edit_general` pour modifier les dispositions. Tout utilisateur connecté voit la liste, car le menu utilisateur la propose. Le journal d'audit inscrit chaque changement sous `layout.create`, `layout.update` ou `layout.delete`.

## En ligne de commande

```bash
openldr layouts list
```

```bash
openldr layouts set Bench --pages /forms,/patients --start-page /forms --roles lab_technician
```

```bash
openldr layouts delete Bench --force
```

`set` crée la disposition, ou remplace celle qui porte ce nom. En cas de remplacement, la page de démarrage et les rôles non indiqués gardent leur valeur. `--start-page none` efface la page de démarrage.

Pour fixer le choix d'un utilisateur :

```bash
openldr user preferences set <user-id> layout full
```

Utilisez l'id d'une disposition, `full` pour la barre latérale complète, ou `none` pour revenir à la valeur par défaut du rôle.

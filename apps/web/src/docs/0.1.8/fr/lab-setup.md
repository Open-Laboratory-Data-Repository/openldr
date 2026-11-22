# Configurer un laboratoire

Le module laboratoire permettra à un laboratoire de réceptionner les échantillons, de suivre des listes de travail et de vérifier les résultats dans OpenLDR. Cette version le prépare. Vous définissez les sections du laboratoire, les examens à vérifier, si une personne peut valider ses propres résultats, et des seuils critiques sur les intervalles de référence. Vous donnez aussi les nouveaux rôles du laboratoire.

**La réception, les listes de travail et la vérification des résultats ne font pas partie de cette version.** Elles arrivent dans des versions ultérieures. Les réglages ci-dessous sont enregistrés dès maintenant. Les enregistrer ne change rien au travail actuel du laboratoire.

Le guide intégré **Configuration du laboratoire** montre chaque étape à l'écran. Cette page donne l'ordre et les commandes, pour une installation gérée en ligne de commande.

## Ce qu'il faut

- Un serveur OpenLDR de cette version ou plus récent, en marche.
- Un compte avec **Lab settings** pour les sections, la vérification et l'auto-validation.
- **Manage terminology** pour les seuils critiques, car ils font partie des intervalles de référence d'un examen.
- **Manage roles** pour donner les rôles du laboratoire.

## L'ordre des étapes

1. Ajoutez les sections du laboratoire, comme l'hématologie. Un examen ne peut être classé que dans une section qui existe. Un laboratoire sans sections peut passer cette étape.
2. Classez chaque examen dans sa section et indiquez s'il exige une vérification. Un examen exige une vérification tant que vous ne la désactivez pas.
3. Décidez de l'auto-validation. Elle est désactivée par défaut, donc la personne qui a saisi un résultat ne peut pas le valider.
4. Ajoutez des seuils critiques aux intervalles de référence des examens qui en ont. Utilisez les seuils approuvés par votre laboratoire.
5. Donnez les rôles **Reception**, **Lab Technician** et **Lab Manager**.

Les étapes 1 à 3 se font sur la page des paramètres du laboratoire et dans le catalogue des examens. L'étape 4 se fait dans le catalogue des examens. L'étape 5 se fait dans Utilisateurs. Les étapes 1 à 3 existent aussi comme commandes `openldr`.

## Les commandes

Connectez-vous d'abord avec `openldr login`, en tant que personne qui détient **Lab settings**. [Connexion du CLI et clés d'accès](/docs/cli-access) explique la connexion. Chaque commande est inscrite dans le journal d'audit sous votre compte.

```sh
openldr lab sections add haem Hématologie
openldr lab sections list
openldr lab tests set HGB --section haem --needs-review true
openldr lab tests set HGB --no-section
openldr lab settings set allow-self-authorise false
openldr lab sections remove haem --force
```

- `lab sections add <code> <name>` ajoute une section. Le code utilise des lettres minuscules, des chiffres et des tirets, en commençant par une lettre. Il ne peut plus changer ensuite.
- `lab sections list` affiche le code et le nom de chaque section.
- `lab tests set <code>` classe un examen dans une section avec `--section <code>`, l'en retire avec `--no-section`, et règle la vérification avec `--needs-review true` ou `false`. Un champ omis garde sa valeur enregistrée.
- `lab settings set allow-self-authorise true|false` active ou désactive l'auto-validation.
- `lab sections remove <code> --force` supprime une section. La commande refuse sans `--force`, car une suppression est définitive. Elle refuse aussi tant qu'un examen utilise la section, avec `section <code> is used by <n> tests`.

Dans une copie des sources, ajoutez `pnpm` devant, par exemple `pnpm openldr lab sections list`.

## Les rôles

- **Reception** peut réceptionner les échantillons, renvoyer une demande à son site, rejeter un échantillon, voir les listes de travail et ouvrir l'index des patients masqué.
- **Lab Technician** peut remplir et soumettre des formulaires, saisir des résultats et voir les listes de travail.
- **Lab Manager** a les sept capacités du laboratoire.

Sur une installation qui utilisait une version antérieure, Reception apparaît au premier démarrage du serveur sur cette version. Lab Technician et Lab Manager reçoivent leurs nouvelles capacités à ce démarrage, une seule fois. Une capacité retirée ensuite reste retirée.

## Résolution des problèmes

- **`lab sections remove` indique que des examens utilisent la section.** Déplacez ces examens avec `lab tests set <code> --section <autre>` ou `--no-section`, puis supprimez-la de nouveau.
- **`lab tests set` indique `no section <code>`.** Ajoutez d'abord la section avec `lab sections add`.
- **Une commande indique que le compte n'a pas la capacité.** Le compte n'a pas **Lab settings**. Donnez-lui le rôle Lab Manager, ou un rôle qui a cette capacité.

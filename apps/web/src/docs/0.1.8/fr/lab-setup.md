# Configurer un laboratoire

Le module laboratoire permet à un laboratoire de réceptionner les échantillons, de suivre des listes de travail et de vérifier les résultats dans OpenLDR. Cette version en apporte la première partie, la réception. Elle prépare aussi le reste. Vous définissez les sections du laboratoire, les examens à vérifier, si une personne peut valider ses propres résultats, et des seuils critiques sur les intervalles de référence. Vous donnez aussi les nouveaux rôles du laboratoire.

**Les listes de travail et la vérification des résultats ne font pas partie de cette version.** Elles arrivent dans des versions ultérieures. Les réglages de vérification et d'auto-validation ci-dessous sont enregistrés dès maintenant. Les enregistrer ne change rien au travail actuel du laboratoire.

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

Chaque commande passe par le serveur OpenLDR en marche, en tant que personne qui détient **Lab settings**. Sous Linux et macOS, connectez-vous d'abord avec `./openldr login`, ou définissez une clé d'accès dans `OPENLDR_KEY`. Sous Windows, `.\openldr.ps1` se connecte uniquement avec une clé d'accès, donc définissez d'abord `OPENLDR_KEY`. Les commandes n'ont pas été lancées sous Windows. [Connexion du CLI et clés d'accès](/docs/cli-access) explique la connexion. Chaque commande est inscrite dans le journal d'audit sous votre compte.

```sh
openldr lab sections add haem Hématologie
openldr lab sections list
openldr lab tests set HGB --section haem --needs-review true
openldr lab tests set HGB --no-section
openldr lab settings set allow-self-authorise false
openldr lab sections remove haem --force
openldr lab requisitions rebuild --force
```

- `lab sections add <code> <name>` ajoute une section. Le code utilise des lettres minuscules, des chiffres et des tirets, en commençant par une lettre. Il ne peut plus changer ensuite.
- `lab sections list` affiche le code et le nom de chaque section.
- `lab tests set <code>` classe un examen dans une section avec `--section <code>`, l'en retire avec `--no-section`, et règle la vérification avec `--needs-review true` ou `false`. Un champ omis garde sa valeur enregistrée.
- `lab settings set allow-self-authorise true|false` active ou désactive l'auto-validation.
- `lab sections remove <code> --force` supprime une section. La commande refuse sans `--force`, car une suppression est définitive. Elle refuse aussi tant qu'un examen utilise la section, avec `section <code> is used by <n> tests`.
- `lab requisitions rebuild --force` reconstruit l'index que la réception utilise pour trouver une demande par son numéro. OpenLDR tient cet index à jour tout seul. Lancez-la donc seulement quand une demande que vous savez enregistrée n'apparaît pas dans la réception. Elle affiche `Indexed <n> orders by requisition number.` Elle refuse sans `--force`, car elle réécrit tout l'index.

Dans une copie des sources, ajoutez `pnpm` devant, par exemple `pnpm openldr lab sections list`.

## Les rôles

- **Reception** peut réceptionner les échantillons, renvoyer une demande à son site, rejeter un échantillon ou une analyse, voir les listes de travail et ouvrir l'index des patients masqué.
- **Lab Technician** peut remplir et soumettre des formulaires, renvoyer et rejeter, saisir des résultats et voir les listes de travail. Il n'a pas **Receive samples**, il ne peut donc pas ouvrir la réception.
- **Lab Manager** a les sept capacités du laboratoire.

Sur une installation qui utilisait une version antérieure, Reception apparaît au premier démarrage du serveur sur cette version. Lab Technician et Lab Manager reçoivent leurs nouvelles capacités à ce démarrage, une seule fois. Une capacité retirée ensuite reste retirée.

## La réception

La réception est le guichet du laboratoire dans le studio. Elle trouve une demande par un numéro de demande scanné ou saisi, enregistre une demande dont le laboratoire n'a aucune trace, trouve ou enregistre le patient, reçoit l'échantillon avec son état et corrige une faute de frappe dans une demande, et annule une demande enregistrée à la réception pour l'enregistrer de nouveau. Elle renvoie aussi une demande à son site, rejette un échantillon ou une analyse, et lie un nouveau prélèvement à la demande qu'il remplace. Le guide intégré **Réception** montre chaque étape.

- La réception exige **Receive samples**. Les rôles Reception et Lab Manager l'ont.
- Le renvoi et le rejet exigent aussi **Return and reject**. Reception, Lab Technician et Lab Manager l'ont. Lier un nouveau prélèvement exige seulement **Receive samples**.
- Un utilisateur avec une limite de données perd **Receive samples** et **Return and reject**. Il n'a donc pas la réception.
- Le formulaire Lab order demande désormais seulement des tests. Il n'a plus de champ **Results**. Les résultats seront saisis et validés au laboratoire dans une version ultérieure. Il n'a plus non plus de champ **Order rejection**. Sur une installation mise à jour, OpenLDR retire ce champ d'un formulaire Lab order que personne n'a modifié. Un formulaire modifié par votre laboratoire le garde.
- Chaque test d'une nouvelle demande est enregistré comme sa propre demande d'examen. Les demandes enregistrées avant cette version restent telles quelles, et la réception liste tous leurs tests.
- Un site ne peut pas encore voir une demande renvoyée ou une demande de nouveau prélèvement sur son propre écran. Le laboratoire prévient le site.
- Un nouveau prélèvement exige un nouveau numéro de demande. L'ancien numéro désigne toujours la demande rejetée.
- Sur une installation mise à jour, Lab Technician reçoit **Return and reject** au premier démarrage sur cette version, une seule fois. Si vous la retirez ensuite, elle reste retirée.
- Le renvoi, le rejet et le lien d'un nouveau prélèvement ne sont pas encore des commandes `openldr`.

## Motifs de renvoi et de rejet

Les listes proposées par la réception sont des jeux de valeurs. Un laboratoire peut ajouter ses propres codes à chacune dans **Terminologie**, dans le studio.

| Liste | Jeu de valeurs |
|------|-----------|
| Pourquoi une demande retourne à son site | `urn:openldr:valueset:order-return-reason` |
| Pourquoi un échantillon est rejeté | `urn:openldr:valueset:order-reject-reason` |
| Pourquoi une analyse est rejetée | `urn:openldr:valueset:test-reject-reason` |
| L'état de l'échantillon | `urn:openldr:valueset:sample-condition` |

OpenLDR fournit quelques codes dans chacune, comme `Form incomplete` pour un renvoi et `Clotted` pour un échantillon. Ces codes fournis s'affichent en anglais.

## Résolution des problèmes

- **`lab sections remove` indique que des examens utilisent la section.** Déplacez ces examens avec `lab tests set <code> --section <autre>` ou `--no-section`, puis supprimez-la de nouveau.
- **`lab tests set` indique `no section <code>`.** Ajoutez d'abord la section avec `lab sections add`.
- **Une commande indique que le compte n'a pas la capacité.** Le compte n'a pas **Lab settings**. Donnez-lui le rôle Lab Manager, ou un rôle qui a cette capacité.

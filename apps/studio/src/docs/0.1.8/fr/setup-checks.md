# Vérifications de configuration

Setup checks vérifie les services et les paramètres nécessaires à cette installation. Utilisez cette page après l'installation ou une modification, puis suivez les conseils de chaque avertissement ou échec.

Vous avez besoin de View settings. Modifier un paramètre lié peut exiger une autre permission. Ces vérifications utilisent la même liste que `openldr doctor`. Consultez [Commencer ici](/docs/start-here) pour configurer la ligne de commande.

Consultez les résultats de votre installation. Les captures montrent une installation de développement isolée avec des omissions volontaires. Aucune donnée d'exemple n'est nécessaire.

## Lire le rapport de préparation actuel

Faites ces vérifications avant d'ouvrir l'installation au personnel. Elles s'exécutent à l'ouverture de la page.

### 1. Ouvrir Settings puis Setup checks

Ouvrez votre menu utilisateur en bas à gauche, choisissez **Settings**, puis **Setup checks**.

![Ouvrir le menu utilisateur en bas à gauche.](setup-checks-guide-user-menu.png)

![Choisir Settings.](setup-checks-guide-settings-menu.png)

![Choisir Setup checks dans Settings.](setup-checks-guide-setup-page.png)

### 2. Lire le résumé

Lisez le nombre d'échecs et d'avertissements. Si aucun n'existe, le résumé indique All checks passed.

![Lire le nombre d'échecs et d'avertissements.](setup-checks-guide-summary.png)

### 3. Lire d'abord les échecs

Lisez le détail du service et l'action conseillée. Cette installation de test signale un échec du stockage d'objets. Suivez les conseils correspondant à votre résultat.

![Lire le détail et l'action conseillée à côté d'un échec.](setup-checks-guide-failed-service.png)

### 4. Lire les avertissements

Un avertissement demande une vérification même si le service est disponible. L'exemple indique que Laboratory name utilise encore le nom fourni par défaut.

![Lire chaque avertissement avant de déclarer l'installation prête.](setup-checks-guide-warning.png)

### 5. Vérifier les éléments ignorés

**Skipped** signifie que la vérification ne s'appliquait pas. Cela ne prouve pas qu'une fonction inutilisée est configurée.

![Skipped indique une vérification non applicable, pas une configuration validée.](setup-checks-guide-skipped.png)

**Résultat attendu :** vous savez quelles vérifications demandent une intervention et quels conseils concernent cette installation.

## Suivre un avertissement et vérifier la correction

Utilisez la page liée pour corriger un problème. Cet exemple corrige le nom du laboratoire et le fuseau horaire manquant sur PostgreSQL.

### 1. Ouvrir la page liée

Sélectionnez **Open Laboratory** près de l'avertissement Laboratory name.

![Suivre le lien vers le paramètre à corriger.](setup-checks-guide-open-laboratory.png)

### 2. Saisir le nom du laboratoire

Saisissez le vrai nom du laboratoire émetteur. La capture utilise `Documentation laboratory` dans une installation de test.

![Saisir le vrai nom du laboratoire. L'exemple utilise un nom fictif.](setup-checks-guide-correct-name.png)

### 3. Définir le fuseau horaire si nécessaire

Sur PostgreSQL ou MySQL, saisissez le nom du fuseau local. L'exemple utilise `Africa/Dar_es_Salaam`. Sur SQL Server, suivez les conseils de la page et fournissez plutôt le fuseau Windows à chaque exécution de rapport.

![Utiliser un fuseau local nommé sur PostgreSQL ou MySQL.](setup-checks-guide-correct-zone.png)

### 4. Enregistrer la correction

Ouvrez le menu à points de Laboratory et choisissez **Save**.

![Ouvrir le menu à points de Laboratory.](setup-checks-guide-laboratory-actions.png)

![Choisir Save pour conserver les corrections.](setup-checks-guide-laboratory-save.png)

### 5. Revenir à Setup checks

Sélectionnez **Setup checks** dans Settings. L'ouverture relance les vérifications.

![Laboratory name et Time zone indiquent maintenant Passed.](setup-checks-guide-corrected-result.png)

**Résultat attendu :** les vérifications Laboratory name et Time zone corrigées indiquent Passed. Les autres avertissements et échecs restent à traiter.

## Relancer les vérifications

Utilisez cette action après une modification de configuration ou le rétablissement d'un service.

### 1. Ouvrir les actions de la page

Sélectionnez les points en haut à droite de Setup checks.

![Ouvrir le menu à points de Setup checks.](setup-checks-guide-setup-actions.png)

### 2. Choisir Run again

Sélectionnez **Run again**. Attendez la fin des vérifications.

![Choisir Run again après une correction.](setup-checks-guide-run-again.png)

**Résultat attendu :** le nouveau résumé montre le résultat actuel. Lisez les échecs et avertissements restants.

![Lire le nouveau résumé et traiter les échecs et avertissements restants.](setup-checks-guide-rerun-result.png)

## Charger les données d'exemple

Utilisez cette action pour essayer OpenLDR sur une nouvelle installation. Elle charge les mêmes données d'exemple que l'étape des données d'exemple du [Premier démarrage](/docs/first-run). Le menu ne la propose que tant que l'installation ne contient aucune donnée de laboratoire. Vous avez besoin de la permission Zone de danger. Administrator l'a.

### 1. Ouvrir les actions de la page

Sélectionnez les points en haut à droite de la page.

### 2. Choisir Charger les données d'exemple

Sélectionnez **Charger les données d'exemple**. Une fenêtre s'ouvre avec le titre **Données d'exemple** et une phrase sur leur contenu.

### 3. Confirmer

Sélectionnez **Charger les données d'exemple** dans la fenêtre. Pour sortir sans charger, sélectionnez **Annuler**. Pendant le chargement, la page affiche **Chargement des données d'exemple…**.

**Résultat attendu :** les vérifications se relancent. **Charger les données d'exemple** n'est plus dans le menu, car l'installation contient maintenant des données de laboratoire.

## Lire les vérifications sur un téléphone

Utilisez la même page sur téléphone. Chaque vérification présente son état et ses conseils.

### 1. Lire le résumé

Ouvrez Setup checks et lisez le résumé en haut.

![Lire le résumé en haut sur téléphone.](setup-checks-guide-phone-summary.png)

### 2. Parcourir les vérifications

Lisez le détail de chaque vérification et les liens ou actions proposés.

![Faire défiler les vérifications pour lire leurs détails et conseils.](setup-checks-guide-phone-check.png)

## Pratique facultative

Aucun exemple de données n'est nécessaire. Dans une installation de test, corrigez un véritable avertissement de nom ou de fuseau, enregistrez, puis relancez les vérifications. Ne provoquez pas de panne pour cet exercice.

## Limites

Le rapport décrit les vérifications au moment de leur exécution. All checks passed ne valide pas tous les rapports, flux ou tâches du personnel. Certaines corrections exigent une configuration serveur hors de Studio.

## Résolution de problèmes

**Les vérifications n'ont pas pu s'exécuter.** Vérifiez la connexion API et le journal serveur, puis choisissez Run again.

**Des services ont échoué.** Suivez les commandes de diagnostic conseillées et examinez le service nommé.

**Un avertissement indique que l'authentification est désactivée.** Désactivez le contournement d'authentification de développement dans la configuration serveur avant toute utilisation réelle.

**La connexion des utilisateurs avertit qu'aucun administrateur n'existe.** L'installation utilise la connexion propre à OpenLDR, et personne n'a terminé la configuration. `openldr doctor` affiche `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Jusque-là, Studio affiche sa page **Créer l'administrateur**, et non cette page. Voir [Connexion et mots de passe](/docs/sign-in).

**Une page liée est inaccessible.** Demandez à un administrateur ayant la permission de modifier ce paramètre.

**Charger les données d'exemple n'est pas dans le menu.** L'installation contient déjà des données de laboratoire, ou votre rôle n'a pas la permission Zone de danger. Un patient, une demande d'analyse, un échantillon, un résultat, une réponse de formulaire enregistrée, une organisation ou un site comptent comme données de laboratoire.

**Les données d'exemple n'ont pas pu être chargées :** suivi d'une raison. Le chargement ne s'est pas terminé. Une partie des données d'exemple peut déjà être en place, et le menu ne propose alors plus le chargement. Le journal du serveur indique la raison.

## Guides associés

Consultez [Laboratoire](/docs/laboratory) pour les informations du laboratoire émetteur, [Connecteurs](/docs/connectors) pour tester les connexions et [Commencer ici](/docs/start-here) pour l'installation et la ligne de commande. Consultez [Premier démarrage](/docs/first-run) pour les étapes qui suivent la création du premier administrateur.

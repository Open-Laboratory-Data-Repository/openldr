# Bien démarrer

OpenLDR Community Edition collecte les données de laboratoire de nombreuses sources, les convertit en FHIR R4 et les enregistre dans une base de données que votre organisation contrôle. Il fournit ensuite des tableaux de bord, des rapports et des vues de surveillance, avec un accent fort sur la résistance aux antimicrobiens (RAM). Il est conçu pour les réseaux nationaux et régionaux de laboratoires.

Ces pages couvrent l'installation, la configuration et le dépannage d'un serveur OpenLDR. Pour apprendre le studio lui-même, ouvrez **Documentation** dans le studio après la connexion.

## 1. Installer

Il vous faut un hôte avec Docker. Lisez d'abord [Prérequis](/docs/requirements).

L'installateur en une ligne génère tous les secrets, démarre la pile sur `https://localhost` avec un certificat auto-signé, puis affiche l'URL et les identifiants administrateur. Toutes les options sont sur la page [Installation](/docs/install).

Linux ou macOS :

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Se connecter

1. Ouvrez l'URL affichée par l'installateur.
2. Connectez-vous avec les identifiants administrateur affichés.
3. Ouvrez **Documentation** dans le menu du studio et lisez **Commencer ici**.

Pour arrêter la pile, lancez `docker compose down` dans le dossier `openldr/` créé par l'installateur. Pour la redémarrer, lancez `docker compose up -d` dans le même dossier.

## Configurer votre système

OpenLDR peut recevoir et traiter les données avant la configuration des établissements, du catalogue de tests ou des paramètres des patients. Ces tâches sont facultatives. Nous recommandons fortement de les réaliser au cours de l'utilisation du système.

- Les établissements associent des noms et des lieux cohérents aux codes.
- Le catalogue de tests rapproche les tests de différentes sources et fournit les choix du formulaire Lab order.
- Les paramètres des patients nomment les systèmes d'identifiants et facilitent la vérification des doublons possibles.

Ouvrez **Documentation** dans Studio et suivez **Configurer votre système**, en commençant par Terminologie. Les guides intégrés expliquent chaque tâche.

Le guide Facilities dans Studio explique la saisie manuelle, les imports, l'historique et les liens entre codes. Vous pouvez utiliser vos propres données. Les fichiers de pratique sont facultatifs.

## 3. Étapes suivantes

- [Charger et envoyer des données](/docs/load-data) : envoyez vos premières données de laboratoire dans OpenLDR.
- [Variables d'environnement](/docs/environment) : configurez un déploiement.
- [Fournisseurs d'authentification](/docs/auth-providers) : connexion avec Keycloak ou un autre fournisseur OpenID Connect.
- [Mises à niveau planifiées](/docs/upgrading) : passez à une nouvelle version sans risque.
- [Interface en ligne de commande (CLI)](/docs/cli) : utilisez OpenLDR depuis un terminal, sur un serveur sans navigateur.
- [Développement](/docs/development) : lancez OpenLDR depuis le code source.

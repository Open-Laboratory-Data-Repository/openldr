# Prérequis

OpenLDR est livré sous forme d'images de conteneurs **Linux**. Il fonctionne partout où Docker est disponible avec le plugin Compose.

## Logiciels

- **Docker** 24+ avec le plugin Compose (`docker compose`).
- **OpenSSL** (pour le certificat auto-signé que génère l'installateur). Présent par défaut sous Linux et macOS.
- **curl** (Linux/macOS) ou PowerShell 5+ (Windows) pour lancer l'installateur en une ligne.

## Matériel

- **4 Go de RAM** libres (8 Go recommandés une fois la terminologie et les tableaux de bord chargés).
- **~5 Go de disque** pour les images et les volumes. Prévoyez **20 Go ou plus** pour un laboratoire en service, avec la terminologie, les fichiers envoyés et les données analytiques.
- 2 cœurs CPU au minimum.

## Plateformes

- **Linux** : la cible principale. Toute distribution récente avec Docker Engine.
- **macOS** : avec Docker Desktop.
- **Windows** : Windows 10/11 avec Docker Desktop, ou **Windows Server avec WSL2**.

> **Windows Server :** Docker Desktop n'est **pas** pris en charge sur Windows Server, et le moteur Docker natif n'exécute que des conteneurs Windows. La voie prise en charge est **Docker CE dans une distribution Ubuntu WSL2**. Elle exige Windows Server **2022 (avec tous les correctifs)** ou **2025**. Server 2019 ne peut pas exécuter la pile WSL2 récente. Voir [Windows Server (WSL2)](/docs/windows-server) pour la procédure complète.

## Réseau

- Un **nom de domaine** public qui pointe vers l'hôte, et les ports entrants **TCP 80 et 443** ouverts, si vous voulez un certificat de confiance (Let's Encrypt). Sans eux, l'installateur se rabat sur un certificat auto-signé. Cela convient pour une installation locale ou de laboratoire.

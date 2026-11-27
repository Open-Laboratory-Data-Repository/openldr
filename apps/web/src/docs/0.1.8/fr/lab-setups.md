# Choisir une installation pour le laboratoire

Une règle couvre tous les laboratoires. Chaque site a une seule installation complète d'OpenLDR, et chaque autre PC du site est un écran sur cette installation. L'installation contient les données et les utilisateurs. Les autres PC ne contiennent rien.

Cette page décrit quatre installations. Choisissez celle qui correspond à votre site, puis suivez les liens pour les étapes.

## Petit site avec une liaison faible

Un site qui analyse ses propres échantillons et dont la liaison internet est mauvaise. Il peut envoyer certains échantillons à un laboratoire plus grand.

- **Quoi installer.** L'[application de bureau](/docs/desktop-app) sur un PC, réglée sur **Ce PC contient les données du laboratoire**.
- **Où créer les utilisateurs.** Sur ce PC. Le site a ses propres utilisateurs.
- **Quand internet est coupé.** Le travail continue. Les données sont sur le PC, donc rien sur le site n'a besoin de la liaison. Les enregistrements destinés à l'OpenLDR national attendent le retour de la liaison.

Donnez à ce site sa propre installation, même si un laboratoire plus grand est proche. Un écran sur l'OpenLDR d'un autre site s'arrête à chaque coupure de la liaison.

## Laboratoire avec deux PC

Un PC contient les données et le second les affiche.

- **Quoi installer sur le PC 1.** L'application de bureau, réglée sur **Ce PC contient les données du laboratoire**, avec **Partager sur le réseau du laboratoire** coché dans son menu de la zone de notification.
- **Quoi installer sur le PC 2.** L'application de bureau, réglée sur **Se connecter au serveur du laboratoire**, avec l'adresse du PC 1. Un navigateur sur le PC 2 convient aussi.
- **Où créer les utilisateurs.** Une fois, sur le PC 1. Le PC 2 se connecte aux mêmes utilisateurs.
- **Quand le réseau est coupé.** Le PC 1 fonctionne comme avant. Le PC 2 affiche **Impossible de joindre le serveur** et revient de lui-même quand il peut joindre le PC 1.

Le PC 1 doit être allumé, avec OpenLDR en marche, chaque fois que le PC 2 est utilisé. Sauvegardez seulement le PC 1. Le PC 2 ne contient aucune donnée.

## Laboratoire plus grand avec plusieurs PC

Un laboratoire avec une réception et plusieurs paillasses. D'autres sites peuvent lui envoyer des échantillons.

- **Quoi installer sur le serveur.** L'édition serveur, avec Docker. Voir [Installation](/docs/install). Elle a HTTPS et elle est faite pour être exposée à un réseau.
- **Quoi installer sur chaque autre PC.** L'application de bureau, réglée sur **Se connecter au serveur du laboratoire**, ou un navigateur.
- **Où créer les utilisateurs.** Sur le serveur. C'est un seul site avec un seul ensemble d'utilisateurs.
- **Quand le réseau est coupé.** Un PC qui ne peut pas joindre le serveur affiche **Impossible de joindre le serveur**. Le serveur garde ses données. Branchez le serveur sur une alimentation qui tient pendant les courtes coupures.

## PC à côté d'un automate

Un PC placé près d'un instrument, qui transmet ses résultats.

- **Quoi installer.** Ni serveur OpenLDR ni base de données. Le PC exécute le programme qui lit l'instrument. Ce programme vient avec le plugin de l'instrument, et il pointe vers l'OpenLDR du site.
- **Où créer les utilisateurs.** Nulle part sur ce PC. Le programme se connecte à l'OpenLDR du site avec un seul compte. Le guide du plugin indique quel compte utiliser.
- **Quand le réseau est coupé.** Le guide du plugin indique ce que le programme garde et ce qu'il envoie plus tard.

Pour que des personnes utilisent aussi Studio sur ce PC, ajoutez l'application de bureau réglée sur **Se connecter au serveur du laboratoire**.

## Comment choisir

| Votre site | Installation |
| --- | --- |
| Un seul PC, ou une liaison souvent coupée | Petit site avec une liaison faible |
| Deux ou trois PC dans une pièce | Laboratoire avec deux PC |
| Une réception, plusieurs paillasses, ou des échantillons d'autres sites | Laboratoire plus grand avec plusieurs PC |

## Ce qui ne change pas

- Chaque site garde ses propres utilisateurs. La connexion n'a pas besoin de l'OpenLDR national.
- Seul le PC qui contient les données a besoin d'une sauvegarde.
- Un PC connecté à un serveur affiche la version de Studio du serveur. Mettez le serveur à jour, et chaque écran suit.
- Le partage est fait pour le réseau du laboratoire. N'ouvrez jamais à internet une application de bureau partagée.

## Limites

- L'envoi d'un échantillon de l'OpenLDR d'un site à celui d'un autre n'est pas dans cette version.
- Un PC en mode connexion installe le même paquet qu'un PC qui contient les données, environ 500 à 600 Mo. Un paquet plus petit viendra plus tard.
- Ces installations ont été essayées avec les deux côtés sur un seul ordinateur. Un essai sur deux vrais PC reste à faire.

## Guides associés

- [Application de bureau](/docs/desktop-app)
- [Exécuter sans Docker](/docs/standalone)
- [Installation](/docs/install)
- [Prérequis](/docs/requirements)

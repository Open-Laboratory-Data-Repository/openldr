# Synchronisation distribuée

Distributed sync relie une installation de laboratoire à une installation centrale OpenLDR. Le laboratoire envoie ses dossiers cliniques. Le central fournit la configuration et la terminologie partagées que le laboratoire lit.

Vous avez besoin de **View sync** pour lire les états et événements. **Manage sync** permet la configuration, la gestion des sites et les décisions sur les divergences. Le central inscrit les laboratoires dans Settings, Sites. Le laboratoire configure sa liaison dans Settings, Distributed sync.

Pour une liaison réelle, obtenez l'identifiant du site, l'URL centrale, l'émetteur OIDC, l'identifiant client et le secret à usage unique lors de l'inscription centrale. Celle-ci exige l'administration des clients Keycloak. Gardez ces valeurs privées et utilisez HTTPS.

Les images montrent les véritables paramètres et un central local délibérément indisponible. Les exemples vérifient la configuration et l'inspection des échecs. Ils ne montrent pas de transfert réussi et n'inventent pas d'identifiants d'inscription. Aucun fichier d'exemple n'est requis.

## Vérifier la disponibilité de l'inscription centrale

L'administrateur central doit inscrire le laboratoire avant que son opérateur configure une liaison réelle.

### 1. Ouvrir Sites sur le central

Ouvrez **Settings**, puis **Sites**.

![Le central gère les laboratoires inscrits dans Settings, Sites.](sync-guide-sites.png)

### 2. Vérifier l'administration du fournisseur

L'inscription exige l'administration des clients Keycloak. Cette installation isolée indique qu'elle est indisponible et ne peut donc pas émettre de véritable secret client. Configurez le service d'identité central avant une mise en service réelle.

![Cette installation isolée ne dispose pas de l'administration des clients du fournisseur. L'inscription est indisponible.](sync-guide-admin-unavailable.png)

**Résultat attendu :** un central configuré propose Enroll site. L'exemple s'arrête avant l'inscription car l'administration des clients est indisponible.

## Saisir les valeurs d'inscription au laboratoire

Utilisez les valeurs fournies par l'administrateur central. Les valeurs des captures désignent seulement un service de test local inexistant.

### 1. Ouvrir Distributed sync

Au laboratoire, ouvrez **Settings**, puis **Distributed sync**.

![Le laboratoire configure sa liaison dans Settings, Distributed sync.](sync-guide-open.png)

### 2. Choisir Settings

Restez sur l'onglet **Settings**.

![Restez sur Settings pour configurer le laboratoire.](sync-guide-settings.png)

### 3. Vérifier Enable sync

Gardez **Enable sync** désactivé pendant la saisie. Activez-le lorsque les valeurs sont prêtes. Désactivé, il laisse les deux traitements en attente.

![Enable sync contrôle l'exécution des traitements d'envoi et de réception.](sync-guide-enabled.png)

### 4. Choisir Direction

Utilisez Push to central pour les seules données du laboratoire, Pull from central pour la seule configuration partagée, ou **Bidirectional** pour les deux.

![Choisissez Push to central, Pull from central ou Bidirectional.](sync-guide-direction.png)

### 5. Saisir Central URL

Utilisez l'adresse publique HTTPS fournie à l'inscription. L'image utilise une adresse locale HTTP absente et ne représente pas une configuration de production.

![Utilisez l'adresse centrale accessible fournie à l'inscription. Cette image utilise une adresse de test locale absente.](sync-guide-central.png)

### 6. Saisir Site ID

Utilisez l'identifiant stable attribué par le central. N'inventez pas un autre identifiant pour un client inscrit.

![Utilisez l'identifiant exact du site inscrit.](sync-guide-site.png)

## Saisir les identifiants du site et enregistrer

Continuez dans l'onglet Sync Settings. Utilisez les identifiants fournis pour ce laboratoire par le central. Laissez un secret existant vide uniquement pour le conserver.

### 1. Saisir l'émetteur et l'identifiant client

Copiez exactement **OIDC issuer URL** et **Client ID** depuis l'inscription centrale.

![Utilisez l'émetteur OIDC et l'identifiant client fournis par le central.](sync-guide-issuer.png)

### 2. Saisir le secret à usage unique

Remplissez **Client secret**. Le champ est masqué et accessible uniquement en écriture. La capture contient une valeur fictive qui ne peut pas authentifier.

![Saisissez le secret à usage unique. Il reste masqué. Cette valeur fictive est inutilisable.](sync-guide-secret.png)

### 3. Définir l'intervalle

Choisissez **Sync interval (minutes)** entre 1 et 1440. La valeur par défaut est 15.

![Choisissez un intervalle de synchronisation entre 1 et 1440 minutes.](sync-guide-interval.png)

### 4. Ouvrir les actions de l'onglet

Activez Enable sync quand tout est prêt, puis ouvrez les points de la barre d'onglets.

![Les points de la barre d'onglets contiennent Save.](sync-guide-actions.png)

### 5. Enregistrer la configuration

Sélectionnez **Save**. Les modifications démarrent, arrêtent ou reconfigurent immédiatement les traitements, sans redémarrer l'API.

![Save applique la configuration sans redémarrer l'API.](sync-guide-save.png)

**Résultat attendu :** une liaison valide peut s'authentifier et transférer les données. Une notification d'enregistrement prouve l'acceptation des paramètres, pas l'accès au central.

## Lire l'activité réelle de synchronisation

Utilisez Activity pour établir si la liaison enregistrée fonctionne réellement.

### 1. Ouvrir Activity

Sélectionnez l'onglet **Activity**. Lisez les états d'envoi et de réception, Pending push, Last checked et Last success.

![Activity montre l'état actuel des traitements et les événements.](sync-guide-activity.png)

### 2. Demander un cycle

Ouvrez les points de l'onglet et choisissez **Sync now** pour demander un cycle immédiat. Aucun cycle ne démarre si la synchronisation est désactivée.

![Sync now demande un cycle immédiat.](sync-guide-now.png)

### 3. Lire la ligne d'événement

Lisez l'événement, la direction, le nombre d'enregistrements et le détail. Cet exemple enregistre un véritable échec car son central local n'existe pas.

![Le central local absent produit un véritable événement d'échec, pas une liaison réussie.](sync-guide-failed-row.png)

### 4. Ouvrir l'événement

Sélectionnez sa ligne pour ouvrir le panneau **Sync event**.

![Ouvrez un événement pour lire son erreur complète et ses métadonnées.](sync-guide-detail.png)

### 5. Lire l'erreur complète

Lisez l'erreur et les métadonnées. Corrigez le problème précis de connexion, d'identité ou de données avant de réessayer.

![Lisez l'échec réseau réel avant de modifier les paramètres.](sync-guide-error.png)

**Résultat attendu :** une liaison réussie affiche des événements réussis, des curseurs qui avancent et une file en attente qui diminue. L'exemple prouve uniquement la visibilité des échecs.

## Arrêter la synchronisation et modifier sans risque

Utilisez l'interrupteur général pour suspendre les deux traitements sans supprimer les valeurs de connexion enregistrées.

### 1. Enregistrer avec Enable sync désactivé

Fermez l'événement, revenez dans Settings, désactivez Enable sync, puis ouvrez les points et choisissez Save.

![Enregistrer avec Enable sync désactivé arrête les deux traitements.](sync-guide-disable-save.png)

### 2. Conserver le secret enregistré pendant les modifications

Rouvrez ou rechargez Settings. Le secret reste vide avec l'indication qu'un secret est enregistré. Laissez-le vide pour le conserver en modifiant les autres champs.

![Un secret enregistré reste vide pendant les modifications des autres champs.](sync-guide-secret-kept.png)

**Résultat attendu :** les deux traitements s'arrêtent. La liaison de test fictive reste désactivée après la démonstration.

## Utiliser les paramètres de synchronisation sur téléphone

Le formulaire défile verticalement à la largeur d'un téléphone. Les tables d'événements larges défilent dans leur propre zone.

### 1. Lire les champs de connexion

Ouvrez Distributed sync, Settings et faites défiler jusqu'au champ voulu.

![Les champs de paramètres s'empilent à la largeur d'un téléphone.](sync-guide-phone-settings.png)

### 2. Consulter Activity

Utilisez Activity pour l'état actuel et les événements. Ouvrez une ligne pour lire tous ses détails.

![Activity reste disponible sur téléphone.](sync-guide-phone-activity.png)

## Valeurs fournies par l'inscription centrale

Sur un central disposant de l'administration des clients Keycloak, ouvrez Sites, ses points, puis Enroll site. Fournissez un Site ID stable en minuscules, un Name facultatif et la Central URL publique. L'inscription crée un client nommé sync-<siteId> et son association de jeton site_id.

Le résultat affiche l'identifiant client, le secret client, l'émetteur OIDC et l'URL centrale. Copiez le secret en privé avant de fermer. Il n'apparaît qu'une fois. Un secret perdu exige Rotate secret sur la ligne du site et une mise à jour au laboratoire. Revoke supprime le client et marque le site révoqué.

Le compte de service central doit avoir manage-clients et view-clients dans le realm Keycloak. Ces opérations n'ont pas été testées dans l'installation isolée. Son administration des identités est volontairement désactivée.

## Faire confiance au TLS central sur le serveur du laboratoire

Accepter un certificat autosigné dans le navigateur ne le rend pas fiable pour le serveur du laboratoire. Téléchargez le certificat public central depuis les points de Sites ou le résultat d'inscription, puis transférez-le au laboratoire par votre canal d'administration habituel.

Montez-le en lecture seule dans le conteneur API du laboratoire et définissez NODE_EXTRA_CA_CERTS avec ce chemin interne. Recréez l'API après modification de son environnement. Le certificat doit correspondre au nom d'hôte ou à l'IP centrale, y compris son Subject Alternative Name. Gardez la validation normale des certificats.

Utilisez une adresse centrale HTTPS fiable en production. Une adresse HTTP localhost sert uniquement aux tests isolés comme l'exemple illustré. Aucun téléchargement de certificat ni changement de confiance TLS n'a été testé ici.

## Utiliser la CLI

Suivez [Commencer ici](/docs/start-here) pour configurer la CLI. Depuis `openldr_ce`, le central utilise sync enroll, list, rotate et revoke. Ces identifiants sont de véritables secrets. N'affichez pas leurs sorties dans des journaux partagés ou des captures.

Au laboratoire, settings sync show masque le secret enregistré. Définissez un champ à la fois avec settings sync set. Sync status et sync now inspectent ou demandent un traitement réel.

```shell
pnpm openldr settings sync show
pnpm openldr sync status
pnpm openldr sync now
pnpm openldr settings sync set enabled false
```

## Dépannage

**L'inscription est indisponible.** Vérifiez les capacités d'administration Keycloak du central et les rôles de son compte de service. OIDC générique ne crée pas de clients de synchronisation.

**L'authentification échoue.** Faites correspondre l'identifiant du site, l'émetteur, l'identifiant client et le secret actuel à l'inscription centrale. Renouvelez un secret perdu, puis mettez à jour le laboratoire.

**Erreur de certificat.** Vérifiez la confiance sur le serveur API du laboratoire et la correspondance des adresses du certificat. L'exception du navigateur ne configure pas le serveur.

**Activity contient des événements failed, quarantined ou diverged.** Ouvrez l'événement et lisez sa raison complète. Tous les échecs ne sont pas des problèmes réseau. Résolvez la condition signalée avant de répéter les modifications.

**Pending push reste élevé.** Lisez Last success et les échecs récents. Sync now demande un cycle sans prouver sa réussite.

## Guides associés

[Fournisseurs d'authentification](/docs/auth-providers), [Variables d'environnement](/docs/environment) et [Paramètres](/docs/settings).

# Synchronisation distribuée

La **synchronisation distribuée** relie plusieurs laboratoires à un serveur OpenLDR **central**, sur des liaisons lentes ou intermittentes. Chaque laboratoire fait tourner une installation OpenLDR CE complète, travaille hors ligne et se met à jour dès qu'une connexion est là.

- **Vers le haut, du laboratoire au central.** Les données que possède le laboratoire : patients, demandes, résultats, prélèvements et comptes rendus. Le central en garde une copie en lecture seule qu'il ne modifie jamais. Le laboratoire reste la source de vérité.
- **Vers le bas, du central au laboratoire.** La configuration que possède le central : formulaires, tableaux de bord, définitions de rapports et paramètres autorisés, plus la terminologie (systèmes de codes et correspondances). Les laboratoires les utilisent en lecture seule.
- **Marquage du site.** Chaque enregistrement porte le `site_id` du laboratoire qui l'a créé. Le central classe et dédoublonne par ce champ, donc deux laboratoires ne se télescopent jamais, même avec les mêmes identifiants locaux.

Comptez 30 minutes, avec deux installations : un central et un laboratoire. Les images viennent d'une seule installation, synchronisation désactivée : elles montrent les pages, pas une liaison réelle. Sélectionnez une image ou un clip pour l'agrandir.

![La page Synchronisation distribuée d'un laboratoire, sur l'onglet Paramètres.](sync-settings-tab.png)

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **View sync** | Voir l'état de la synchronisation et l'onglet Activité |
| **Manage sync** | Configurer la synchronisation, inscrire et gérer les sites, résoudre les divergences |

Les deux pages sont dans **Paramètres** : **Sites** sur le central, **Synchronisation distribuée** sur un laboratoire.

## Avant de commencer

- Le **central** inscrit les laboratoires et garde la copie. Les **laboratoires** se connectent au central et envoient leurs propres données.
- L'inscription crée des clients Keycloak, donc le realm Keycloak du central doit donner au compte de service d'administration les rôles `manage-clients` et `view-clients`. L'export de realm livré avec OpenLDR les contient. Un conteneur Keycloak démarré pour la première fois **avant** l'arrivée de la synchronisation doit réimporter son realm, ou recevoir ces deux rôles à la main. Sinon, la création du client échoue.
- Utilisez HTTPS pour l'URL du central en production. Le secret client circule une fois à l'inscription, et les jetons du laboratoire à chaque synchronisation.
- Le laboratoire joint le central **de serveur à serveur, en HTTPS**. Si le central a un certificat autosigné, ce qui est le cas par défaut de l'installeur, le laboratoire doit recevoir le certificat public du central. Passer l'avertissement dans un navigateur ne suffit **pas** : le serveur du laboratoire vérifie le certificat lui-même. Voir l'[Exemple 2](#exemple-2-faire-confiance-au-certificat-du-central-sur-le-laboratoire).

## Exemple 1 : inscrire un laboratoire sur le central

L'inscription crée un client Keycloak confidentiel, `sync-<siteId>`, avec un mappeur de jeton `site_id`. Elle génère le secret du client et ajoute une ligne à la liste des sites. Le secret n'est affiché **qu'une fois** et ne peut plus jamais être relu. S'il est perdu, renouvelez-le.

![La page Sites du central et son menu : Inscrire un site, Télécharger le certificat central, Actualiser.](sync-sites-menu.mp4)

1. Sur le central, ouvrez **Paramètres**, puis **Sites**.
2. Ouvrez le menu **⋯** de la page et sélectionnez **Inscrire un site**. Remplissez :

   | Champ | Notes |
   | --- | --- |
   | Site ID | Un identifiant stable du laboratoire, par exemple `lab-site-01`. Minuscules, chiffres et tirets, 1 à 63 caractères, sans tiret au début. C'est aussi l'id du client Keycloak et la clé de la liste des sites. |
   | Name | Un libellé lisible, facultatif. |
   | Central URL | L'adresse publique par laquelle le laboratoire joindra le central, par exemple `https://central.example.org`. Obligatoire. |

   ![La fenêtre Inscrire un site, avec Site ID, Name et Central URL.](sync-enroll-site.png)

3. Sélectionnez **Inscrire**. Une fenêtre unique montre ce dont le laboratoire a besoin : **client id**, **client secret**, **OIDC issuer** et **central URL**. Copiez chacun avec son bouton et transmettez-les au laboratoire avant de fermer. Le secret ne sera plus affiché. La même fenêtre propose **Télécharger le certificat central**, pour prendre le certificat dans la même étape.

**Résultat attendu :** le site est listé avec un badge **active**. Le menu de sa ligne propose **Renouveler le secret**, qui émet un nouveau secret, et **Révoquer**, qui supprime le client et marque la ligne révoquée.

### Télécharger le certificat du central

Si le laboratoire doit faire confiance à un central autosigné, donnez-lui le certificat public du central. Sélectionnez **Télécharger le certificat central** dans le menu **⋯** de la page Sites, ou dans la fenêtre d'inscription, pour enregistrer `central-certificate.pem`. Il vient de `GET /api/settings/sync/central-certificate`, réservé aux administrateurs. C'est le certificat TLS public du central, pas un secret. Il faut que `TLS_CERT_PATH` pointe vers le certificat du central. L'installeur le règle et monte le certificat pour vous.

### En ligne de commande, sur le central

```bash
openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org
openldr sync list
openldr sync rotate lab-site-01
openldr sync revoke lab-site-01
```

`sync enroll` affiche une fois le client id, le client secret, le site id, l'URL du central et l'émetteur OIDC, avec un avertissement : le secret ne sera plus affiché. `--central-url` est obligatoire. `sync list` montre les sites inscrits et leur état, jamais de secret. `sync rotate` affiche une fois un nouveau secret. `sync revoke` supprime le client et marque la ligne révoquée, et peut être relancé sans risque. Ajoutez `--json` à chacune pour une sortie lisible par machine.

## Exemple 2 : faire confiance au certificat du central sur le laboratoire

Passez cette étape si le central a un certificat auquel le laboratoire fait déjà confiance, par exemple Let's Encrypt pour un vrai domaine. Elle est nécessaire quand le central utilise un certificat **autosigné** : le cas par défaut de l'installeur, et le cas habituel d'un central sur un réseau local ou une adresse IP.

**Pourquoi.** Le processus de synchronisation du laboratoire ouvre une connexion HTTPS vers le central pour obtenir un jeton et envoyer ou recevoir des données. Node.js, qui fait tourner le serveur du laboratoire, vérifie le certificat du central avec son propre magasin de confiance et refuse ce qu'il ne connaît pas, quoi qu'en dise le navigateur. La synchronisation échoue donc tant que le laboratoire ne fait pas confiance au certificat.

1. Copiez `central-certificate.pem` sur le laboratoire, par exemple dans `config/nginx/certs/central/fullchain.pem` à côté du fichier compose.
2. Montez-le en lecture seule dans le conteneur `api` du laboratoire, et réglez `NODE_EXTRA_CA_CERTS` sur son chemin dans le conteneur. Dans le `docker-compose.yml` du laboratoire, sous le service `api` :

   ```yaml
   volumes:
     - ./config/nginx/certs/central/fullchain.pem:/etc/ssl/central-ca.pem:ro
   ```

   et dans le `.env` du laboratoire :

   ```bash
   NODE_EXTRA_CA_CERTS=/etc/ssl/central-ca.pem
   ```

3. Recréez l'API du laboratoire : `docker compose up -d api`.

**Le certificat doit correspondre à l'adresse du central.** TLS vérifie aussi que le certificat a été émis pour l'adresse que joint le laboratoire. Si le laboratoire joint le central par une adresse IP, comme `https://10.0.0.5`, le certificat du central doit porter cette IP comme **IP Subject Alternative Name**. Un certificat qui ne la liste que comme nom DNS est refusé avec `ERR_TLS_CERT_ALTNAME_INVALID`. Créez au besoin un certificat avec une IP SAN :

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout config/nginx/certs/privkey.pem -out config/nginx/certs/fullchain.pem \
  -subj "/CN=10.0.0.5" -addext "subjectAltName=IP:10.0.0.5,DNS:localhost,IP:127.0.0.1"
```

Redémarrez ensuite la passerelle du central avec `docker compose restart gateway`, téléchargez de nouveau le certificat, et refaites les étapes ci-dessus sur le laboratoire.

## Exemple 3 : connecter le laboratoire au central

L'opérateur du laboratoire prend les cinq valeurs de l'inscription (client id, client secret, site id, URL du central et émetteur OIDC) et les saisit sur la page **Synchronisation distribuée** du laboratoire.

1. Sur le laboratoire, ouvrez **Paramètres**, puis **Synchronisation distribuée**. Elle a deux onglets : **Paramètres**, la configuration, et **Activité**, l'état en direct et les événements récents. Restez sur **Paramètres**.
2. Remplissez les champs :

   | Champ | Notes |
   | --- | --- |
   | Activer la synchronisation | L'interrupteur principal. Désactivé, les deux processus restent en sommeil. |
   | Sens | **Envoyer vers le central** envoie seulement les données du laboratoire. **Récupérer depuis le central** reçoit seulement la configuration et la terminologie. **Bidirectionnelle** fait les deux. |
   | URL du central | L'adresse du central donnée à l'inscription, par exemple `https://central.example.org`. |
   | Identifiant du site | Le site id de ce laboratoire, par exemple `lab-site-01`. |
   | URL de l'émetteur OIDC | L'émetteur du realm donné à l'inscription, par exemple `https://central.example.org/auth/realms/openldr`. |
   | Identifiant client | Le client créé, `sync-<siteId>`. |
   | Secret client | Le secret unique de l'inscription. En écriture seule et masqué. Laissez-le vide quand vous modifiez d'autres champs, pour garder la valeur enregistrée. |
   | Intervalle de synchronisation (minutes) | La fréquence, de 1 à 1440. 15 par défaut. |

3. Sélectionnez **Enregistrer**. Avec la synchronisation activée, l'URL du central, le site id, l'émetteur OIDC et l'identifiant client sont obligatoires. L'enregistrement prend effet tout de suite : activer ou désactiver, changer de sens ou modifier un champ démarre, arrête ou reconfigure les processus en direct, **sans redémarrage**.

### Suivre la synchronisation

![Ouvrir l'onglet Activité.](sync-activity.mp4)

Ouvrez l'onglet **Activité**. Une bande d'état, rafraîchie toutes les quelques secondes, montre :

- Un badge **on** ou **off** pour l'ensemble.
- Une ligne d'envoi et une ligne de réception, chacune `running` ou `idle`, avec la dernière séquence et l'heure de la dernière synchronisation. Un sens que le mode exclut affiche **non démarré**.
- **Envois en attente** : le nombre de changements locaux qui attendent de monter.
- **Dernière vérification** et **Dernier succès**.

En dessous, le tableau **Activité récente** liste chaque événement, le plus récent d'abord : sens, événement (`synced`, `failed`, `quarantined` ou `diverged`), nombre d'enregistrements, détail et heure. Sélectionnez une ligne pour l'erreur et les métadonnées complètes. **Synchroniser maintenant** lance un passage tout de suite au lieu d'attendre l'intervalle. Il indique si un passage a démarré, et ne fait rien tant que la synchronisation est désactivée.

![L'onglet Activité sur une installation sans synchronisation : non démarré, 0 envoi en attente, jamais vérifié, aucune activité.](sync-activity-tab.png)

**Résultat attendu** avec une liaison réelle : le central liste le laboratoire **active** dans Sites. Sur le laboratoire, **Activité** montre l'ensemble actif, avec les lignes d'envoi et de réception qui avancent et **Envois en attente** qui baisse vers zéro. La copie du central reçoit les enregistrements du laboratoire, marqués de son site id. Le laboratoire reçoit les formulaires, tableaux de bord, rapports et la terminologie du central.

### En ligne de commande, sur le laboratoire

```bash
openldr settings sync show
openldr settings sync set mode bidirectional
openldr sync status
openldr sync now
```

`settings sync set <field> <value>` écrit un champ : `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret` ou `intervalMinutes`. `sync status` affiche les processus en direct, les curseurs et l'arriéré. `sync now` lance un passage, et échoue si la synchronisation est désactivée.

## Sur un téléphone

Les deux pages fonctionnent sur un téléphone. Le tableau d'activité défile sur le côté pour atteindre le détail de chaque événement.

## Dépannage

- **La synchronisation reste éteinte, ou rien ne se passe.** Vérifiez que la synchronisation est activée et que le sens est le bon. Vérifiez l'URL du central, le site id, l'émetteur OIDC et l'identifiant client. Un secret laissé vide garde l'ancienne valeur, donc un mauvais secret demande un nouveau collage.
- **`503` « identity provider admin client is not configured » à l'inscription, sur le central.** L'API n'a pas d'identifiants du compte de service d'administration Keycloak. Réglez `KEYCLOAK_ADMIN_CLIENT_ID` et `KEYCLOAK_ADMIN_CLIENT_SECRET` dans le `.env` du central et recréez l'API. Le journal d'audit reste vide, car l'inscription écrit son entrée seulement après la création du client.
- **`403` à l'inscription, sur le central.** Le compte de service d'administration n'a pas `manage-clients` et `view-clients`. Réimportez le realm du central, ou ajoutez ces deux rôles à la main, puis réessayez.
- **L'inscription échoue avec `fetch failed: connect ECONNREFUSED 127.0.0.1:443`, sur le central.** L'API tente de joindre Keycloak par l'adresse publique, qui dans le conteneur est l'API elle-même. Réglez `OIDC_INTERNAL_ISSUER_URL` sur le realm interne, par exemple `http://keycloak:8080/auth/realms/openldr`, pour que les appels serveur passent par l'adresse interne. Recréez l'API.
- **La synchronisation du laboratoire échoue avec `self-signed certificate`.** Le laboratoire ne fait pas confiance au certificat du central. Voir l'[Exemple 2](#exemple-2-faire-confiance-au-certificat-du-central-sur-le-laboratoire).
- **La synchronisation échoue avec `ERR_TLS_CERT_ALTNAME_INVALID`.** Le certificat est accepté mais ne liste pas l'adresse que joint le laboratoire. Créez le certificat du central avec une IP Subject Alternative Name pour cette adresse, téléchargez-le de nouveau et réinstallez-le sur le laboratoire.
- **Secret client perdu.** Il est irrécupérable, par conception. Utilisez **Renouveler le secret** sur le site, depuis le menu de sa ligne dans Sites ou avec `openldr sync rotate <siteId>`, et collez le nouveau secret dans l'onglet Paramètres du laboratoire.
- **Jetons du laboratoire refusés par le central.** Le site a été révoqué, ou l'identifiant client ou l'émetteur OIDC du laboratoire ne correspond pas à ce que le central a créé. Vérifiez que le site est actif avec `openldr sync list`, et que l'émetteur pointe vers le realm du central.
- **Un laboratoire révoqué doit revenir.** Inscrivez de nouveau le même site id sur le central. La ligne se réactive et un nouveau secret est émis.

## Guides associés

- [Paramètres](/docs/settings)
- [Utilisateurs et rôles](/docs/users)
- [Variables d'environnement](/docs/environment)

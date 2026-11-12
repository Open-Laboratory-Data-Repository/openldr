# Fournisseurs d'authentification

OpenLDR peut connecter les personnes de trois façons : avec ses propres comptes, par Keycloak, ou par un fournisseur OpenID Connect générique, ou OIDC. `AUTH_ADAPTER` choisit l'une d'elles. S'il n'est pas défini, il vaut `keycloak`. Le mode générique exige la découverte OIDC et des jetons d'accès JWT signés. Les jetons opaques ne sont pas acceptés. Ce guide ne certifie pas la configuration d'un second fournisseur.

## Choisir un mode de connexion

| Mode | Où vivent les comptes et les mots de passe | Choisissez-le quand |
| --- | --- | --- |
| `AUTH_ADAPTER=local` | Dans la base de données d'OpenLDR. Aucun autre service ne tourne. | Un laboratoire gère sa propre installation et n'a besoin que de noms d'utilisateur et de mots de passe. C'est le choix le plus simple, et celui qui consomme le moins de mémoire. |
| `AUTH_ADAPTER=keycloak` | Dans Keycloak, un service séparé qui tourne à côté d'OpenLDR. | L'installation est un central de synchronisation, ou elle utilise déjà Keycloak. L'enrôlement des sites de synchronisation exige l'administration Keycloak. |
| `AUTH_ADAPTER=oidc` | Chez un fournisseur que vous avez déjà, comme une connexion nationale. | Les personnes doivent utiliser une connexion existante. OpenLDR ne peut ni créer ces comptes ni réinitialiser leurs mots de passe. |

Choisissez avant le premier démarrage. La base de données retient le mode de connexion de son premier démarrage, et refuse de démarrer sous un autre. Il n'existe aucun moyen de passer les comptes d'une installation existante de Keycloak ou d'OIDC à la connexion locale.

## Choisir l'authentification et l'administration

| Configuration | Connexion | Administration du fournisseur | Création des clients de synchronisation |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=local`, administration absente ou `local` | Comptes propres à OpenLDR | Disponible dans Studio et la CLI | Indisponible |
| `AUTH_ADAPTER=keycloak`, administration absente ou `keycloak` | Métadonnées Keycloak | Avec les identifiants administratifs | Keycloak uniquement |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Métadonnées Keycloak | Indisponible | Indisponible |
| `AUTH_ADAPTER=oidc`, administration absente ou `none` | Découverte OIDC | Indisponible | Indisponible |

Par défaut, `IDENTITY_ADMIN_ADAPTER` vaut `keycloak` pour Keycloak, `local` pour la connexion locale et `none` pour OIDC générique. L'association OIDC générique et administration Keycloak est refusée. La connexion locale n'accepte que `local` ou aucune valeur.

## Mettre en place la connexion locale

Utilisez une base de données neuve. Définissez ceci dans `.env` :

```dotenv
AUTH_ADAPTER=local
SECRETS_ENCRYPTION_KEY=YOUR_KEY
```

`SECRETS_ENCRYPTION_KEY` est obligatoire. Le serveur scelle sa clé de signature des jetons avec elle, et refuse de démarrer en connexion locale sans elle. `OIDC_ISSUER_URL` et les réglages Keycloak ne servent pas. Laissez `IDENTITY_ADMIN_ADAPTER` vide. Voir [Variables d'environnement](/docs/environment) pour la clé.

### Créer le premier administrateur avec un code de configuration

Une nouvelle installation n'a aucun compte. Tant que le premier administrateur n'existe pas, Studio affiche une page **Créer l'administrateur** à quiconque l'ouvre. La page demande un code de configuration. Seule une personne qui a accès au serveur peut en obtenir un, donc un inconnu sur le réseau du laboratoire ne peut pas prendre l'installation avant vous.

1. Démarrez OpenLDR.
2. Sur le serveur, lancez `openldr auth setup-code`. La commande affiche un code valable 30 minutes. Utilisez la forme installée ou de développement de la commande, décrite dans [Interface en ligne de commande](/docs/cli).
3. Ouvrez Studio. La page **Créer l'administrateur** s'ouvre.
4. Tapez le code dans **Code de configuration**, puis un nom d'utilisateur, puis deux fois le mot de passe.
5. Sélectionnez **Créer l'administrateur**.

Studio vous connecte avec le rôle verrouillé **Administrator**. La page de configuration ne revient plus, et `openldr auth setup-code` refuse désormais avec `an administrator already exists`.

Relancer la commande remplace le code précédent. Un code faux ou expiré affiche **Ce code de configuration est incorrect ou a expiré.** Un nom d'utilisateur déjà pris affiche **Ce nom d'utilisateur est déjà utilisé.** Tant que la configuration n'est pas terminée, `openldr doctor` affiche un avertissement sur sa ligne Sign-in.

### Règles des mots de passe et des sessions

Ces valeurs sont fixes. Ce ne sont pas des paramètres.

- Un mot de passe compte de 10 à 128 caractères et ne peut pas être le nom d'utilisateur. Aucune règle n'impose de types de caractères, et les mots de passe n'expirent pas.
- Cinq mots de passe faux de suite verrouillent le compte pendant cinq minutes. Un verrouillage se termine toujours tout seul. Une connexion réussie ou une réinitialisation par un administrateur remet le compte à zéro.
- Chaque adresse a droit à 30 tentatives de connexion par minute. Une adresse IPv6 compte par son /64. Le compte est gardé en mémoire sur chaque serveur.
- Une session se termine après 12 heures sans utilisation, ou 7 jours après la connexion, selon ce qui arrive en premier.
- Le cookie de session n'a pas de date d'expiration. Fermer le navigateur déconnecte donc l'utilisateur de ce navigateur, sauf si le navigateur est réglé pour rouvrir sa dernière session. Les limites de 12 heures et de 7 jours s'appliquent toujours.
- Changer son propre mot de passe ferme ses autres sessions et garde la session en cours.
- La réinitialisation par un administrateur donne un mot de passe temporaire et ferme les sessions de l'utilisateur. Celui-ci doit choisir un nouveau mot de passe à la connexion suivante, différent du mot de passe temporaire.
- La réinitialisation du mot de passe par e-mail n'est pas disponible. Studio masque **Envoyer un e-mail de réinitialisation**.

Un mot de passe faux, un compte verrouillé et un compte désactivé reçoivent tous le même message, donc la page de connexion ne révèle pas si un compte existe.

### Mots de passe en HTTP simple

En HTTP simple, un mot de passe traverse le réseau sans chiffrement. Toute personne qui peut observer le trafic entre un navigateur et le serveur peut le lire. Servez Studio en HTTPS, ou n'y accédez que par Tailscale, qui chiffre le trafic entre les appareils. Le cookie de session n'est marqué `Secure` que lorsqu'une requête arrive en HTTPS, donc le HTTP simple fonctionne quand même. Il n'est pas privé.

### Ce que la connexion locale ne fait pas

- Pas de second facteur.
- Pas de réinitialisation du mot de passe par e-mail.
- Pas d'inscription libre. Un administrateur ajoute chaque personne.
- Pas de passage d'une installation Keycloak ou OIDC existante à la connexion locale.
- Pas d'enrôlement de synchronisation. Une installation en connexion locale ne peut pas être un central de synchronisation.

Sans administration du fournisseur, gérez les comptes, mots de passe et sessions chez le fournisseur. OpenLDR ne peut ni créer, modifier ou supprimer ces utilisateurs, ni réinitialiser leurs mots de passe ou révoquer leurs sessions. L'attribution des rôles locaux et la désactivation/réactivation locale restent disponibles dans Studio et la CLI. La désactivation locale bloque OpenLDR, sans désactiver le compte du fournisseur. La création des clients de synchronisation distribuée exige encore l'administration Keycloak. La synchronisation générique entre machines ne fait pas partie de cette configuration prise en charge.

## Configurer un fournisseur générique

Utilisez un nouveau déploiement sans identités liées à un autre émetteur. Enregistrez un client public pour navigateur avec code d'autorisation et PKCE. PKCE lie l'échange du code au navigateur qui a lancé la connexion. Ne donnez aucun secret client à Studio.

Enregistrez `https://YOUR_HOST/studio/auth/callback` comme URI de redirection et `https://YOUR_HOST/studio` comme URI de retour après déconnexion. Autorisez l'origine de Studio pour la découverte et les requêtes de jetons du navigateur. Le fournisseur doit publier les métadonnées OIDC et les clés de signature. Ses jetons d'accès doivent être des JWT avec l'émetteur et l'audience configurés.

```dotenv
AUTH_ADAPTER=oidc
IDENTITY_ADMIN_ADAPTER=none
OIDC_ISSUER_URL=https://YOUR_PROVIDER/ISSUER_PATH
OIDC_AUDIENCE=openldr-api
OIDC_WEB_CLIENT_ID=openldr-web
```

`OIDC_SCOPES` vaut `openid profile email` par défaut. Ajoutez les scopes API exigés par le fournisseur et conservez `openid`. Définissez `OIDC_RESOURCE` si le fournisseur exige une URL de ressource pour émettre le jeton d’accès API. Ces valeurs viennent de sa configuration ; OpenLDR ne les déduit pas de `OIDC_AUDIENCE`.

Remplacez l'émetteur, l'audience et l'identifiant client par les valeurs du fournisseur. Configurez cette audience dans les jetons d'accès. OpenLDR vérifie la signature, l'émetteur, l'audience et l'expiration. Un jeton d'identité ne remplace pas un jeton d'accès API.

`OIDC_INTERNAL_JWKS_URL` peut fournir explicitement une adresse interne pour les clés de signature. Cela ne change pas l'émetteur attendu. `OIDC_INTERNAL_ISSUER_URL` concerne Keycloak uniquement ; le mode générique n'en déduit aucune adresse. Retirez les anciens paramètres Keycloak d'un déploiement générique. Le mode Keycloak conserve des métadonnées statiques pour les proxys qui bloquent la découverte.

Redémarrez les processus applicatifs après modification. Sans adresse de déconnexion dans les métadonnées, la déconnexion efface seulement la session locale. La session du fournisseur peut rester active.

## Donner accès au premier administrateur

Cette section concerne Keycloak et OIDC générique. En connexion locale, le code de configuration crée le premier administrateur.

Connectez-vous une fois pour créer le compte local. Cette première connexion n'accorde aucun accès administrateur. Sur le serveur, trouvez le sujet du compte avec `openldr user list`. Vérifiez ce sujet auprès du fournisseur, puis lancez :

```sh
openldr user assign-role SUBJECT lab_admin
```

Remplacez `SUBJECT` par le sujet exact du fournisseur, pas l'identifiant utilisateur local. Reconnectez-vous et vérifiez les droits. Les changements suivants utilisent cette commande ou les actions utilisateur de Studio.

## Conserver l'émetteur

OpenLDR lie la base applicative à son émetteur avant de démarrer les services authentifiés. Un changement ultérieur bloque le démarrage. Une nouvelle URL peut désigner d'autres identités, même avec les mêmes noms d'utilisateur. Ce lien reste local et ne passe pas par la synchronisation des paramètres.

Lors de la première mise à niveau avec cette protection, conservez `OIDC_ISSUER_URL`. Les anciennes lignes utilisateur ne prouvent pas leur émetteur d'origine. Le premier enregistrement conserve la valeur configurée et ne détecte pas une erreur antérieure. Gardez le même émetteur lors d'une restauration de la base applicative.

Si le même fournisseur a seulement changé d'adresse, par exemple un nouveau nom d'hôte ou le passage à HTTPS, les identifiants des utilisateurs ne changent pas. Définissez la nouvelle `OIDC_ISSUER_URL`, puis exécutez :

```bash
openldr auth rebind-issuer --force
```

Sans `--force`, la commande affiche les deux émetteurs et ne modifie rien. Avec `--force`, elle enregistre un événement d'audit `auth.issuer.rebind`. Ne l'utilisez pas pour passer à un autre fournisseur. Il n'existe aucune migration automatique des comptes. Le transfert entre fournisseurs, la correspondance des sujets et la restauration des identités exigent une procédure distincte validée par l'opérateur. Les commandes de migration de base restent disponibles sans démarrer les services authentifiés.

## Dépannage de la connexion locale

- **Le dernier administrateur a oublié son mot de passe.** Sur le serveur, lancez `openldr user reset-password <username> --force`. La commande affiche une seule fois un mot de passe temporaire et ferme les sessions de cet utilisateur. Connectez-vous avec, puis choisissez un nouveau mot de passe. Le nom d'utilisateur doit être exact, majuscules comprises. `openldr users list` affiche tous les noms d'utilisateur. Sans `--force`, la commande ne change rien.
- **`openldr auth setup-code` répond `an administrator already exists`.** La configuration est terminée. Connectez-vous, ou récupérez un mot de passe perdu comme ci-dessus.
- **`openldr auth setup-code` répond `local sign-in is not enabled`.** `AUTH_ADAPTER` ne vaut pas `local` dans l'environnement du serveur.
- **Le serveur refuse de démarrer après le passage à `AUTH_ADAPTER=local`, et cite deux émetteurs différents.** La base de données a d'abord démarré avec Keycloak ou OIDC. Passer une installation d'un mode de connexion à un autre n'est pas pris en charge. Démarrez la connexion locale sur une base neuve. `openldr auth rebind-issuer` n'aide pas ici, car elle sert seulement à un fournisseur qui a changé d'adresse.
- **Le serveur refuse de démarrer et affiche `SECRETS_ENCRYPTION_KEY is required when AUTH_ADAPTER=local`.** Définissez la clé et redémarrez.
- **Un rôle donné avec `openldr user assign-role` n'a aucun effet.** La commande prend l'ID de l'utilisateur, pas son nom d'utilisateur. Avec un nom d'utilisateur, elle annonce un succès et n'accorde rien. `openldr user create` affiche l'ID, et `openldr users list` le montre en début de ligne.

Voir [Variables d'environnement](/docs/environment) et [Interface en ligne de commande](/docs/cli).

# Fournisseurs d'authentification

OpenLDR peut connecter les personnes de trois façons : avec ses propres comptes, par Keycloak, ou par un fournisseur OpenID Connect générique, ou OIDC. `AUTH_ADAPTER` choisit l'une d'elles. S'il n'est pas défini, il vaut `keycloak`. Le mode générique exige la découverte OIDC et des jetons d'accès JWT signés. Les jetons opaques ne sont pas acceptés. Ce guide ne certifie pas la configuration d'un second fournisseur.

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les extraits de configuration indiquent le fichier à modifier ; ce ne sont pas des commandes. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

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

Utilisez une installation neuve sans identités liées à un autre émetteur. Keycloak est le défaut seulement quand `AUTH_ADAPTER` n'est pas défini. OIDC générique exige découverte et jetons JWT signés ; les jetons opaques sont refusés. Ce guide ne certifie aucun fournisseur externe. Les captures de première connexion restent différées.

### 1. Enregistrer le client navigateur chez le fournisseur

Remplacez YOUR_HOST. PKCE lie l’échange au navigateur initial. Autorisez l’origine Studio pour découverte et jetons. Aucun secret client dans Studio. Les écrans fournisseurs varient ; ceci est un exemple de configuration.

```text
{{operator:auth-client}}
```

![Enregistrer le client navigateur chez le fournisseur.](guide:operator-auth-client)

### 2. Définir les valeurs dans le fichier environnement

Remplacez émetteur, audience et identifiant. Gardez openid ; ajoutez les portées API et OIDC_RESOURCE seulement si requis. Le jeton d’accès doit inclure l’audience. Un ID token n’est pas un jeton API. Retirez les paramètres Keycloak obsolètes. OIDC_INTERNAL_ISSUER_URL est ignoré en mode générique. OIDC_INTERNAL_JWKS_URL change la récupération des clés, pas l’émetteur attendu.

```text
{{operator:auth-config}}
```

![Définir les valeurs dans le fichier environnement.](guide:operator-auth-config)

### 3. Recréer l’API et lire son démarrage

Résolvez erreurs de configuration ou découverte. OpenLDR contrôle signature, émetteur, audience et expiration. Sans endpoint de déconnexion, la session locale s’efface mais celle du fournisseur peut rester. La connexion réelle sera testée séparément.

```sh
{{operator:auth-recreate}}
```

![Recréer l’API et lire son démarrage.](guide:operator-auth-recreate)

## Accorder l’administration à un compte identifié

Cette section concerne Keycloak et OIDC générique. En connexion locale, le code de configuration crée le premier administrateur.

Le compte doit déjà avoir effectué sa première connexion et exister localement. Cela ne donne pas automatiquement l’administration. Cette tâche opérateur suppose ce préalable, sans décrire la connexion.

### 1. Lire le compte et son sujet fournisseur

Vérifiez le sujet chez le fournisseur. Ne confondez pas sujet, identifiant local et nom. Gardez la sortie privée.

```sh
{{operator:auth-users}}
```

![Lire le compte et son sujet fournisseur.](guide:operator-auth-users)

### 2. Attribuer le rôle administrateur local

Remplacez SUBJECT par le sujet vérifié. Cela change les autorisations locales. Vérifiez l’accès obtenu. Utilisez ensuite cette commande ou les actions utilisateur Studio.

```sh
{{operator:auth-role}}
```

![Attribuer le rôle administrateur local.](guide:operator-auth-role)

## Préserver l’émetteur d’une base existante

La base est liée à son émetteur avant le démarrage authentifié. Gardez-le lors des mises à niveau et restaurations. Les noms ne prouvent pas l’identité de l’ancien émetteur. La liaison reste locale et ne se synchronise pas. Un autre fournisseur exige une migration explicite.

### 1. Examiner le déplacement sans le modifier

Seulement si le même fournisseur change d’adresse ou protocole, définissez la nouvelle URL et examinez les valeurs ancienne/nouvelle. Sans --force la liaison divergente reste inchangée. Appliquez d’abord les migrations en attente.

```sh
{{operator:auth-rebind-review}}
```

![Examiner le déplacement sans le modifier.](guide:operator-auth-rebind-review)

### 2. Confirmer seulement une identité fournisseur inchangée

Utilisez --force seulement pour le même fournisseur avec sujets inchangés. Ce n’est pas un raccourci pour changer de fournisseur. L’événement auth.issuer.rebind enregistre la modification. Redémarrez et vérifiez séparément. Ce guide ne l’exécute pas sur votre hôte.

```sh
{{operator:auth-rebind}}
```

![Confirmer seulement une identité fournisseur inchangée.](guide:operator-auth-rebind)

## Dépannage de la connexion locale

- **Le dernier administrateur a oublié son mot de passe.** Sur le serveur, lancez `openldr user reset-password <username> --force`. La commande affiche une seule fois un mot de passe temporaire et ferme les sessions de cet utilisateur. Connectez-vous avec, puis choisissez un nouveau mot de passe. Le nom d'utilisateur doit être exact, majuscules comprises. `openldr users list` affiche tous les noms d'utilisateur. Sans `--force`, la commande ne change rien.
- **`openldr auth setup-code` répond `an administrator already exists`.** La configuration est terminée. Connectez-vous, ou récupérez un mot de passe perdu comme ci-dessus.
- **`openldr auth setup-code` répond `local sign-in is not enabled`.** `AUTH_ADAPTER` ne vaut pas `local` dans l'environnement du serveur.
- **Le serveur refuse de démarrer après le passage à `AUTH_ADAPTER=local`, et cite deux émetteurs différents.** La base de données a d'abord démarré avec Keycloak ou OIDC. Passer une installation d'un mode de connexion à un autre n'est pas pris en charge. Démarrez la connexion locale sur une base neuve. `openldr auth rebind-issuer` n'aide pas ici, car elle sert seulement à un fournisseur qui a changé d'adresse.
- **Le serveur refuse de démarrer et affiche `SECRETS_ENCRYPTION_KEY is required when AUTH_ADAPTER=local`.** Définissez la clé et redémarrez.
- **Un rôle donné avec `openldr user assign-role` n'a aucun effet.** La commande prend l'ID de l'utilisateur, pas son nom d'utilisateur. Avec un nom d'utilisateur, elle annonce un succès et n'accorde rien. `openldr user create` affiche l'ID, et `openldr users list` le montre en début de ligne.

Voir [Variables d'environnement](/docs/environment) et [Interface en ligne de commande](/docs/cli).

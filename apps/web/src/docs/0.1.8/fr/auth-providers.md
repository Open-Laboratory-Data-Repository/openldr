# Fournisseurs d'authentification

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les illustrations de fichiers montrent le texte à modifier dans le fichier indiqué. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

## Choisir l'authentification et l'administration

| Configuration | Connexion | Administration du fournisseur | Création des clients de synchronisation |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration absente ou `keycloak` | Métadonnées Keycloak | Avec les identifiants administratifs | Keycloak uniquement |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Métadonnées Keycloak | Indisponible | Indisponible |
| `AUTH_ADAPTER=oidc`, administration absente ou `none` | Découverte OIDC | Indisponible | Indisponible |

Par défaut, `IDENTITY_ADMIN_ADAPTER` vaut `keycloak` pour Keycloak et `none` pour OIDC générique. L'association OIDC générique et administration Keycloak est refusée.

Sans administration du fournisseur, gérez les comptes, mots de passe et sessions chez le fournisseur. OpenLDR ne peut ni créer, modifier ou supprimer ces utilisateurs, ni réinitialiser leurs mots de passe ou révoquer leurs sessions. L'attribution des rôles locaux et la désactivation/réactivation locale restent disponibles dans Studio et la CLI. La désactivation locale bloque OpenLDR, sans désactiver le compte du fournisseur. La création des clients de synchronisation distribuée exige encore l'administration Keycloak. La synchronisation générique entre machines ne fait pas partie de cette configuration prise en charge.

## Configurer un fournisseur générique

Utilisez une installation neuve sans identités liées à un autre émetteur. Keycloak reste le défaut. OIDC générique exige découverte et jetons JWT signés ; les jetons opaques sont refusés. Ce guide ne certifie aucun fournisseur externe. Les captures de première connexion restent différées.

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

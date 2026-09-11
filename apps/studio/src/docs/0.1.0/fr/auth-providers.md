# Fournisseurs d'authentification

OpenLDR accepte Keycloak et OpenID Connect générique, ou OIDC, pour la connexion. Keycloak reste le choix par défaut. Le mode générique exige la découverte OIDC et des jetons d'accès JWT signés. Les jetons opaques ne sont pas acceptés. Ce guide ne certifie pas la configuration d'un second fournisseur.

## Choisir l'authentification et l'administration

| Configuration | Connexion | Administration du fournisseur | Création des clients de synchronisation |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration absente ou `keycloak` | Métadonnées Keycloak | Avec les identifiants administratifs | Keycloak uniquement |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Métadonnées Keycloak | Indisponible | Indisponible |
| `AUTH_ADAPTER=oidc`, administration absente ou `none` | Découverte OIDC | Indisponible | Indisponible |

Par défaut, `IDENTITY_ADMIN_ADAPTER` vaut `keycloak` pour Keycloak et `none` pour OIDC générique. L'association OIDC générique et administration Keycloak est refusée.

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

Voir [Variables d'environnement](/docs/environment), [Utilisateurs et rôles](/docs/users) et [Synchronisation distribuée](/docs/sync).

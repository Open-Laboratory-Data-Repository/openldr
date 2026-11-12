# Fournisseurs d'authentification

OpenLDR prend en charge Keycloak et OpenID Connect générique, ou OIDC, pour la connexion. OIDC générique utilise la découverte du fournisseur et des jetons d'accès JWT signés. Les jetons d'accès opaques ne sont pas pris en charge.

Utilisez un nouveau déploiement pour un nouveau fournisseur d'identité. Une base existante appartient à son émetteur et aux sujets d'origine du fournisseur. Des noms d'utilisateur identiques ne rendent pas interchangeables les comptes de fournisseurs différents.

Les images de configuration portent la mention Illustration. Les captures de connexion utilisent un vrai fournisseur Keycloak isolé en mode OIDC générique, avec authentification obligatoire. Votre fournisseur peut avoir une autre page de connexion. Cela vérifie le parcours local de test, pas tous les déploiements.

La configuration initiale exige les accès d'administration du serveur et du fournisseur. Studio utilise un client navigateur public et le code d'autorisation avec PKCE. PKCE lie l'échange du code au navigateur ayant lancé la connexion. Ne donnez pas de secret client à Studio.

## Configurer un nouveau déploiement OIDC générique

Enregistrez d'abord le client navigateur chez le fournisseur. Utilisez ses vrais émetteur, audience, portées et identifiant client. Gardez la configuration serveur privée.

### 1. Enregistrer le client navigateur

Utilisez le code d'autorisation avec PKCE. Enregistrez `https://YOUR_HOST/studio/auth/callback` comme URI de retour et `https://YOUR_HOST/studio` comme URI de retour après déconnexion. Autorisez l'origine Studio pour la découverte et les demandes de jetons du navigateur.

![Illustration. Enregistrer un client navigateur public avec PKCE chez le fournisseur.](auth-providers-guide-client-registration.png)

### 2. Choisir le mode générique

Dans le .env du déploiement, définissez `AUTH_ADAPTER=oidc` et `IDENTITY_ADMIN_ADAPTER=none`. OIDC générique ne peut pas utiliser l'administration Keycloak.

![Illustration. Choisir OIDC générique sans administration du fournisseur.](auth-providers-guide-auth-mode.png)

### 3. Définir l'émetteur, l'audience et l'identifiant client

Renseignez OIDC_ISSUER_URL, OIDC_AUDIENCE et OIDC_WEB_CLIENT_ID selon le fournisseur. Les jetons d'accès doivent contenir l'émetteur et l'audience attendus. Un jeton d'identité n'est pas un jeton d'accès API.

![Illustration. Utiliser les valeurs d'émetteur, d'audience et de client fournies par le fournisseur.](auth-providers-guide-issuer-settings.png)

### 4. Vérifier les portées et la ressource demandées

OIDC_SCOPES vaut `openid profile email` par défaut. Gardez openid et ajoutez les portées API nécessaires. Renseignez OIDC_RESOURCE seulement si le fournisseur exige un indicateur de ressource. OpenLDR ne le déduit pas de l'audience.

![Illustration. Garder openid et ajouter seulement les portées ou la ressource requises.](auth-providers-guide-scopes.png)

### 5. Recréer le service applicatif concerné

Appliquez la configuration de démarrage avec votre commande habituelle de déploiement. Vérifiez que le fournisseur publie les métadonnées de découverte et les clés de signature. Gardez AUTH_DEV_BYPASS désactivé.

![Illustration. Recréer l'application après modification de sa configuration de démarrage.](auth-providers-guide-restart.png)

**Résultat attendu :** le navigateur peut lancer la connexion du fournisseur. Un fichier de configuration valide ne prouve pas à lui seul une connexion réussie.

## Se connecter par le fournisseur

Ouvrez Studio avec son adresse publique configurée. L'exemple utilise un compte fictif sur le fournisseur isolé.

### 1. Ouvrir Studio

Studio redirige vers le fournisseur configuré. Vérifiez son identité avant de saisir vos identifiants.

![Studio redirige vers le fournisseur d'identité configuré.](auth-providers-guide-provider.png)

### 2. Saisir le nom d'utilisateur

Utilisez le compte fourni par votre organisation. L'exemple utilise `guide.operator`.

![Saisir le nom d'utilisateur du fournisseur.](auth-providers-guide-username.png)

### 3. Saisir le mot de passe du fournisseur

Utilisez la méthode de connexion du fournisseur. Le mot de passe reste masqué dans la capture. D'autres fournisseurs peuvent demander une authentification supplémentaire.

![Saisir le mot de passe du fournisseur. Il reste masqué.](auth-providers-guide-password.png)

### 4. Choisir Sign In

Sélectionnez l'action de connexion du fournisseur. Un échange de code réussi ramène à Studio.

![La connexion authentifie auprès du vrai fournisseur.](auth-providers-guide-sign-in.png)

### 5. Vérifier les accès initiaux

La première connexion crée un compte local. Elle ne donne pas les droits d'administration. L'exemple affiche Access denied pour la page demandée, avec Docs et la navigation accessible.

![La première connexion crée un compte local sans droits d'administration.](auth-providers-guide-first-access.png)

**Résultat attendu :** le fournisseur a authentifié le compte. Les permissions applicatives viennent toujours des rôles locaux.

## Donner l'accès local au premier administrateur

Sur le serveur, identifiez le compte créé à la première connexion. Utilisez le sujet exact du fournisseur, pas le nom d'utilisateur ni l'identifiant local.

### 1. Trouver le sujet du compte

Depuis `openldr_ce`, lancez `pnpm openldr user list`. Faites correspondre le sujet au compte souhaité chez le fournisseur. Consultez [Commencer ici](/docs/start-here) pour configurer la CLI.

![Illustration. Trouver le compte local après sa première connexion.](auth-providers-guide-list-subject.png)

### 2. Attribuer le rôle administrateur

Lancez `pnpm openldr user assign-role SUBJECT lab_admin` avec ce sujet exact. Cette commande change l'accès OpenLDR. Elle ne rend pas l'utilisateur administrateur du fournisseur.

![Illustration. Attribuer le rôle administrateur au sujet exact du fournisseur.](auth-providers-guide-grant-role.png)

### 3. Vérifier l'accès accordé

Reconnectez-vous ou rechargez l'application authentifiée, puis vérifiez les pages d'administration autorisées. Dans le test, Users apparaît après l'attribution du rôle local.

![Après l'attribution locale, Studio affiche les pages d'administration autorisées.](auth-providers-guide-admin-access.png)

**Résultat attendu :** le compte local choisi possède le rôle attribué. La commande CLI de test a réussi et la vraie page Users s'est ouverte.

## Gérer les accès locaux sans administrer le fournisseur

OIDC générique conserve les rôles et les contrôles d'accès locaux. Création de compte, profil, réinitialisation du mot de passe et sessions restent chez le fournisseur d'identité.

### 1. Ouvrir Users

Sélectionnez **Users**. Lisez l'avis d'administration du fournisseur au-dessus du tableau.

![OIDC générique conserve les contrôles locaux sans administration des comptes du fournisseur.](auth-providers-guide-users.png)

### 2. Vérifier le compte souhaité

Vérifiez le nom d'utilisateur et les informations d'identité disponibles avant de modifier l'accès local.

![Vérifier l'identité du fournisseur avant de modifier les rôles locaux.](auth-providers-guide-user-row.png)

### 3. Utiliser les actions locales de la ligne

Ouvrez les points de la ligne. **Edit role** modifie les rôles OpenLDR. Disable bloque ce compte dans OpenLDR. Il ne désactive pas le compte du fournisseur ni ses sessions.

![La ligne propose des actions locales de rôle et d'accès.](auth-providers-guide-local-actions.png)

**Résultat attendu :** l'administration des utilisateurs du fournisseur est indisponible dans ce mode. Confiez comptes et mots de passe à l'administrateur du fournisseur.

## Se déconnecter de Studio

Utilisez le menu utilisateur de l'application. La fin de session du fournisseur dépend de ses métadonnées de déconnexion.

### 1. Ouvrir le menu utilisateur

Sélectionnez votre menu utilisateur en bas à gauche.

![Ouvrir le menu utilisateur pour se déconnecter.](auth-providers-guide-user-menu.png)

### 2. Choisir Sign out

Sélectionnez **Sign out**. Studio efface sa session et utilise la déconnexion du fournisseur si elle est disponible.

![Sign out efface la session applicative et utilise la déconnexion du fournisseur si disponible.](auth-providers-guide-sign-out.png)

### 3. Vérifier l'état obtenu

Dans ce test, le fournisseur a terminé sa session et exige une nouvelle connexion. Sans point de déconnexion découvert, seule la session locale est effacée. Celle du fournisseur peut rester active.

![Ce fournisseur a terminé sa session et exige une nouvelle connexion.](auth-providers-guide-signed-out.png)

## Vérifier un changement d'émetteur avant de réassocier

Un changement d'émetteur bloque le démarrage authentifié avec une base déjà associée. Conservez l'émetteur lors d'une restauration.

### 1. Lire le refus avant de forcer

Si le même fournisseur change d'adresse, configurez l'émetteur souhaité et lancez d'abord `pnpm openldr auth rebind-issuer` sans --force. La commande signale une différence et refuse de la modifier. Un autre fournisseur exige une procédure de correspondance des identités.

![Illustration. Réassocier seulement si le même fournisseur a déménagé sans changer les sujets.](auth-providers-guide-issuer-rebind.png)

**Résultat attendu :** seul un changement d'adresse vérifié, avec sujets inchangés, permet une réassociation forcée. Le test illustré a exercé le refus, pas une modification forcée d'identité.

## Lire les conseils d'authentification sur téléphone

La documentation authentifiée s'adapte à la largeur du téléphone.

### 1. Ouvrir le guide

Lisez le guide des fournisseurs d'authentification dans Docs. La page de connexion dépend du fournisseur et exige sa propre vérification sur téléphone.

![La documentation authentifiée reste lisible sur téléphone.](auth-providers-guide-phone-docs.png)

## Choisir les modes de connexion et d'administration

L'administration utilise keycloak par défaut en mode Keycloak et none en mode générique. L'authentification générique avec administration Keycloak est refusée. Distinguez le client navigateur public du client d'administration confidentiel.

| Configuration | Connexion | Administration du fournisseur |
| --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration omise ou keycloak | Métadonnées des points d'accès Keycloak | Disponible seulement avec les identifiants d'administration configurés. La création des clients de synchronisation utilise Keycloak. |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Métadonnées des points d'accès Keycloak | Indisponible. Les rôles et accès locaux restent disponibles. |
| `AUTH_ADAPTER=oidc`, administration omise ou none | Découverte OIDC | Indisponible. La création générique d'accès machine à machine pour la synchronisation est hors de cette configuration. |

## Points d'accès internes et vérification des jetons

OIDC_INTERNAL_JWKS_URL permet de configurer explicitement un point interne de clés de signature. Il ne change pas l'émetteur attendu. OIDC_INTERNAL_ISSUER_URL est propre à Keycloak. Le mode générique n'en déduit aucun point d'accès. Retirez les anciens paramètres propres à Keycloak du déploiement générique.

OpenLDR vérifie la signature, l'émetteur, l'audience et l'expiration du jeton d'accès API. La session navigateur utilise les portées configurées et la ressource facultative. Une connexion réussie chez le fournisseur ne garantit pas que l'API reçoit le bon jeton d'accès.

## Préserver l'espace des identités

OpenLDR associe la base applicative à son émetteur avant le démarrage authentifié. La synchronisation des paramètres ne réplique pas cette association. Changer l'URL peut changer l'espace des identités même si les noms d'utilisateur correspondent.

À la première mise à niveau avec protection de l'émetteur, gardez OIDC_ISSUER_URL inchangé. Les anciennes lignes utilisateur ne prouvent pas quel émetteur les a créées. La première association enregistre la valeur configurée et ne peut pas détecter une erreur antérieure.

Si le même fournisseur a changé d'adresse sans changer aucun sujet, une commande `pnpm openldr auth rebind-issuer --force` vérifiée modifie l'association et enregistre auth.issuer.rebind. Ce n'est pas une migration automatique des comptes. Changer de fournisseur, réassocier des sujets ou restaurer des identités exige une procédure distincte vérifiée. Les commandes de migration de base restent disponibles sans démarrage authentifié.

## Résolution de problèmes

**Serveur inaccessible.** Vérifiez l'API et la route de configuration publique. Une page de connexion du fournisseur ne prouve pas que l'API est disponible.

**La connexion réussit mais Studio refuse l'accès.** Vérifiez le sujet local et le rôle attribué. La première connexion n'accorde pas lab_admin.

**Jeton refusé.** Comparez émetteur, audience, clés, expiration, portées et ressource avec la vraie configuration des jetons d'accès. Ne copiez pas de jetons dans des journaux partagés ou des captures.

**Redirection refusée.** Vérifiez l'URI /studio/auth/callback enregistrée et l'origine publique exacte.

**Émetteur différent au démarrage.** Rétablissez l'émetteur d'origine. Forcez la réassociation seulement pour le même fournisseur déplacé sans changement des sujets.

**Création d'utilisateur, réinitialisation ou inscription de synchronisation absente.** Le mode générique n'administre pas le fournisseur. Utilisez le fournisseur d'identité pour ses comptes et sessions.

## Limites de la vérification d'authentification

Le test réel utilisait la découverte OIDC générique, le code d'autorisation avec PKCE, la vérification JWT et l'attribution locale de rôles dans un domaine Keycloak isolé. Le contournement d'authentification était désactivé. Aucune réponse navigateur ou API n'était simulée.

Le compte fictif a été désactivé et ses sessions révoquées après les captures. Mots de passe, identifiants d'administration client et jetons sont restés hors du dépôt. Ce test ne certifie ni un autre fournisseur, ni TLS de production, ni l'authentification multifacteur, ni le renouvellement silencieux, ni la reprise après panne.

## Guides associés

[Variables d'environnement](/docs/environment), [Utilisateurs](/docs/users), [Rôles](/docs/roles) et [Synchronisation distribuée](/docs/sync).

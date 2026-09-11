# Authentication providers

## English

OpenLDR supports Keycloak and generic OpenID Connect, or OIDC, for sign-in. Keycloak remains the default. Generic mode requires discovery and signed JWT access tokens. Opaque access tokens are unsupported. This guide does not certify a second provider's deployment configuration.

### Choose authentication and administration

| Configuration | Sign-in | Provider administration | Sync client provisioning |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration omitted or `keycloak` | Keycloak metadata | Available with admin credentials | Keycloak only |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Keycloak metadata | Unavailable | Unavailable |
| `AUTH_ADAPTER=oidc`, administration omitted or `none` | OIDC discovery | Unavailable | Unavailable |

`IDENTITY_ADMIN_ADAPTER` defaults to `keycloak` for Keycloak authentication and `none` for generic OIDC. Generic authentication with Keycloak administration is rejected.

Without provider administration, manage accounts, passwords and provider sessions at the provider. OpenLDR cannot create, edit or delete provider users, reset passwords or revoke provider sessions. Local role assignment and local disable/enable remain available in Studio and the CLI. Local disable blocks OpenLDR access; it does not disable the provider account. Distributed sync client provisioning still requires Keycloak administration. Generic machine-to-machine sync is outside this guide's supported setup.

### Configure a generic provider

Use a fresh deployment with no identities bound to another issuer. Register a public browser client using authorization code with PKCE. PKCE binds the code exchange to the browser that started sign-in. Do not give Studio a client secret.

Register `https://YOUR_HOST/studio/auth/callback` as the redirect URI and `https://YOUR_HOST/studio` as the logout return URI. Allow the Studio origin for browser discovery and token requests. The provider must publish OIDC discovery metadata and signing keys. Its access tokens must be JWTs with the configured issuer and audience.

```dotenv
AUTH_ADAPTER=oidc
IDENTITY_ADMIN_ADAPTER=none
OIDC_ISSUER_URL=https://YOUR_PROVIDER/ISSUER_PATH
OIDC_AUDIENCE=openldr-api
OIDC_WEB_CLIENT_ID=openldr-web
```

`OIDC_SCOPES` defaults to `openid profile email`. Add the API scopes required by your provider and keep `openid`. Set `OIDC_RESOURCE` when the provider requires a resource URL to issue the API access token. Resource and scope values come from the provider configuration; OpenLDR does not infer them from `OIDC_AUDIENCE`.

Replace the issuer, audience and client ID with provider values. Configure the provider to include that audience in access tokens. OpenLDR checks signatures, issuer, audience and expiry. An ID token is not an API access token.

`OIDC_INTERNAL_JWKS_URL` can explicitly supply an internal signing-key endpoint. It does not change the expected issuer. `OIDC_INTERNAL_ISSUER_URL` is Keycloak-specific; generic mode does not derive endpoints from it. Remove stale Keycloak settings from a generic deployment. Keycloak mode retains static metadata for proxies that block discovery.

Restart application processes after changing configuration. If discovery has no logout endpoint, signing out clears the local session only. The provider session can remain active.

### Grant the first administrator access

Sign in once to create the local account. First login does not grant administrator access. On the server, find that account's provider subject using `openldr user list`. Check the subject against the intended provider account, then run:

```sh
openldr user assign-role SUBJECT lab_admin
```

Replace `SUBJECT` with the exact provider subject, not the local user ID. Sign in again and verify the assigned access. Later role changes use the same CLI command or Studio's user actions.

### Preserve the issuer

OpenLDR binds the application database to its issuer before authenticated services start. Later issuer changes stop startup. Changing the URL can change the identity namespace even when usernames match. The binding stays local and does not replicate through settings sync.

On the first upgrade with this protection, keep the existing `OIDC_ISSUER_URL`. Historical user rows cannot prove their original issuer. The first binding records the configured value; it cannot detect an earlier configuration mistake. Keep the same issuer when restoring an existing application database.

If the same provider only moved address, for example a new hostname or a switch to HTTPS, user IDs do not change. Set the new `OIDC_ISSUER_URL`, then run:

```bash
openldr auth rebind-issuer --force
```

Without `--force` the command shows both issuers and changes nothing. With it, the command records an `auth.issuer.rebind` audit event. Do not use it to switch to a different provider. There is no automatic account migration. Moving identities between providers, remapping subjects and restoring provider identities need a separate operator-reviewed procedure. Database migration commands remain available without starting authenticated services.

See [Environment variables](/docs/environment) and [Command-line interface](/docs/cli).

## Français

OpenLDR accepte Keycloak et OpenID Connect générique, ou OIDC, pour la connexion. Keycloak reste le choix par défaut. Le mode générique exige la découverte OIDC et des jetons d'accès JWT signés. Les jetons opaques ne sont pas acceptés. Ce guide ne certifie pas la configuration d'un second fournisseur.

### Choisir l'authentification et l'administration

| Configuration | Connexion | Administration du fournisseur | Création des clients de synchronisation |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration absente ou `keycloak` | Métadonnées Keycloak | Avec les identifiants administratifs | Keycloak uniquement |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Métadonnées Keycloak | Indisponible | Indisponible |
| `AUTH_ADAPTER=oidc`, administration absente ou `none` | Découverte OIDC | Indisponible | Indisponible |

Par défaut, `IDENTITY_ADMIN_ADAPTER` vaut `keycloak` pour Keycloak et `none` pour OIDC générique. L'association OIDC générique et administration Keycloak est refusée.

Sans administration du fournisseur, gérez les comptes, mots de passe et sessions chez le fournisseur. OpenLDR ne peut ni créer, modifier ou supprimer ces utilisateurs, ni réinitialiser leurs mots de passe ou révoquer leurs sessions. L'attribution des rôles locaux et la désactivation/réactivation locale restent disponibles dans Studio et la CLI. La désactivation locale bloque OpenLDR, sans désactiver le compte du fournisseur. La création des clients de synchronisation distribuée exige encore l'administration Keycloak. La synchronisation générique entre machines ne fait pas partie de cette configuration prise en charge.

### Configurer un fournisseur générique

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

### Donner accès au premier administrateur

Connectez-vous une fois pour créer le compte local. Cette première connexion n'accorde aucun accès administrateur. Sur le serveur, trouvez le sujet du compte avec `openldr user list`. Vérifiez ce sujet auprès du fournisseur, puis lancez :

```sh
openldr user assign-role SUBJECT lab_admin
```

Remplacez `SUBJECT` par le sujet exact du fournisseur, pas l'identifiant utilisateur local. Reconnectez-vous et vérifiez les droits. Les changements suivants utilisent cette commande ou les actions utilisateur de Studio.

### Conserver l'émetteur

OpenLDR lie la base applicative à son émetteur avant de démarrer les services authentifiés. Un changement ultérieur bloque le démarrage. Une nouvelle URL peut désigner d'autres identités, même avec les mêmes noms d'utilisateur. Ce lien reste local et ne passe pas par la synchronisation des paramètres.

Lors de la première mise à niveau avec cette protection, conservez `OIDC_ISSUER_URL`. Les anciennes lignes utilisateur ne prouvent pas leur émetteur d'origine. Le premier enregistrement conserve la valeur configurée et ne détecte pas une erreur antérieure. Gardez le même émetteur lors d'une restauration de la base applicative.

Si le même fournisseur a seulement changé d'adresse, par exemple un nouveau nom d'hôte ou le passage à HTTPS, les identifiants des utilisateurs ne changent pas. Définissez la nouvelle `OIDC_ISSUER_URL`, puis exécutez :

```bash
openldr auth rebind-issuer --force
```

Sans `--force`, la commande affiche les deux émetteurs et ne modifie rien. Avec `--force`, elle enregistre un événement d'audit `auth.issuer.rebind`. Ne l'utilisez pas pour passer à un autre fournisseur. Il n'existe aucune migration automatique des comptes. Le transfert entre fournisseurs, la correspondance des sujets et la restauration des identités exigent une procédure distincte validée par l'opérateur. Les commandes de migration de base restent disponibles sans démarrer les services authentifiés.

Voir [Variables d'environnement](/docs/environment) et [Interface en ligne de commande](/docs/cli).

## Português

O OpenLDR aceita Keycloak e OpenID Connect genérico, ou OIDC, para iniciar sessão. Keycloak continua a ser a opção predefinida. O modo genérico exige descoberta OIDC e tokens de acesso JWT assinados. Tokens opacos não são aceites. Este guia não certifica a configuração de um segundo fornecedor.

### Escolher autenticação e administração

| Configuração | Início de sessão | Administração do fornecedor | Criação de clientes de sincronização |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administração omitida ou `keycloak` | Metadados Keycloak | Com credenciais administrativas | Apenas Keycloak |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Metadados Keycloak | Indisponível | Indisponível |
| `AUTH_ADAPTER=oidc`, administração omitida ou `none` | Descoberta OIDC | Indisponível | Indisponível |

Por predefinição, `IDENTITY_ADMIN_ADAPTER` é `keycloak` para Keycloak e `none` para OIDC genérico. A combinação de OIDC genérico com administração Keycloak é rejeitada.

Sem administração do fornecedor, gira contas, palavras-passe e sessões no fornecedor. O OpenLDR não pode criar, editar ou eliminar esses utilizadores, redefinir palavras-passe ou revogar sessões do fornecedor. A atribuição de funções locais e a desativação/reativação local continuam disponíveis no Studio e na CLI. A desativação local bloqueia o OpenLDR, sem desativar a conta do fornecedor. A criação de clientes de sincronização distribuída ainda exige administração Keycloak. A sincronização genérica entre máquinas está fora desta configuração suportada.

### Configurar um fornecedor genérico

Use uma nova instalação sem identidades ligadas a outro emissor. Registe um cliente público de navegador com código de autorização e PKCE. PKCE associa a troca do código ao navegador que iniciou a sessão. Não forneça um segredo de cliente ao Studio.

Registe `https://YOUR_HOST/studio/auth/callback` como URI de redirecionamento e `https://YOUR_HOST/studio` como URI de retorno após terminar sessão. Autorize a origem do Studio para descoberta e pedidos de tokens pelo navegador. O fornecedor deve publicar metadados OIDC e chaves de assinatura. Os tokens de acesso devem ser JWT com o emissor e a audiência configurados.

```dotenv
AUTH_ADAPTER=oidc
IDENTITY_ADMIN_ADAPTER=none
OIDC_ISSUER_URL=https://YOUR_PROVIDER/ISSUER_PATH
OIDC_AUDIENCE=openldr-api
OIDC_WEB_CLIENT_ID=openldr-web
```

`OIDC_SCOPES` usa `openid profile email` por omissão. Acrescente os scopes API exigidos pelo fornecedor e mantenha `openid`. Defina `OIDC_RESOURCE` se o fornecedor exigir um URL de recurso para emitir o token de acesso API. Estes valores vêm da configuração do fornecedor; o OpenLDR não os deduz de `OIDC_AUDIENCE`.

Substitua emissor, audiência e identificador do cliente pelos valores do fornecedor. Configure essa audiência nos tokens de acesso. O OpenLDR verifica assinatura, emissor, audiência e expiração. Um token de identidade não substitui um token de acesso à API.

`OIDC_INTERNAL_JWKS_URL` pode fornecer explicitamente um endereço interno para as chaves de assinatura. Não altera o emissor esperado. `OIDC_INTERNAL_ISSUER_URL` pertence apenas ao Keycloak; o modo genérico não deriva endereços desse valor. Remova definições antigas do Keycloak de uma instalação genérica. O modo Keycloak conserva metadados estáticos para proxies que bloqueiam a descoberta.

Reinicie os processos da aplicação após alterar a configuração. Sem endereço de logout nos metadados, terminar sessão limpa apenas a sessão local. A sessão do fornecedor pode continuar ativa.

### Dar acesso ao primeiro administrador

Inicie sessão uma vez para criar a conta local. O primeiro acesso não concede direitos administrativos. No servidor, encontre o sujeito da conta com `openldr user list`. Confirme esse sujeito junto do fornecedor e execute:

```sh
openldr user assign-role SUBJECT lab_admin
```

Substitua `SUBJECT` pelo sujeito exato do fornecedor, não pelo identificador local do utilizador. Inicie sessão novamente e verifique os direitos. Alterações posteriores usam a mesma CLI ou as ações de utilizador do Studio.

### Conservar o emissor

O OpenLDR associa a base da aplicação ao emissor antes de iniciar serviços autenticados. Alterações posteriores bloqueiam o arranque. Outro URL pode identificar contas diferentes, mesmo com nomes iguais. A associação permanece local e não entra na sincronização de definições.

Na primeira atualização com esta proteção, mantenha `OIDC_ISSUER_URL`. Os registos antigos não comprovam o emissor original. A primeira associação guarda o valor configurado e não deteta um erro anterior. Mantenha o mesmo emissor ao restaurar a base da aplicação.

Se o mesmo fornecedor apenas mudou de endereço, por exemplo um novo nome de anfitrião ou a passagem para HTTPS, os identificadores dos utilizadores não mudam. Defina o novo `OIDC_ISSUER_URL` e execute:

```bash
openldr auth rebind-issuer --force
```

Sem `--force`, o comando mostra os dois emissores e não altera nada. Com `--force`, regista um evento de auditoria `auth.issuer.rebind`. Não o use para mudar para outro fornecedor. Não existe migração automática de contas. Transferir identidades entre fornecedores, mapear sujeitos e restaurar identidades exige outro procedimento aprovado pelo operador. Os comandos de migração da base continuam disponíveis sem iniciar serviços autenticados.

Veja [Variáveis de ambiente](/docs/environment) e [Interface de linha de comandos](/docs/cli).

# Fornecedores de autenticação

O OpenLDR aceita Keycloak e OpenID Connect genérico, ou OIDC, para iniciar sessão. Keycloak continua a ser a opção predefinida. O modo genérico exige descoberta OIDC e tokens de acesso JWT assinados. Tokens opacos não são aceites. Este guia não certifica a configuração de um segundo fornecedor.

## Escolher autenticação e administração

| Configuração | Início de sessão | Administração do fornecedor | Criação de clientes de sincronização |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administração omitida ou `keycloak` | Metadados Keycloak | Com credenciais administrativas | Apenas Keycloak |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Metadados Keycloak | Indisponível | Indisponível |
| `AUTH_ADAPTER=oidc`, administração omitida ou `none` | Descoberta OIDC | Indisponível | Indisponível |

Por predefinição, `IDENTITY_ADMIN_ADAPTER` é `keycloak` para Keycloak e `none` para OIDC genérico. A combinação de OIDC genérico com administração Keycloak é rejeitada.

Sem administração do fornecedor, gira contas, palavras-passe e sessões no fornecedor. O OpenLDR não pode criar, editar ou eliminar esses utilizadores, redefinir palavras-passe ou revogar sessões do fornecedor. A atribuição de funções locais e a desativação/reativação local continuam disponíveis no Studio e na CLI. A desativação local bloqueia o OpenLDR, sem desativar a conta do fornecedor. A criação de clientes de sincronização distribuída ainda exige administração Keycloak. A sincronização genérica entre máquinas está fora desta configuração suportada.

## Configurar um fornecedor genérico

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

## Dar acesso ao primeiro administrador

Inicie sessão uma vez para criar a conta local. O primeiro acesso não concede direitos administrativos. No servidor, encontre o sujeito da conta com `openldr user list`. Confirme esse sujeito junto do fornecedor e execute:

```sh
openldr user assign-role SUBJECT lab_admin
```

Substitua `SUBJECT` pelo sujeito exato do fornecedor, não pelo identificador local do utilizador. Inicie sessão novamente e verifique os direitos. Alterações posteriores usam a mesma CLI ou as ações de utilizador do Studio.

## Conservar o emissor

O OpenLDR associa a base da aplicação ao emissor antes de iniciar serviços autenticados. Alterações posteriores bloqueiam o arranque. Outro URL pode identificar contas diferentes, mesmo com nomes iguais. A associação permanece local e não entra na sincronização de definições.

Na primeira atualização com esta proteção, mantenha `OIDC_ISSUER_URL`. Os registos antigos não comprovam o emissor original. A primeira associação guarda o valor configurado e não deteta um erro anterior. Mantenha o mesmo emissor ao restaurar a base da aplicação.

Se o mesmo fornecedor apenas mudou de endereço, por exemplo um novo nome de anfitrião ou a passagem para HTTPS, os identificadores dos utilizadores não mudam. Defina o novo `OIDC_ISSUER_URL` e execute:

```bash
openldr auth rebind-issuer --force
```

Sem `--force`, o comando mostra os dois emissores e não altera nada. Com `--force`, regista um evento de auditoria `auth.issuer.rebind`. Não o use para mudar para outro fornecedor. Não existe migração automática de contas. Transferir identidades entre fornecedores, mapear sujeitos e restaurar identidades exige outro procedimento aprovado pelo operador. Os comandos de migração da base continuam disponíveis sem iniciar serviços autenticados.

Veja [Variáveis de ambiente](/docs/environment), [Utilizadores e funções](/docs/users) e [Sincronização distribuída](/docs/sync).

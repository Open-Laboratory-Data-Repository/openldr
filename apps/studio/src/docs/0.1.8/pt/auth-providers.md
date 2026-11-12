# Fornecedores de autenticação

OpenLDR suporta Keycloak e OpenID Connect genérico, ou OIDC, para iniciar sessão. O OIDC genérico usa a descoberta do fornecedor e tokens de acesso JWT assinados. Não suporta tokens de acesso opacos.

Use um novo ambiente para um novo fornecedor de identidade. Uma base existente pertence ao emissor e aos sujeitos originais do fornecedor. Nomes de utilizador iguais não tornam intercambiáveis contas de fornecedores diferentes.

As imagens de configuração estão identificadas como ilustrações. As capturas de início de sessão usam um fornecedor Keycloak real e isolado em modo OIDC genérico, com autenticação obrigatória. O seu fornecedor pode ter outra página. Isto comprova o percurso local de teste, não todos os ambientes.

A configuração inicial exige acesso de administração ao servidor e ao fornecedor. Studio usa um cliente público de navegador e código de autorização com PKCE. PKCE liga a troca do código ao navegador que iniciou a sessão. Não atribua um segredo de cliente a Studio.

## Configurar um novo ambiente OIDC genérico

Registe primeiro o cliente de navegador no fornecedor. Use o emissor, a audiência, os âmbitos e o identificador de cliente reais. Mantenha privada a configuração do servidor.

### 1. Registar o cliente de navegador

Use código de autorização com PKCE. Registe `https://YOUR_HOST/studio/auth/callback` como URI de redirecionamento e `https://YOUR_HOST/studio` como URI de regresso após terminar sessão. Permita a origem de Studio para descoberta e pedidos de tokens no navegador.

![Ilustração. Registar um cliente público de navegador com PKCE no fornecedor.](auth-providers-guide-client-registration.png)

### 2. Escolher o modo genérico

No .env do ambiente, defina `AUTH_ADAPTER=oidc` e `IDENTITY_ADMIN_ADAPTER=none`. OIDC genérico não pode usar a administração Keycloak.

![Ilustração. Escolher OIDC genérico sem administração do fornecedor.](auth-providers-guide-auth-mode.png)

### 3. Definir o emissor, a audiência e o identificador de cliente

Preencha OIDC_ISSUER_URL, OIDC_AUDIENCE e OIDC_WEB_CLIENT_ID segundo o fornecedor. Os tokens de acesso têm de conter o emissor e a audiência esperados. Um token de identidade não é um token de acesso à API.

![Ilustração. Usar os valores de emissor, audiência e cliente fornecidos pelo fornecedor.](auth-providers-guide-issuer-settings.png)

### 4. Verificar os âmbitos e o recurso pedidos

OIDC_SCOPES usa `openid profile email` por predefinição. Mantenha openid e acrescente os âmbitos API necessários. Defina OIDC_RESOURCE apenas se o fornecedor exigir um indicador de recurso. OpenLDR não o deduz da audiência.

![Ilustração. Manter openid e acrescentar apenas os âmbitos ou recurso necessários.](auth-providers-guide-scopes.png)

### 5. Recriar o serviço afetado

Aplique a configuração de arranque com o comando habitual do ambiente. Confirme que o fornecedor publica os metadados de descoberta e as chaves de assinatura. Mantenha AUTH_DEV_BYPASS desligado.

![Ilustração. Recriar a aplicação após alterar a configuração de arranque.](auth-providers-guide-restart.png)

**Resultado esperado:** o navegador está configurado para iniciar sessão no fornecedor. Um ficheiro de configuração válido, por si só, não comprova um início de sessão bem-sucedido.

## Iniciar sessão através do fornecedor

Abra Studio no endereço público configurado. O exemplo usa uma conta fictícia no fornecedor isolado.

### 1. Abrir Studio

Studio redireciona para o fornecedor configurado. Confirme que chegou ao fornecedor esperado antes de introduzir credenciais.

![Studio redireciona para o fornecedor de identidade configurado.](auth-providers-guide-provider.png)

### 2. Introduzir o nome de utilizador

Use a conta fornecida pela organização. O exemplo usa `guide.operator`.

![Introduzir o nome de utilizador do fornecedor.](auth-providers-guide-username.png)

### 3. Introduzir a palavra-passe do fornecedor

Use o método de início de sessão do fornecedor. A palavra-passe permanece oculta na captura. Outros fornecedores podem exigir autenticação adicional.

![Introduzir a palavra-passe do fornecedor. Permanece oculta.](auth-providers-guide-password.png)

### 4. Escolher Sign In

Selecione a ação de início de sessão do fornecedor. Uma troca de código bem-sucedida regressa a Studio.

![O início de sessão autentica através do fornecedor real.](auth-providers-guide-sign-in.png)

### 5. Verificar o acesso inicial

O primeiro início de sessão cria uma conta local. Não concede acesso de administrador. O exemplo mostra Access denied na página pedida e continua a oferecer Docs e a navegação disponível.

![O primeiro início de sessão cria uma conta local sem acesso de administrador.](auth-providers-guide-first-access.png)

**Resultado esperado:** o fornecedor autenticou a conta. As permissões da aplicação continuam a vir dos papéis locais.

## Dar acesso local ao primeiro administrador

No servidor, identifique a conta criada no primeiro início de sessão. Use o sujeito exato do fornecedor, não o nome de utilizador nem o identificador local.

### 1. Encontrar o sujeito da conta

A partir de `openldr_ce`, execute `pnpm openldr user list`. Confirme que o sujeito corresponde à conta pretendida no fornecedor. Leia [Começar aqui](/docs/start-here) para configurar a CLI.

![Ilustração. Encontrar a conta local após o primeiro início de sessão.](auth-providers-guide-list-subject.png)

### 2. Atribuir o papel de administrador

Execute `pnpm openldr user assign-role SUBJECT lab_admin` com esse sujeito exato. Isto altera o acesso a OpenLDR. Não torna o utilizador administrador do fornecedor.

![Ilustração. Atribuir o papel de administrador ao sujeito exato do fornecedor.](auth-providers-guide-grant-role.png)

### 3. Verificar o acesso concedido

Inicie sessão novamente ou recarregue a aplicação autenticada e verifique as páginas de administração permitidas. No teste, Users aparece após atribuir o papel local.

![Após atribuir o papel local, Studio mostra as páginas de administração permitidas.](auth-providers-guide-admin-access.png)

**Resultado esperado:** a conta local escolhida tem o papel atribuído. O comando CLI do teste terminou com sucesso e a página real Users abriu.

## Gerir acesso local sem administrar o fornecedor

OIDC genérico mantém os papéis e controlos de acesso locais. A criação de contas, edição de perfis, reposição de palavras-passe e sessões permanecem no fornecedor de identidade.

### 1. Abrir Users

Selecione **Users**. Leia o aviso sobre administração do fornecedor acima da tabela.

![OIDC genérico mantém os controlos locais sem administração das contas do fornecedor.](auth-providers-guide-users.png)

### 2. Verificar a conta pretendida

Confirme o nome de utilizador e a informação de identidade disponível antes de alterar o acesso local.

![Verificar a identidade do fornecedor antes de alterar papéis locais.](auth-providers-guide-user-row.png)

### 3. Usar as ações locais da linha

Abra os pontos da linha. **Edit role** altera os papéis OpenLDR. Disable bloqueia esta conta em OpenLDR. Não desativa a conta nem termina as sessões do fornecedor.

![A linha oferece ações locais de papéis e acesso.](auth-providers-guide-local-actions.png)

**Resultado esperado:** a administração dos utilizadores do fornecedor está indisponível neste modo. Gira contas e palavras-passe através do administrador do fornecedor.

## Terminar sessão em Studio

Use o menu de utilizador da aplicação. O fim da sessão do fornecedor depende dos metadados de saída do fornecedor.

### 1. Abrir o menu de utilizador

Selecione o menu de utilizador no canto inferior esquerdo.

![Abrir o menu de utilizador para terminar sessão.](auth-providers-guide-user-menu.png)

### 2. Escolher Sign out

Selecione **Sign out**. Studio limpa a sua sessão e usa a saída do fornecedor quando disponível.

![Sign out limpa a sessão da aplicação e usa a saída do fornecedor quando disponível.](auth-providers-guide-sign-out.png)

### 3. Verificar o estado obtido

Neste teste, o fornecedor terminou a sessão e exige um novo início. Sem um endereço de saída publicado na descoberta, apenas a sessão local é limpa. A sessão do fornecedor pode permanecer ativa.

![Este fornecedor terminou a sessão e exige um novo início.](auth-providers-guide-signed-out.png)

## Verificar uma alteração de emissor antes de reassociar

Uma alteração de emissor bloqueia o arranque autenticado numa base já associada. Preserve o emissor ao restaurar um ambiente.

### 1. Ler a recusa antes de forçar

Se o mesmo fornecedor mudou de endereço, defina o emissor pretendido e execute primeiro `pnpm openldr auth rebind-issuer` sem --force. O comando indica a diferença e recusa alterar. Um fornecedor diferente exige um procedimento de associação de identidades.

![Ilustração. Reassociar apenas quando o mesmo fornecedor mudou sem alterar os sujeitos.](auth-providers-guide-issuer-rebind.png)

**Resultado esperado:** apenas uma mudança de endereço revista, com sujeitos inalterados, pode usar a reassociação forçada. O teste ilustrado exercitou a recusa, não uma alteração forçada de identidade.

## Ler as indicações de autenticação num telemóvel

A página de documentação autenticada adapta-se à largura do telemóvel.

### 1. Abrir o guia

Leia o guia de fornecedores de autenticação em Docs. A disposição do início de sessão vem do fornecedor e exige a sua própria verificação no telemóvel.

![A documentação autenticada continua legível no telemóvel.](auth-providers-guide-phone-docs.png)

## Escolher os modos de sessão e administração

A administração usa keycloak por predefinição no modo Keycloak e none no modo genérico. A autenticação genérica com administração Keycloak é recusada. Distinga o cliente público de navegador do cliente confidencial de administração.

| Configuração | Início de sessão | Administração do fornecedor |
| --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administração omitida ou keycloak | Metadados dos endereços Keycloak | Disponível apenas com credenciais de administração configuradas. A criação de clientes de sincronização usa Keycloak. |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Metadados dos endereços Keycloak | Indisponível. Os papéis e acessos locais permanecem disponíveis. |
| `AUTH_ADAPTER=oidc`, administração omitida ou none | Descoberta OIDC | Indisponível. A criação genérica de acessos máquina a máquina para sincronização fica fora desta configuração. |

## Endereços internos e verificação de tokens

OIDC_INTERNAL_JWKS_URL permite configurar explicitamente um endereço interno de chaves de assinatura. Não altera o emissor esperado. OIDC_INTERNAL_ISSUER_URL é específico de Keycloak. O modo genérico não deriva endereços desse valor. Remova definições antigas exclusivas de Keycloak do ambiente genérico.

OpenLDR verifica a assinatura, o emissor, a audiência e a validade do token de acesso API. A sessão do navegador usa os âmbitos configurados e o recurso opcional. Iniciar sessão no fornecedor não garante que a API recebe o token pretendido.

## Preservar o espaço de identidades

OpenLDR associa a base da aplicação ao emissor antes do arranque autenticado. Não replica essa associação pela sincronização de definições. Alterar o URL pode alterar o espaço de identidades mesmo com nomes de utilizador iguais.

Na primeira atualização com proteção de emissor, preserve OIDC_ISSUER_URL. Os registos históricos de utilizadores não provam que emissor os criou. A primeira associação regista o valor configurado e não deteta um erro de configuração anterior.

Se o mesmo fornecedor mudou de endereço sem alterar qualquer sujeito, um `pnpm openldr auth rebind-issuer --force` revisto altera a associação e regista auth.issuer.rebind. Não é uma migração automática de contas. Mudar de fornecedor, reassociar sujeitos ou restaurar identidades exige um procedimento separado e revisto. Os comandos de migração da base continuam disponíveis sem arranque autenticado.

## Resolução de problemas

**Servidor inacessível.** Verifique a API e a rota de configuração pública. Uma página de início de sessão do fornecedor não prova que a API está disponível.

**O início de sessão tem sucesso mas Studio recusa acesso.** Verifique o sujeito da conta local e o papel atribuído. O primeiro início de sessão não concede lab_admin.

**Token recusado.** Compare o emissor, a audiência, as chaves, a validade, os âmbitos e o recurso com a configuração real do token de acesso. Não cole tokens em registos partilhados ou capturas.

**Redirecionamento recusado.** Verifique o URI /studio/auth/callback registado e a origem pública exata.

**Emissor diferente no arranque.** Restaure o emissor original. Force a reassociação apenas para o mesmo fornecedor deslocado sem alterar os sujeitos.

**Falta criação de utilizador, reposição de palavra-passe ou inscrição de sincronização.** O modo genérico não administra o fornecedor. Use o fornecedor de identidade para as contas e sessões.

## Limites da verificação de autenticação

O teste real usou descoberta OIDC genérica, código de autorização com PKCE, verificação de tokens JWT e atribuição local de papéis num domínio Keycloak isolado. O desvio de autenticação estava desligado. Não houve respostas simuladas no navegador ou na API.

A conta fictícia foi desativada e as sessões revogadas após as capturas. As palavras-passe, credenciais de administração do cliente e tokens ficaram fora do repositório. Este teste não certifica outro fornecedor, TLS de produção, autenticação multifator, renovação silenciosa ou recuperação durante falhas.

## Guias relacionados

[Variáveis de ambiente](/docs/environment), [Utilizadores](/docs/users), [Papéis](/docs/roles) e [Sincronização distribuída](/docs/sync).

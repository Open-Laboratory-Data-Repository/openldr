# Fornecedores de autenticação

O OpenLDR pode iniciar a sessão das pessoas de três formas: com as suas próprias contas, através do Keycloak, ou através de um fornecedor OpenID Connect genérico, ou OIDC. `AUTH_ADAPTER` escolhe uma delas. Se não estiver definido, vale `keycloak`. O modo genérico exige descoberta OIDC e tokens de acesso JWT assinados. Tokens opacos não são aceites. Este guia não certifica a configuração de um segundo fornecedor.

## Escolher um modo de início de sessão

| Modo | Onde ficam as contas e as palavras-passe | Escolha-o quando |
| --- | --- | --- |
| `AUTH_ADAPTER=local` | Na base de dados do próprio OpenLDR. Não corre mais nenhum serviço. | Um laboratório gere a sua própria instalação e só precisa de nomes de utilizador e palavras-passe. É a opção mais simples e a que gasta menos memória. |
| `AUTH_ADAPTER=keycloak` | No Keycloak, um serviço separado que corre ao lado do OpenLDR. | A instalação é um central de sincronização, ou já usa o Keycloak. Inscrever sites de sincronização exige administração Keycloak. |
| `AUTH_ADAPTER=oidc` | Num fornecedor que já tem, como um início de sessão nacional. | As pessoas têm de usar um início de sessão existente. O OpenLDR não pode criar essas contas nem repor as suas palavras-passe. |

Escolha antes do primeiro arranque. A base de dados guarda o modo de início de sessão do primeiro arranque e recusa arrancar com outro. Não há forma de passar as contas de uma instalação existente do Keycloak ou do OIDC para o início de sessão local.

## Escolher autenticação e administração

| Configuração | Início de sessão | Administração do fornecedor | Criação de clientes de sincronização |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=local`, administração omitida ou `local` | Contas do próprio OpenLDR | Disponível no Studio e na CLI | Indisponível |
| `AUTH_ADAPTER=keycloak`, administração omitida ou `keycloak` | Metadados Keycloak | Com credenciais administrativas | Apenas Keycloak |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Metadados Keycloak | Indisponível | Indisponível |
| `AUTH_ADAPTER=oidc`, administração omitida ou `none` | Descoberta OIDC | Indisponível | Indisponível |

Por predefinição, `IDENTITY_ADMIN_ADAPTER` é `keycloak` para Keycloak, `local` para o início de sessão local e `none` para OIDC genérico. A combinação de OIDC genérico com administração Keycloak é rejeitada. O início de sessão local só aceita `local` ou nenhum valor.

## Configurar o início de sessão local

Use uma base de dados nova. Defina isto no `.env`:

```dotenv
AUTH_ADAPTER=local
SECRETS_ENCRYPTION_KEY=YOUR_KEY
```

`SECRETS_ENCRYPTION_KEY` é obrigatória. O servidor sela com ela a sua chave de assinatura de tokens, e recusa arrancar com início de sessão local sem ela. `OIDC_ISSUER_URL` e as definições do Keycloak não são usados. Deixe `IDENTITY_ADMIN_ADAPTER` por definir. Veja [Variáveis de ambiente](/docs/environment) para a chave.

### Criar o primeiro administrador com um código de configuração

Uma instalação nova não tem contas. Enquanto o primeiro administrador não existir, o Studio mostra a página **Criar o administrador** a quem o abrir. A página pede um código de configuração. Só quem tem acesso ao servidor consegue obter um, por isso um estranho na rede do laboratório não pode ficar com a instalação primeiro.

1. Arranque o OpenLDR.
2. No servidor, execute `openldr auth setup-code`. O comando mostra um código válido durante 30 minutos. Use a forma instalada ou de desenvolvimento do comando, descrita em [Interface de linha de comandos](/docs/cli).
3. Abra o Studio. Abre-se a página **Criar o administrador**.
4. Escreva o código em **Código de configuração**, depois um nome de utilizador, depois a palavra-passe duas vezes.
5. Selecione **Criar o administrador**.

O Studio inicia a sua sessão com a função bloqueada **Administrator**. A página de configuração não volta a aparecer, e `openldr auth setup-code` passa a recusar com `an administrator already exists`.

Executar o comando de novo substitui o código anterior. Um código errado ou expirado mostra **Este código de configuração está errado ou expirou.** Um nome de utilizador já usado mostra **Esse nome de utilizador já está em uso.** Enquanto a configuração não terminar, o `openldr doctor` mostra um aviso na sua linha Sign-in.

### Regras das palavras-passe e das sessões

Estes valores são fixos. Não são definições.

- Uma palavra-passe tem de 10 a 128 caracteres e não pode ser o nome de utilizador. Não há regra sobre tipos de caracteres, e as palavras-passe não expiram.
- Cinco palavras-passe erradas seguidas bloqueiam a conta durante cinco minutos. Um bloqueio acaba sempre por si. Um início de sessão certo ou uma reposição feita por um administrador põe a contagem a zero.
- Cada endereço tem direito a 30 tentativas de início de sessão por minuto. Um endereço IPv6 conta pelo seu /64. A contagem fica em memória em cada servidor.
- Uma sessão termina após 12 horas sem uso, ou 7 dias depois de iniciar sessão, o que acontecer primeiro.
- Alterar a própria palavra-passe termina as outras sessões e mantém a sessão atual.
- Uma reposição feita por um administrador define uma palavra-passe temporária e termina as sessões desse utilizador. O utilizador tem de escolher uma nova palavra-passe no próximo início de sessão.
- A reposição da palavra-passe por e-mail não está disponível. O Studio esconde **Enviar e-mail de reposição**.

Uma palavra-passe errada, uma conta bloqueada e uma conta desativada recebem todas a mesma mensagem, por isso a página de início de sessão não revela se uma conta existe.

### Palavras-passe em HTTP simples

Em HTTP simples, uma palavra-passe atravessa a rede sem cifra. Quem consiga observar o tráfego entre um navegador e o servidor pode lê-la. Sirva o Studio em HTTPS, ou aceda-lhe só através do Tailscale, que cifra o tráfego entre dispositivos. O cookie de sessão só fica marcado como `Secure` quando um pedido chega por HTTPS, por isso o HTTP simples funciona na mesma. Não é privado.

### O que o início de sessão local não faz

- Não há segundo fator.
- Não há reposição da palavra-passe por e-mail.
- Não há registo livre. Um administrador junta cada pessoa.
- Não é possível passar uma instalação Keycloak ou OIDC existente para o início de sessão local.
- Não há inscrição de sincronização. Uma instalação com início de sessão local não pode ser um central de sincronização.

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

Esta secção é para Keycloak e OIDC genérico. Com início de sessão local, o código de configuração cria o primeiro administrador.

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

## Resolução de problemas do início de sessão local

- **O último administrador esqueceu-se da palavra-passe.** No servidor, execute `openldr user reset-password <username> --force`. O comando mostra uma só vez uma palavra-passe temporária e termina as sessões desse utilizador. Inicie sessão com ela e escolha uma nova palavra-passe. O nome de utilizador tem de estar exato, incluindo maiúsculas. `openldr users list` mostra todos os nomes de utilizador. Sem `--force`, o comando não altera nada.
- **`openldr auth setup-code` responde `an administrator already exists`.** A configuração está feita. Inicie sessão, ou recupere uma palavra-passe perdida como acima.
- **`openldr auth setup-code` responde `local sign-in is not enabled`.** `AUTH_ADAPTER` não é `local` no ambiente do servidor.
- **O servidor recusa arrancar depois de definir `AUTH_ADAPTER=local`, e indica dois emissores diferentes.** A base de dados arrancou primeiro com Keycloak ou OIDC. Passar uma instalação de um modo de início de sessão para outro não é suportado. Arranque o início de sessão local numa base nova. `openldr auth rebind-issuer` não ajuda aqui, porque serve apenas para um fornecedor que mudou de endereço.
- **O servidor recusa arrancar e mostra `SECRETS_ENCRYPTION_KEY is required when AUTH_ADAPTER=local`.** Defina a chave e arranque de novo.
- **Uma função dada com `openldr user assign-role` não tem efeito.** O comando recebe o ID do utilizador, não o nome de utilizador. Com um nome de utilizador, indica sucesso e não concede nada. `openldr user create` mostra o ID, e `openldr users list` mostra-o no início de cada linha.

Veja [Variáveis de ambiente](/docs/environment) e [Interface de linha de comandos](/docs/cli).

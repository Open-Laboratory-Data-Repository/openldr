# Fornecedores de autenticação

O OpenLDR pode iniciar a sessão das pessoas de três formas: com as suas próprias contas, através do Keycloak, ou através de um fornecedor OpenID Connect genérico, ou OIDC. `AUTH_ADAPTER` escolhe uma delas. Se não estiver definido, vale `keycloak`. O modo genérico exige descoberta OIDC e tokens de acesso JWT assinados. Tokens opacos não são aceites. Este guia não certifica a configuração de um segundo fornecedor.

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. Os exemplos de configuração indicam o ficheiro a editar; não são comandos de terminal. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

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
- O cookie de sessão não tem data de expiração. Por isso, fechar o navegador termina a sessão do utilizador nesse navegador, a não ser que o navegador esteja configurado para reabrir a última sessão. Os limites de 12 horas e de 7 dias continuam a aplicar-se.
- Alterar a própria palavra-passe termina as outras sessões e mantém a sessão atual.
- Uma reposição feita por um administrador define uma palavra-passe temporária e termina as sessões desse utilizador. O utilizador tem de escolher uma nova palavra-passe no próximo início de sessão, diferente da temporária.
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

Use uma instalação nova sem identidades ligadas a outro emissor. Keycloak só é o padrão quando `AUTH_ADAPTER` não está definido. OIDC genérico exige descoberta e tokens JWT assinados; tokens opacos não são suportados. Não certifica fornecedores externos. Capturas do primeiro início de sessão continuam adiadas.

### 1. Registar o cliente navegador no fornecedor

Substitua YOUR_HOST. PKCE liga a troca ao navegador inicial. Permita a origem Studio para descoberta e tokens. Não dê um segredo de cliente ao Studio. Ecrãs variam; isto é um exemplo de configuração.

```text
{{operator:auth-client}}
```

![Registar o cliente navegador no fornecedor.](guide:operator-auth-client)

### 2. Definir valores no ficheiro de ambiente

Substitua emissor, audiência e identificador. Mantenha openid; acrescente âmbitos API e OIDC_RESOURCE apenas se necessário. O token de acesso deve incluir a audiência. Um ID token não é um token API. Retire parâmetros Keycloak antigos. OIDC_INTERNAL_ISSUER_URL é ignorado no modo genérico. OIDC_INTERNAL_JWKS_URL muda onde obter chaves, não o emissor esperado.

```text
{{operator:auth-config}}
```

![Definir valores no ficheiro de ambiente.](guide:operator-auth-config)

### 3. Recriar a API e ler o arranque

Resolva erros de configuração ou descoberta. OpenLDR verifica assinatura, emissor, audiência e validade. Sem endpoint de saída, limpa a sessão local mas a do fornecedor pode continuar. Teste o início de sessão separadamente na instalação nova.

```sh
{{operator:auth-recreate}}
```

![Recriar a API e ler o arranque.](guide:operator-auth-recreate)

## Dar acesso administrativo a uma conta identificada

Esta secção é para Keycloak e OIDC genérico. Com início de sessão local, o código de configuração cria o primeiro administrador.

A conta deve já ter feito a primeira autenticação e existir localmente. Isso não dá administração automaticamente. Esta tarefa pressupõe esse passo, sem descrever o início de sessão.

### 1. Ler a conta e o sujeito do fornecedor

Confirme o sujeito no fornecedor. Não confunda com ID local ou nome. Mantenha a saída privada.

```sh
{{operator:auth-users}}
```

![Ler a conta e o sujeito do fornecedor.](guide:operator-auth-users)

### 2. Atribuir o papel administrativo local

Substitua SUBJECT pelo sujeito verificado. Altera autorização local. Verifique o acesso resultante. Alterações seguintes usam este comando ou ações de utilizador Studio.

```sh
{{operator:auth-role}}
```

![Atribuir o papel administrativo local.](guide:operator-auth-role)

## Preservar o emissor de uma base existente

A base liga-se ao emissor antes de iniciar serviços autenticados. Mantenha-o ao atualizar e restaurar. Nomes não provam identidade histórica. A ligação é local e não se replica pela sincronização. Outro fornecedor exige migração explícita.

### 1. Examinar a mudança sem a aplicar

Só se o mesmo fornecedor mudar de endereço ou protocolo, defina o novo URL e examine os valores antigo/novo. Sem --force não altera a ligação divergente. Resolva primeiro migrações pendentes.

```sh
{{operator:auth-rebind-review}}
```

![Examinar a mudança sem a aplicar.](guide:operator-auth-rebind-review)

### 2. Confirmar apenas uma identidade de fornecedor inalterada

Use --force apenas para o mesmo fornecedor e sujeitos inalterados. Não é um atalho para mudar de fornecedor. Alterações registam auth.issuer.rebind. Reinicie e verifique separadamente. Este guia não executa a alteração no anfitrião.

```sh
{{operator:auth-rebind}}
```

![Confirmar apenas uma identidade de fornecedor inalterada.](guide:operator-auth-rebind)

## Resolução de problemas do início de sessão local

- **O último administrador esqueceu-se da palavra-passe.** No servidor, execute `openldr user reset-password <username> --force`. O comando mostra uma só vez uma palavra-passe temporária e termina as sessões desse utilizador. Inicie sessão com ela e escolha uma nova palavra-passe. O nome de utilizador tem de estar exato, incluindo maiúsculas. `openldr users list` mostra todos os nomes de utilizador. Sem `--force`, o comando não altera nada.
- **`openldr auth setup-code` responde `an administrator already exists`.** A configuração está feita. Inicie sessão, ou recupere uma palavra-passe perdida como acima.
- **`openldr auth setup-code` responde `local sign-in is not enabled`.** `AUTH_ADAPTER` não é `local` no ambiente do servidor.
- **O servidor recusa arrancar depois de definir `AUTH_ADAPTER=local`, e indica dois emissores diferentes.** A base de dados arrancou primeiro com Keycloak ou OIDC. Passar uma instalação de um modo de início de sessão para outro não é suportado. Arranque o início de sessão local numa base nova. `openldr auth rebind-issuer` não ajuda aqui, porque serve apenas para um fornecedor que mudou de endereço.
- **O servidor recusa arrancar e mostra `SECRETS_ENCRYPTION_KEY is required when AUTH_ADAPTER=local`.** Defina a chave e arranque de novo.
- **Uma função dada com `openldr user assign-role` não tem efeito.** O comando recebe o ID do utilizador, não o nome de utilizador. Com um nome de utilizador, indica sucesso e não concede nada. `openldr user create` mostra o ID, e `openldr users list` mostra-o no início de cada linha.

Veja [Variáveis de ambiente](/docs/environment) e [Interface de linha de comandos](/docs/cli).

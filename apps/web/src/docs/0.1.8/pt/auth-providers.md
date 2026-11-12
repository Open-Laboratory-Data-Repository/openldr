# Fornecedores de autenticação

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. Os exemplos de configuração indicam o ficheiro a editar; não são comandos de terminal. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

## Escolher autenticação e administração

| Configuração | Início de sessão | Administração do fornecedor | Criação de clientes de sincronização |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administração omitida ou `keycloak` | Metadados Keycloak | Com credenciais administrativas | Apenas Keycloak |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Metadados Keycloak | Indisponível | Indisponível |
| `AUTH_ADAPTER=oidc`, administração omitida ou `none` | Descoberta OIDC | Indisponível | Indisponível |

Por predefinição, `IDENTITY_ADMIN_ADAPTER` é `keycloak` para Keycloak e `none` para OIDC genérico. A combinação de OIDC genérico com administração Keycloak é rejeitada.

Sem administração do fornecedor, gira contas, palavras-passe e sessões no fornecedor. O OpenLDR não pode criar, editar ou eliminar esses utilizadores, redefinir palavras-passe ou revogar sessões do fornecedor. A atribuição de funções locais e a desativação/reativação local continuam disponíveis no Studio e na CLI. A desativação local bloqueia o OpenLDR, sem desativar a conta do fornecedor. A criação de clientes de sincronização distribuída ainda exige administração Keycloak. A sincronização genérica entre máquinas está fora desta configuração suportada.

## Configurar um fornecedor genérico

Use uma instalação nova sem identidades ligadas a outro emissor. Keycloak continua o padrão. OIDC genérico exige descoberta e tokens JWT assinados; tokens opacos não são suportados. Não certifica fornecedores externos. As capturas do primeiro início de sessão Keycloak estão em [Instalar](/docs/install).

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

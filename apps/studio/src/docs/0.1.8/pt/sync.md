# Sincronização distribuída

Distributed sync liga uma instalação de laboratório a uma instalação central do OpenLDR. O laboratório envia os registos clínicos. O central fornece a configuração e a terminologia partilhadas para leitura no laboratório.

Precisa de **View sync** para ler estados e eventos. **Manage sync** permite configurar, gerir sites e decidir sobre divergências. O central inscreve laboratórios em Settings, Sites. O laboratório configura a ligação em Settings, Distributed sync.

Para uma ligação real, obtenha o identificador do site, URL central, emissor OIDC, identificador do cliente e segredo único na inscrição central. Esta exige administração de clientes Keycloak. Mantenha os valores privados e use HTTPS.

As imagens mostram as definições reais e um central local deliberadamente indisponível. Os exemplos verificam a configuração e a consulta de falhas. Não mostram uma transferência bem-sucedida nem inventam credenciais de inscrição. Não precisa de ficheiros de exemplo.

## Verificar se a inscrição central está disponível

O administrador central tem de inscrever o laboratório antes de o operador configurar uma ligação real.

### 1. Abrir Sites no central

Abra **Settings** e depois **Sites**.

![O central gere os laboratórios inscritos em Settings, Sites.](sync-guide-sites.png)

### 2. Verificar a administração do fornecedor

A inscrição exige administração de clientes Keycloak. Esta instalação isolada indica que está indisponível e não pode emitir um segredo real. Configure o serviço de identidade central antes de uma ligação real.

![Esta instalação isolada não tem administração de clientes do fornecedor. A inscrição está indisponível.](sync-guide-admin-unavailable.png)

**Resultado esperado:** um central configurado oferece Enroll site. O exemplo para antes da inscrição porque a administração de clientes está indisponível.

## Introduzir os valores de inscrição no laboratório

Use os valores emitidos pelo administrador central. Os valores das capturas apontam apenas para um serviço local de teste inexistente.

### 1. Abrir Distributed sync

No laboratório, abra **Settings** e depois **Distributed sync**.

![O laboratório configura a ligação em Settings, Distributed sync.](sync-guide-open.png)

### 2. Escolher Settings

Mantenha o separador **Settings**.

![Mantenha Settings para configurar o laboratório.](sync-guide-settings.png)

### 3. Verificar Enable sync

Mantenha **Enable sync** desligado enquanto introduz os valores. Ative-o quando estiverem prontos. Desligado, mantém ambos os processos inativos.

![Enable sync controla a execução dos processos de envio e receção.](sync-guide-enabled.png)

### 4. Escolher Direction

Use Push to central apenas para dados do laboratório, Pull from central apenas para configuração partilhada ou **Bidirectional** para ambos.

![Escolha Push to central, Pull from central ou Bidirectional.](sync-guide-direction.png)

### 5. Introduzir Central URL

Use o endereço público HTTPS fornecido na inscrição. A imagem usa um endereço local HTTP ausente e não representa uma configuração de produção.

![Use o endereço central acessível fornecido na inscrição. Esta imagem usa um endereço local de teste ausente.](sync-guide-central.png)

### 6. Introduzir Site ID

Use o identificador estável atribuído pelo central. Não invente outro identificador para um cliente inscrito.

![Use o identificador exato do site inscrito.](sync-guide-site.png)

## Introduzir as credenciais do site e guardar

Continue no separador Sync Settings. Use as credenciais fornecidas pelo central para este laboratório. Deixe um segredo existente vazio apenas para o manter.

### 1. Introduzir o emissor e o identificador do cliente

Copie **OIDC issuer URL** e **Client ID** exatamente da inscrição central.

![Use o emissor OIDC e o identificador do cliente fornecidos pelo central.](sync-guide-issuer.png)

### 2. Introduzir o segredo único

Preencha **Client secret**. O campo está oculto e só permite escrita. A captura contém um valor fictício que não permite autenticar.

![Introduza o segredo único. Continua oculto. Este valor fictício é inutilizável.](sync-guide-secret.png)

### 3. Definir o intervalo

Escolha **Sync interval (minutes)** entre 1 e 1440. A predefinição é 15.

![Escolha um intervalo de sincronização entre 1 e 1440 minutos.](sync-guide-interval.png)

### 4. Abrir as ações do separador

Ative Enable sync quando estiver pronto e abra os pontos da barra de separadores.

![Os pontos da barra de separadores contêm Save.](sync-guide-actions.png)

### 5. Guardar a configuração

Selecione **Save**. As alterações iniciam, param ou reconfiguram os processos de imediato, sem reiniciar a API.

![Save aplica a configuração sem reiniciar a API.](sync-guide-save.png)

**Resultado esperado:** uma ligação válida consegue autenticar e transferir dados. Uma notificação de gravação prova que as definições foram aceites, não que o central foi alcançado.

## Ler a atividade real de sincronização

Use Activity para determinar se a ligação guardada funciona.

### 1. Abrir Activity

Selecione o separador **Activity**. Leia os estados de envio e receção, Pending push, Last checked e Last success.

![Activity mostra o estado atual dos processos e os eventos.](sync-guide-activity.png)

### 2. Pedir um ciclo

Abra os pontos do separador e escolha **Sync now** para pedir um ciclo imediato. Não executa um ciclo com a sincronização desligada.

![Sync now pede um ciclo imediato.](sync-guide-now.png)

### 3. Ler a linha do evento

Leia o evento, a direção, o número de registos e o detalhe. Este exemplo regista uma falha real porque o central local não existe.

![O central local ausente produz um evento de falha real, não uma ligação bem-sucedida.](sync-guide-failed-row.png)

### 4. Abrir o evento

Selecione a linha para abrir o painel **Sync event**.

![Abra um evento para ler o erro completo e os metadados.](sync-guide-detail.png)

### 5. Ler o erro completo

Leia o erro e os metadados. Corrija o problema específico de ligação, identidade ou dados antes de repetir.

![Leia a falha de rede real antes de alterar as definições.](sync-guide-error.png)

**Resultado esperado:** uma ligação bem-sucedida mostra eventos com sucesso, cursores a avançar e menos registos em espera. O exemplo comprova apenas a visibilidade das falhas.

## Parar a sincronização e editar em segurança

Use o interruptor geral para suspender ambos os processos sem remover os valores de ligação guardados.

### 1. Guardar com Enable sync desligado

Feche o evento, regresse a Settings, desligue Enable sync e abra os pontos para escolher Save.

![Guardar com Enable sync desligado para ambos os processos.](sync-guide-disable-save.png)

### 2. Manter o segredo guardado ao editar

Reabra ou recarregue Settings. O segredo continua vazio com a indicação de segredo guardado. Deixe-o vazio para o manter ao alterar outros campos.

![Um segredo guardado continua vazio ao editar outros campos.](sync-guide-secret-kept.png)

**Resultado esperado:** ambos os processos param. A ligação fictícia de teste permanece desligada após a demonstração.

## Usar as definições de sincronização num telemóvel

O formulário desloca-se verticalmente à largura de um telemóvel. Tabelas largas de eventos podem deslocar-se na sua própria área.

### 1. Ler os campos de ligação

Abra Distributed sync, Settings e desloque até ao campo necessário.

![Os campos de definições ficam empilhados à largura do telemóvel.](sync-guide-phone-settings.png)

### 2. Consultar Activity

Use Activity para o estado atual e os eventos. Abra uma linha para ler o detalhe completo.

![Activity continua disponível num telemóvel.](sync-guide-phone-activity.png)

## Valores fornecidos pela inscrição central

Num central com administração de clientes Keycloak configurada, abra Sites, os pontos e Enroll site. Indique um Site ID estável em minúsculas, um Name opcional e a Central URL pública. A inscrição cria um cliente sync-<siteId> e a associação site_id do token.

O resultado mostra o identificador e segredo do cliente, o emissor OIDC e a URL central. Copie o segredo em privado antes de fechar. Aparece apenas uma vez. Um segredo perdido exige Rotate secret na linha do site e atualização no laboratório. Revoke elimina o cliente e marca o site como revogado.

A conta de serviço central precisa de manage-clients e view-clients no realm Keycloak. Estas operações não foram testadas na instalação isolada. A administração de identidades está desativada de propósito.

## Confiar no TLS central no servidor do laboratório

Aceitar um certificado autoassinado no navegador não o torna fiável para o servidor do laboratório. Descarregue o certificado público central nos pontos de Sites ou no resultado da inscrição e transfira-o para o laboratório pelo canal habitual de administração.

Monte-o apenas de leitura no contentor da API do laboratório e defina NODE_EXTRA_CA_CERTS com esse caminho interno. Recrie a API após alterar o ambiente. O certificado deve corresponder ao nome ou IP central, incluindo o Subject Alternative Name. Mantenha a validação normal de certificados.

Use um endereço central HTTPS de confiança em produção. Um endereço HTTP localhost serve apenas para testes isolados como o exemplo ilustrado. Não foi testada aqui a descarga de certificados nem uma alteração de confiança TLS.

## Usar a CLI

Siga [Começar aqui](/docs/start-here) para configurar a CLI. Em `openldr_ce`, o central usa sync enroll, list, rotate e revoke. Estas credenciais são segredos reais. Não coloque os resultados em registos partilhados ou capturas.

No laboratório, settings sync show oculta o segredo guardado. Defina um campo de cada vez com settings sync set. Sync status e sync now consultam ou pedem processamento real.

```shell
pnpm openldr settings sync show
pnpm openldr sync status
pnpm openldr sync now
pnpm openldr settings sync set enabled false
```

## Resolução de problemas

**A inscrição está indisponível.** Confira as capacidades de administração Keycloak central e as funções da conta de serviço. O OIDC genérico não cria clientes de sincronização.

**A autenticação falha.** Faça corresponder o site, o emissor, o identificador do cliente e o segredo atual à inscrição central. Renove um segredo perdido e atualize o laboratório.

**Erro de certificado.** Confira a confiança no servidor da API do laboratório e a correspondência do endereço do certificado. A exceção do navegador não configura o servidor.

**Activity contém eventos failed, quarantined ou diverged.** Abra o evento e leia o motivo completo. Nem todas as falhas são problemas de rede. Resolva a condição indicada antes de repetir alterações.

**Pending push continua elevado.** Leia Last success e as falhas recentes. Sync now pede um ciclo sem provar o sucesso.

## Guias relacionados

[Fornecedores de autenticação](/docs/auth-providers), [Variáveis de ambiente](/docs/environment) e [Definições](/docs/settings).

# Atividade

Activity permite verificar se um envio recente chegou e o que OpenLDR registou depois. Um envio é um lote de dados, como um pedido webhook ou um lote de ingestão pela CLI.

Use os seus envios recentes. Não são necessários dados de exemplo. As capturas seguem o paciente fictício enviado na instalação de teste de Workflows. Uma instalação vazia pode não ter envios recentes.

Precisa de **View activity**. Esta página lê os eventos registados. Não altera, repete ou elimina os dados. [Auditoria](/docs/audit) regista alterações de utilizadores e administrativas.

## Acompanhar um envio

Use esta tarefa quando um remetente pergunta se os dados chegaram. Tenha à mão o identificador da resposta ou a hora de envio.

### 1. Abrir Activity

Selecione **Activity** no menu principal.

![Abrir Activity para acompanhar envios recentes.](activity-guide-open-page.png)

### 2. Encontrar o envio

Introduza o identificador em **Search payloads...**. A pesquisa também encontra origem, estado ou etapa na lista carregada.

![Pesquisar o identificador do envio para encontrar este pedido.](activity-guide-search.png)

### 3. Verificar a linha correspondente

Confirme a origem e a hora de início. Leia a etapa e o estado atuais. O exemplo chegou a Persisted e Complete.

![Confirmar a origem, a hora de início, a etapa e o estado atuais.](activity-guide-matching-row.png)

### 4. Abrir o ciclo de vida

Selecione a linha para abrir **Payload lifecycle**.

![Selecionar a linha para inspecionar o ciclo de vida registado.](activity-guide-open-row.png)

### 5. Guardar o identificador

Copie o identificador por baixo do título do painel ao comunicar um problema.

![Guardar o identificador ao pedir ajuda a um administrador.](activity-guide-payload-id.png)

### 6. Ler Received

Leia a data e hora de chegada, os detalhes da origem e o identificador da execução associada. Use esse identificador no histórico de Workflows.

![Received regista a chegada e o identificador da execução do workflow.](activity-guide-received.png)

### 7. Ler Persisted

Leia o evento de armazenamento e as contagens de recursos. O exemplo guardou um Patient. Outros workflows podem registar etapas diferentes.

![Persisted regista a contagem de recursos guardados.](activity-guide-persisted.png)

### 8. Regressar à lista

Selecione **Close** no canto superior direito.

![Fechar o painel do ciclo de vida para regressar à lista.](activity-guide-close.png)

**Resultado esperado:** identifica o envio e as etapas que foram registadas para ele.

## Obter o último estado registado

Use Refresh após chegarem novos dados. Feche e reabra o painel para obter os detalhes atuais.

### 1. Abrir Activity actions

Selecione os pontos com o nome **Activity actions**.

![Activity actions contém Refresh.](activity-guide-actions.png)

### 2. Escolher Refresh

Selecione **Refresh**. Reabra a linha para obter os detalhes atualizados do ciclo de vida.

![Refresh volta a obter a lista recente.](activity-guide-refresh.png)

**Resultado esperado:** a lista de envios recentes volta a carregar.

## Mostrar os envios concluídos

Use filtros Status para rever um resultado específico. Os filtros aplicam-se aos envios recentes carregados.

### 1. Abrir Filter

Selecione **Filter**.

![Filter reduz os envios recentes carregados.](activity-guide-filter.png)

### 2. Adicionar uma regra

Selecione **Add filter**.

![Add filter cria uma regra.](activity-guide-add-filter.png)

### 3. Escolher Status

Abra o seletor de coluna e escolha **Status**. Mantenha **Equals**.

![Escolher Status como coluna e manter Equals.](activity-guide-status-rule.png)

### 4. Escolher Complete

Abra o seletor de valor e escolha **Complete**. Escolha outro estado para investigar esse resultado.

![Escolher Complete para inspecionar envios guardados sem execução de workflow falhada.](activity-guide-complete-value.png)

### 5. Aplicar a regra

Selecione **Apply**. A regra aparece acima da tabela.

![Apply atualiza as linhas visíveis.](activity-guide-apply-filter.png)

**Resultado esperado:** as linhas visíveis correspondem à regra Status.

![O filtro Status aplicado aparece acima das linhas correspondentes.](activity-guide-filtered.png)

## Mostrar os inícios mais recentes primeiro

Ordene por hora quando a ordem de chegada importa. A ordenação altera apenas a lista carregada.

### 1. Adicionar uma ordenação

Selecione **Sort** e depois **Add sort**.

![Add sort cria uma regra de ordenação.](activity-guide-add-sort.png)

### 2. Escolher Started

Selecione **Started** nas colunas disponíveis.

![Escolher Started para ordenar pela hora de chegada.](activity-guide-sort-started.png)

### 3. Escolher a ordem descendente

Selecione **Asc** uma vez para mudar para **Desc**.

![Mudar Asc para Desc para mostrar os inícios mais recentes primeiro.](activity-guide-sort-direction.png)

### 4. Aplicar a ordenação

Selecione **Apply**. Os inícios mais recentes aparecem primeiro.

![Apply guarda a ordenação escolhida para as linhas carregadas.](activity-guide-apply-sort.png)

## Escolher as colunas visíveis

Use esta tarefa quando a tabela é mais larga do que a informação necessária.

### 1. Abrir Columns

Selecione **Columns**.

![Columns controla as colunas visíveis da tabela.](activity-guide-columns.png)

### 2. Escolher os campos

Use as caixas das colunas para mostrar ou ocultar campos. Mantenha Payload visível para identificar as linhas. Feche o menu no fim.

![Manter os campos necessários para a revisão.](activity-guide-column-options.png)

### 3. Usar as páginas da tabela

Use o tamanho da página e as setas por baixo da tabela quando a lista carregada ocupa várias páginas.

![Usar o tamanho da página e as setas quando existem várias páginas.](activity-guide-pagination.png)

## Ler um envio num telemóvel

Pesquise primeiro para reduzir a tabela. Desloque horizontalmente para ler as colunas mais à direita.

### 1. Pesquisar envios recentes

Use o campo de pesquisa no topo de Activity.

![Pesquisar envios recentes no telemóvel.](activity-guide-phone-search.png)

### 2. Abrir o envio

Selecione o identificador na linha.

![Selecionar o identificador para abrir o ciclo de vida.](activity-guide-phone-open.png)

### 3. Ler o ciclo de vida

Desloque o painel para ler as etapas registadas e as contagens de recursos.

![Ler cada etapa registada no painel do telemóvel.](activity-guide-phone-detail.png)

## Ler etapas e estados

A barra destaca as etapas até à última registada. Leia o ciclo de vida para ver que eventos existem. A ausência de Validated não prova que todas as verificações anteriores falharam.

Um envio registado não prova que o destinatário aceitou ou leu os dados. Stuck não prova que o processamento parou. Consulte History e os resultados dos nós do workflow.

| Etapa | Significado |
| --- | --- |
| Received | Um lote de ingestão ou workflow registou a chegada. |
| Validated | Um workflow registou uma verificação aprovada. |
| Persisted | Um evento de armazenamento registou recursos guardados. |
| Pushed | Uma etapa registou o envio para outro sistema. |

| Estado | Significado |
| --- | --- |
| Complete | Os dados chegaram ao armazenamento sem execução de workflow falhada registada. |
| Failed | Uma execução de workflow ou lote de ingestão associado falhou. |
| Stuck | Os eventos registados não estabelecem conclusão nem falha. |
| Running | Uma importação ou lote CLI continua ativo. |
| Stopped | Uma importação ou lote CLI foi parado. |

## Compreender a janela do histórico

Activity carrega até 200 envios recentes. A pesquisa, os filtros, a ordenação e a paginação atuam nessas linhas. Não pesquisam toda a base de dados.

O histórico de lotes CLI também tem um limite próprio. Para lotes antigos, use `openldr pipeline status`. Leia [Começar aqui](/docs/start-here) para o lançador instalado ou a forma de desenvolvimento `pnpm openldr pipeline status`. Use a sua pasta real, como `~/Downloads/openldr_ce` ou `C:\openldr_ce`.

## Prática opcional com dados fictícios

Pode acompanhar qualquer envio recebido sem criar mais dados. Para praticar num teste, use o Bundle fictício opcional de [Workflows](/docs/workflows#ficheiros-ficticios-opcionais-de-pratica). Complete os passos do webhook e procure aqui o identificador de correlação devolvido. Não é necessário um exemplo na utilização normal.

## Resolução de problemas

**A lista está vazia.** Limpe a pesquisa e os filtros e escolha Refresh. Consulte as respostas ao remetente e History em Workflows antes de concluir que nada chegou. Os eventos antigos podem ficar fora da janela recente.

**Uma linha indica Failed.** Abra History do workflow e inspecione o nó que falhou. Activity não oferece repetição. Confira os efeitos antes de seguir o procedimento de recuperação do workflow.

**O painel permanece em Loading.** Feche, escolha Refresh e reabra a linha. Se persistir, peça a um administrador que verifique o pedido API e os registos do servidor. O painel não distingue todos os pedidos falhados dos pedidos lentos.

**Refresh apresenta um erro.** Tente mais uma vez. Comunique o erro exato se persistir.

## Guias relacionados

[Workflows](/docs/workflows) explica as execuções e recibos webhook. [Auditoria](/docs/audit) explica os registos de alterações administrativas.

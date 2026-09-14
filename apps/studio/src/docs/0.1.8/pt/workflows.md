# Fluxos de trabalho

Crie e execute processos de dados no editor de fluxos de trabalho.

## Objetivo

Pode abrir um fluxo, navegar pelos seus nós e consultar as execuções.

![Lista de fluxos de trabalho](workflows-list.png)

## Antes de começar

Precisa da função Lab Admin ou Lab Manager. Prepare os
[conectores](/docs/connectors) usados pelos nós.

## Passos

1. Abra Workflows e escolha um fluxo existente ou a ação de criação.
2. Dê um nome ao fluxo e abra o editor.
3. Adicione um acionador e os nós necessários.
4. Ligue os nós pela ordem de execução e configure cada um no painel lateral.
5. Guarde com Save e faça um teste com Run.

![Editor de fluxos e controlos da área de trabalho](workflow-builder.png)

6. Consulte o histórico para verificar os resultados de cada nó.

![Histórico de execuções](workflow-run-history.png)

## Navegar na área de trabalho

- No canto inferior esquerdo, **+** aproxima a vista e **−** afasta a vista.
- **Fit View**, abaixo dos botões de zoom, mostra todos os nós.
- No canto superior esquerdo, escolha a mão para o modo **Pan**.
  Arraste uma zona vazia da área de trabalho para deslocar a vista.
- No modo **Select**, o ícone de ponteiro, arrastar com o botão esquerdo
  seleciona os nós num retângulo. Use o botão central ou direito para deslocar a vista.

O minimapa no canto inferior direito também permite deslocar a vista e alterar o zoom.
Se perder os nós de vista, use **Fit View** antes de mover um nó.
Estes controlos não alteram as posições guardadas dos nós.

## Resultado esperado

Os nós estão visíveis. O fluxo está guardado e o histórico apresenta o resultado do teste.

## Resolução de problemas

Se um nó falhar, verifique os campos obrigatórios e o conector.
Consulte os resultados no histórico antes de alterar o fluxo.

## Utilização web avançada

Consulte o guia de [relatórios agendados](/docs/report-pipeline) para preparar relatórios recorrentes.

## Guias relacionados

- [Relatórios agendados](/docs/report-pipeline)
- [Conectores](/docs/connectors)
- [Relatórios](/docs/reports)
- [Auditoria](/docs/audit)


## Webhooks em várias instâncias da API

Guarde a alteração do caminho ou segredo antes de enviar pedidos com o novo valor. Cada instância atualizada lê o caminho e o segredo atuais na base de dados partilhada. Não é necessário reiniciar após guardar o fluxo. Os pedidos já autenticados podem terminar.

Envie o segredo apenas no cabeçalho `x-webhook-token`. O caminho antigo devolve 404 após uma alteração. Um segredo antigo ou ilegível devolve 401. Um fluxo desativado ou eliminado devolve 404. Cada acionador ativo precisa de um caminho único, mesmo dentro do mesmo fluxo. Caminhos em conflito devolvem 503 sem executar o fluxo. Uma falha na consulta da base também devolve 503. As instâncias nunca recorrem a credenciais em cache.

Pare todas as instâncias API antigas e todos os processos antigos que alteram fluxos. Aplique a migração 096 com `openldr db migrate` e inicie as instâncias atualizadas. Os processos antigos não mantêm o novo índice de caminhos. Esta implementação exige uma interrupção; não misture versões durante as escritas. As instâncias devem partilhar a base e a chave de encriptação.

## Pedidos webhook duráveis

O OpenLDR guarda um recibo e um evento numa única transação antes de aceitar o webhook. Se a base estiver indisponível antes da aceitação, o pedido falha sem recibo aceite. Um erro ou ligação perdida não prova que nada foi executado. Repita com a mesma chave de idempotência e os mesmos dados.

O cabeçalho opcional `Idempotency-Key` identifica um pedido lógico. No mesmo fluxo, a mesma chave e os mesmos dados reutilizam o recibo original. Dados diferentes com a mesma chave devolvem 409. Os dados incluem corpo, parâmetros, cabeçalhos encaminhados e conteúdo binário. Cabeçalhos de autenticação e transporte ficam excluídos. Sem chave, cada POST cria um pedido e pode duplicar efeitos.

O OpenLDR espera até 10 segundos após aceitar. Uma execução concluída mantém os campos existentes da resposta 200. Um pedido repetido já concluído devolve 200 mesmo com `Prefer: respond-async`. Uma falha registada devolve 500 com `requestId`, sem erros brutos. Recibos interrompidos ou cancelados devolvem 409. Um pedido em espera ou em execução devolve 202 com `accepted: true`, `requestId`, `status` e `statusUrl`. `Location` e `Retry-After` indicam o endereço e o intervalo de consulta. 202 significa aceite, não concluído. `Prefer: respond-async` dispensa a espera. Desligar a ligação não cancela trabalho aceite.

### Exemplo de envio

Uma resposta 200 concluída pode ser `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. As chaves devem conter entre 1 e 200 caracteres ASCII imprimíveis sem espaços.

Envie `POST /api/workflows/hooks/example` com `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` e `Prefer: respond-async`. Use a mesma chave e os mesmos dados ao repetir esse pedido.

Exemplo de corpo da resposta 202:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Consulte o endereço devolvido com `GET /api/workflows/hooks/example?requestId=request-id` e o segredo atual em `x-webhook-token`. Respeite `Retry-After`. A consulta devolve apenas `requestId`, `status` e `runId`, sem dados ou erros brutos. O identificador sozinho não dá acesso. Após rotação, o segredo antigo deixa de autorizar consultas. Mudar ou eliminar o caminho pode impedir esta consulta. Os operadores continuam a consultar recibos por identificador do fluxo e do pedido.

### Consulta e recuperação

O separador Recibos webhook no histórico mostra `queued`, `running`, `completed`, `failed`, `interrupted` e `cancelled`. Os endpoints de operador são `GET /api/workflows/:id/receipts?limit=25&offset=0` e `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

O limite vai de 1 a 100 e o deslocamento começa em zero. Estes comandos usam o mesmo serviço da API. Não permitem repetir a execução.

Pedidos em espera podem continuar após reiniciar. Desativar, eliminar ou alterar o fluxo antes da execução cancela trabalho em espera. `interrupted` indica um resultado incerto. O OpenLDR nunca repete automaticamente trabalho já iniciado. Confirme que o processo original parou e confira os efeitos externos antes de enviar uma nova identidade. Não há reversão automática dos efeitos externos. Os recibos e as chaves sobrevivem à eliminação do fluxo. Não existe expiração nem limpeza automática, por isso o armazenamento cresce.

A migração 097 adiciona o armazenamento de recibos. A implementação continua a seguir P14. Pare as instâncias API e os processos antigos que alteram fluxos. Execute `openldr db migrate` e inicie as instâncias atualizadas. Não misture versões durante as escritas. A compatibilidade real do cliente CDR continua por provar, pois o seu código fonte não foi verificado.

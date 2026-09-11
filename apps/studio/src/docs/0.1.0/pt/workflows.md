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

Pare todas as instâncias API antigas e todos os processos antigos que alteram fluxos. Aplique a migração 096 com `openldr db migrate` e inicie as instâncias atualizadas. Os processos antigos não mantêm o novo índice de caminhos. Esta implementação exige uma interrupção; não misture versões durante as escritas. As instâncias devem partilhar a base e a chave de encriptação. Esta alteração não torna a execução durável. Os emissores ainda precisam de tratar pedidos interrompidos e possíveis efeitos duplicados.

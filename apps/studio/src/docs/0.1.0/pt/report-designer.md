# Designer de relatórios

O modelo define a disposição do documento. O relatório da biblioteca liga esse modelo a uma consulta principal.

![Modelo aberto no designer](report-designer-canvas.png)

## Duas ações distintas

| Ação do menu ⋯ | Resultado |
| --- | --- |
| **Publicar revisão** | Publica uma versão do modelo guardado. Não cria um relatório na biblioteca. |
| **Criar relatório a partir deste modelo** | Abre o formulário para criar um relatório ligado ao modelo e a uma consulta. Não publica uma revisão do modelo. |

## Do modelo ao relatório

1. Prepare uma [consulta guardada](/docs/query) e associe uma tabela do modelo a essa consulta.
2. Guarde o modelo e aguarde a confirmação. Ambas as ações exigem um modelo já guardado.
3. No menu **⋯** do designer, escolha **Publicar revisão**. Confirme a mensagem com o nome do modelo e o estado publicado.
4. Escolha **⋯ → Criar relatório a partir deste modelo**.
5. Preencha o **Nome** e a **Categoria** do relatório. A **Descrição** é opcional. Confirme o **Modelo** e a **Consulta principal**. A consulta pode estar pré-selecionada a partir da primeira tabela associada.
6. No menu **⋯** do formulário, escolha **Criar relatório**. Nome, categoria, modelo e consulta principal são obrigatórios.
7. Confirme a mensagem com o nome do novo relatório. Este nome pode ser diferente do nome do modelo.
8. Abra [Relatórios](/docs/reports), selecione o relatório na sua categoria, preencha os parâmetros obrigatórios e execute-o. Verifique o documento e as linhas da folha de cálculo.

Por exemplo, use uma consulta guardada que devolva duas colunas. Associe uma tabela a essa consulta, guarde o modelo e publique a revisão. Depois, crie um relatório com um nome distinto e essa consulta principal. Confirme a entrada na biblioteca e as colunas obtidas.

## Verificar o resultado

A revisão publicada pertence ao modelo. A entrada criada em Relatórios usa o nome escolhido para o relatório. A consulta principal fornece as linhas da folha de cálculo; o modelo define a disposição do documento.

Publicar uma revisão posterior do mesmo modelo não exige criar outro relatório. Use a ação de criação apenas para acrescentar uma entrada à biblioteca.

Se a criação estiver desativada, verifique os quatro campos obrigatórios. Se o modelo estiver publicado mas não aparecer em Relatórios, use a ação de criação do relatório.

## Guias relacionados

- [Relatórios](/docs/reports)
- [Consultas](/docs/query)
- [Conectores](/docs/connectors)

# Terminologia

Encontre os códigos do seu laboratório, adicione as suas listas e escolha os códigos aceites por um formulário. Comece por consultar as listas já instaladas.

Um **publicador** agrupa listas pela entidade que as mantém. Um **sistema de códigos** contém termos codificados. Um **conjunto de valores** seleciona os códigos permitidos para uma utilização, como um campo de formulário.

Não precisa dos dados de exemplo da documentação. As capturas usam uma lista integrada e um exemplo temporário chamado `DOCS-GUIDE-REVIEW`. Use os seus nomes, códigos e URLs ao criar listas para o laboratório.

A leitura exige permissão para consultar terminologia. Criar, alterar e importar exige permissão para gerir terminologia.

## Encontrar um código e consultar os detalhes

Procure um código existente antes de criar outro. Este exemplo encontra um motivo de rejeição de teste no sistema integrado REJECT-TEST.

### 1. Abrir Terminologia

Selecione **Terminologia** no menu principal à esquerda.

![Captura do Studio: Abrir Terminologia](terminology-guide-open-terminology.png)

### 2. Escolher o publicador

Selecione o publicador que mantém a lista. Neste exemplo, escolha **System**.

![Captura do Studio: Escolher o publicador](terminology-guide-choose-publisher.png)

### 3. Selecionar Code systems

Se o publicador oferecer os dois tipos de lista, selecione **Code systems** junto ao nome.

![Captura do Studio: Selecionar Code systems](terminology-guide-code-systems-tab.png)

### 4. Abrir um sistema de códigos

Selecione a lista a consultar. Este exemplo abre **REJECT-TEST**.

![Captura do Studio: Abrir um sistema de códigos](terminology-guide-choose-code-system.png)

### 5. Pesquisar pelo código ou nome

Introduza parte do código ou nome em **Search terms…**. Este exemplo usa `HAEM`.

![Captura do Studio: Pesquisar pelo código ou nome](terminology-guide-search-terms.png)

**Resultado esperado:** a lista mostra os termos correspondentes deste sistema. O filtro de estado permite reduzir os resultados.

![Captura do Studio: Pesquisar pelo código ou nome](terminology-guide-search-result.png)

### 6. Abrir o termo

Selecione a linha. O painel **Edit term** mostra o código, o nome, o estado e os outros detalhes.

![Captura do Studio: Abrir o termo](terminology-guide-open-term.png)

![Captura do Studio: Abrir o termo](terminology-guide-term-details.png)

### 7. Fechar o painel

Selecione **Close** no canto superior direito para sair sem guardar alterações.

![Captura do Studio: Fechar o painel](terminology-guide-close-term.png)

## Criar um sistema de códigos para a sua lista

Crie um sistema de códigos quando a lista necessária ainda não existir. Escolha primeiro o publicador. As capturas usam System e mantêm Active selecionado.

**System code** é o identificador curto e não pode mudar depois da criação. **System name** é o nome legível. **Canonical URL** identifica a lista nas trocas com outros sistemas. Pode ficar vazio numa lista personalizada.

### 1. Abrir o menu da página

Selecione os três pontos à direita do percurso do publicador, acima da tabela.

![Captura do Studio: Abrir o menu da página](terminology-guide-system-actions.png)

### 2. Abrir Code system

Selecione **Code system** no menu.

![Captura do Studio: Abrir Code system](terminology-guide-code-system-menu.png)

### 3. Escolher New

Selecione **New**. Abre-se o painel **New coding system**.

![Captura do Studio: Escolher New](terminology-guide-new-code-system.png)

### 4. Introduzir o código do sistema

Introduza um código único em **System code**. O exemplo usa `DOCS-GUIDE-REVIEW`.

![Captura do Studio: Introduzir o código do sistema](terminology-guide-system-code.png)

### 5. Introduzir o nome

Introduza o nome a apresentar em **System name**.

![Captura do Studio: Introduzir o nome](terminology-guide-system-name.png)

### 6. Introduzir o URL canónico, se necessário

Introduza o identificador da sua organização em **Canonical URL**. Numa lista personalizada, pode deixar o campo vazio.

![Captura do Studio: Introduzir o URL canónico, se necessário](terminology-guide-system-url.png)

### 7. Criar o sistema de códigos

Selecione **Create** na parte inferior deste painel.

![Captura do Studio: Criar o sistema de códigos](terminology-guide-create-system.png)

**Resultado esperado:** o novo sistema aparece no publicador escolhido. Abra a linha para adicionar termos.

![Captura do Studio: Criar o sistema de códigos](terminology-guide-system-created-step-0.png)

## Adicionar um termo

Adicione um código e o seu nome legível a um sistema existente. O código deve ser único nesse sistema. Os novos termos começam como Active. O nome curto, a classe, a unidade e os metadados são opcionais.

### 1. Abrir o sistema de destino

Selecione o sistema que deve conter o termo. Use uma lista existente ou a criada acima.

![Captura do Studio: Abrir o sistema de destino](terminology-guide-system-created-step-1.png)

### 2. Abrir o menu dos termos

Selecione os três pontos junto de **Search terms…** e do filtro de estado.

![Captura do Studio: Abrir o menu dos termos](terminology-guide-term-actions-step-2.png)

### 3. Escolher New term

Selecione **New term**.

![Captura do Studio: Escolher New term](terminology-guide-new-term.png)

### 4. Introduzir o código

Introduza o valor a guardar em **Code**. O exemplo usa `EXAMPLE-1`.

![Captura do Studio: Introduzir o código](terminology-guide-term-code.png)

### 5. Introduzir o nome apresentado

Introduza um nome legível em **Display name**.

![Captura do Studio: Introduzir o nome apresentado](terminology-guide-term-display.png)

### 6. Abrir o menu do editor de termos

Selecione os três pontos junto dos separadores **Details** e **Mappings**.

![Captura do Studio: Abrir o menu do editor de termos](terminology-guide-term-sheet-actions-step-6.png)

### 7. Escolher Create

Selecione **Create** para guardar o novo termo.

![Captura do Studio: Escolher Create](terminology-guide-create-term.png)

**Resultado esperado:** o painel fecha e o termo aparece no sistema de códigos.

![Captura do Studio: Escolher Create](terminology-guide-term-created.png)

## Alterar o nome apresentado de um termo

Corrija o nome legível quando necessário. O código guardado mantém-se.

### 1. Abrir o termo

Selecione a linha do termo no sistema de códigos.

![Captura do Studio: Abrir o termo](terminology-guide-edit-term-row.png)

### 2. Alterar Display name

Substitua o texto de **Display name**. O exemplo usa `Updated example label`.

![Captura do Studio: Alterar Display name](terminology-guide-edit-term-name.png)

### 3. Abrir o menu do editor de termos

Selecione os três pontos junto de **Details** e **Mappings**.

![Captura do Studio: Abrir o menu do editor de termos](terminology-guide-term-sheet-actions-step-3.png)

### 4. Escolher Save

Selecione **Save**. Os termos existentes usam Save e os novos termos usam Create.

![Captura do Studio: Escolher Save](terminology-guide-save-term.png)

**Resultado esperado:** a lista apresenta o novo nome junto do mesmo código.

![Captura do Studio: Escolher Save](terminology-guide-term-updated.png)

## Importar vários termos de um ficheiro

Use a importação se já tiver uma lista de códigos e nomes. Abra primeiro o sistema de destino.

O modelo descarregado usa **JSON Lines**, um objeto JSON por linha. Cada termo precisa de `code` e `displayName`. A linha de metadados identifica o sistema de códigos. Por exemplo:

```jsonl
{"type":"meta","codingSystem":"DOCS-GUIDE-REVIEW","version":"2026-01-01"}
{"code":"EXAMPLE-2","displayName":"Imported example label"}
```

Use o identificador do seu sistema e os seus termos. São permitidas linhas vazias e linhas iniciadas por `//`.

### 1. Abrir o menu dos termos

Selecione os três pontos junto de **Search terms…**.

![Captura do Studio: Abrir o menu dos termos](terminology-guide-term-actions-step-1.png)

### 2. Descarregar o modelo, se necessário

Selecione **Download template**. Prepare o ficheiro com os campos e exemplos do modelo.

![Captura do Studio: Descarregar o modelo, se necessário](terminology-guide-download-template.png)

### 3. Escolher Import terms

Abra novamente o menu dos termos e selecione **Import terms**.

![Captura do Studio: Escolher Import terms](terminology-guide-import-terms.png)

### 4. Selecionar o ficheiro preparado

Escolha o ficheiro na janela do computador. A importação começa após a seleção. A captura mostra o resultado depois de selecionar o ficheiro de exemplo.

![Captura do Studio: Selecionar o ficheiro preparado](terminology-guide-import-result.png)

**Resultado esperado:** os códigos importados aparecem neste sistema. A pesquisa permite encontrar um código específico.

## Consultar os códigos permitidos por um conjunto de valores

Consulte um conjunto de valores para saber as respostas que um campo pode oferecer. As regras **Include** e **Exclude** definem a lista. **Expansion** apresenta os códigos obtidos.

### 1. Voltar à lista de sistemas

Se estiver aberta uma lista de termos, selecione **← Code systems**.

![Captura do Studio: Voltar à lista de sistemas](terminology-guide-back-to-systems.png)

### 2. Selecionar Value sets

Selecione **Value sets** junto ao nome do publicador. Este exemplo usa System.

![Captura do Studio: Selecionar Value sets](terminology-guide-value-sets-tab.png)

### 3. Abrir um conjunto de valores

Selecione a linha. Este exemplo abre **Test rejection reasons**.

![Captura do Studio: Abrir um conjunto de valores](terminology-guide-open-value-set.png)

### 4. Ler Expansion

Desloque-se até **Expansion** para consultar os códigos produzidos pelas regras.

![Captura do Studio: Ler Expansion](terminology-guide-value-set-expansion.png)

**Resultado esperado:** pode consultar os códigos permitidos sem alterar o conjunto. A quantidade depende dos sistemas e regras da instalação.

## Criar uma lista de códigos permitidos

Crie um conjunto de valores para oferecer uma lista controlada de códigos. Este exemplo inclui todos os códigos de um sistema. Deixe a lista de conceitos vazia para incluir o sistema inteiro. O exemplo permanece Draft enquanto é preparado.

### 1. Abrir o menu da página

Feche primeiro qualquer painel de edição. Selecione os três pontos junto ao percurso do publicador.

![Captura do Studio: Abrir o menu da página](terminology-guide-value-set-page-actions.png)

### 2. Abrir Value set

Selecione **Value set** no menu.

![Captura do Studio: Abrir Value set](terminology-guide-value-set-menu.png)

### 3. Escolher New

Selecione **New** para abrir o editor.

![Captura do Studio: Escolher New](terminology-guide-new-value-set.png)

### 4. Introduzir o URL do conjunto

Introduza uma **Canonical URL** única. Use um URL diferente do sistema de códigos.

![Captura do Studio: Introduzir o URL do conjunto](terminology-guide-value-set-url.png)

### 5. Introduzir um título legível

Introduza o nome da lista de códigos permitidos em **Title**.

![Captura do Studio: Introduzir um título legível](terminology-guide-value-set-title.png)

### 6. Escolher o sistema de códigos de origem

Em **Include**, abra **System** e escolha a lista que contém os termos.

![Captura do Studio: Escolher o sistema de códigos de origem](terminology-guide-value-set-system.png)

![Captura do Studio: Escolher o sistema de códigos de origem](terminology-guide-value-set-system-selection.png)

### 7. Abrir o menu do editor

Selecione os três pontos no canto superior direito do editor do conjunto de valores.

![Captura do Studio: Abrir o menu do editor](terminology-guide-value-set-actions.png)

### 8. Escolher Save

Selecione **Save**. O editor calcula a expansão depois de guardar.

![Captura do Studio: Escolher Save](terminology-guide-save-value-set.png)

**Resultado esperado:** Expansion apresenta os códigos ativos do sistema escolhido. O exemplo contém dois códigos.

![Captura do Studio: Escolher Save](terminology-guide-value-set-created.png)

Um conjunto de valores também pode incluir conceitos específicos, excluir códigos ou importar outro conjunto. Criá-lo não o associa automaticamente a um formulário. Consulte o [guia de Formulários](/docs/forms) para configurar os campos.

## Abrir a importação de uma distribuição padrão

LOINC, SNOMED CT e RxNorm têm uma importação de distribuições ZIP no navegador. Use-a para o pacote fornecido pelo publicador, em vez de uma pequena lista de termos locais.

### 1. Escolher o publicador externo

Selecione **LOINC**, **SNOMED CT** ou **RxNorm**. A captura usa LOINC.

![Captura do Studio: Escolher o publicador externo](terminology-guide-standard-publisher.png)

### 2. Abrir o menu da página

Selecione os três pontos à direita do percurso do publicador.

![Captura do Studio: Abrir o menu da página](terminology-guide-standard-actions.png)

### 3. Escolher Import distribution...

Selecione **Import distribution...**.

![Captura do Studio: Escolher Import distribution...](terminology-guide-import-distribution.png)

**Resultado esperado:** abre-se o painel de importação. Inclui um campo ZIP, uma versão opcional e a confirmação da licença. A importação decorre em segundo plano depois do envio.

![Captura do Studio: Escolher Import distribution...](terminology-guide-distribution-importer.png)

Forneça o pacote de distribuição e trate da respetiva licença.

## Escolher um publicador no telefone

A lista de publicadores começa recolhida para deixar mais espaço para a tabela.

### 1. Mostrar os publicadores

Selecione **Show publishers** no canto superior esquerdo do painel Terminologia.

![Captura do Studio: Mostrar os publicadores](terminology-guide-phone-show-publishers.png)

### 2. Escolher o publicador

Selecione o publicador pretendido.

![Captura do Studio: Escolher o publicador](terminology-guide-phone-choose-publisher.png)

### 3. Recolher a lista de publicadores

Selecione **Hide publishers** para devolver a largura à tabela.

![Captura do Studio: Recolher a lista de publicadores](terminology-guide-phone-hide-publishers.png)

**Resultado esperado:** o publicador escolhido mantém-se no percurso. Desloque a tabela horizontalmente para alcançar as colunas fora do ecrã.

## Resolução de problemas

### A importação indica displayName required

O erro identifica a linha sem nome legível. Adicione `displayName` ao termo e escolha o ficheiro corrigido. O exemplo abaixo falhou na linha 2.

![Captura do Studio: A importação indica displayName required](terminology-guide-import-error.png)

### As opções Term estão desativadas

Abra primeiro um sistema de códigos. As ações sobre termos precisam de uma lista de destino.

### Não consigo alterar o código de um termo existente

O editor mantém o código após a criação. O nome apresentado e os outros campos editáveis ainda podem mudar.

### O conjunto de valores é indicado como imutável

Alguns conjuntos padrão são apenas de leitura. O editor explica que precisam de ser duplicados antes de qualquer alteração.

### O conjunto de valores tem uma expansão vazia

Verifique as regras Include, o sistema escolhido e o estado dos termos. Um conjunto de testes deste laboratório também depende dos testes ativados.

## Guias relacionados

[Começar aqui](/docs/start-here) explica o CLI instalado e o CLI de desenvolvimento, incluindo as pastas de exemplo `openldr_ce`. Consulte esse guia antes de executar comandos de terminologia num terminal.

[Formulários](/docs/forms) · [Catálogo de testes](/docs/test-catalog) · [Unidades de saúde](/docs/facilities) · [As suas preferências](/docs/user-preferences)

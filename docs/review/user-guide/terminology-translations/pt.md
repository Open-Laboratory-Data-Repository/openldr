# Terminologia

Encontre os códigos do seu laboratório, adicione as suas listas e escolha os códigos aceites por um formulário. Comece por consultar as listas já instaladas.

Um **publicador** agrupa listas pela entidade que as mantém. Um **sistema de códigos** contém termos codificados. Um **conjunto de valores** seleciona os códigos permitidos para uma utilização, como um campo de formulário.

Não precisa dos dados de exemplo da documentação. As capturas usam uma lista integrada e um exemplo temporário chamado `DOCS-GUIDE-REVIEW`. Use os seus nomes, códigos e URLs ao criar listas para o laboratório.

A leitura exige permissão para consultar terminologia. Criar, alterar e importar exige permissão para gerir terminologia.

## Encontrar um código e consultar os detalhes

Procure um código existente antes de criar outro. Este exemplo encontra um motivo de rejeição de teste no sistema integrado REJECT-TEST.

### 1. Abrir Terminologia

Selecione **Terminologia** no menu principal à esquerda.

__SHOT:open-terminology:1__

### 2. Escolher o publicador

Selecione o publicador que mantém a lista. Neste exemplo, escolha **System**.

__SHOT:choose-publisher:2__

### 3. Selecionar Code systems

Se o publicador oferecer os dois tipos de lista, selecione **Code systems** junto ao nome.

__SHOT:code-systems-tab:3__

### 4. Abrir um sistema de códigos

Selecione a lista a consultar. Este exemplo abre **REJECT-TEST**.

__SHOT:choose-code-system:4__

### 5. Pesquisar pelo código ou nome

Introduza parte do código ou nome em **Search terms…**. Este exemplo usa `HAEM`.

__SHOT:search-terms:5__

**Resultado esperado:** a lista mostra os termos correspondentes deste sistema. O filtro de estado permite reduzir os resultados.

__SHOT:search-result:0__

### 6. Abrir o termo

Selecione a linha. O painel **Edit term** mostra o código, o nome, o estado e os outros detalhes.

__SHOT:open-term:6__

__SHOT:term-details:0__

### 7. Fechar o painel

Selecione **Close** no canto superior direito para sair sem guardar alterações.

__SHOT:close-term:7__

## Criar um sistema de códigos para a sua lista

Crie um sistema de códigos quando a lista necessária ainda não existir. Escolha primeiro o publicador. As capturas usam System e mantêm Active selecionado.

**System code** é o identificador curto e não pode mudar depois da criação. **System name** é o nome legível. **Canonical URL** identifica a lista nas trocas com outros sistemas. Pode ficar vazio numa lista personalizada.

### 1. Abrir o menu da página

Selecione os três pontos à direita do percurso do publicador, acima da tabela.

__SHOT:system-actions:1__

### 2. Abrir Code system

Selecione **Code system** no menu.

__SHOT:code-system-menu:2__

### 3. Escolher New

Selecione **New**. Abre-se o painel **New coding system**.

__SHOT:new-code-system:3__

### 4. Introduzir o código do sistema

Introduza um código único em **System code**. O exemplo usa `DOCS-GUIDE-REVIEW`.

__SHOT:system-code:4__

### 5. Introduzir o nome

Introduza o nome a apresentar em **System name**.

__SHOT:system-name:5__

### 6. Introduzir o URL canónico, se necessário

Introduza o identificador da sua organização em **Canonical URL**. Numa lista personalizada, pode deixar o campo vazio.

__SHOT:system-url:6__

### 7. Criar o sistema de códigos

Selecione **Create** na parte inferior deste painel.

__SHOT:create-system:7__

**Resultado esperado:** o novo sistema aparece no publicador escolhido. Abra a linha para adicionar termos.

__SHOT:system-created:0__

## Adicionar um termo

Adicione um código e o seu nome legível a um sistema existente. O código deve ser único nesse sistema. Os novos termos começam como Active. O nome curto, a classe, a unidade e os metadados são opcionais.

### 1. Abrir o sistema de destino

Selecione o sistema que deve conter o termo. Use uma lista existente ou a criada acima.

__SHOT:system-created:1__

### 2. Abrir o menu dos termos

Selecione os três pontos junto de **Search terms…** e do filtro de estado.

__SHOT:term-actions:2__

### 3. Escolher New term

Selecione **New term**.

__SHOT:new-term:3__

### 4. Introduzir o código

Introduza o valor a guardar em **Code**. O exemplo usa `EXAMPLE-1`.

__SHOT:term-code:4__

### 5. Introduzir o nome apresentado

Introduza um nome legível em **Display name**.

__SHOT:term-display:5__

### 6. Abrir o menu do editor de termos

Selecione os três pontos junto dos separadores **Details** e **Mappings**.

__SHOT:term-sheet-actions:6__

### 7. Escolher Create

Selecione **Create** para guardar o novo termo.

__SHOT:create-term:7__

**Resultado esperado:** o painel fecha e o termo aparece no sistema de códigos.

__SHOT:term-created:0__

## Alterar o nome apresentado de um termo

Corrija o nome legível quando necessário. O código guardado mantém-se.

### 1. Abrir o termo

Selecione a linha do termo no sistema de códigos.

__SHOT:edit-term-row:1__

### 2. Alterar Display name

Substitua o texto de **Display name**. O exemplo usa `Updated example label`.

__SHOT:edit-term-name:2__

### 3. Abrir o menu do editor de termos

Selecione os três pontos junto de **Details** e **Mappings**.

__SHOT:term-sheet-actions:3__

### 4. Escolher Save

Selecione **Save**. Os termos existentes usam Save e os novos termos usam Create.

__SHOT:save-term:4__

**Resultado esperado:** a lista apresenta o novo nome junto do mesmo código.

__SHOT:term-updated:0__

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

__SHOT:term-actions:1__

### 2. Descarregar o modelo, se necessário

Selecione **Download template**. Prepare o ficheiro com os campos e exemplos do modelo.

__SHOT:download-template:2__

### 3. Escolher Import terms

Abra novamente o menu dos termos e selecione **Import terms**.

__SHOT:import-terms:3__

### 4. Selecionar o ficheiro preparado

Escolha o ficheiro na janela do computador. A importação começa após a seleção. A captura mostra o resultado depois de selecionar o ficheiro de exemplo.

__SHOT:import-result:4__

**Resultado esperado:** os códigos importados aparecem neste sistema. A pesquisa permite encontrar um código específico.

## Consultar os códigos permitidos por um conjunto de valores

Consulte um conjunto de valores para saber as respostas que um campo pode oferecer. As regras **Include** e **Exclude** definem a lista. **Expansion** apresenta os códigos obtidos.

### 1. Voltar à lista de sistemas

Se estiver aberta uma lista de termos, selecione **← Code systems**.

__SHOT:back-to-systems:1__

### 2. Selecionar Value sets

Selecione **Value sets** junto ao nome do publicador. Este exemplo usa System.

__SHOT:value-sets-tab:2__

### 3. Abrir um conjunto de valores

Selecione a linha. Este exemplo abre **Test rejection reasons**.

__SHOT:open-value-set:3__

### 4. Ler Expansion

Desloque-se até **Expansion** para consultar os códigos produzidos pelas regras.

__SHOT:value-set-expansion:4__

**Resultado esperado:** pode consultar os códigos permitidos sem alterar o conjunto. A quantidade depende dos sistemas e regras da instalação.

## Criar uma lista de códigos permitidos

Crie um conjunto de valores para oferecer uma lista controlada de códigos. Este exemplo inclui todos os códigos de um sistema. Deixe a lista de conceitos vazia para incluir o sistema inteiro. O exemplo permanece Draft enquanto é preparado.

### 1. Abrir o menu da página

Feche primeiro qualquer painel de edição. Selecione os três pontos junto ao percurso do publicador.

__SHOT:value-set-page-actions:1__

### 2. Abrir Value set

Selecione **Value set** no menu.

__SHOT:value-set-menu:2__

### 3. Escolher New

Selecione **New** para abrir o editor.

__SHOT:new-value-set:3__

### 4. Introduzir o URL do conjunto

Introduza uma **Canonical URL** única. Use um URL diferente do sistema de códigos.

__SHOT:value-set-url:4__

### 5. Introduzir um título legível

Introduza o nome da lista de códigos permitidos em **Title**.

__SHOT:value-set-title:5__

### 6. Escolher o sistema de códigos de origem

Em **Include**, abra **System** e escolha a lista que contém os termos.

__SHOT:value-set-system:6__

__SHOT:value-set-system-selection:6__

### 7. Abrir o menu do editor

Selecione os três pontos no canto superior direito do editor do conjunto de valores.

__SHOT:value-set-actions:7__

### 8. Escolher Save

Selecione **Save**. O editor calcula a expansão depois de guardar.

__SHOT:save-value-set:8__

**Resultado esperado:** Expansion apresenta os códigos ativos do sistema escolhido. O exemplo contém dois códigos.

__SHOT:value-set-created:0__

Um conjunto de valores também pode incluir conceitos específicos, excluir códigos ou importar outro conjunto. Criá-lo não o associa automaticamente a um formulário. Consulte o [guia de Formulários](/docs/forms) para configurar os campos.

## Abrir a importação de uma distribuição padrão

LOINC, SNOMED CT e RxNorm têm uma importação de distribuições ZIP no navegador. Use-a para o pacote fornecido pelo publicador, em vez de uma pequena lista de termos locais.

### 1. Escolher o publicador externo

Selecione **LOINC**, **SNOMED CT** ou **RxNorm**. A captura usa LOINC.

__SHOT:standard-publisher:1__

### 2. Abrir o menu da página

Selecione os três pontos à direita do percurso do publicador.

__SHOT:standard-actions:2__

### 3. Escolher Import distribution...

Selecione **Import distribution...**.

__SHOT:import-distribution:3__

**Resultado esperado:** abre-se o painel de importação. Inclui um campo ZIP, uma versão opcional e a confirmação da licença. A importação decorre em segundo plano depois do envio.

__SHOT:distribution-importer:0__

Forneça o pacote de distribuição e trate da respetiva licença.

## Escolher um publicador no telefone

A lista de publicadores começa recolhida para deixar mais espaço para a tabela.

### 1. Mostrar os publicadores

Selecione **Show publishers** no canto superior esquerdo do painel Terminologia.

__SHOT:phone-show-publishers:1__

### 2. Escolher o publicador

Selecione o publicador pretendido.

__SHOT:phone-choose-publisher:2__

### 3. Recolher a lista de publicadores

Selecione **Hide publishers** para devolver a largura à tabela.

__SHOT:phone-hide-publishers:3__

**Resultado esperado:** o publicador escolhido mantém-se no percurso. Desloque a tabela horizontalmente para alcançar as colunas fora do ecrã.

## Resolução de problemas

### A importação indica displayName required

O erro identifica a linha sem nome legível. Adicione `displayName` ao termo e escolha o ficheiro corrigido. O exemplo abaixo falhou na linha 2.

__SHOT:import-error:0__

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

# Catálogo de exames

O catálogo de exames é a lista nacional de exames. Cada exame tem um código, um nome, uma categoria, os tipos de amostra que aceita e, quando o tem, um código LOINC. Um exame sem código LOINC mostra **Sem LOINC**.

Abra **Catálogo de exames** na barra lateral. Precisa da permissão de ver a Terminologia para o ver, e da permissão de a gerir para alterar qualquer coisa.

## Quem altera o quê

Uma instalação que não recebeu o catálogo do nível central é dona dele. Aí pode adicionar exames, editá-los, retirá-los e repô-los. Um laboratório independente é o seu próprio nível central.

Um laboratório que recebe o catálogo do nível central não pode alterar os seus exames. A página indica-o acima da tabela. O laboratório pode sempre ativar ou desativar exames, restringir as suas amostras e definir um nome local. A sincronização nunca envia essas definições de volta.

## Encontrar exames

A pesquisa abrange o código, o nome, o nome curto e o nome local. Use **Filtrar** para a categoria, o LOINC, **Ativado aqui** e o estado. Os exames retirados ficam ocultos, exceto se filtrar por eles.

## Adicionar e editar um exame

1. Escolha **Adicionar exame** no menu ⋯, ou **Editar** no menu ⋯ de uma linha.
2. Introduza o código. Deixe-o vazio para usar o código LOINC. Um código não muda depois de guardado.
3. Introduza o nome, e um nome curto se quiser.
4. Escolha uma categoria e marque os tipos de amostra que o exame aceita.
5. Introduza o código LOINC. Quando o LOINC está carregado aqui, pesquisa-o. Caso contrário escreve-o, e só o formato é verificado.
6. Em **Este laboratório**, ative o exame, desmarque as amostras que este laboratório não aceita e defina um nome local.
7. Escolha **Guardar** no menu ⋯ no topo do painel.

Os tipos de amostra vêm da lista de tipos de amostra do CE. As categorias vêm de **Test categories** na página Terminologia.

## Ações numa linha

O menu ⋯ de cada linha ativa ou desativa o exame neste laboratório. Quando esta instalação é dona do catálogo, também retira ou repõe o exame. Retirar é reversível, por isso não pede confirmação.

Na linha de comandos: `openldr test-catalog enable`, `disable`, `retire` ou `restore`, seguido do código.

## Importar uma lista de exames

Quando esta instalação é dona do catálogo, escolha **Importar** no menu ⋯. O painel tem quatro passos. Voltar, Seguinte, Aplicar e Fechar estão no seu menu ⋯. Nada é escrito antes de **Aplicar**.

1. **Ficheiro.** Arraste um ficheiro CSV ou Excel (.xlsx), ou clique para escolher um. O CE lê a primeira folha de um ficheiro Excel. Um ficheiro tem no máximo 5000 exames e 5 MB.
2. **Colunas.** O CE associa os cabeçalhos aos campos. Verifique cada um. O nome é obrigatório. Um campo definido como **Não está no ficheiro** não muda nos exames que já estão no catálogo. Uma célula vazia numa coluna escolhida apaga esse campo.
3. **Valores.** Os textos de categoria e de amostra são comparados com as listas pelo código ou pelo nome, sem contar maiúsculas nem espaços. Uma célula de amostra pode ter várias, separadas por `;`. Escolha o que significa cada texto sem correspondência. Pode adicionar uma categoria: o código parte do texto, e pode alterá-lo. Uma linha com texto sem escolha é recusada.
4. **Revisão.** O CE mostra quantos exames são novos, alterados, sem alteração e recusados, cada recusa com a linha e o motivo, e as categorias que vai adicionar. Escolha **Aplicar** para escrever tudo de uma vez.

Os exames são comparados pelo código, por isso importar o mesmo ficheiro duas vezes não muda nada. Um exame que não está no ficheiro não é retirado. Uma importação nunca muda o estado de um exame nem as definições deste laboratório. Quando o LOINC não está carregado aqui, só o formato dos códigos LOINC é verificado, e a revisão indica-o.

## Exportar o catálogo

Escolha **Exportar CSV** no menu ⋯. Qualquer instalação pode exportar, incluindo um laboratório que recebe o catálogo do nível central. O ficheiro tem os exames ativos nas colunas que uma importação lê: `code`, `name`, `short_name`, `loinc`, `category` e `specimen_types`. Edite-o numa folha de cálculo e importe-o de novo. Um valor que começa por `=` ou `@` recebe um `'` no início, para que uma folha de cálculo não o execute como fórmula.

Na linha de comandos: `openldr test-catalog import <ficheiro>` mostra o que mudaria, e `--apply` escreve-o. `openldr test-catalog export` escreve o CSV.

## O pedido de exames

O campo **Tests** do pedido de exames lista os exames deste laboratório: os exames do catálogo ativados aqui, com o nome local quando existe. Um exame retirado sai da lista. Ative exames antes de qualquer pedido: o campo é obrigatório, e uma lista vazia não deixa passar nenhum pedido.

O campo **Specimen Type** oferece então só as amostras aceites por pelo menos um exame escolhido, pela lista mais curta deste laboratório quando a definiu. Sem exames escolhidos, ou se nenhum lista amostras, oferece toda a lista de amostras, como antes.

Um pedido enviado indica primeiro o código LOINC de cada exame, quando o tem, e depois o código do catálogo. Os relatórios que leem o primeiro código de um pedido continuam a encontrar LOINC. Um exame sem código LOINC é enviado com o código do catálogo.

Uma instalação cujo pedido de exames foi alterado no editor de formulários mantém o seu próprio campo Tests. Para usar esta lista, escolha o conjunto de valores `urn:openldr:valueset:lab-tests` para esse campo no editor. Na linha de comandos, `openldr terminology expand urn:openldr:valueset:lab-tests` mostra a lista que o campo Tests oferece.

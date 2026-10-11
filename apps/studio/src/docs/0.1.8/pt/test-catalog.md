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

Cada exame tem a sua própria amostra. Abra a linha de um exame e escolha entre as amostras que esse exame aceita, pela lista mais curta deste laboratório quando a definiu. O pedido já não tem um campo de amostra separado.

Um pedido enviado indica primeiro o código LOINC de cada exame, quando o tem, e depois o código do catálogo. Os relatórios que leem o primeiro código de um pedido continuam a encontrar LOINC. Um exame sem código LOINC é enviado com o código do catálogo.

Uma instalação cujo pedido de exames foi alterado no editor de formulários mantém o seu próprio campo Tests. Para usar esta lista, escolha o conjunto de valores `urn:openldr:valueset:lab-tests` para esse campo no editor. Na linha de comandos, `openldr terminology expand urn:openldr:valueset:lab-tests` mostra a lista que o campo Tests oferece.


## Parâmetros de resultado

Um exame pode nomear os parâmetros de resultado que produz: hemoglobina, contagem de CD4, leitura de um TDR de malária. Os parâmetros vêm do dicionário de resultados desta instalação, por isso nada se escreve à mão. Marque um no painel do exame e indique se o resultado é um número, um código de uma lista, ou texto livre.

Um parâmetro numérico pode ter intervalos de referência. Cada intervalo tem um limite inferior, um superior, uma unidade, e um nome opcional, por exemplo Mulheres do planalto. Pode também nomear um sexo e uma faixa etária. O menu ⋯ da linha de um intervalo move-o para cima, para baixo ou remove-o, e o menu ⋯ do parâmetro acrescenta um. A ordem decide qual o intervalo que começa selecionado na bancada. Dois intervalos do mesmo parâmetro não podem ter o mesmo nome. Um exame sem parâmetros continua a funcionar: o painel pede apenas uma amostra.

Na linha de comandos, `openldr test-catalog params <code>` mostra os parâmetros de um exame, e `--set <ficheiro>` substitui-os a partir de um ficheiro JSON.

## Associar códigos de teste do laboratório

Cada sistema de laboratório dá nomes aos seus testes à sua maneira. O DISA chama à carga viral `HIVVL`, `POCVR` ou `POHVL`. Associe cada um desses códigos ao teste do catálogo que significa, e os relatórios podem contar o teste do catálogo seja qual for o nome dado pelo laboratório.

Abra o separador **Observados**. Lista todos os códigos de teste do armazém, com a descrição, o número de pedidos e a data em que foram vistos pela última vez. Um código associado antes de chegarem dados aparece com 0 pedidos. Filtre por **Sem correspondência**, **Com correspondência** ou **Ambíguo**.

Para associar um código, abra o menu ⋯ da sua linha e escolha **Associar a um teste do catálogo**. Escolha o teste e depois **Guardar** no menu ⋯ do painel. **Remover correspondência**, no mesmo menu, retira-a.

Os códigos são comparados como a base de dados do armazém compara texto. No Postgres a comparação é exata: `HIVVL` e `HIVVL ` (com um espaço no fim) são dois códigos. No MSSQL e no MySQL com as definições por omissão, maiúsculas e minúsculas contam como iguais, e o MSSQL ignora também os espaços no fim. No MSSQL e no MySQL, duas correspondências cujos códigos diferem apenas na capitalização (`HIVVL` e `hivvl`) entram em conflito em `test_map`, e cada reconstrução falha até uma delas ser removida. Associe só uma delas.

Um código é **Ambíguo** quando tem duas correspondências com o catálogo, por exemplo uma feita na página Terminologia e outra feita aqui. Os relatórios deixam-no de fora até o associar de novo. Quando o central associou um código, é a correspondência do central que os relatórios usam, e a do laboratório para esse código é ignorada.

Um laboratório não pode alterar uma correspondência enviada pelo central. A sua linha indica **Do central**.

### Associar vários códigos de uma vez

**Exportar CSV**, no menu ⋯ do separador, escreve todos os códigos observados. Preencha `catalog_code`, ou `loinc` quando só conhece o código LOINC, e depois **Importar CSV**. A importação mostra as linhas novas, alteradas, inalteradas e recusadas antes de escrever o que quer que seja. Uma linha com ambas as colunas vazias fica como está. Uma linha é recusada quando o armazém só tem esse código com espaços à volta, porque o leitor de ficheiros apara as células. Associe esse código no separador Observados ou com `openldr test-catalog map set`. Num laboratório, uma linha cujo código o central associou é recusada, a não ser que peça a correspondência que o central já tem.

### Relatórios

As correspondências são copiadas para a tabela do armazém `test_map`. Um relatório junta-a assim:

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
where tm.loinc = '25836-8'
group by tm.catalog_name
```

A cópia atualiza-se quando uma correspondência ou um teste do catálogo muda, e no arranque. Se uma atualização falhar, o separador di-lo. Escolha **Reconstruir a cópia do armazém** no seu menu ⋯.

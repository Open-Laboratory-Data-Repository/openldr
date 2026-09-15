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

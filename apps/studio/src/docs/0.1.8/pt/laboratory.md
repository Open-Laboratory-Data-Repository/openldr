# Laboratório

Em **Definições → Laboratório**, configure a identidade dos cabeçalhos dos relatórios e o registo proposto para novas instalações.

## Configuração

1. Preencha o nome do laboratório, a morada e o contacto.
2. Escolha um ficheiro de imagem para o logótipo. A pré-visualização aparece antes de guardar. Limpar o logótipo também exige guardar.
3. Selecione o registo de instalações. Este valor preenche o sistema inicial ao criar uma instalação; não importa dados nem altera identificadores existentes.
4. Introduza um fuso horário IANA, por exemplo `Africa/Dar_es_Salaam`. Desvios fixos não são aceites. Num armazém SQL Server, deixe o campo vazio e introduza o nome Windows no filtro de fuso horário do relatório.
5. Guarde através do menu **⋯** da página. Confirme a notificação e volte a abrir a página para verificar os valores.
6. Pré-visualize um relatório que use o cabeçalho partilhado para verificar a identidade e o logótipo.

## Registo e limites

A lista apresenta fontes ativas registadas em [Instalações](/docs/facilities). Se faltar a fonte, inicie a importação nessa página e registe-a. Regresse ao Laboratório e recarregue a página. Uma lista vazia também pode indicar uma falha de carregamento.

Escolha o registo ao qual pertencem os códigos das suas instalações. O URI distingue esses códigos dos de outro registo. Esta escolha não migra instalações existentes.

O fuso horário pode preencher inicialmente um filtro de relatório; não define a hora de todos os agendamentos. Consulte [Relatórios](/docs/reports).

As alterações não são guardadas automaticamente. Se ocorrer um erro, corrija o valor e tente novamente. O logótipo deve ser um ficheiro de imagem aceite pela página, não um endereço web.

## Guias relacionados

- [Definições](/docs/settings)
- [Instalações](/docs/facilities)
- [Relatórios](/docs/reports)

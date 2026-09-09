# Unidades

A página Unidades contém a sua lista mestre de unidades, cada local a que um resultado pode ser
atribuído, e as ferramentas para importar uma a partir de um registo nacional cujo ficheiro ainda
não corresponde aos nomes de coluna do OpenLDR.

## Resultado

Pode importar uma lista nacional de unidades cujos cabeçalhos de coluna e vocabulário não
correspondem aos do OpenLDR, usando um mapeamento de colunas e um mapeamento de valores, a partir
do assistente de importação ou da CLI `openldr`.

## Antes de começar

- Saiba a que registo nacional pertence o ficheiro (o seu URI canónico, por exemplo `urn:zm:mfl`).
  O identificador permanente de cada linha importada é derivado deste URI e da própria coluna de
  código do ficheiro, pelo que o mesmo registo deve ter sempre o mesmo nome.
- Mantenha o ficheiro de origem aberto algures para comparar a sua linha de cabeçalhos com os
  campos do contrato abaixo.

## Os quatro passos do assistente de importação

O assistente de importação tem quatro passos, numerados no topo: Origem, Dados, Mapeamento e
Revisão. Clique num passo dessa faixa para se mover entre eles. Não há um botão Voltar separado.

- **Origem.** Escolha o ficheiro e o registo a que pertence. Se esta instalação ainda não tiver
  nenhum registo, o botão aqui mostra "Registar uma fonte" em vez de "Continuar". Sair de Origem
  envia o ficheiro para o servidor. O ficheiro fica guardado, ainda não verificado, porque ainda
  não existe nenhum mapeamento de colunas.
- **Dados.** Mostra o ficheiro guardado como uma tabela, só de leitura. Nada é editável neste
  passo. A tabela é paginada a partir do servidor, uma página de cada vez, e funciona da mesma
  forma para um ficheiro CSV e para uma versão JSONL. Continuar avança para o Mapeamento. Não
  envia nada: o ficheiro já está guardado.
- **Mapeamento.** Todas as decisões vivem aqui: o mapeamento de colunas, os valores fixos, o que
  fazer com conflitos, ausências e remoções, e que palavras do próprio registo correspondem ao
  vocabulário. Cada linha também tem o seu próprio ícone de estado, descrito mais abaixo, para
  verificar uma só coluna depressa. A sua ação principal, Validar tudo, executa a primeira
  verificação completa sobre o ficheiro já guardado no passo Origem. Não envia o ficheiro uma
  segunda vez.
- **Revisão.** Relata o que a verificação encontrou e oferece uma única ação, Aplicar. Nada nela é
  editável.

### O mapeamento decide, a revisão relata

Se a verificação revelar algo que queira mudar, volte ao Mapeamento, mude-o e avance de novo. Essa
ida e volta é deliberada. Uma lista nacional de estabelecimentos está ligada a coisas de mais para
valer a pena trocar correção por rapidez.

Na primeira passagem, o Mapeamento não mostra nenhuma lista de valores não reconhecidos, porque
ainda nada leu o ficheiro. Clique em Validar tudo, deixe a verificação correr, e a lista está à sua
espera quando voltar. O mesmo vale para as opções que deixam passar um problema: nenhuma lhe é
oferecida enquanto nada lhe disser que o problema existe.

**Mudar seja o que for no Mapeamento descarta a última Revisão.** É de propósito. Um resumo que já
não corresponde ao que está prestes a importar é pior do que resumo nenhum, por isso o assistente
retira-o em vez de deixar no ecrã um número que já não é verdade. A Revisão está atualizada ou não
está lá.

Duas coisas deliberadamente **não** a descartam, porque não podem mudar o que a verificação
encontrou: as escolhas de conflitos, ausências e remoções, que se aplicam no momento da importação
e não na leitura do ficheiro, e a opção de importar apesar de linhas ilegíveis, que apenas decide
se a importação pode prosseguir.

Os valores não reconhecidos de um campo aparecem sob a sua própria linha de mapeamento, cada um com
a sua lista de escolha, em vez de numa caixa mais abaixo. A lista é mantida enquanto trabalha nela:
guardar um mapeamento não faz desaparecer as linhas restantes, e já não repete a verificação
sozinho. Peça a verificação seguinte quando estiver pronto.

**Um valor de nível que não pertence a nenhum tipo pode ser ignorado.** Escolha **Ignorar este
valor** no topo da lista. O valor é importado exatamente como está escrito, o que já acontece a um
valor que ninguém mapeou, e a linha deixa de o contar. A decisão fica guardada para o registo, por
isso a próxima importação do mesmo ficheiro não volta a perguntar. Só é oferecido para `level`:
`status` e `country` têm vocabulários pequenos e fechados, sem nada neles que valha a pena ignorar.

**Um valor de nível que a lista não tem pode ser adicionado a ela.** Escolha **Adicionar "…" como
novo tipo** no topo da lista. Abre-se uma confirmação com o nome, que pode corrigir, e o código que
vai receber, que não pode. O tipo é adicionado só a esse registo: cada outro registo mantém a lista
que tem. Se o nome escrito já corresponder a algo na lista, a adição é recusada e nomeia o que
encontrou, porque duas entradas que se leem da mesma forma deixariam as duas de resolver. Adicionar
um tipo exige a capacidade `terminology.manage` além de `facilities.manage`; sem ela, a opção fica
desativada e ainda pode mapear ou ignorar.

### O ícone de estado em cada linha

Cada linha de mapeamento tem um pequeno ícone junto ao seu seletor de campo. Tem quatro estados:

- Um círculo de informação âmbar significa que a linha ainda não foi verificada.
- Um visto verde dentro de um círculo significa que foi verificada e nada está errado.
- Um círculo vermelho significa que algo está errado. A linha diz o quê, logo por baixo.
- Uma seta circular cinzenta significa que o mapeamento mudou desde a última verificação.
- Um círculo discreto com um traço significa que a coluna é guardada como dados extra. Não reclama
  nenhum campo do contrato, por isso não há nada a verificar e o ícone não faz nada. A maioria das
  colunas de um export real está assim, o que deixa as outras sobressair.

Cada estado tem a sua própria forma, e não apenas a sua própria cor, para que continuem distintos
num telemóvel, onde a dica não chega sequer a abrir.

O ícone mantém-se clicável em todos os estados. Uma nova verificação nunca é recusada.

Nenhuma linha fica verde sozinha, por melhor que pareça o campo sugerido. A sugestão avalia o NOME
da coluna. Não consegue saber o que está dentro da coluna, e os nomes que reconhece com mais
confiança costumam ser os dos campos controlados cujos valores mais precisam de verificação. Verde
quer dizer que uma verificação leu a coluna.

Clicar no ícone verifica só essa coluna. Lê os valores dessa coluna no ficheiro que já enviou no
passo Origem, sem verificar todo o ficheiro de novo. Use Validar tudo quando quiser uma verificação
completa de todas as colunas de uma vez.

### A ortografia não é problema seu

Um valor que difere do vocabulário apenas nas maiúsculas, ou por escrever Centre onde o vocabulário
escreve Center, resolve-se sozinho e nunca chega a essa lista. O `Health Centre` do seu registo é
importado como `health-center`, e as palavras que o seu ficheiro usou são guardadas junto da linha.

Um nome verdadeiramente diferente continua a chegar-lhe. `1st Level Hospital` não é a ortografia de
nada no vocabulário, por isso espera pela sua decisão, que é precisamente o objetivo.

**Um mapeamento que fez à mão ganha sempre.** Nada decidido automaticamente passa por cima de uma
decisão que tomou.

Cada passo mostra um único botão, o que avança para o passo seguinte. Qualquer outra ação, incluindo
as três opções de verificar de novo e Fechar, fica no menu `⋯` da página.

**Não há botão Guardar. O ícone de estado é o guardar.** Escolha os valores nas listas por baixo de
uma linha e depois carregue no ícone dessa linha: guarda as suas escolhas, lê a coluna outra vez e
põe a linha a verde se não sobrar nada. Validar tudo faz o mesmo para todas as linhas antes de
verificar o ficheiro inteiro. Até lá a linha diz o que está à espera, por exemplo «4 valor(es) não
reconhecido(s). 2 escolhido(s), ainda não guardado(s)».

Não pode clicar num passo que ainda não alcançou, nem voltar a um passo anterior enquanto uma
verificação em segundo plano está a decorrer. Clicar em Validar tudo no Mapeamento leva-o à Revisão
sozinho assim que a verificação começa, antes de ela terminar. Se a verificação encontrar um
problema no mapeamento de colunas, o assistente devolve-o ao Mapeamento e mostra os erros ali, para
que possa corrigir o mapeamento no mesmo sítio.

### Corrigir uma célula no passo Dados

O passo Dados mostra o seu ficheiro como uma tabela. Clique numa célula para mudar o que ela diz.

As suas alterações não são escritas de volta no ficheiro que enviou. Ficam guardadas à parte,
contra o próprio ficheiro, por isso enviar o mesmo ficheiro outra vez mantém cada correção feita.
Se o ficheiro mudar, as correções deixam de se aplicar, porque os números de linha que nomeiam já
não querem dizer nada.

Uma célula corrigida ganha um traço âmbar na margem esquerda e um botão para anular. Anular repõe
o valor do ficheiro.

Corrigir uma célula numa coluna mapeada para `level`, `status` ou `country` faz uma pergunta: mudar
só esta linha, ou mudar todas as linhas que dizem a mesma coisa. As categorias costumam repetir-se,
por isso um valor corrigido uma vez costuma estar errado onde quer que apareça.

Duas coisas que uma correção não pode fazer. Não pode recuperar uma linha cujo número de colunas
não corresponde ao cabeçalho: essa linha é posta de lado antes de existir qualquer célula, por isso
corrija-a no CSV. E não pode acrescentar nem remover uma linha. Uma linha que não deva ser importada
é uma linha a remover do CSV.

Corrigir uma célula torna a sua última verificação desatualizada. Verifique a coluna de novo,
depois valide, antes de avançar para a Revisão.

## O que é um mapeamento de colunas

O contrato de importação do OpenLDR tem um conjunto fixo de campos: `national_code` e `name`
(obrigatórios), mais `level`, `ownership`, `status`, `country`, `zone`, `region`, `district`,
`council`, `ward`, `village`, `address`, `phone`, `latitude` e `longitude` (opcionais). Um ficheiro
nacional quase nunca escreve as suas colunas assim: pode chamar à coluna de código `MFL Code`, ou
à coluna de região `Province`.

Um **mapeamento de colunas** é a tradução entre os dois. As suas chaves são **os próprios
cabeçalhos do ficheiro, exatamente como aparecem no ficheiro**, e não os nomes do contrato. Para
cada cabeçalho tem três opções:

- **Mapeá-lo** para um campo do contrato. Dois cabeçalhos nunca podem mapear para o mesmo campo. O
  analisador não consegue adivinhar qual deve prevalecer, por isso recusa em vez de adivinhar.
- **Dar-lhe um valor fixo.** Use isto quando o contrato precisa de um campo para o qual o ficheiro
  não tem nenhuma coluna. Um ficheiro nacional raramente traz o seu próprio país, por exemplo,
  pelo que `country` é normalmente um valor fixo em vez de uma coluna mapeada.

  `level`, `status` e `country` estão ligados a conjuntos de valores, por isso o seu valor fixo
  escolhe-se numa lista em vez de se escrever. A escolha grava o código, que é a mesma cadeia que o
  importador produz para um valor mapeado na Revisão, pelo que um valor escolhido não precisa de
  mapeamento nenhum. Pode continuar a escrever um valor que a lista não oferece. O painel avisa-o
  quando o faz, e esse valor é importado exatamente como escrito e aparece na Revisão para ser
  mapeado. Se uma instalação não tiver lista de valores para um campo, o painel também o diz, e nada
  é verificado.
- **Mantê-lo como dado extra.** A coluna continua a ser importada, transportada para o campo
  `extras` do registo, mas não é tratada como um dos campos do contrato.

Não precisa de decidir sobre cada cabeçalho. Deixe um por tratar e ele continua a reclamar o seu
campo sozinho, desde que já escreva exatamente o nome de um campo do contrato. O analisador chama
a isto uma coluna **passthrough**. Um cabeçalho não tratado que não escreve nada do contrato é
recusado, a menos que ative **Permitir colunas não reconhecidas**, o que o transporta para
`extras` da mesma forma que escolher "manter como dado extra".

> **O seu mapeamento de colunas decide o destino de cada coluna.** Se mapear cinco colunas de vinte,
> as outras quinze são mantidas como dados extra e a importação continua. Não lhe perguntam sobre
> elas e nada se perde: cada linha leva-as nos seus dados extra, que é também onde fica uma coluna
> que escolha manter assim explicitamente.
>
> **Sem qualquer mapeamento, uma coluna não reconhecida continua a interromper o ficheiro.** Nada
> indicou ao importador se queria essa coluna, e ele não adivinha: uma coluna descartada em silêncio
> é pior do que um ficheiro recusado. Use a opção oferecida que verifica o ficheiro de novo
> mantendo as colunas não reconhecidas como dados extra. Tem de ser definido antes de o ficheiro ser
> lido, por isso não pode ser acrescentado no passo de confirmação. **O ficheiro que já enviou é
> reutilizado**, por isso um registo nacional nunca é enviado duas vezes para mudar uma definição.
>
> Uma versão JSONL nunca para por isto: cada linha nomeia os seus próprios campos.

## Como obter um mapeamento sugerido

Raramente precisa de construir um mapeamento de colunas à mão. Tanto o assistente como a CLI
podem examinar os cabeçalhos de um ficheiro e propor um mapeamento offline, sem ida e volta ao
servidor:

- **No assistente:** abra **Unidades**, escolha **Importar**, selecione o ficheiro e escolha o
  registo. Saia do passo Origem para carregar e guardar o ficheiro. O passo Dados mostra o ficheiro
  como uma tabela em apenas leitura. O passo Mapeamento abre a seguir com uma sugestão já
  preenchida. Cada linha começa com um ícone de estado âmbar, descrito mais acima, porque nada leu
  ainda o ficheiro. Clique num ícone para verificar essa coluna, ou em Validar tudo para verificar
  todas.
- **A partir da CLI:** execute `openldr facilities suggest-map <path>`. Mostra o mesmo mapeamento
  sugerido em formato de tabela, assinala qualquer colisão que a própria sugestão causaria, e
  indica como devolver o resultado: `openldr facilities import <path> --column-map <file.json>`.

Em qualquer dos casos, reveja a sugestão. É um ponto de partida, não uma resposta que pode deixar
de verificar.

## Recusas, e como corrigi-las

Uma importação com problemas de mapeamento de colunas não escreve nada. Cada problema é reportado
de uma só vez, para que uma única passagem de correção repare o ficheiro, em vez de descobrir os
erros um a um. Quatro coisas podem correr mal:

| Motivo | O que significa | Como corrigir |
|---|---|---|
| `duplicate_target` | Dois cabeçalhos reivindicam o mesmo campo do contrato. Um cabeçalho reivindica um campo por estar mapeado para ele, **ou apenas por ter o seu nome** — uma coluna chamada `Zone` reivindica `zone` mesmo que o painel mostre `Não mapeado`. | Decida qual cabeçalho está correto para esse campo e coloque o outro em `Não mapeado`, o que mantém os seus valores como dado extra. |
| `constant_collision` | Um valor fixo e um cabeçalho mapeado (ou não tratado, já correspondente) reclamam ambos o mesmo campo. | Mantenha apenas um dos dois, o valor fixo ou o mapeamento de coluna, para esse campo. |
| `unknown_target` | Um cabeçalho está mapeado para um nome que não é um dos campos do contrato. | Corrija o erro de escrita, ou mapeie-o para dado extra se não pertencer de todo ao contrato. |
| `missing_required` | `national_code` ou `name` não tem coluna mapeada nem valor fixo. | Mapeie uma coluna, ou forneça um valor fixo, para o campo obrigatório em falta. |

> **Uma coluna que tem o nome de um campo do contrato reivindica-o.** Um ficheiro com `Province` e
> `Zone` é recusado se mapear `Province` para `zone`, porque `Zone` já o reivindica pelo nome.
> Coloque `Zone` em `Não mapeado` para libertar a reivindicação. Os seus valores são mantidos como
> dado extra, nunca descartados. O mesmo vale para `Ownership`, `Ward`, `District`, `Latitude` e
> `Longitude`.

## A distinção que costuma confundir

Um mapeamento de colunas decide para onde vai cada **coluna**. Um mapeamento de valores decide o
que significa cada **valor** num campo controlado (`level`, `status`, `country`). Os dois
comportam-se de forma muito diferente quando estão incompletos:

- **Um valor não mapeado é importado na mesma.** Se um ficheiro escreve o nível de uma unidade
  como `"Health Centre"` e o seu conjunto de valores não reconhece exatamente essa grafia, a
  linha é importada na mesma. O texto original é mantido, e o valor é reportado para que possa
  mapeá-lo mais tarde. Nada bloqueia por causa disto.
- **Uma coluna obrigatória não mapeada bloqueia toda a importação.** Se `national_code` ou `name`
  não tiver de onde vir, o analisador recusa-se a adivinhar, e nenhum registo é escrito até
  corrigir o mapeamento.

Em resumo: um problema de coluna interrompe a importação antes de começar; um problema de valor
fica registado e pode ser corrigido depois.

## Registar uma unidade manualmente

A maioria das unidades chega por importação. Também pode adicionar uma a partir da página
Unidades, e uma unidade que exista na sua lista nacional deve ser registada como tal, e não como
uma unidade puramente local.

### Os dois códigos

Uma linha de unidade tem espaço para dois códigos, e não são a mesma coisa:

- **Código nacional.** O código que a sua lista nacional ou mestre de unidades usa. Opcional,
  porque um local só de laboratório não tem nenhum.
- **Código local.** A sua própria numeração, seja qual for o nome que o seu LIS dá ao local.
  Também opcional.

Pelo menos um dos dois tem de estar presente. A coluna CÓDIGO da tabela Unidades mostra o código
local quando existe um, e recorre ao código nacional caso contrário, a mesma regra que o resto do
sistema usa para dar a uma unidade o seu código público.

### Porque é que o registo importa

O identificador permanente de uma unidade é derivado do seu **registo de unidades mais o seu
código nacional**. Forneça ambos e a unidade fica arquivada exatamente sob a identidade que uma
importação CSV desse registo lhe daria, pelo que uma importação posterior da mesma lista atualiza
a sua linha em vez de criar uma segunda.

Deixe o código nacional vazio e a unidade mantém um identificador privado. Isso é correto para um
local que genuinamente não está na lista nacional.

O registo já tem de existir nesta instalação. Um registo desconhecido ou desativado é recusado,
com uma mensagem a indicar qual. Os registos são a mesma lista que o assistente de importação
oferece.

### O que não pode alterar depois

**O código nacional e o registo da unidade ficam fixos assim que a unidade é criada.** Fazem parte
da sua identidade, não são campos comuns. Mudar qualquer um deixaria a linha arquivada sob um
identificador que o seu próprio código já não produz, e a próxima importação desse registo não a
encontraria.

Assim, uma unidade criada sem código nacional não pode adquirir um mais tarde. Se precisar de
adicionar um, elimine a unidade e registe-a de novo.

### Campos obrigatórios

Os marcadores de obrigatoriedade do formulário são impostos ao guardar, e o servidor também os
impõe.

Dois campos são deliberadamente **não** obrigatórios, porque nenhum registo nacional pode
presumir-se que os fornece: o código local (uma importação nunca produz um) e a região (nem todos
os países têm esse nível intermédio; a lista da Zâmbia não tem nada entre Province e District).
Quando edita uma unidade existente, só os campos que efetivamente altera são reverificados, pelo
que uma unidade importada com uma lacuna continua editável.

## Filtragem, ordenação e pesquisa

A tabela Unidades usa a mesma barra de ferramentas que a Auditoria: uma caixa de pesquisa, e os
botões Filtrar, Ordenar, Colunas e Repor.

- Pesquisar verifica nome, código, região, distrito e conselho, no servidor, num único pedido.
  Encontra texto em qualquer uma dessas cinco colunas, mesmo as que a tabela não está a mostrar
  no momento.
- Filtrar adiciona uma regra: escolha uma coluna, um operador e um valor. Pode adicionar mais do
  que uma regra.
- Ordenar ordena a tabela por qualquer coluna ordenável, de forma crescente ou decrescente.
- Colunas mostra ou oculta colunas.
- Repor limpa todos os filtros, ordenações, termos de pesquisa e escolhas de colunas, e devolve a
  tabela às suas predefinições. Este botão só aparece depois de aplicar um filtro ou uma ordenação.
  Cada controlo também se limpa sozinho, por isso pode desfazer uma coisa sem desfazer o resto.

Os filtros ativos aparecem como etiquetas removíveis abaixo da barra de ferramentas.

Um controlo ocupa a sua própria linha abaixo da barra de ferramentas, porque não é uma coluna
comum:

- **Estado do mapeamento.** Se uma unidade pode ser um alvo de mapeamento, e se algo já mapeia
  para ela. Mapeada significa que pelo menos um código observado já se resolve para ela. Não
  mapeada significa que a unidade está pronta para ser um alvo mas nada aponta ainda para ela.
  Não projetada significa que a unidade ainda não chegou à tabela voltada para relatórios, pelo
  que não pode ser de todo um alvo de mapeamento. Este estado vem de uma junção entre duas outras
  tabelas, não de uma coluna guardada, por isso mantém o seu próprio menu suspenso em vez de se
  juntar à lista de Filtrar.

Registo nacional ocupava essa linha como segunda caixa. Agora é uma coluna de Filtrar, com o nome
Registo nacional, porque sempre filtrou uma coluna guardada como todos os outros filtros. Filtrar
dá-lhe operadores que a caixa não tinha: a caixa exigia o URI completo do registo, e "contém"
encontra parte dele, por isso pode escrever `hfr` em vez de
`urn:openldr:cs:facility-register:hfr` inteiro. Os valores continuam a ser texto livre em vez de
uma lista de escolha, porque uma unidade pode ter um código de registo que a sua instalação já não
lista como fonte ativa, e uma lista de escolha esconderia essas linhas.

Uma vista filtrada e ordenada pode ser partilhada. Os filtros e ordenações aparecem no próprio URL
da página, pelo que copiar o link e enviá-lo a alguém reabre a mesma vista. Links antigos que
usavam um único parâmetro de consulta, como `?zone=Central`, continuam a funcionar.

No estúdio, Filtrar e Ordenar podem usar estas colunas: código, nome, região, distrito, estado,
origem, zona, conselho, país, nível, titularidade, origem gerida, estado no registo e registo
nacional.

### Duas coisas a saber

Pesquisar verifica cada linha diretamente em vez de usar um índice. Num grande registo nacional
isto pode demorar mais do que filtrar por um valor de coluna exato. Se uma pesquisa parecer lenta,
restrinja primeiro com Filtrar, e depois pesquise dentro do resultado mais pequeno.

A ordem predefinida da tabela e uma ordenação explícita por nome podem colocar os nomes numa
ordem diferente. Comparam maiúsculas/minúsculas e letras acentuadas segundo regras diferentes. Se
um relatório depender de uma ordem específica, aplique uma ordenação explícita em vez de confiar
na vista predefinida.

## Linha de comandos: listar unidades

`openldr facilities list` suporta a mesma gramática de filtro e ordenação que a barra de
ferramentas, permitindo que um script reproduza qualquer vista construída no navegador.

- `--where column:operator:value`. Repetível. Apenas os dois primeiros dois-pontos são
  delimitadores, pelo que um valor pode em si conter um dois-pontos.
- `--sort column` ordena de forma crescente. `--sort -column`, com um traço à frente, ordena de
  forma decrescente. Repetível.
- `--limit <n>` limita quantas linhas são devolvidas. Sem este sinalizador, o comando devolve no
  máximo 200 linhas. Na vista de tabela, a última linha diz quantas está a ver do total. Com
  `--json`, o total viaja no payload, e essa linha não é impressa.
- `--json` mostra saída legível por máquina em vez de uma tabela.

```bash
openldr facilities list --sort -name --limit 10
```

Este comando lista as últimas dez unidades por nome, de Z a A. Não aplica nenhum filtro, por isso
devolve linhas onde quer que o registo tenha alguma.

```bash
openldr facilities list --where level:eq:hospital --sort -name
```

Este comando lista as unidades cuja coluna level corresponde exatamente a "hospital", ordenadas
por nome de Z a A. `eq` exige uma correspondência exata, e distingue maiúsculas de minúsculas, por
isso verifique primeiro os valores de nível reais do seu próprio registo. Os registos guardam
muitas vezes valores como "Health Post", "Health Centre" ou "1st Level Hospital", e um valor que
não corresponda exatamente não devolve nada.

A CLI também pode filtrar e ordenar por `id`, a única coluna que a barra de ferramentas do
estúdio deixa de fora. `health` não tem forma `--where`: é calculada, não guardada, por isso filtre
por ela através do menu suspenso Estado do mapeamento do estúdio. Use `facilitySystem` para o
registo nacional, o mesmo nome de coluna que o filtro Registo nacional do estúdio usa.

Uma coluna desconhecida, ou um operador que essa coluna não permite, é rejeitado com uma mensagem
que identifica exatamente o erro, a mesma validação que a barra de ferramentas usa. Um sinalizador
mal escrito falha da mesma forma que um filtro mal escrito falharia no navegador.

## Guias relacionados

- [Terminologia](/docs/terminology)
- [Auditoria](/docs/audit)

## Eliminar unidades em massa

O menu da linha elimina uma unidade. Um registo nacional tem milhares, por isso uma importação mal
mapeada precisa de uma saída que não seja linha a linha. **Eliminar estas unidades…**, no menu `⋯`
da página, remove tudo o que o filtro atual da tabela seleciona.

Leia a confirmação antes de a aceitar. Nomeia três coisas, cada uma respondendo a uma pergunta
diferente:

- **A contagem.** É contra ela que a eliminação é autorizada. Se a seleção mudar entre a confirmação
  e o seu clique, a operação é recusada e nada é eliminado.
- **Quantas são usadas por relatórios.** Eliminá-las muda o que os relatórios mostram. Se o armazém
  não puder ser contactado, a janela di-lo em vez de indicar zero.
- **Algumas unidades pelo nome.** São a única proteção contra um filtro que seleciona linhas que não
  pretendia. Se não as reconhecer, cancele e verifique o filtro.

O filtro por estado de mapeamento é o único que uma eliminação em massa não consegue usar, por isso
a ação fica indisponível enquanto estiver ativo. Limpe-o e selecione antes por registo ou por área
administrativa.

A partir de um terminal:

```
openldr facilities delete --where facilitySystem:eq:urn:zmb:mfl --force
```

`--force` é obrigatório, tal como um `--where` ou um `--all` explícito: esquecer o filtro nunca
deve significar silenciosamente todo o registo.

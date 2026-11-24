# Catálogo de testes

Mantenha uma lista partilhada de testes, escolha os oferecidos neste laboratório e ligue os códigos recebidos das origens. Um teste do catálogo e um campo de resultado são diferentes. Um teste pode produzir vários campos de resultado.

**Esta configuração é opcional.** O OpenLDR pode receber e processar dados laboratoriais antes de a configurar. Recomendamos configurá-la durante o uso. O formulário Lab order oferece os testes ativados neste laboratório.

Use os seus códigos de testes, nomes, amostras e ficheiros. As capturas usam exemplos fictícios. Não precisa de dados de exemplo da documentação. Os [ficheiros opcionais de prática](#pratica-opcional-com-dados-ficticios) estão no fim.

A leitura exige **Browse terminology**. As alterações exigem **Manage terminology**. Se o catálogo vier do central, este laboratório pode alterar a disponibilidade, as amostras e os nomes locais. Não pode alterar as definições partilhadas.

As capturas usam uma instalação que detém o catálogo. Os exemplos de campos também usam um pequeno dicionário fictício de resultados. Os números dos intervalos de referência servem apenas para documentação. Use intervalos e significados de códigos aprovados para os testes reais.

## Adicionar um teste ao catálogo

Use para um teste novo quando esta instalação detém o catálogo. Pesquise um teste existente antes de adicionar outro código.

### 1. Abrir Test catalog

Selecione **Test catalog** no menu principal à esquerda.

![Test catalog está no menu principal à esquerda.](test-catalog-guide-open-page.png)

### 2. Abrir as ações de Tests

Selecione **Tests** e abra os pontos junto à pesquisa e aos controlos da tabela.

![Tests contém o catálogo disponível nesta instalação.](test-catalog-guide-tests-tab.png)

![Abra o menu de pontos da página Tests.](test-catalog-guide-page-actions-step-2.png)

### 3. Escolher Add test

Selecione **Add test**. Abre o painel do teste.

![Escolha Add test para introduzir um teste à mão.](test-catalog-guide-add-menu.png)

O painel lê-se de cima para baixo nesta ordem: **LOINC**, **Informações básicas**, **Tipos de amostra**, **Parâmetros de resultado**, **Valores de referência** e **Este laboratório**. Informações básicas tem o código, o nome, o nome curto, a categoria, os dois tempos de resposta e a verificação. Quando LOINC está carregado, escolha primeiro o código LOINC. Ele preenche os campos vazios abaixo. [Preencher um exame a partir do LOINC](#preencher-um-exame-a-partir-do-loinc) explica o que preenche. Os passos abaixo preenchem os mesmos campos à mão.

### 4. Introduzir o código

Introduza o código estável do catálogo. O exemplo fictício usa `EXAMPLE-ALPHA`. Deixe vazio apenas se o código LOINC deve tornar-se o código. Um código guardado não pode ser alterado.

![Use o código estável do catálogo. O exemplo usa EXAMPLE-ALPHA.](test-catalog-guide-test-code.png)

### 5. Introduzir o nome

Introduza o nome a apresentar. Um nome curto é opcional. O exemplo usa `Example panel Alpha` e `Example Alpha`.

![Introduza o nome do teste a apresentar.](test-catalog-guide-test-name.png)

![Um nome curto é opcional.](test-catalog-guide-test-short-name.png)

### 6. Escolher a categoria

Selecione a categoria adequada na lista configurada. As categorias vêm de Terminology.

![Escolha uma categoria na lista configurada.](test-catalog-guide-category-option.png)

### 7. Escolher as amostras aceites

Marque os tipos de amostra aceites pelo teste. Use as escolhas configuradas para o teste real.

![Marque os tipos de amostra aceites pelo teste.](test-catalog-guide-specimen.png)

## Terminar e guardar o teste

Continue no painel aberto. Pode configurar este laboratório e os campos de resultado depois de guardar a definição partilhada.

### 1. Verificar o campo LOINC

O campo LOINC está no topo do painel. Introduza um código LOINC confirmado se o tiver, ou deixe vazio. Quando LOINC estiver carregado, pesquise e selecione um termo. Aqui não está carregado, pelo que apenas verifica o formato dos códigos introduzidos. Quando LOINC está carregado, escolher um código também preenche alguns campos vazios. [Preencher um exame a partir do LOINC](#preencher-um-exame-a-partir-do-loinc) explica o que preenche.

![LOINC é opcional. Sem o dicionário, a instalação verifica apenas o formato dos códigos introduzidos.](test-catalog-guide-loinc.png)

### 2. Abrir as ações do painel

Selecione os pontos no painel do teste, abaixo do título.

![O painel do teste tem o seu próprio menu de pontos.](test-catalog-guide-sheet-actions.png)

### 3. Escolher Save

Selecione **Save**. Os testes novos também usam Save.

![Save cria o teste. Pode configurar este laboratório depois.](test-catalog-guide-save-menu.png)

**Resultado esperado:** o painel fecha e o teste aparece em Tests. Começa Off neste laboratório, salvo se o ativou no painel.

![O teste aparece em Tests. Começa Off neste laboratório.](test-catalog-guide-created.png)

## Disponibilizar um teste neste laboratório

Ative os testes que este laboratório realiza. Isto altera a disponibilidade local usada pelo formulário Lab order.

### 1. Abrir as ações da linha do teste

Selecione os pontos à direita da linha do teste.

![Use os pontos da linha do teste para a disponibilidade local.](test-catalog-guide-row-actions.png)

### 2. Escolher Switch on at this lab

Selecione **Switch on at this lab**. A mesma ação passa a Switch off at this lab num teste ativado.

![Switch on at this lab disponibiliza o teste aqui.](test-catalog-guide-enable-menu.png)

**Resultado esperado:** On at this lab mostra On. Os testes importados não ficam ativados automaticamente.

![A coluna de disponibilidade local mostra agora On.](test-catalog-guide-enabled.png)

## Definir o nome e as amostras deste laboratório

Use definições locais quando este laboratório apresenta outro nome ou aceita menos amostras. Um laboratório que recebe o catálogo do central também pode alterar estas definições.

### 1. Escolher Edit

Abra os pontos da linha e selecione **Edit**. O código guardado aparece sem campo editável.

![Edit abre o catálogo e as definições locais.](test-catalog-guide-edit-menu.png)

![Um teste existente mantém o código. Corrija o nome e os outros campos editáveis.](test-catalog-guide-fixed-code.png)

### 2. Verificar a disponibilidade local

Em **This lab**, use **On at this lab** para escolher se este laboratório oferece o teste.

![As definições This lab controlam se a instalação oferece o teste.](test-catalog-guide-local-enabled.png)

### 3. Verificar as amostras locais

Mantenha os tipos aceites neste laboratório. As escolhas locais podem restringir a lista do catálogo. Manter todas as amostras segue a lista do catálogo.

![Este laboratório pode restringir as amostras do catálogo.](test-catalog-guide-local-specimen.png)

### 4. Introduzir um nome local se necessário

Introduza o nome local no campo correspondente, ou deixe vazio para usar o nome do catálogo. O exemplo usa `Alpha at this lab`.

![Um nome local altera a apresentação do teste neste laboratório.](test-catalog-guide-local-name.png)

### 5. Guardar as definições locais

Abra os pontos do painel e selecione **Save**.

![Save guarda as definições locais com o teste existente.](test-catalog-guide-local-save.png)

**Resultado esperado:** as definições do laboratório ficam guardadas sem alterar o código do teste.

## Encontrar e exportar testes

Pesquise antes de criar outro teste. Também pode exportar testes ativos do catálogo para revisão ou importação posterior.

### 1. Pesquisar por código ou nome

Use **Search code or name**. A pesquisa também encontra nomes curtos e locais. O exemplo encontra o teste pelo nome local.

![A pesquisa encontra um teste pelo nome do catálogo ou local.](test-catalog-guide-search.png)

### 2. Ler a linha correspondente

Verifique o código e o nome do catálogo antes de editar. O teste mantém o nome do catálogo mesmo quando o nome local corresponde à pesquisa.

![O teste correspondente continua visível pelo nome do catálogo.](test-catalog-guide-search-result.png)

### 3. Escolher Export CSV quando precisa de ficheiro

Limpe a pesquisa se já não precisar dela. Abra os pontos de Tests e selecione **Export CSV** para descarregar testes ativos. Um laboratório gerido pelo central também pode exportar.

![Export CSV descarrega testes ativos do catálogo num formato importável.](test-catalog-guide-export.png)

**Resultado esperado:** o navegador descarrega um CSV com as colunas aceites pelo assistente. A exportação contém testes ativos do catálogo, não apenas uma linha visível.

O ficheiro tem três colunas para o tempo de resposta e a verificação: `expected_tat_hours`, `critical_tat_hours` e `requires_verification`. A verificação escreve-se `yes` ou `no`. No assistente de importação, estas colunas são **Tempo de resposta esperado (horas)**, **Tempo de resposta crítico (horas)** e **Requer verificação (yes/no)**. Uma importação lê yes, no, true ou false. Uma célula de tempo que não seja um número faz recusar a sua linha.

## Escolher e associar o ficheiro de testes

Importe quando tiver uma lista CSV ou Excel .xlsx. Os testes correspondem por código. A importação não retira testes ausentes do ficheiro nem altera definições locais.

### 1. Escolher Import

Em Tests, abra os pontos da página e selecione **Import**.

![Abra o menu de pontos da página Tests.](test-catalog-guide-page-actions-step-1.png)

![Import abre o assistente de revisão do ficheiro.](test-catalog-guide-import-menu.png)

Há exemplos para importar em [examples/test-catalog](https://github.com/Open-Laboratory-Data-Repository/openldr/tree/v{{version}}/examples/test-catalog).

### 2. Escolher o ficheiro

Selecione a área de ficheiro e escolha o seu CSV ou XLSX. O assistente lê o ficheiro e abre **Step 2 of 4: Columns**.

![Escolha o seu CSV ou XLSX. Nada é escrito antes de Apply.](test-catalog-guide-import-file.png)

### 3. Verificar a coluna Name

Verifique cada coluna sugerida. Name é obrigatório. Corrija um campo pelo seletor junto ao nome.

![Verifique as associações sugeridas de colunas. Name é obrigatório.](test-catalog-guide-import-columns.png)

### 4. Verificar colunas ausentes e vazias

**Not in the file** mantém um campo existente. Uma célula vazia numa coluna selecionada limpa esse campo. Associe uma coluna vazia apenas se for essa a intenção.

![Not in the file mantém o campo existente. Uma célula vazia numa coluna associada limpa-o.](test-catalog-guide-import-missing-column.png)

### 5. Continuar para Values

Abra os pontos do painel de importação e selecione **Next**.

![Next está nos pontos do painel de importação.](test-catalog-guide-import-next-actions.png)

![Next verifica os valores de categoria e amostra.](test-catalog-guide-import-next.png)

## Resolver valores e rever a importação

Values lista textos de categoria ou amostra sem correspondência numa escolha configurada. Decida o significado de cada texto antes de aplicar o ficheiro.

### 1. Encontrar valores desconhecidos

Leia o texto e a contagem de linhas afetadas. Um valor deixado **Not chosen** provoca a recusa da linha. Este exemplo tem uma categoria desconhecida.

![Um texto de categoria desconhecido exige uma decisão antes de importar a linha.](test-catalog-guide-import-unknown.png)

### 2. Escolher a categoria certa

Selecione uma categoria existente com o mesmo significado. Escolha **Add as a new category** apenas se pretender uma nova categoria.

![Escolha uma categoria existente, ou Add as a new category quando o significado é novo.](test-catalog-guide-import-new-category.png)

### 3. Verificar o código de uma nova categoria

Ao adicionar uma categoria, verifique ou altere o código gerado. Este exemplo adiciona uma categoria fictícia. Resolva também as amostras desconhecidas pelas respetivas escolhas.

![Verifique o código sugerido antes de adicionar a categoria.](test-catalog-guide-import-category-code.png)

### 4. Continuar para Review

Abra os pontos do painel e selecione **Next**.

![Next calcula as contagens de revisão com as suas decisões de valores.](test-catalog-guide-import-values-next.png)

### 5. Ler as contagens e os avisos

Verifique New, Changed, Unchanged e Refused, as razões de recusa e Categories to add. Use Back nos pontos para corrigir as decisões do ficheiro.

![Leia as contagens de linhas novas, alteradas, inalteradas e recusadas e as categorias a adicionar.](test-catalog-guide-import-review.png)

### 6. Escolher Apply

Quando a revisão corresponde à intenção, abra os pontos do painel e selecione **Apply**. Nada é escrito antes desta ação.

![Apply escreve apenas depois de rever a importação.](test-catalog-guide-import-apply.png)

**Resultado esperado:** o painel fecha e os testes importados aparecem. Começam Off neste laboratório. Importar novamente o mesmo ficheiro indica linhas inalteradas, sem duplicados.

![Os testes importados aparecem em Tests e começam Off neste laboratório.](test-catalog-guide-import-result.png)

![O ficheiro igual é reconhecido como inalterado, sem criar testes duplicados.](test-catalog-guide-repeat-review.png)

## Escolher os campos de resultado de um teste

Faça esta tarefa quando as pessoas vão introduzir resultados por este teste. As escolhas vêm do dicionário instalado. Se faltarem, importe primeiro o dicionário do sistema. [Terminologia](/docs/terminology) explica as listas de códigos e [Começar aqui](/docs/start-here) explica a CLI. A prática opcional inclui um dicionário fictício.

### 1. Abrir o teste e escolher os campos de resultado

Escolha Edit no menu da linha do teste. Marque os campos produzidos pelo teste nos seus parâmetros de resultado.

![Edit abre o catálogo e as definições locais.](test-catalog-guide-edit-menu.png)

![Marque os campos produzidos pelo teste. As escolhas vêm do dicionário de resultados.](test-catalog-guide-parameter-choice.png)

### 2. Escolher cada tipo de resultado

Escolha **Numeric**, **Coded** ou **Text** para cada campo selecionado. Um campo codificado também precisa do conjunto de valores configurado. O exemplo usa Numeric.

![Escolha Numeric, Coded ou Text para o campo de resultado.](test-catalog-guide-parameter-type.png)

### 3. Abrir as ações do campo numérico

Vá a **Valores de referência**, abaixo dos parâmetros de resultado. Cada campo numérico marcado tem aí o seu próprio título, com o seu próprio menu de pontos. Selecione os pontos junto ao campo que precisa de intervalo de referência. Sem nenhum campo numérico marcado, a secção di-lo.

![Os campos numéricos têm as suas próprias ações de intervalo.](test-catalog-guide-parameter-actions.png)

### 4. Escolher Add range

Selecione **Add range**. Aparece um formulário de intervalo de referência abaixo do título do campo.

![Add range cria um intervalo de referência para este campo.](test-catalog-guide-add-range.png)

## Definir o intervalo de referência e guardar

Use os limites aprovados para o teste, método e população. O intervalo e os números fictícios do exemplo não devem ser usados como intervalos clínicos.

### 1. Dar nome ao intervalo

Introduza um nome que identifique o intervalo. O exemplo usa `Example band only`.

![Dê nome ao intervalo. Este intervalo fictício serve apenas para documentação.](test-catalog-guide-range-name.png)

### 2. Introduzir os limites aprovados

Introduza os limites inferior e superior do teste real. Limites vazios ficam abertos. Os valores 1 e 10 da captura servem apenas para documentação.

![Use os limites aprovados para o método real. Estes números são fictícios.](test-catalog-guide-range-bounds.png)

### 3. Introduzir a unidade

Defina a unidade usada pelo intervalo. Use o mesmo significado e escala do resultado real. Um novo intervalo começa com a unidade do campo de resultado.

Escreva parte da unidade, por exemplo `mmol`, e escolha-a na lista UCUM. UCUM é a lista padrão de unidades. Se a sua unidade não estiver na lista, selecione **Usar "mmol/litre"** (a linha mostra o que escreveu) para a manter. O intervalo mostra então **Não é uma unidade UCUM**. A unidade fica guardada na mesma. Uma unidade guardada antes abre como estava e não é verificada de novo.

![Defina a unidade deste intervalo de referência.](test-catalog-guide-range-unit.png)

### 4. Verificar restrições de sexo e idade

Defina os limites de sexo ou idade aplicáveis. Um intervalo sem restrições não deve tê-los.

Preencha **Idade de** e **Idade até**, depois escolha **Idade em**: **Dias**, **Meses** ou **Anos**. Um intervalo sem unidade escolhida conta em anos. As duas idades estão dentro do intervalo. Um intervalo de 0 a 28 dias serve a um bebé no dia 28, não no dia 29. Um bebé nascido hoje tem 0 dias. A idade conta da data de nascimento até à data de hoje neste laboratório. Essa data vem de **Fuso horário** em [Laboratório](/docs/laboratory). Sem fuso horário, a data é em UTC.

Um intervalo sem nome mostra uma etiqueta feita dos seus limites. **Idade até** `28` em dias sozinha dá `até 28 dias`. **Idade de** `18` em anos sozinha dá `18 anos ou mais`.

![Os limites de sexo e idade restringem a aplicação do intervalo. Deixe abertos apenas num intervalo sem restrições.](test-catalog-guide-range-context.png)

### 5. Introduzir os limites críticos se o laboratório os usar

Escreva os limites aprovados em **Limite crítico inferior** e **Limite crítico superior**, abaixo de **Idade até**. Deixe-os vazios quando o exame não os tem. **Limite crítico inferior** tem de ser menor ou igual a **Limite inferior**, **Limite crítico superior** tem de ser maior ou igual a **Limite superior**, e **Limite crítico inferior** tem de ser menor que **Limite crítico superior**. Cada regra só é verificada quando os seus dois valores estão preenchidos.

### 6. Guardar o teste

Abra os pontos do painel do teste e selecione **Save**.

![Save guarda os campos de resultado e os intervalos selecionados.](test-catalog-guide-parameter-save.png)

**Resultado esperado:** os campos, os tipos de resultado e os intervalos selecionados ficam guardados com o teste.

## Definir o tempo de resposta e a verificação

Registe em quanto tempo os resultados deste exame devem voltar, e se uma segunda pessoa os verifica. O CE guarda-os com o exame. O plugin de laboratório ainda não os usa.

1. Abra os pontos da linha e selecione **Editar**.
2. Escreva em **Tempo de resposta esperado (horas)**, em **Informações básicas** depois da categoria, as horas da receção à libertação que o laboratório pretende. O exemplo usa `4`.
3. Escreva em **Tempo de resposta crítico (horas)** as horas após as quais o exame está atrasado, ou deixe vazio.
4. Deixe **Requer verificação** ligado quando uma segunda pessoa tem de verificar cada resultado. Desligue-o quando não for preciso.
5. Abra os pontos do painel do exame e selecione **Guardar**.

**Resultado esperado:** o exame guarda os dois tempos e o interruptor. Cada tempo tem de ser um número acima de 0. Um tempo vazio não tem meta. Um laboratório que recebe o catálogo do central vê estes valores como texto e não os pode alterar.

## Preencher um exame a partir do LOINC

Quando LOINC está carregado, escolher um código LOINC no painel do exame preenche parte do exame. Preenche apenas os campos ainda vazios. Nunca altera um campo que preencheu nem um parâmetro de resultado que marcou. Nada é escrito antes de guardar.

1. Abra o painel do exame com **Adicionar exame** ou **Editar**.
2. Escreva parte do nome ou do código em **LOINC**. Cada resultado mostra uma segunda linha com o nome curto, a classe e a unidade do LOINC. Escolha o termo.
3. Verifique **Nome** e **Nome curto**. Um nome vazio recebe o nome longo do LOINC. Um nome curto vazio recebe o nome curto do LOINC.
4. Leia abaixo de **Categoria**. Quando a categoria estava vazia e a classe LOINC corresponde a uma categoria aqui, é escolhida. Quando a categoria tem outro valor, um botão diz `Chemistry, sugerida`. Selecione-o para usar a categoria do LOINC. Quando a classe não corresponde a nenhuma categoria aqui, uma linha di-lo.
5. Leia **Tipos de amostra**. Quando a lista estava vazia e um só tipo de amostra corresponde claramente, fica marcado. Os outros tipos que correspondem mostram **sugerido** ao lado. Marque-os se o exame os aceitar.
6. Leia **Parâmetros de resultado**. Quando o exame ainda não tem campos de resultado, o campo de resultado do LOINC é adicionado e marcado. Um campo que ainda não está no dicionário de resultados mostra **Novo, guardado com o teste**.
7. Verifique cada parâmetro de resultado, depois abra os pontos do painel do exame e selecione **Guardar**.

**Resultado esperado:** Guardar cria primeiro cada campo novo marcado no dicionário de resultados, e depois guarda o exame. Um campo novo que desmarque antes de guardar nunca é criado. O campo recebe o nome do componente LOINC, por exemplo `Cholesterol` para 2093-3. Um código de quantidade torna-se um campo numérico com a unidade do LOINC. Um código ordinal com lista de respostas torna-se um campo codificado, com essa lista como conjunto de valores. Qualquer outro código torna-se um campo de texto. Um novo intervalo começa com a unidade do campo.

Escolha outro código, ou limpe o código, e o painel retira os campos de resultado que a última escolha e **Preencher a partir do painel** adicionaram. Os campos que marcou à mão ficam. Um nome, nome curto, categoria ou amostra que uma escolha preencheu fica até o alterar.

### Adicionar os campos do LOINC a um exame que já tem campos

Uma escolha não adiciona campo de resultado quando o exame já tem um. Use antes os pontos de **Parâmetros de resultado**.

1. Selecione **Usar o campo de resultado do LOINC** para marcar o campo do LOINC ao lado dos que já existem.
2. Para um código de painel, selecione **Preencher a partir do painel**. Marca um campo para cada exame do painel, pela ordem do LOINC.
3. Quando o exame já tem campos de resultado, Preencher a partir do painel pergunta primeiro. Escolha **Substituir** para os trocar pelos do painel, ou **Adicionar** para adicionar só os que faltam.
4. Abra os pontos do painel do exame e selecione **Guardar**.

**Resultado esperado:** ambos esperam por Guardar, como uma escolha. Um campo que já está no dicionário é reutilizado, por isso repetir qualquer um deles não adiciona nada de novo. Um exame do painel para o qual o LOINC não dá campo de resultado não é adicionado, e uma mensagem indica-o.

### Procurar no LOINC

Use isto quando sabe o tipo de exame mas não o nome nem o código.

1. Selecione os pontos ao lado de **LOINC** e escolha **Procurar no LOINC**.
2. Abra os ramos da árvore LOINC e escolha o código.

**Resultado esperado:** a árvore fecha. O código preenche o exame da mesma forma que uma escolha na pesquisa.

### Tipos de amostra e SNOMED

Uma instalação nova tem 15 tipos de amostra: Blood, Urine, CSF, Sputum, Plasma, Serum, Stool, Pleural fluid, Ascitic fluid, Saliva, Wound specimen, Throat swab, Nasal swab, Synovial fluid e Bone marrow. Cada um está ligado ao seu código SNOMED na tabela de correspondência local. Uma escolha LOINC encontra um tipo de amostra por essa ligação.

Uma instalação atualizada a partir de uma versão anterior recebe os tipos e ligações em falta na atualização. A atualização só adiciona o que falta. Um tipo que retirou da lista continua retirado. Uma ligação SNOMED que alterou ou desligou fica como a deixou.

Abrir um exame guardado mostra as linhas LOINC mas não preenche nada. Só um código escolhido no painel preenche campos. Para que outro tipo de amostra seja encontrado, associe-o ao seu código SNOMED em [Terminologia](/docs/terminology).

## Adicionar um campo de resultado a partir do exame

Use isto quando o exame precisa de um campo de resultado que ainda não está no dicionário de resultados. Um laboratório que recebe o dicionário do central não pode adicionar campos.

1. Abra o painel do exame com **Adicionar exame** ou **Editar**.
2. Abra os pontos ao lado de **Parâmetros de resultado** e selecione **Adicionar campo**.
3. Escreva o nome do campo em **Nome**. O exemplo usa `Haemoglobin A1c`.
4. Deixe **Código** vazio para criar um a partir do nome, por exemplo `HAEMOGLOBIN_A1C`, ou escreva o seu próprio código.
5. Escolha o **Tipo**. Para um número, escolha a **Unidade** no UCUM. Para um campo codificado, escolha o **Conjunto de valores**.
6. Abra os pontos de **Adicionar campo de resultado** e selecione **Guardar**.
7. Abra os pontos do painel do exame e selecione **Guardar**.

**Resultado esperado:** o novo campo fica marcado no exame com o tipo escolhido e aparece em **Campos de resultado**. Um código que já está no dicionário é recusado. Dê outro código, ou marque o campo que já existe.

## Ligar um código de teste recebido ao catálogo

Faça esta tarefa depois de chegarem os dados laboratoriais habituais. Se Observed estiver vazio, crie o catálogo e volte mais tarde. Ativar um teste localmente e associar um código recebido são ações separadas.

### 1. Abrir Observed

Selecione **Observed** no topo. Tests lista os códigos recebidos com pedidos.

![Observed lista códigos de testes e resultados recebidos das origens.](test-catalog-guide-observed-tab.png)

![Cada código da origem mostra a associação atual ao catálogo.](test-catalog-guide-observed-test-row.png)

### 2. Escolher Map to catalog test

Abra os pontos da linha do código recebido e selecione **Map to catalog test**.

![Abra os pontos da linha do código da origem.](test-catalog-guide-observed-row-actions.png)

![Map to catalog test abre o seletor de destino.](test-catalog-guide-map-test-menu.png)

### 3. Abrir o seletor de destino

Selecione **Choose a catalog test**.

![Choose a catalog test é o seletor de destino.](test-catalog-guide-map-picker.png)

### 4. Pesquisar no catálogo

Em **Search catalog tests**, pesquise o teste que este código da origem realmente representa.

![Pesquise o teste do catálogo com o significado real deste código da origem.](test-catalog-guide-map-search.png)

### 5. Selecionar o teste certo

Escolha o teste correspondente. Verifique o código e o nome.

![Selecione o teste correspondente do catálogo.](test-catalog-guide-map-target.png)

### 6. Guardar a associação

Abra os pontos do painel de associação e selecione **Save**.

![O painel de associação tem o seu próprio menu de pontos.](test-catalog-guide-map-actions.png)

![Save guarda a associação usada pelos relatórios.](test-catalog-guide-map-save.png)

**Resultado esperado:** o código recebido mostra o seu Catalog test. Os relatórios podem contar o código da origem através desta identidade do catálogo.

![O código da origem mostra agora o teste do catálogo.](test-catalog-guide-mapped-test.png)

## Fazer corresponder códigos de resultados ao dicionário

Os códigos de resultado identificam resultados individuais. São diferentes dos códigos de teste. A correspondência exata é útil quando a origem e o dicionário usam os mesmos códigos. As associações existentes e os códigos ambíguos ficam iguais.

### 1. Escolher Results em Observed

Selecione **Results** para ver códigos de resultado recebidos.

![Results muda Observed de códigos de teste para códigos de resultado.](test-catalog-guide-results-toggle.png)

![Os códigos de resultado são separados dos códigos de teste.](test-catalog-guide-result-code-row.png)

### 2. Escolher Map matching codes

Abra os pontos de Observed e selecione **Map matching codes**.

![Abra os pontos de Observed para associar códigos de resultado.](test-catalog-guide-observed-actions.png)

![Map matching codes verifica correspondências exatas com o dicionário de resultados.](test-catalog-guide-match-menu.png)

### 3. Escolher o sistema laboratorial

Escolha o sistema de origem cujos códigos pretende comparar. Se só existir um, fica selecionado automaticamente.

![Escolha o sistema laboratorial cujos códigos de resultado pretende comparar.](test-catalog-guide-match-system.png)

### 4. Ler as correspondências propostas

Verifique cada código, nome de destino e contagem de resultados. Nomes iguais não substituem a verificação do significado real dos códigos.

![Leia as correspondências exatas propostas antes de aplicar.](test-catalog-guide-match-preview.png)

### 5. Abrir Matching actions

Selecione os pontos no painel de correspondências.

![Abra Matching actions depois de verificar a lista.](test-catalog-guide-match-actions.png)

### 6. Aplicar as correspondências

Selecione **Map these codes**. Para códigos diferentes, use Map to result field na linha do código recebido.

![Map these codes aplica as correspondências propostas.](test-catalog-guide-match-apply.png)

**Resultado esperado:** o código associado indica o seu Result field. Se a página indicar uma cópia do armazém desatualizada, os pontos oferecem Rebuild warehouse copy.

![O código de resultado recebido indica agora o campo de resultado.](test-catalog-guide-matched-result.png)

![Rebuild warehouse copy repete a publicação das associações quando a página indica uma cópia desatualizada.](test-catalog-guide-rebuild-menu.png)

## Ligar um campo de resultado a LOINC

Use um código confirmado para o significado do campo real. O exemplo fictício apenas demonstra o editor. A entrada LOINC ilustrativa não recomenda um código para o seu campo. Um laboratório que recebe o dicionário do central não pode alterar estas ligações.

### 1. Abrir Result fields

Selecione **Result fields**. Encontre o código do dicionário e verifique o papel e as unidades.

![Result fields lista campos do dicionário de resultados instalado.](test-catalog-guide-result-fields-tab.png)

![Result fields mostra o código, o papel, as unidades e a ligação LOINC do dicionário.](test-catalog-guide-result-field-row.png)

### 2. Escolher Link LOINC

Abra os pontos da linha do campo e selecione **Link LOINC**.

![Abra os pontos da linha do campo de resultado.](test-catalog-guide-result-field-actions.png)

![Link LOINC abre o editor da ligação do campo.](test-catalog-guide-loinc-link-menu.png)

### 3. Introduzir ou selecionar o LOINC confirmado

Com LOINC carregado, pesquise e selecione. Caso contrário, introduza o código confirmado. Esta instalação verifica apenas o formato do código introduzido. Não prova o significado clínico.

![Introduza o LOINC confirmado do campo real. Sem LOINC carregado, apenas verifica o formato do código introduzido.](test-catalog-guide-loinc-input.png)

### 4. Guardar a ligação

Abra os pontos da ligação LOINC e selecione **Save**.

![Use os pontos da ligação LOINC para guardar.](test-catalog-guide-loinc-actions.png)

![Save guarda a ligação. Verifique o significado na sua terminologia antes de usar.](test-catalog-guide-loinc-save.png)

**Resultado esperado:** a linha do campo mostra o código LOINC. Export CSV no menu Result fields descarrega as ligações.

![A linha do campo mostra agora o código LOINC guardado.](test-catalog-guide-loinc-result.png)

![Export CSV descarrega as ligações do dicionário para revisão ou edição.](test-catalog-guide-result-export.png)

## Usar Test catalog num telemóvel

Os mesmos separadores e ações continuam disponíveis no telemóvel. As tabelas largas podem deslocar-se horizontalmente.

### 1. Escolher o separador

Use Tests, Result fields ou Observed no topo da página.

![Tests, Result fields e Observed continuam no topo no telemóvel.](test-catalog-guide-phone-tests.png)

### 2. Abrir as ações relevantes

Em Tests, os pontos da página ficam junto à pesquisa e aos controlos da tabela. Cada linha mantém o seu menu.

![Os pontos de Tests ficam junto à pesquisa e aos controlos da tabela.](test-catalog-guide-phone-actions.png)

### 3. Escolher códigos de resultado recebidos

Em Observed, escolha Results para códigos de resultado recebidos em vez de códigos de teste.

![Use Results para trabalhar com códigos de resultado recebidos no telemóvel.](test-catalog-guide-phone-results.png)

## Prática opcional com dados fictícios

Cada tarefa anterior pode usar os seus dados. Use estes ficheiros apenas numa instalação de teste. Um teste pode ser retirado, mas não eliminado. Não importe testes fictícios para um catálogo em uso real.

- [Descarregar um CSV com dois testes](https://openldr.online/docs-samples/user-guide/test-catalog/example-tests.csv) para a tarefa de importação.
- [Descarregar um dicionário de resultados com um campo](https://openldr.online/docs-samples/user-guide/test-catalog/example-result-fields.json) para as tarefas de campos de resultado.
- [Descarregar quatro recursos laboratoriais fictícios](https://openldr.online/docs-samples/user-guide/test-catalog/example-lab-data.json) para preencher Observed.

Para seguir as imagens exatamente, adicione primeiro EXAMPLE-ALPHA à mão. O CSV sozinho cria Beta e Gamma. Use os seus nomes correspondentes se não usar os ficheiros de prática.

Para o dicionário e o lote opcionais, siga primeiro [Começar aqui](/docs/start-here). Coloque os ficheiros descarregados na pasta `data` da instalação. Exemplo numa cópia de desenvolvimento:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr terminology import resource data/example-result-fields.json
pnpm openldr ingest data/example-lab-data.json
```

Numa instalação Linux ou macOS, use `./openldr` em vez de `pnpm openldr`. No Windows, use `.\openldr.ps1` na pasta da instalação, como `C:\openldr_ce`. Substitua a pasta de exemplo pela real. Começar aqui mostra os passos de cada plataforma.

## Antes de usar as sugestões LOINC

As sugestões LOINC, **Procurar no LOINC**, **Usar o campo de resultado do LOINC** e **Preencher a partir do painel** precisam do LOINC carregado nesta instalação, com a sua ontologia construída. Sem eles, o painel do exame não mostra linhas LOINC nem ações LOINC. **Adicionar campo** continua a funcionar. Um administrador carrega o LOINC a partir do CLI, de uma pasta com a versão LOINC descompactada:

```shell
./openldr terminology import loinc data/loinc --accept-license
./openldr terminology ontology build cs-url-LOINC data/loinc
```

No Windows, use `.\openldr.ps1` em vez de `./openldr`. Uma instalação que carregou o LOINC antes de existirem as sugestões LOINC tem de importar o LOINC de novo. Até lá, o LOINC não sugere nenhuma unidade. Uma instalação que carregou o LOINC antes de existirem os nomes curtos também tem de o importar de novo para os obter. Execute o mesmo comando `terminology import loinc`. Até lá, uma escolha deixa **Nome curto** vazio e a pesquisa não mostra nome curto. A página CLI do site lista os comandos das sugestões LOINC e dos campos de resultado.

## Antes de alterar dados partilhados do catálogo

Um catálogo recebido do central tem definições partilhadas de leitura. A disponibilidade, as escolhas de amostras e os nomes locais continuam a ser definições deste laboratório.

A importação aceita até 5 000 linhas e 5 MB. A importação Excel lê a primeira folha. Os testes correspondem por código. Um ficheiro não retira testes ausentes nem altera definições locais.

Retirar um teste oculta-o da lista ativa predefinida. Pode ser restaurado. Os testes do catálogo não podem ser eliminados. Use o filtro Status para encontrar testes retirados.

## Resolução de problemas

**Add test ou Import não aparece.** Verifique se o catálogo vem do central e se a conta pode gerir terminologia. Leia a mensagem de propriedade acima da tabela.

**Falta um teste novo em Lab order.** Verifique On at this lab. Criar ou importar um teste não o ativa automaticamente.

**A importação recusa linhas.** Leia a razão de cada linha em Review. Volte a Values para categorias ou amostras sem escolha. Verifique Name e o código ou LOINC que fornece a identidade.

**Não aparecem parâmetros de resultado.** A instalação não tem campos utilizáveis no dicionário. Carregue primeiro o dicionário do sistema. O dicionário de prática é apenas um exemplo.

**Um código continua sem associação.** Verifique se selecionou Tests ou Results. Associar um nível não associa o outro.

**Guardar recusa um limite crítico.** A mensagem, em inglês, indica o campo e o intervalo, por exemplo `HGB range 1: the critical low limit must be at or below the low limit.` Corrija o limite e guarde de novo.

**Não aparece nenhuma linha LOINC abaixo de um campo.** O LOINC ou a sua ontologia não está carregado nesta instalação. Veja [Antes de usar as sugestões LOINC](#antes-de-usar-as-sugestoes-loinc).

**O LOINC não sugere nenhuma unidade.** Esta instalação carregou o LOINC antes de existirem as sugestões LOINC. Importe o LOINC de novo.

**Uma escolha LOINC deixa Nome curto vazio.** Esta instalação carregou o LOINC antes de serem lidos os nomes curtos. Importe o LOINC de novo com `terminology import loinc`. Veja [Antes de usar as sugestões LOINC](#antes-de-usar-as-sugestoes-loinc).

**Uma escolha não adiciona campo de resultado.** O exame já tinha um campo de resultado, ou o código é um painel. Use **Usar o campo de resultado do LOINC** ou **Preencher a partir do painel** nos pontos de Parâmetros de resultado.

**Um intervalo mostra Não é uma unidade UCUM.** A unidade que manteve não está na lista UCUM. Fica guardada como foi escrita. Escolha a mesma unidade na lista, se existir.

**A página indica uma cópia do armazém desatualizada.** Abra as ações de Observed e escolha Rebuild warehouse copy. A página indica falha se não conseguir reconstruir.

## Guias relacionados

[Terminologia](/docs/terminology) explica as listas de códigos configuradas. [Unidades](/docs/facilities) explica códigos de unidades. [Começar aqui](/docs/start-here) explica a CLI instalada e de desenvolvimento. [Configuração do laboratório](/docs/lab-setup) explica os limites críticos e o módulo de laboratório.

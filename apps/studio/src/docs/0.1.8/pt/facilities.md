# Unidades de saúde

Dê nomes, códigos e localizações consistentes às unidades dos seus dados. Adicione unidades, importe um registo e ligue os códigos recebidos às unidades certas.

**Esta configuração é opcional.** O OpenLDR pode receber e processar dados antes de configurar Facilities. Recomendamos completar a configuração durante a utilização do sistema para identificar as unidades nos relatórios.

**Registry** contém as unidades adicionadas ou importadas. **Observed** contém os códigos recebidos e mostra a unidade correspondente. Adicionar uma unidade e ligar um código recebido são tarefas distintas.

Um **registo** é uma lista mantida por uma organização, como um diretório nacional ou a lista da sua organização. **System** seleciona esse registo. O URI e o **Facility code** identificam a unidade em conjunto.

Use o seu próprio registo, os seus dados e ficheiros. As capturas mostram unidades fictícias. Não precisa de dados de exemplo. Os [ficheiros de prática opcionais](#pratica-opcional-com-dados-ficticios) estão no fim.

A consulta exige **View facilities**. Adicionar, editar, importar e ligar exige **Manage facilities**. Add e Edit também exigem um formulário publicado destinado a Facilities. Esse formulário define os campos e as indicações obrigatórias.

## Registar a origem da lista de unidades

Faça isto uma vez por registo. Se o registo já aparece em **System** ou **National system**, use-o e passe esta tarefa. Não crie outra origem para o mesmo registo.

### 1. Abrir Facilities

Selecione **Facilities** no menu principal à esquerda.

![Captura do Studio: Abrir Facilities](facilities-guide-open-facilities.png)

### 2. Abrir Import facilities

Em **Registry**, abra os pontos à direita dos separadores e selecione **Import facilities**.

![Captura do Studio: Abrir Import facilities](facilities-guide-source-actions.png)

![Captura do Studio: Abrir Import facilities](facilities-guide-source-import.png)

### 3. Escolher Register a source

Selecione **Register a source**. Pode registar a origem antes de escolher um ficheiro. Quando já existem origens, esta ação está no menu do painel de importação.

![Captura do Studio: Escolher Register a source](facilities-guide-register-source-button.png)

![Captura do Studio: Escolher Register a source](facilities-guide-register-existing-actions.png)

![Captura do Studio: Escolher Register a source](facilities-guide-register-existing-menu.png)

### 4. Introduzir o URI permanente do registo

Em **Canonical URI**, use o identificador fornecido pela organização responsável. Para uma lista própria, escolha um URI estável. O exemplo fictício usa `urn:example:facilities:guide`.

![Captura do Studio: Introduzir o URI permanente do registo](facilities-guide-register-url.png)

### 5. Introduzir o nome

Em **Display name**, introduza o nome que as pessoas devem escolher. O exemplo usa `Example facility register`.

![Captura do Studio: Introduzir o nome](facilities-guide-register-name.png)

### 6. Introduzir um código curto

Em **Code**, introduza um identificador curto para o registo. O exemplo usa `EXAMPLE`. Version, jurisdiction e contact são opcionais.

![Captura do Studio: Introduzir um código curto](facilities-guide-register-code.png)

### 7. Registar a origem

Abra o menu deste painel e selecione **Register**.

![Captura do Studio: Registar a origem](facilities-guide-register-actions.png)

![Captura do Studio: Registar a origem](facilities-guide-register-save.png)

**Resultado esperado:** o novo registo fica selecionado no painel de importação. Registar a origem ainda não importou nenhuma unidade.

![Captura do Studio: Registar a origem](facilities-guide-register-selected.png)

### 8. Fechar o painel para adicionar manualmente

Selecione **Close** no canto superior direito. Para importar um ficheiro, mantenha o painel aberto e [continue a importação](#escolher-o-ficheiro-do-registo).

![Captura do Studio: Fechar o painel para adicionar manualmente](facilities-guide-close-import.png)

## Começar uma ficha de unidade

Adicione manualmente quando precisa de introduzir um único local. Os passos seguintes usam o formulário publicado nesta instalação. Preencha os campos obrigatórios do seu formulário.

### 1. Escolher Add facility

Em **Registry**, abra o menu da página e selecione **Add facility**.

![Captura do Studio: Escolher Add facility](facilities-guide-add-actions.png)

![Captura do Studio: Escolher Add facility](facilities-guide-add-menu.png)

### 2. Escolher System

Em **System**, selecione a origem registada desta unidade. O nome seleciona o URI canónico.

![Captura do Studio: Escolher System](facilities-guide-add-system.png)

### 3. Introduzir Facility code

Introduza o código exato usado pelo registo, incluindo os zeros iniciais. O exemplo usa `EXAMPLE-CLINIC-01`.

![Captura do Studio: Introduzir Facility code](facilities-guide-add-code.png)

### 4. Introduzir Name

Introduza o nome legível da unidade. O exemplo usa `Example Clinic North`.

![Captura do Studio: Introduzir Name](facilities-guide-add-name.png)

### 5. Escolher Country

Pesquise o país e selecione um resultado. Escrever apenas a pesquisa não seleciona a resposta.

![Captura do Studio: Escolher Country](facilities-guide-add-country.png)

### 6. Introduzir Zone se o formulário exigir

Introduza a zona real da unidade. As sugestões vêm das localizações já introduzidas neste registo. A captura usa `Example Zone`.

![Captura do Studio: Introduzir Zone se o formulário exigir](facilities-guide-add-zone.png)

### 7. Introduzir District e outras localizações obrigatórias

Este formulário também exige **District**. Preencha o distrito da unidade. Complete Region ou Council quando tiver esses dados.

![Captura do Studio: Introduzir District e outras localizações obrigatórias](facilities-guide-add-district.png)

**Continue abaixo:** a ficha continua aberta em New facility. Ainda não foi guardada.

## Completar e guardar a unidade

Continue no painel **New facility** aberto. Escolha o estado e o tipo na terminologia configurada e guarde.

### 1. Escolher Status

Pesquise em **Status** e selecione o resultado adequado. O exemplo escolhe **Active**.

![Captura do Studio: Escolher Status](facilities-guide-add-status.png)

### 2. Escolher Level

**Level** seleciona o tipo de unidade. Pesquise e escolha o tipo adequado entre os disponíveis na instalação.

![Captura do Studio: Escolher Level](facilities-guide-add-level.png)

### 3. Abrir o menu do painel

Selecione os pontos abaixo do título do painel, perto do canto superior direito.

![Captura do Studio: Abrir o menu do painel](facilities-guide-add-sheet-actions.png)

### 4. Escolher Create

Selecione **Create**. Se o formulário indicar campos em falta, preencha-os e tente novamente.

![Captura do Studio: Escolher Create](facilities-guide-add-create.png)

**Resultado esperado:** o painel fecha e Registry volta a carregar. A unidade aparece com código, nome e origem. Se um filtro a esconder, pesquise pelo código.

![Captura do Studio: Escolher Create](facilities-guide-add-result.png)

## Encontrar e alterar uma unidade

Use esta tarefa para corrigir um nome, uma localização ou outro detalhe. Pesquisar primeiro também evita criar outra ficha para uma unidade existente.

### 1. Pesquisar a unidade

Em **Search facilities…**, introduza o nome ou código. O exemplo pesquisa `EXAMPLE-CLINIC-01`.

![Captura do Studio: Pesquisar a unidade](facilities-guide-search-input.png)

### 2. Abrir a linha

Selecione a linha da unidade. Os dados guardados abrem em **Edit facility**.

![Captura do Studio: Abrir a linha](facilities-guide-edit-row.png)

### 3. Alterar os dados

Edite o campo a corrigir. Aqui, Name passa a `Example Clinic North Updated`.

![Captura do Studio: Alterar os dados](facilities-guide-edit-name.png)

### 4. Abrir o menu do painel

Selecione os pontos abaixo do título do painel.

![Captura do Studio: Abrir o menu do painel](facilities-guide-edit-actions.png)

### 5. Escolher Save

Selecione **Save**. As fichas existentes usam Save; as novas usam Create.

![Captura do Studio: Escolher Save](facilities-guide-edit-save.png)

**Resultado esperado:** Registry mostra as alterações. O exemplo mantém o código. System e Facility code também podem ser corrigidos. Não elimine a ficha apenas para corrigir o código.

![Captura do Studio: Escolher Save](facilities-guide-edit-result.png)

## Consultar as alterações

History mostra as alterações de uma unidade, com a data e o autor. Pode consultar sem alterar a ficha.

### 1. Abrir o menu da linha

Selecione os pontos à direita da linha da unidade.

![Captura do Studio: Abrir o menu da linha](facilities-guide-history-row-actions.png)

### 2. Escolher History

Selecione **History**.

![Captura do Studio: Escolher History](facilities-guide-history-menu.png)

**Resultado esperado:** Facility history mostra primeiro as alterações mais recentes. O exemplo mostra a alteração do nome e a criação inicial.

![Captura do Studio: Escolher History](facilities-guide-history-result.png)

### 3. Fechar History

Selecione **Close** no canto superior direito para regressar a Registry.

![Captura do Studio: Fechar History](facilities-guide-history-close.png)

## Escolher o ficheiro do registo

Importe uma lista existente em CSV, JSON Lines ou Excel `.xlsx`. Precisa de uma coluna de códigos e outra de nomes. Os restantes campos podem ser associados, fornecidos como valores fixos ou mantidos como dados adicionais.

Use a origem registada que detém os códigos deste ficheiro. Os requisitos do formulário manual não definem as colunas obrigatórias da importação.

### 1. Abrir Import facilities

Em Registry, abra o menu da página e selecione **Import facilities**.

![Captura do Studio: Abrir Import facilities](facilities-guide-import-actions.png)

![Captura do Studio: Abrir Import facilities](facilities-guide-import-menu.png)

### 2. Escolher o ficheiro

Selecione a área File e escolha o seu ficheiro. O nome aparece em Source. O formato acompanha o ficheiro escolhido.

![Captura do Studio: Escolher o ficheiro](facilities-guide-import-file.png)

![Captura do Studio: Escolher o ficheiro](facilities-guide-import-format.png)

### 3. Escolher National system

Selecione a origem registada deste ficheiro. Se faltar, [registe a origem](#registar-a-origem-da-lista-de-unidades) primeiro.

![Captura do Studio: Escolher National system](facilities-guide-import-register-step-3.png)

### 4. Indicar se é uma versão completa

Marque **This file is a complete release** apenas se o ficheiro contém todo o registo. Deixe desmarcado para um ficheiro parcial. Uma versão completa permite verificar as unidades existentes ausentes do ficheiro.

![Captura do Studio: Indicar se é uma versão completa](facilities-guide-import-complete-release.png)

### 5. Continuar para Mapping

Selecione **Continue**. O ficheiro é enviado e guardado e abre Mapping. Ainda não foi importada nenhuma unidade.

![Captura do Studio: Continuar para Mapping](facilities-guide-import-continue.png)

## Associar colunas e valores fixos

Mapping liga os cabeçalhos do ficheiro aos campos do OpenLDR. Verifique as sugestões para código e nome e decida como tratar as restantes colunas.

### 1. Verificar as colunas obrigatórias

A coluna do código deve corresponder a `national_code`. O nome legível deve corresponder a `name`. Abra a lista ao lado de um cabeçalho para corrigir o destino.

![Captura do Studio: Verificar as colunas obrigatórias](facilities-guide-map-code.png)

![Captura do Studio: Verificar as colunas obrigatórias](facilities-guide-map-name.png)

### 2. Corrigir outros destinos

Escolha o campo adequado ao lado de cada cabeçalho. Aqui, **Operating Status** deve corresponder a `status` em vez de permanecer como dado adicional.

![Captura do Studio: Corrigir outros destinos](facilities-guide-map-status-option.png)

### 3. Manter colunas adicionais úteis

Para uma coluna sem campo padrão, abra o menu da linha e selecione **Keep as extra**. O exemplo mantém Notes.

![Captura do Studio: Manter colunas adicionais úteis](facilities-guide-map-extra-actions.png)

![Captura do Studio: Manter colunas adicionais úteis](facilities-guide-map-extra-save.png)

### 4. Fornecer valores fixos para colunas ausentes

Se todas as unidades partilham um valor ausente do ficheiro, introduza-o em **Fixed values**. Aqui, Country é selecionado na terminologia. Todas as linhas recebem esse país.

![Captura do Studio: Fornecer valores fixos para colunas ausentes](facilities-guide-map-fixed-country.png)

### 5. Decidir o tratamento das alterações após a pré-visualização

Em **Rows changed since this preview**, escolha ignorar essas linhas ou substituí-las pelo ficheiro. Por predefinição, essas linhas do registo ficam intactas.

![Captura do Studio: Decidir o tratamento das alterações após a pré-visualização](facilities-guide-map-conflict-policy.png)

### 6. Validar o ficheiro

Selecione **Validate all**. A verificação decorre em segundo plano e depois abre Review. Corrija qualquer associação obrigatória em falta antes de continuar.

![Captura do Studio: Validar o ficheiro](facilities-guide-map-validate.png)

**Resultado esperado:** Review descreve os efeitos do ficheiro e das associações atuais. Se houver valores sem associação canónica, defina-os como abaixo.

![Captura do Studio: Validar o ficheiro](facilities-guide-review-unmapped.png)

## Definir valores desconhecidos

O ficheiro pode usar palavras diferentes da terminologia configurada. Associe-as aos valores pretendidos. O exemplo usa Operating e Closed como estados.

### 1. Regressar a Mapping

Em Review, selecione **Map these values**. As opções aparecem abaixo da coluna correspondente em Mapping.

![Captura do Studio: Regressar a Mapping](facilities-guide-review-map-values.png)

### 2. Definir o significado de Operating

Neste exemplo, escolha **Active** para Operating. No seu ficheiro, escolha o valor com o mesmo significado.

![Captura do Studio: Definir o significado de Operating](facilities-guide-map-operating.png)

### 3. Definir o significado de Closed

Neste exemplo, escolha **Inactive** para Closed. Não junte significados diferentes apenas para remover um aviso.

![Captura do Studio: Definir o significado de Closed](facilities-guide-map-closed.png)

### 4. Verificar novamente

Selecione **Validate all**. As decisões ficam guardadas para este registo e o ficheiro é verificado novamente.

![Captura do Studio: Verificar novamente](facilities-guide-map-revalidate.png)

**Resultado esperado:** Review reflete as novas decisões. Neste exemplo, desaparece o aviso de estado sem associação.

## Rever e aplicar a importação

Leia as alterações previstas antes de as aplicar. Um ficheiro pode criar linhas, alterar linhas ou corresponder às existentes. Os números dependem do ficheiro e do registo atual.

### 1. Ler o resumo

Verifique os números de linhas novas, alteradas, inalteradas e ignoradas, além dos avisos. Se necessário, volte a Mapping e valide novamente. Review apresenta as decisões sem as editar.

![Captura do Studio: Ler o resumo](facilities-guide-review-summary.png)

### 2. Confirmar a importação revista

Selecione **Confirm import**. Aguarde o painel de conclusão.

![Captura do Studio: Confirmar a importação revista](facilities-guide-import-confirm.png)

**Resultado esperado:** Import complete indica as criações, atualizações e linhas inalteradas ou ignoradas.

![Captura do Studio: Confirmar a importação revista](facilities-guide-import-complete.png)

### 3. Regressar a Registry

Selecione **Close** no canto superior direito. O registo volta a carregar com as unidades importadas.

![Captura do Studio: Regressar a Registry](facilities-guide-import-close.png)

![Captura do Studio: Regressar a Registry](facilities-guide-import-result.png)

## Atualizar um registo existente

Quando chegar a próxima versão do ficheiro, repita a importação com o mesmo National system. O registo e o código identificam as linhas existentes. Não precisa de recriar essas unidades manualmente.

### 1. Reutilizar a origem registada

Escolha o mesmo registo na nova importação e repita Source e Mapping. Verifique novamente as colunas.

![Captura do Studio: Reutilizar a origem registada](facilities-guide-import-register-step-1.png)

### 2. Ler as alterações previstas

Após a validação, confira os números. Repetir o mesmo ficheiro de exemplo encontra duas linhas inalteradas e não cria nenhuma.

![Captura do Studio: Ler as alterações previstas](facilities-guide-reimport-summary.png)

### 3. Aplicar as alterações revistas

Selecione **Confirm import** quando o resumo corresponde à sua intenção.

![Captura do Studio: Aplicar as alterações revistas](facilities-guide-reimport-confirm.png)

**Resultado esperado:** o ficheiro repetido indica linhas inalteradas sem criar duplicados. Um ficheiro alterado apresenta as diferenças reais.

![Captura do Studio: Aplicar as alterações revistas](facilities-guide-reimport-complete.png)

## Ligar códigos recebidos que correspondem ao registo

Faça esta tarefa após a chegada dos dados laboratoriais. Observed lista os códigos recebidos. Se estiver vazio, pode criar Registry agora e regressar após a chegada do fluxo habitual.

A correspondência exata liga um código recebido à unidade com o mesmo código no registo escolhido. As associações existentes são mantidas.

### 1. Abrir Observed

Selecione **Observed** ao lado de Registry.

![Captura do Studio: Abrir Observed](facilities-guide-observed-tab.png)

### 2. Escolher Link matching codes

Abra o menu da página Observed e selecione **Link matching codes**.

![Captura do Studio: Escolher Link matching codes](facilities-guide-observed-actions.png)

![Captura do Studio: Escolher Link matching codes](facilities-guide-matching-menu.png)

### 3. Escolher o registo

Selecione o registo cujos códigos pretende comparar.

![Captura do Studio: Escolher o registo](facilities-guide-matching-register.png)

### 4. Ler as correspondências propostas

Confira os números e nomes. O exemplo tem três códigos para ligar e um sem correspondência. Os seus números vêm dos seus dados.

![Captura do Studio: Ler as correspondências propostas](facilities-guide-matching-preview.png)

### 5. Abrir Link actions

Selecione os pontos no canto superior direito deste painel.

![Captura do Studio: Abrir Link actions](facilities-guide-matching-actions.png)

### 6. Aplicar as correspondências

Selecione **Link N codes**, sendo N o número da sua pré-visualização. O exemplo mostra Link 3 codes.

![Captura do Studio: Aplicar as correspondências](facilities-guide-matching-apply.png)

**Resultado esperado:** os códigos correspondentes mostram a unidade em Resolves to. Report facilities pode mostrar Updating durante a reconstrução das ligações dos relatórios e depois Current.

![Captura do Studio: Aplicar as correspondências](facilities-guide-matching-result.png)

## Ligar um código diferente usado pela origem

Use esta tarefa quando uma origem usa outro código para a mesma unidade física. Escolha a ficha Registry que a representa. O exemplo liga EXTERNAL-CLINIC à clínica norte existente.

### 1. Escolher Map na linha recebida

Abra o menu dessa linha e selecione **Map**. Uma linha já associada oferece Edit mapping.

![Captura do Studio: Escolher Map na linha recebida](facilities-guide-mapping-row-actions.png)

![Captura do Studio: Escolher Map na linha recebida](facilities-guide-mapping-menu.png)

### 2. Pesquisar a unidade de destino

Em Target, use **Search terms** para pesquisar pelo nome ou código. System está fixo em FACILITY-REGISTRY neste percurso.

![Captura do Studio: Pesquisar a unidade de destino](facilities-guide-mapping-search.png)

### 3. Selecionar a unidade correspondente

Escolha a unidade correta nos resultados.

![Captura do Studio: Selecionar a unidade correspondente](facilities-guide-mapping-target.png)

### 4. Verificar o tipo de associação

Mantenha **Same as** quando os códigos representam a mesma unidade. Uma relação mais ampla ou mais restrita não corresponde à mesma identidade.

![Captura do Studio: Verificar o tipo de associação](facilities-guide-mapping-type.png)

### 5. Abrir o menu da associação

Selecione os pontos no canto superior direito do painel de associação.

![Captura do Studio: Abrir o menu da associação](facilities-guide-mapping-sheet-actions.png)

### 6. Escolher Create

Selecione **Create** para a nova associação. Uma associação existente usa Save.

![Captura do Studio: Escolher Create](facilities-guide-mapping-create.png)

**Resultado esperado:** Resolves to mostra a unidade escolhida junto do código diferente da origem.

![Captura do Studio: Escolher Create](facilities-guide-mapping-result.png)

## Usar Facilities num telemóvel

As tarefas Registry e Observed continuam disponíveis no telemóvel. O cabeçalho muda de linha para deixar espaço ao estado dos relatórios.

### 1. Escolher Registry

Selecione **Registry** no topo para consultar a lista de unidades.

![Captura do Studio: Escolher Registry](facilities-guide-phone-registry.png)

### 2. Escolher Observed

Selecione **Observed** para consultar os códigos recebidos.

![Captura do Studio: Escolher Observed](facilities-guide-phone-observed.png)

### 3. Abrir o menu desse separador

Selecione os pontos à direita dos separadores. As ações dependem do separador selecionado. Desloque a tabela horizontalmente para ver as restantes colunas.

![Captura do Studio: Abrir o menu desse separador](facilities-guide-phone-actions.png)

## Prática opcional com dados fictícios

Pode concluir todas as tarefas acima com os seus próprios dados. Estes ficheiros servem apenas para praticar numa instalação de teste:

- [Descarregar o CSV com duas unidades](https://openldr.online/docs-samples/example-facilities.csv) usado nas capturas da importação.
- [Descarregar o lote com sete recursos](https://openldr.online/docs-samples/example-observed-data.json) usado para demonstrar os códigos recebidos. Contém um paciente fictício, três pedidos e três relatórios.

Para obter as três correspondências exatas mostradas, adicione também `EXAMPLE-CLINIC-01` com a tarefa manual. Use Example facility register nestas fichas fictícias. Apenas com o CSV há menos correspondências; a pré-visualização indica os códigos sem correspondência.

Importe o CSV no navegador com os passos anteriores. Antes de carregar o lote opcional, leia [Start here](/docs/start-here) para as instruções da CLI instalada e de desenvolvimento. Coloque o JSON na pasta `data` da instalação.

Exemplo para uma instalação Linux ou macOS:

```shell
cd ~/Downloads/openldr_ce
./openldr ingest data/example-observed-data.json
```

Exemplo para uma instalação Windows:

```shell
cd C:\openldr_ce
.\openldr.ps1 ingest data\example-observed-data.json
```

Exemplo para um repositório de desenvolvimento, depois de colocar o ficheiro na sua pasta `data`:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-observed-data.json
```

Estas pastas são exemplos. Substitua-as pela pasta real, como explicado em Start here. Regresse a Observed após a importação e siga as tarefas de ligação.

## Resolução de problemas

### Create indica campos obrigatórios

Preencha os campos assinalados. Num campo de terminologia, selecione um resultado em vez de deixar apenas o texto da pesquisa. Escolha Create novamente.

![Captura do Studio: Resolução de problemas](facilities-guide-required-error.png)

### Já existe uma unidade com esse código neste registo

Não pode adicionar duas vezes o mesmo par System e Facility code. Feche o formulário, encontre a linha existente e edite-a. O erro reproduzido refere o código nacional; este formulário chama-lhe Facility code.

![Captura do Studio: Resolução de problemas](facilities-guide-duplicate-error.png)

### Falta uma coluna para um campo obrigatório

Associe a coluna de códigos a `national_code` e a de nomes a `name`, ou forneça o valor fixo adequado. Valide novamente.

![Captura do Studio: Resolução de problemas](facilities-guide-missing-code-error.png)

![Captura do Studio: Resolução de problemas](facilities-guide-missing-code-fix.png)

### Um código recebido ainda indica Not mapped

Importar um registo não liga os códigos recebidos. Use Link matching codes para códigos exatos ou Map na linha quando a origem usa um código diferente.

### Add ou Edit está indisponível

Estas ações exigem Manage facilities e um formulário publicado destinado a Facilities. A página indica o formulário em falta. Abra Forms para o publicar ou corrigir. A importação de um registo não exige esse formulário.

### Uma unidade guardada não aparece na lista visível

A pesquisa, os filtros e a página continuam aplicados após guardar. Pesquise pelo código para encontrar a ficha.

## Distinguir estas operações

A introdução manual segue o formulário Facilities publicado. As importações usam as associações de colunas. Uma origem de registo, uma unidade Registry e uma associação de código Observed são registos distintos.

Um ficheiro parcial não avalia as unidades ausentes. Marque uma versão completa apenas para o registo inteiro e leia as decisões adicionais em Mapping e o resultado em Review.

## Guias relacionados

[Terminology](/docs/terminology) explica as listas e os códigos. [Start here](/docs/start-here) explica a CLI. [Dashboards](/docs/dashboard) trata de gráficos e prática opcional. [Your preferences](/docs/user-preferences) trata das definições pessoais.

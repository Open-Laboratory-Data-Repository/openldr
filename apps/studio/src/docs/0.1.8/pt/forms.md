# Formulários

Forms permite ao pessoal introduzir dados em formulários publicados. Os autores usam o construtor para escolher campos, pré-visualizar e publicar versões.

Use os seus pacientes, testes ativos do catálogo e um formulário aprovado. As imagens mostram registos fictícios e Example request form numa instalação de teste isolada. Não precisa de ficheiros de exemplo da documentação.

Use forms permite ler definições. Submit forms permite recolher dados. Edit forms permite alterar o desenho e Publish forms publicá-lo. Para escrever dados, o formulário também precisa de uma configuração de envio válida e de um workflow ativo para os dados recebidos.

Os formulários Draft e Archived continuam a abrir com View/Run. Submit está desativado até ao estado Published. Preview no construtor permite experimentar o desenho sem guardar uma resposta.

Os números de versão nas imagens são exemplos. Cada publicação guarda um instantâneo e recebe o número seguinte. Os seus números dependem do histórico de publicação. Leia [Começar aqui](/docs/start-here) para a instalação e a CLI.

## Escolher o paciente, teste e amostra de um pedido

Use esta tarefa para registar um pedido pretendido no formulário publicado Lab order. Use o paciente e os testes adequados ao pedido.

### 1. Abrir Forms

Selecione **Forms** no menu principal.

![Forms está no menu principal à esquerda.](forms-guide-open-page.png)

### 2. Abrir Lab order

Abra os pontos da linha **Lab order** e selecione **View/Run**.

![Use os pontos da linha Lab order para abrir a página de recolha.](forms-guide-order-row-actions.png)

![View/Run abre o formulário publicado para introduzir dados.](forms-guide-order-run.png)

### 3. Pesquisar o paciente

Em **Patient**, pesquise pelo nome ou identificador do paciente.

![Pesquise o paciente real pelo nome ou identificador.](forms-guide-order-patient-search.png)

### 4. Selecionar o paciente

Confira o registo correspondente e selecione o paciente correto.

![Selecione o paciente correto nos resultados.](forms-guide-order-patient-choice.png)

### 5. Pesquisar o teste

Em **Tests**, pesquise o teste pedido no catálogo. A lista usa testes ativos neste laboratório.

![Tests lista os testes do catálogo ativos neste laboratório.](forms-guide-order-test-search.png)

### 6. Escolher o teste

Selecione o teste pedido. Repita apenas quando o pedido precisar de outro teste.

![Escolha o teste do catálogo pedido para este paciente.](forms-guide-order-test-choice.png)

### 7. Abrir os detalhes

Em **Results**, selecione a linha do teste escolhido para abrir os detalhes.

![Abra a linha do teste em Results para completar a amostra e os detalhes do resultado.](forms-guide-order-test-details.png)

### 8. Escolher a amostra

Selecione o tipo de amostra registado para este teste na lista configurada.

![Selecione o tipo de amostra usado neste teste.](forms-guide-order-specimen.png)

**Resultado esperado:** os detalhes do teste contêm a amostra escolhida. O pedido ainda não foi enviado.

## Rever e enviar o pedido de laboratório

Continue após escolher o paciente, testes e detalhes da amostra. Preencha os outros campos obrigatórios antes de enviar.

### 1. Fechar os detalhes do teste

Selecione **Close** no canto superior direito do painel de detalhes.

![Close regressa ao pedido com a amostra escolhida.](forms-guide-order-details-close.png)

### 2. Escolher a prioridade

Escolha a **Priority** registada. A imagem usa **Routine**.

![Escolha a prioridade deste pedido. O exemplo usa Routine.](forms-guide-order-priority.png)

### 3. Rever o pedido e abrir as ações

Confira o paciente, testes e amostras e abra os pontos no canto superior direito.

![Reveja o pedido e abra o menu de pontos.](forms-guide-order-submit-actions.png)

### 4. Enviar o pedido pretendido

Selecione **Submit** uma vez. Aguarde o resultado. Não envie novamente apenas para confirmar o sucesso.

![Submit escreve uma resposta do formulário. Use-o uma vez para este pedido pretendido.](forms-guide-order-submit.png)

**Resultado esperado:** **Response captured.** confirma a resposta guardada. As respostas ficam no ecrã. Outro Submit é outra escrita. Use-o apenas para um envio pretendido.

![Response captured confirma a resposta enviada. Envie novamente apenas para outro pedido pretendido.](forms-guide-order-result.png)

## Começar o desenho de um formulário de pedido

Use esta tarefa quando um formulário existente não recolhe a informação necessária ao workflow. O construtor escolhe uma versão do formato de dados de saúde FHIR e um tipo de recurso.

### 1. Escolher New

Em Forms, abra os pontos no canto superior direito e selecione **New**.

![O menu de pontos de Forms contém New.](forms-guide-page-actions.png)

![New abre Form Builder.](forms-guide-new-menu.png)

### 2. Dar nome ao formulário

Introduza um nome que descreva a tarefa. O exemplo usa `Example request form`.

![Dê nome ao formulário segundo a tarefa que vai servir.](forms-guide-builder-name.png)

### 3. Escolher a versão FHIR

Abra **FHIR Version** e escolha a versão exigida pelos registos. O exemplo seleciona **R4 (most common)**.

![Escolha a versão FHIR dos recursos de destino. Este exemplo usa R4.](forms-guide-builder-fhir-version.png)

### 4. Escolher o tipo de recurso

Abra **Resource Type**, encontre **ServiceRequest** e selecione-o para este exemplo de pedido.

![Selecione ServiceRequest para construir um formulário de pedido.](forms-guide-builder-resource.png)

**Resultado esperado:** o pacote inicial disponível abre para escolher os campos.

## Escolher campos do pacote inicial e guardar um rascunho

Mantenha no pacote inicial os campos necessários. Este exemplo mantém Patient, Tests, Results, Priority e Reference Number. O seu workflow pode precisar de mais campos.

### 1. Desmarcar Requesting Clinician neste exemplo

Desmarque **Requesting Clinician** quando este formulário de exemplo não o recolhe.

![Desmarque Requesting Clinician se o formulário de exemplo não precisar dele.](forms-guide-pack-clinician.png)

### 2. Desmarcar Clinical Notes neste exemplo

Desmarque **Clinical Notes**. Mantenha-o no seu formulário se o workflow precisar dele.

![Desmarque Clinical Notes se o formulário de exemplo não precisar dele.](forms-guide-pack-notes.png)

### 3. Desmarcar Referring Facility neste exemplo

Desmarque **Referring Facility** para o exemplo de cinco campos.

![Desmarque Referring Facility se o formulário de exemplo não precisar dele.](forms-guide-pack-facility.png)

### 4. Desmarcar Order rejection neste exemplo

Desmarque **Order rejection** neste exemplo.

![Desmarque Order rejection se o formulário de exemplo não precisar dele.](forms-guide-pack-rejection.png)

### 5. Verificar a seleção restante

Confira que **Patient**, **Tests**, **Results**, **Priority** e **Reference Number** continuam selecionados. O pacote ilustrado indica **5 of 9 selected**.

![Mantenha os campos necessários. Este exemplo mantém Patient, Tests, Results, Priority e Reference Number.](forms-guide-pack-choices.png)

![Cinco campos continuam selecionados neste exemplo.](forms-guide-pack-selected-count.png)

### 6. Acrescentar os campos

Abra os pontos do pacote e selecione **Add 5 fields**.

![O pacote inicial tem o próprio menu de pontos.](forms-guide-pack-actions.png)

![Acrescente os cinco campos escolhidos ao novo formulário.](forms-guide-pack-add.png)

### 7. Guardar o rascunho

Abra os pontos do construtor no canto superior direito e selecione **Save draft**.

![Abra Builder actions para pré-visualizar e guardar.](forms-guide-builder-actions-step-7.png)

![Save draft guarda o desenho atual sem o publicar.](forms-guide-draft-save.png)

**Resultado esperado:** a definição fica guardada como Draft. Guardar o desenho não envia respostas nem o publica.

![O construtor lista os campos acrescentados do pacote.](forms-guide-builder-fields.png)

## Alterar o texto do campo de referência

Use esta tarefa para usar termos reconhecidos pelo pessoal. O exemplo muda Reference Number para Requisition reference.

### 1. Abrir o editor do campo

Selecione Edit no campo **Reference Number** do construtor.

![Abra Reference Number para alterar o nome visível.](forms-guide-field-open.png)

### 2. Alterar Display Label

Em **Display Label**, introduza `Requisition reference`.

![Display Label altera o texto visto pela pessoa que introduz dados.](forms-guide-field-label.png)

### 3. Introduzir uma indicação

Em **Placeholder**, introduza `Enter the requisition number`. Esta indicação aparece no campo vazio.

![Placeholder fornece uma indicação curta num campo vazio.](forms-guide-field-placeholder.png)

### 4. Verificar Required

Mantenha **Required** desligado quando a resposta for opcional. Ative-o apenas quando o workflow exigir uma resposta.

![Required torna a resposta obrigatória. Deixe-o desligado num campo opcional.](forms-guide-field-required.png)

### 5. Verificar Enabled

Mantenha **Enabled** ativo para mostrar o campo e recolher uma resposta.

![Enabled controla a apresentação do campo e a recolha de uma resposta.](forms-guide-field-enabled.png)

### 6. Aplicar a alteração do campo

Abra os pontos do editor do campo e selecione **Save**. A alteração aplica-se ao desenho atual do construtor.

![Field actions contém Save e Cancel.](forms-guide-field-actions.png)

![Save aplica as alterações do campo ao desenho atual.](forms-guide-field-save.png)

**Resultado esperado:** a lista mostra Requisition reference. Use Save draft ou Publish do construtor para guardar o formulário alterado.

![A lista de campos usa o novo nome visível.](forms-guide-field-updated.png)

## Experimentar o desenho sem recolher dados

Use Preview para consultar o desenho atual antes de publicar. As respostas de exemplo não se tornam respostas enviadas.

### 1. Abrir Preview

Abra os pontos do construtor e selecione **Preview**.

![Abra Builder actions para pré-visualizar e guardar.](forms-guide-builder-actions-step-1.png)

![Preview abre o desenho atual sem enviar dados.](forms-guide-preview-menu.png)

### 2. Abrir Preview actions

Selecione os pontos no cabeçalho do painel Preview.

![Preview actions contém Fill example e Reset.](forms-guide-preview-actions.png)

### 3. Preencher respostas de exemplo

Selecione **Fill example**.

![Fill example fornece respostas de demonstração sem guardar uma resposta.](forms-guide-preview-fill.png)

### 4. Ler a pré-visualização

Confira o texto, os campos e as respostas de exemplo. O exemplo mostra o campo Requisition reference.

![Preview mostra o formulário com respostas de exemplo.](forms-guide-preview-filled.png)

### 5. Limpar as respostas de exemplo

Abra novamente Preview actions e selecione **Reset**.

![Reset limpa as respostas de demonstração.](forms-guide-preview-reset.png)

### 6. Fechar Preview

Selecione **Close** no canto superior direito para regressar ao construtor.

![Close regressa ao construtor.](forms-guide-preview-close.png)

**Resultado esperado:** regressa ao mesmo desenho. Fill example e Reset não enviaram respostas nem guardaram a definição.

## Guardar e publicar o desenho revisto

Use esta tarefa quando o desenho estiver pronto. Publicar guarda o desenho atual e cria um instantâneo numerado.

### 1. Guardar o rascunho editado

Abra os pontos do construtor e selecione **Save draft**.

![Save draft guarda o desenho atualizado sem o publicar.](forms-guide-draft-save-edited.png)

### 2. Publicar o desenho

Abra novamente os pontos do construtor e selecione **Publish**.

![Publish guarda o desenho e cria uma versão publicada.](forms-guide-publish-menu.png)

### 3. Ler a versão publicada

Confira o estado publicado e o número de instantâneo gerado no cabeçalho. Não pode escrever esse número.

![O cabeçalho mostra o estado publicado e o número de versão.](forms-guide-published-version.png)

**Resultado esperado:** a lista Forms indica Published. O envio continua a exigir respostas válidas e um workflow de recolha configurado.

![O novo formulário aparece como Published na lista.](forms-guide-published-row.png)

## Comparar uma indicação alterada com uma versão publicada

Use esta tarefa antes de publicar uma alteração posterior. O exemplo muda apenas a indicação do campo de referência. O nome visível já corresponde à versão publicada.

### 1. Alterar a indicação

Abra o editor de Requisition reference. Altere **Placeholder** para `Enter the reference from the paper form` e use os pontos do campo para Save.

![Faça a alteração a comparar. O exemplo muda a indicação do campo.](forms-guide-version-draft-change.png)

### 2. Abrir Compare

Abra os pontos do construtor e selecione **Compare**.

![Compare lê as diferenças entre versões e o rascunho atual.](forms-guide-compare-menu.png)

### 3. Escolher a versão à esquerda

Abra o seletor esquerdo e escolha o instantâneo publicado a comparar. O exemplo seleciona **v1**.

![Escolha a versão publicada do lado From.](forms-guide-compare-from.png)

![Selecione a versão de referência para comparar.](forms-guide-compare-from-version.png)

### 4. Verificar a versão à direita

Mantenha **Current draft** no seletor direito para comparar o desenho atual do construtor. Também pode escolher outra versão publicada.

![O lado To pode ser Current draft ou outra versão publicada.](forms-guide-compare-to.png)

### 5. Ler a diferença indicada

O exemplo indica uma propriedade de campo alterada, **Field reference-number · placeholder**. Não indica alteração do nome visível.

![Leia as diferenças antes de decidir publicar ou restaurar.](forms-guide-compare-result.png)

### 6. Fechar Compare com Escape

Prima Escape para regressar ao construtor. Fechar Compare não guarda nem publica o desenho alterado.

![Escape regressa ao construtor sem alterar uma versão guardada.](forms-guide-compare-close.png)

**Resultado esperado:** reviu a diferença mantendo a edição atual no construtor.

## Guardar e publicar uma alteração posterior

Use esta tarefa após comparar uma alteração com uma versão publicada.

### 1. Guardar o rascunho alterado

Abra os pontos do construtor e selecione **Save draft**.

![Guarde a alteração revista em rascunho antes de publicar.](forms-guide-changed-save-draft.png)

### 2. Verificar o estado Draft

Se o conteúdo guardado diferir do publicado, o formulário passa a **Draft**. View/Run continua a abri-lo, mas Submit fica desativado até publicar.

![Alterar o conteúdo publicado guardado devolve o formulário a Draft.](forms-guide-changed-draft-status.png)

### 3. Publicar a alteração revista

Abra os pontos do construtor e selecione **Publish** quando a alteração estiver pronta.

![Publique o rascunho alterado revisto para criar a versão seguinte.](forms-guide-changed-publish.png)

**Resultado esperado:** o formulário passa a Published com o número seguinte. Guardar sem alterações não transforma, por si só, um formulário Published em Draft.

## Restaurar o conteúdo de um instantâneo publicado

Use esta tarefa quando um desenho publicado anterior contiver o conteúdo pretendido. Restaurar substitui o formulário editável por esse instantâneo.

### 1. Abrir Versions

Abra os pontos do construtor e selecione **Versions**.

![Versions abre os instantâneos publicados, mais recentes primeiro.](forms-guide-versions-menu.png)

### 2. Encontrar o instantâneo

Leia o número, o nome e a data de publicação. As versões mais recentes aparecem primeiro. A lista tem paginação quando necessário.

![Leia o número de versão, o nome e a data de publicação.](forms-guide-versions-list.png)

### 3. Abrir as ações da versão

Selecione os pontos do instantâneo a restaurar. A imagem usa a versão 1.

![Cada versão publicada tem o próprio menu de pontos.](forms-guide-version-row-actions.png)

### 4. Escolher Restore

Selecione **Restore**.

![Restore substitui o formulário editável pelo instantâneo escolhido.](forms-guide-restore-menu.png)

### 5. Confirmar o instantâneo

Leia a confirmação e selecione **Restore** para substituir o desenho atual. Cancel mantém o desenho.

![Reveja a versão escolhida. Restaurar conteúdo diferente devolve a Draft e desativa o envio até publicar.](forms-guide-restore-confirm.png)

### 6. Verificar o estado resultante

A restauração ilustrada altera o conteúdo publicado e o formulário passa a **Draft**. Restaurar conteúdo idêntico pode manter um formulário Published em Published.

![O formulário restaurado é Draft. Publique-o novamente apenas após revisão.](forms-guide-restore-result.png)

**Resultado esperado:** o construtor contém o conteúdo restaurado. Um Draft restaurado continua visível com View/Run, com Submit desativado até publicar.

## Publicar conteúdo restaurado revisto

Use esta tarefa após confirmar que o Draft restaurado é o desenho que o pessoal deve usar.

### 1. Publicar o formulário restaurado

Abra os pontos do construtor e selecione **Publish**.

![Publish volta a disponibilizar o formulário restaurado revisto.](forms-guide-republish-menu.png)

### 2. Verificar o novo número do instantâneo

Leia a versão publicada no cabeçalho. Publicar novamente cria o instantâneo seguinte sem reutilizar o número restaurado.

![O formulário restaurado revisto volta a ser publicado com o número seguinte.](forms-guide-republished-version.png)

**Resultado esperado:** o desenho restaurado volta a Published. A instalação de exemplo tem instantâneos 1 a 4. Os números são ilustrativos.

## Exportar a definição do formulário

Use esta tarefa para obter um ficheiro JSON FHIR Questionnaire. A exportação contém a definição, não as respostas enviadas.

### 1. Abrir as ações da linha do formulário

Regresse a Forms e abra os pontos do formulário a exportar.

![O menu da linha contém ações de ciclo de vida e exportação.](forms-guide-list-actions.png)

### 2. Escolher Export

Selecione **Export**. O navegador descarrega o ficheiro JSON Questionnaire.

![Export descarrega o formulário como ficheiro JSON Questionnaire.](forms-guide-export-menu.png)

**Resultado esperado:** o ficheiro contém a definição do formulário. Export não envia nem altera o formulário.

## Criar um rascunho separado e consultar o estado de envio

Use Duplicate para adaptar um formulário existente mantendo a definição original.

### 1. Escolher Duplicate

Nos pontos da linha do formulário original, selecione **Duplicate**.

![Duplicate cria um rascunho separado para adaptar um formulário existente.](forms-guide-duplicate-menu.png)

### 2. Verificar a cópia separada

Encontre a nova cópia em Forms. Começa como **Draft**. O original mantém-se.

![Duplicate cria um Draft separado mantendo o original.](forms-guide-duplicate-result.png)

### 3. Abrir View/Run no Draft

Abra os pontos da cópia e selecione **View/Run**. A página avisa que o envio está desativado até publicar.

![Pode abrir um Draft para consulta, mas o envio fica desativado até publicar.](forms-guide-draft-run-warning.png)

### 4. Verificar Submit

Abra os pontos da página. **Submit** está desativado neste formulário não publicado.

![Submit está desativado neste formulário não publicado.](forms-guide-draft-submit-disabled.png)

**Resultado esperado:** a cópia continua um Draft separado. Abrir View/Run não publica nem envia respostas.

## Arquivar ou eliminar uma cópia sem uso

Archive mantém a definição e impede o uso para envios. Delete elimina definitivamente a definição escolhida. As imagens retiram apenas a cópia de demonstração separada.

### 1. Regressar a Forms

Selecione **Forms** no menu principal. Encontre a cópia a retirar.

![Forms está no menu principal à esquerda.](forms-guide-open-page.png)

### 2. Arquivar a cópia

Abra os pontos da linha e selecione **Archive**.

![Archive impede o uso normal para envios mantendo a definição.](forms-guide-archive-menu.png)

### 3. Verificar Archived

A cópia mantém-se na lista de gestão com o estado **Archived**. Deixa de ser Published para envio.

![O formulário arquivado mantém-se na lista com o estado.](forms-guide-archive-result.png)

### 4. Escolher Delete para uma remoção pretendida

Para remover definitivamente, abra os pontos da mesma cópia e selecione **Delete**. Confira que escolheu a cópia e não o original.

![Delete elimina definitivamente a definição escolhida. Esta é apenas a cópia de demonstração prevista.](forms-guide-delete-menu.png)

### 5. Confirmar o formulário indicado

Leia o nome na confirmação. Selecione **Delete** para remover ou Cancel para manter.

![Leia o nome antes de confirmar. Cancel mantém o formulário.](forms-guide-delete-confirm.png)

**Resultado esperado:** a cópia eliminada desaparece de Forms. O exemplo manteve o formulário original.

## Consultar formulários e pré-visualizações num telemóvel

Use as mesmas ações da lista e do construtor no telemóvel. Uma tabela larga pode deslocar-se horizontalmente.

### 1. Encontrar o formulário

Use **Search forms** na lista à largura do telemóvel.

![Forms está disponível num telemóvel. Colunas largas podem deslocar-se horizontalmente.](forms-guide-phone-list.png)

### 2. Abrir Builder actions

Abra o formulário no construtor e selecione os pontos no canto superior direito.

![Builder actions continua disponível num telemóvel.](forms-guide-phone-builder-actions.png)

### 3. Escolher Preview

Selecione **Preview** no menu do construtor.

![Abra Preview no mesmo menu do construtor.](forms-guide-phone-preview-menu.png)

### 4. Consultar a pré-visualização no telemóvel

Leia a pré-visualização e desloque os campos. Preview actions continua nos pontos do cabeçalho.

![Preview abre sobre o construtor à largura do telemóvel.](forms-guide-phone-preview.png)

**Resultado esperado:** o desenho continua disponível para consulta à largura do telemóvel.

## Limites

Este percurso recolhe um pedido e uma escolha de amostra. Não demonstra a introdução de valores de resultados laboratoriais nem a rejeição de um pedido.

Save do editor de campo aplica uma edição local do construtor. Save draft do construtor guarda a definição. Publish guarda o desenho e cria uma versão. As ações de Preview não fazem nenhuma destas escritas.

Guardar ou restaurar conteúdo diferente pode devolver um formulário Published a Draft. Conteúdo idêntico não força essa alteração. View/Run continua disponível, mas o envio exige Published.

## Resolução de problemas

**Não há paciente correspondente.** Confira a pesquisa e se o fluxo habitual forneceu esse paciente. Use Patients para consultar o registo recebido.

**Falta um teste.** Confira se existe em Test catalog e está ativo neste laboratório.

**Submit está desativado.** Confira o estado e a mensagem de preparação para envio. Publique um Draft revisto e confira a configuração de recolha.

**Submit indica respostas inválidas.** Leia os erros dos campos e corrija valores obrigatórios ou inválidos antes de repetir. Uma mensagem Response captured com sucesso não precisa de um segundo envio.

**Restore deixa Draft.** Reveja o conteúdo restaurado e use Publish quando o envio voltar a ser necessário.

## Guias relacionados

Leia [Pacientes](/docs/patients) para registos recebidos e [Catálogo de testes](/docs/test-catalog) para testes ativos. Leia [Workflows](/docs/workflows) para o workflow de recolha e [Começar aqui](/docs/start-here) para instalação e CLI.

## Prática opcional

Use uma instalação de teste com pacientes fictícios e testes ativos no laboratório. As tarefas de recolha usam os seus registos recebidos. Não precisa de ficheiros de exemplo.

Para praticar o desenho, use um nome separado e o exemplo ServiceRequest de cinco campos. Experimente Preview, Save draft, Publish, Compare e Versions. Duplique a definição antes de praticar Archive ou Delete.

Envie um Lab order de teste apenas quando pretender escrever esse pedido. O exemplo documentado enviou uma resposta. As capturas seguintes não enviaram outra resposta.

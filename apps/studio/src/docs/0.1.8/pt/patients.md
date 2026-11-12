# Pacientes

Encontre as fichas de pacientes recebidas com os dados laboratoriais, leia identificadores e pedidos e reveja possíveis duplicados. A página Patients lê fichas da origem. Não permite editar nem juntar pacientes.

**As definições de pacientes são opcionais.** O OpenLDR recebe pacientes com os dados laboratoriais antes de dar nomes aos sistemas de identificadores. Recomendamos adicionar nomes úteis e rever possíveis duplicados durante o uso.

Use as fichas recebidas e os seus sistemas de identificadores. Não precisa de dados de exemplo da documentação. As imagens mostram pacientes fictícios numa instalação de teste. Há [dados opcionais de prática](#pratica-opcional-com-pacientes-ficticios) no fim.

**View patient index** permite uma lista mascarada e pesquisas por identificador exato. **View patient identifiers** permite nomes completos, identificadores, datas de nascimento, contactos e pesquisas por nome. Estas consultas sem máscara são auditadas. As imagens usam esta permissão.

**Manage patient index** permite definir sistemas de identificadores e decidir sobre duplicados. Um laboratório que recebe os nomes do central não os pode alterar aqui.

## Encontrar um paciente e ler os detalhes

Verifique assim quem uma ficha da origem descreve e os seus pedidos laboratoriais. Se a lista estiver vazia, volte depois de o fluxo habitual enviar pacientes.

### 1. Abrir Patients

Selecione **Patients** no menu principal e use o separador **Patients**.

![Patients está no menu principal à esquerda.](patients-guide-open-page.png)

![Patients lista fichas recebidas dos sistemas de origem.](patients-guide-patients-tab.png)

### 2. Pesquisar a pessoa

Em **Search name or identifier**, introduza um nome ou identificador. Sem permissão para ver identificadores, o campo mostra **Exact identifier** e exige o valor completo.

![Com permissão para ver identificadores, a pesquisa encontra parte de um nome.](patients-guide-search-name.png)

### 3. Verificar a linha correspondente

Leia o nome, o sexo, a idade, os identificadores listados e a contagem de pedidos. Confirme a pessoa pelas fichas da origem. O nome, por si só, não estabelece a identidade.

![Leia a linha do paciente correspondente antes de abrir.](patients-guide-search-result.png)

### 4. Abrir o paciente

Selecione a linha. **Identity** no painel Patient mostra dados da origem. O menu de pontos da linha também oferece **View**.

![Selecione a linha do paciente para abrir os detalhes de leitura.](patients-guide-open-row.png)

![View no menu da linha abre os mesmos detalhes.](patients-guide-row-view.png)

![Identity mostra dados da origem. A página Patients não os edita.](patients-guide-identity.png)

### 5. Ler os identificadores

Em **Identifiers**, leia cada sistema e valor. Um nome do sistema altera a apresentação, não o valor da origem.

![Identifiers mostra os sistemas e valores recebidos para este paciente.](patients-guide-identifiers.png)

### 6. Ler os pedidos

Em **Requests**, verifique datas de pedido, painéis, unidades requisitantes, estados e contagens de resultados. Use a paginação se houver mais linhas.

![Requests mostra pedidos, estados e contagens de resultados do paciente.](patients-guide-requests.png)

### 7. Fechar o painel

Selecione **Close** no canto superior direito para voltar à lista.

![Close volta à lista de pacientes.](patients-guide-close-details-step-7.png)

**Resultado esperado:** consulta a ficha sem alterar os dados do paciente. As correções de identidade pertencem ao sistema que mantém esses dados.

## Dar nome a um sistema de identificadores e mostrá-lo na lista

Um sistema de identificadores é o URI que indica o tipo de um valor de identificador. Configure os sistemas recebidos das suas origens. Use um nome reconhecível.

### 1. Abrir Identifier systems

Selecione **Identifier systems** no topo de Patients. Lista os sistemas recebidos e as contagens de pacientes.

![Identifier systems lista os tipos de identificadores recebidos.](patients-guide-identifier-tab.png)

### 2. Escolher Edit para o sistema

Abra os pontos da linha certa e selecione **Edit**. Verifique o URI antes de alterar as definições.

![Abra os pontos do sistema a que pretende dar nome.](patients-guide-identifier-row-actions.png)

![Edit abre as definições de apresentação e pesquisa do sistema.](patients-guide-identifier-edit.png)

### 3. Introduzir o nome

Em **Label**, introduza um nome legível. O exemplo fictício usa `Example ID`. Deixe vazio para usar o nome fornecido pela origem.

![Dê um nome reconhecível ao sistema. O exemplo usa Example ID.](patients-guide-identifier-label.png)

### 4. Escolher se mostra os valores

Ative **Show in the list** para incluir este sistema na coluna Identifiers da tabela Patients.

![Show in the list inclui o sistema de identificadores na tabela de pacientes.](patients-guide-identifier-list.png)

### 5. Verificar se participa nas pesquisas

Mantenha **Search matches it** ligado para valores úteis à identificação. Desligue para um sistema de valores genéricos que não deve identificar uma pessoa. Isto também afeta a correspondência de duplicados por identificador igual.

![Search matches it define se os identificadores do sistema participam nas pesquisas.](patients-guide-identifier-searchable.png)

### 6. Abrir Identifier system actions

Selecione os pontos deste painel de definições.

![As definições do sistema têm o seu próprio menu de pontos.](patients-guide-identifier-actions.png)

### 7. Guardar as definições

Selecione **Save**.

![Save guarda o nome e as escolhas de apresentação e pesquisa.](patients-guide-identifier-save.png)

**Resultado esperado:** a linha do sistema mostra o nome guardado e as definições de apresentação e pesquisa.

![O sistema mostra agora o nome guardado.](patients-guide-identifier-saved.png)

## Encontrar um paciente por um identificador listado

Pesquise pelo valor do identificador, não pelo nome do sistema. Pode aparecer mais de uma ficha quando a origem tem um identificador partilhado ou duplicado.

### 1. Voltar a Patients e pesquisar

Selecione **Patients** e introduza o valor do identificador. O exemplo pesquisa `DOCS-001`.

![Patients lista fichas recebidas dos sistemas de origem.](patients-guide-patients-tab.png)

![Pesquise o valor, não o nome. Estas duas fichas fictícias partilham DOCS-001 de propósito.](patients-guide-search-identifier.png)

### 2. Verificar o valor com nome

Leia a coluna Identifiers. O exemplo mostra **Example ID: DOCS-001**. As duas fichas fictícias partilham-no de propósito.

![O identificador listado aparece com o nome configurado.](patients-guide-listed-identifier.png)

**Resultado esperado:** os pacientes correspondentes aparecem com o nome de identificador configurado. A coluna Identifiers vazia não significa que a ficha da origem não tem identificadores. Verifique a definição de apresentação.

## Encontrar fichas marcadas Merged

Faça esta tarefa quando a origem desativou uma ficha ou comunicou uma substituição. A lista predefinida mostra fichas ativas.

### 1. Abrir Filter

Selecione **Filter** acima da lista de pacientes.

![Use Filter para incluir fichas marcadas Merged pela origem.](patients-guide-filter-open.png)

### 2. Adicionar um filtro

Selecione **Add filter**.

![Add filter inicia uma regra Status.](patients-guide-filter-add.png)

### 3. Verificar a regra Status

Use **Status** como coluna e mantenha **Equals**.

![Escolha Status e mantenha o operador Equals.](patients-guide-filter-status.png)

### 4. Escolher Merged

Selecione **Merged** como valor.

![Escolha Merged para consultar fichas inativas ou substituídas.](patients-guide-filter-merged.png)

### 5. Aplicar o filtro

Selecione **Apply**.

![Apply atualiza a lista com esta regra Status.](patients-guide-filter-apply.png)

**Resultado esperado:** a lista mostra fichas Merged. Aparece uma indicação junto aos nomes. Limpe o filtro de estado para voltar às fichas ativas.

![As fichas Merged mostram uma indicação junto ao nome do paciente.](patients-guide-merged-row-step-0.png)

## Seguir uma substituição comunicada pela origem

Uma ficha substituída pode apontar para o paciente com que foi junta na origem. O OpenLDR segue essa ligação comunicada. Esta ação não junta fichas.

### 1. Abrir a ficha juntada

Selecione a linha do paciente juntado. Uma substituição comunicada acrescenta um menu de ações em Identity.

![As fichas Merged mostram uma indicação junto ao nome do paciente.](patients-guide-merged-row-step-1.png)

![Uma substituição comunicada acrescenta um menu de pontos ao painel Patient.](patients-guide-merged-actions-step-1.png)

### 2. Abrir as ações do painel Patient

Selecione os pontos junto a **Identity**.

![Uma substituição comunicada acrescenta um menu de pontos ao painel Patient.](patients-guide-merged-actions-step-2.png)

### 3. Seguir a substituição

Selecione **Open the patient this record was merged into**.

![Open the patient this record was merged into segue a substituição da origem.](patients-guide-merged-replacement.png)

**Resultado esperado:** o paciente de substituição abre no painel Patient de leitura.

![O paciente de substituição abre no mesmo painel de leitura.](patients-guide-replacement-result.png)

## Inspecionar um grupo de possíveis duplicados

Reveja os elementos antes de decidir se as fichas descrevem a mesma pessoa. Um identificador partilhado pode ser um erro de introdução ou um valor genérico. O OpenLDR não decide por si.

### 1. Abrir Duplicates

Selecione **Duplicates** no topo de Patients.

![Duplicates lista grupos que podem representar a mesma pessoa.](patients-guide-duplicates-tab.png)

### 2. Ler a regra e os elementos

Verifique a razão da sugestão e quantos pacientes contém cada grupo. O exemplo corresponde a um identificador partilhado.

![Leia a regra e os elementos antes de decidir se o grupo é duplicado.](patients-guide-duplicate-group.png)

### 3. Abrir o grupo

Selecione a linha para abrir **Likely duplicates**.

![Selecione a linha do grupo para inspecionar os membros.](patients-guide-duplicate-open.png)

### 4. Comparar os membros

Leia os elementos, os identificadores e os dados de identidade disponíveis. A correspondência por nome igual também exige dados de nascimento iguais e valores de sexo compatíveis.

![O painel do grupo explica porque estes pacientes foram associados.](patients-guide-duplicate-evidence.png)

### 5. Abrir um membro quando necessário

Use os pontos desse membro e selecione **Open patient** para consultar a ficha completa e os pedidos.

![Cada membro tem um menu de pontos para abrir o paciente completo.](patients-guide-member-actions.png)

![Open patient abre a ficha de leitura do membro selecionado.](patients-guide-member-open.png)

**Resultado esperado:** o membro selecionado abre num painel Patient de leitura. Rever o grupo não junta fichas de pacientes.

![Open patient mostra o membro selecionado no seu painel de leitura.](patients-guide-member-view-result.png)

## Registar que um grupo contém pessoas diferentes

Use apenas depois de confirmar que as fichas sugeridas são pessoas diferentes. Num duplicado real, corrija as fichas da origem. A decisão do grupo é reversível.

### 1. Voltar ao grupo

Se o painel Patient de um membro estiver aberto, selecione **Close** para voltar a Likely duplicates.

![Close volta à lista de pacientes.](patients-guide-close-details-step-1.png)

### 2. Introduzir uma razão se for útil

Em **Reason**, registe porque são pessoas diferentes. O exemplo descreve explicitamente a demonstração fictícia.

![Depois de confirmar pessoas diferentes, introduza uma razão para a decisão.](patients-guide-duplicate-reason.png)

### 3. Abrir as ações do grupo

Selecione os pontos junto ao título Evidence do grupo.

![Use os pontos do grupo para registar a decisão.](patients-guide-duplicate-actions.png)

### 4. Marcar o grupo como pessoas diferentes

Selecione **Mark as not duplicates**.

![Mark as not duplicates oculta este grupo revisto em Open. Não junta nem elimina pacientes.](patients-guide-duplicate-mark.png)

**Resultado esperado:** o grupo desaparece de Open. As fichas de pacientes permanecem iguais.

![O grupo revisto está ausente da lista Open.](patients-guide-duplicate-dismissed.png)

## Mostrar novamente um grupo revisto

Anule assim uma decisão anterior Not duplicates e devolva o grupo à revisão.

### 1. Escolher Not duplicates

Em Duplicates, abra **Status** e escolha **Not duplicates**.

![Use Status para encontrar grupos marcados como não duplicados.](patients-guide-duplicate-status.png)

![Not duplicates lista grupos revistos.](patients-guide-duplicate-status-option.png)

### 2. Abrir o grupo revisto

Selecione a linha.

![Abra o grupo revisto se precisar de anular a decisão.](patients-guide-duplicate-reopen.png)

### 3. Escolher Show again

Abra os pontos do grupo e selecione **Show again**.

![Use os pontos do grupo para registar a decisão.](patients-guide-duplicate-actions.png)

![Show again devolve o grupo a Open sem alterar fichas de pacientes.](patients-guide-duplicate-restore.png)

### 4. Voltar a Open

Use **Status** para escolher **Open**.

![Escolha Open para voltar aos grupos de duplicados por resolver.](patients-guide-duplicate-status-open.png)

**Resultado esperado:** o grupo volta à lista aberta de revisão.

![O grupo está novamente em Open para revisão.](patients-guide-duplicate-restored.png)

## Exportar grupos de duplicados abertos

Faça esta tarefa quando a equipa que mantém as fichas da origem precisa dos grupos abertos. A exportação exige View patient identifiers e é auditada.

### 1. Abrir as ações de Duplicates

Selecione os pontos acima da tabela Duplicates.

![O separador Duplicates tem um menu de exportação separado.](patients-guide-duplicate-export-actions.png)

### 2. Escolher Export CSV

Selecione **Export CSV**. O navegador descarrega os grupos abertos.

![Export CSV descarrega grupos abertos para a equipa que mantém os dados da origem.](patients-guide-duplicate-export.png)

**Resultado esperado:** o CSV inclui os identificadores necessários à revisão na origem. A exportação não marca nem junta pacientes.

## Usar Patients num telemóvel

Os separadores e o painel Patient continuam disponíveis no telemóvel. Uma lista larga pode deslocar-se horizontalmente.

### 1. Escolher o separador

Use Patients, Identifier systems ou Duplicates no topo.

![Patients, Identifier systems e Duplicates continuam no topo no telemóvel.](patients-guide-phone-tabs.png)

### 2. Pesquisar o paciente

Use o campo de pesquisa com as mesmas permissões de identificadores do computador.

![Use a pesquisa de pacientes no telemóvel.](patients-guide-phone-search.png)

### 3. Abrir os detalhes do paciente

Selecione a linha correspondente e desloque o painel Patient para ler as secções.

![O painel Patient usa a largura do telemóvel e permite deslocar pelas secções.](patients-guide-phone-details.png)

## Prática opcional com pacientes fictícios

Todas as tarefas anteriores podem usar as fichas recebidas. Este ficheiro opcional destina-se apenas a teste. Contém três pacientes fictícios, um pedido, um relatório e um resultado. Dois pacientes partilham um identificador. Uma ficha antiga aponta para a substituição.

[Descarregue o lote de prática com seis recursos](https://openldr.online/docs-samples/user-guide/patients/example-patients.json). Leia [Começar aqui](/docs/start-here) para a CLI instalada e de desenvolvimento. Coloque depois o ficheiro na pasta data da instalação.

Exemplo numa cópia de desenvolvimento:

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-patients.json
```

Numa instalação Linux ou macOS, use `./openldr` em vez de `pnpm openldr`. No Windows, use `.\openldr.ps1` na pasta da instalação, como `C:\openldr_ce`. Substitua as pastas de exemplo pela real. Começar aqui mostra cada plataforma.

O ficheiro não exige os ficheiros opcionais de prática do catálogo de testes. As contagens de pedidos e pacientes podem diferir das imagens.

## Compreender a máscara e os limites dos duplicados

Sem View patient identifiers, os nomes ficam mascarados, os identificadores mostram só os últimos quatro caracteres e as datas de nascimento apenas o ano. Telefone e email ficam ocultos. A pesquisa exige um identificador exato. Estes limites também se aplicam aos grupos de duplicados.

Os grupos por identificador igual usam o mesmo valor no mesmo sistema pesquisável. Excluem identificadores sem sistema e sistemas com Search matches it desligado. A comparação de nome e nascimento ignora maiúsculas, espaços e acentos. Compara fichas ativas.

Um grupo mostra no máximo 50 membros. Não pode marcar aqui um grupo maior. Verifique se um identificador genérico foi usado para muitas pessoas. Corrija os dados da origem ou a definição de pesquisa do sistema.

Os dados dos pacientes pertencem ao processo da origem. Esta página lê identidades, dá nomes aos sistemas de identificadores e regista decisões de revisão de duplicados. Não permite editar nem juntar pacientes.

## Resolução de problemas

**A lista de pacientes está vazia.** Verifique se chegaram dados de pacientes pelo fluxo habitual. Não precisa de exemplos nem de nomes de identificadores para receber pacientes.

**Parte de um nome não encontra nada.** Sem View patient identifiers, pesquise o valor completo do identificador. Verifique Search matches it para esse sistema.

**A coluna Identifiers está vazia.** Ative Show in the list num sistema recebido. Abra o painel Patient para verificar os identificadores da origem.

**Não pode editar as definições de identificadores.** Verifique Manage patient index e se os nomes vêm do central. Um laboratório gerido pelo central consulta esses nomes aqui.

**O painel indica que a lista está desatualizada.** Recarregue a página e reabra o paciente. A referência da lista pode expirar após reiniciar o servidor.

**Um grupo de duplicados volta após uma atualização da origem.** Compare os membros e os elementos atuais. Corrija duplicados reais no sistema de origem em vez de os marcar como pessoas diferentes.

## Guias relacionados

[Unidades](/docs/facilities) explica a identidade das unidades. [Catálogo de testes](/docs/test-catalog) explica códigos de testes e resultados. [Começar aqui](/docs/start-here) explica a CLI.

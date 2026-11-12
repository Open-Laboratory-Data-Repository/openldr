# Formulários

Os **formulários** são os ecrãs para introduzir dados à mão: um pedido de exames na receção, um registo de paciente, uma unidade. Cada formulário constrói-se no **Construtor de Formulários** a partir de campos, e cada campo pode corresponder a um elemento FHIR, para que o que se escreve se torne um registo a sério. Um formulário passa de **Draft** a **Published** e depois a **Archived**, para poder ser desenhado com segurança antes de alguém o usar.

Uma instalação nova traz quatro formulários publicados: **Lab order**, **Patient**, **Users** e **Facility**. Este guia faz um pedido de exames com o formulário incluído, e depois constrói e publica um formulário seu. Leva cerca de 15 minutos. Selecione uma imagem ou um clip para o ampliar.

O Construtor de Formulários aparece no idioma do studio. Os nomes dos campos do Lab order incluído, como **Tests** ou **Priority**, e os menus da página **Formulários** ficam em inglês. Este guia cita-os tal como aparecem.

![Formulários: os quatro formulários incluídos, com tipo FHIR, número de campos, versão e estado.](forms-tour.png)

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **Use forms** | Abrir os formulários e ler a sua definição |
| **Submit forms** | Preencher um formulário com **View/Run** e enviá-lo. Enviar escreve dados clínicos |
| **Edit forms** | Criar e alterar formulários no construtor, e exportá-los |
| **Publish forms** | Publicar uma versão nova |

## Antes de começar

O Exemplo 1 precisa de três coisas na instalação:

1. **Os dados de exemplo da documentação**, pelos seus pacientes. Veja [Painéis, Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).
2. **Exames ativados neste laboratório.** O campo **Tests** do Lab order só lista esses. Siga primeiro [Catálogo de exames, Exemplos 1 e 2](/docs/test-catalog#exemplo-2-ativar-exames-neste-laboratorio).
3. **O fluxo Ingest ativo.** Está ativo numa instalação nova. Um formulário enviado passa por ele. Veja [Fluxos de trabalho](/docs/workflows).

> **Use uma instalação de teste.** Enviar um formulário escreve um pedido real, que não pode ser apagado. Depois do Exemplo 1, os dados de exemplo têm 61 pedidos, e não 60.

## Exemplo 1: fazer um pedido de exames

![Abrir o Lab order, escolher o paciente, o exame, a amostra e a prioridade.](forms-lab-order.mp4)

1. Abra **Formulários**. Na linha **Lab order**, abra **⋯** e selecione **View/Run**.
2. Em **Patient**, escreva `Chausiku` e escolha **Demo Chausiku**, nascido em 1994-05-14. Os nomes aparecem com o apelido primeiro.
3. Em **Tests**, escreva `Full` e escolha **Full blood count**. Aparece uma linha em **Results**: **FBC Full blood count**, **Tipo de amostra não definido**.
4. Selecione essa linha. No painel, defina o tipo de amostra como **Blood** e feche o painel. A linha mostra **Blood**.
5. Defina **Priority** como **Routine**.

![O pedido pronto a enviar.](forms-lab-order-filled.png)

6. Abra o menu **⋯** da página e selecione **Submit**.

![Enviar a partir do menu da página. Aparece Response captured.](forms-lab-order-submit.mp4)

**Resultado esperado:** uma faixa verde **Response captured** no topo. O pedido passa pelo fluxo Ingest até ao armazém, com o código de exame `58410-2` e a prioridade `routine`. Em [Pacientes](/docs/patients), Chausiku Demo tem agora cinco pedidos.

O formulário continua preenchido depois de enviar. Não envie outra vez, a não ser que queira um segundo pedido.

**Referring Facility** pesquisa no seu registo de unidades, por nome ou por código. Uma unidade aparece assim que está em [Unidades](/docs/facilities). **Requesting Clinician** recebe um nome escrito. O pedido guarda os dois, que chegam assim com ele ao armazém.

## Exemplo 2: construir um formulário a partir de um pacote inicial

Construa um formulário mais curto para pedidos de carga viral a partir do pacote Lab order, pré-visualize-o e publique-o.

![Dar nome ao formulário, escolher R4 e ServiceRequest, manter cinco campos do pacote e adicioná-los.](forms-build.mp4)

1. Em **Formulários**, abra o menu **⋯** da página e selecione **New**. Abre-se o **Construtor de Formulários**.
2. Em **Nome do formulário**, escreva `Quick viral load request`.
3. Defina **Versão FHIR** como **R4 (a mais comum)**.
4. Defina **Tipo de recurso** como **ServiceRequest**. Escreva para filtrar a lista longa. O **Pacote Lab order** abre sozinho, com **9 de 9 selecionados**. Cada entrada diz porque está lá.
5. Desmarque **Requesting Clinician**, **Clinical Notes**, **Referring Facility** e **Order rejection**.
6. Abra o menu **⋯** do pacote e selecione **Adicionar 5 campos**.

**Resultado esperado:** o construtor lista **5 campos (5 ativos)**: Patient, Tests, Results, Priority, e Reference Number em `identifier`. A **Biblioteca** à direita lista as entradas do pacote que deixou de fora, e todos os outros elementos de ServiceRequest, prontos a adicionar com um clique. Uma nota diz que o envio está configurado.

![O construtor com cinco campos, e a Biblioteca ao lado.](forms-builder.png)

### Pré-visualizar

![Abrir Preview a partir do menu do construtor e preenchê-lo com valores de exemplo.](forms-preview.mp4)

1. Abra **Ações do construtor**, o **⋯** no canto superior direito, e selecione **Pré-visualizar**. O formulário abre num painel, exatamente como um utilizador o vê.
2. Abra o menu **⋯** do painel e selecione **Preencher exemplo**. Cada campo recebe um valor de exemplo. **Repor**, no mesmo menu, limpa-os.

![A pré-visualização com valores de exemplo.](forms-preview-filled.png)

A pré-visualização nunca envia nada.

### Publicar

![Publicar a partir do menu do construtor.](forms-publish.mp4)

1. Feche a pré-visualização. Abra **Ações do construtor** e selecione **Publicar**. Publish guarda primeiro o formulário, por isso não há um passo de guardar à parte.

**Resultado esperado:** uma mensagem confirma, e o ponto de estado ao lado do nome fica verde com **v1**. Em **Formulários**, **Quick viral load request** aparece como **Published**, com **5** campos.

![O formulário novo na lista, Published.](forms-list-published.png)

Para o retirar, abra o menu **⋯** da linha e selecione **Delete**.

## O ciclo de vida

- **Guardar rascunho**, em **Ações do construtor**, guarda sem publicar nada.
- **Publicar** guarda o formulário que está no ecrã e depois publica-o.
- **Comparar** mostra as alterações entre duas versões.
- **Versões** lista cada versão publicada, a mais recente primeiro, com a data. Fica desativado enquanto o formulário nunca tiver sido guardado.
- **Repor**, nas ações de uma versão, repõe-na. Substitui o formulário em edição, e um formulário publicado volta logo a rascunho. Sai de View/Run até ser publicado outra vez. Undo no construtor só muda o ecrã: guarde para o escrever.
- Desmarcar um campo na lista desativa-o: não aparece, não é validado e não recolhe resposta. Fica no formulário para ser reativado.
- O menu de cada linha da lista duplica, compara, publica, arquiva, exporta (também como pacote do marketplace) ou elimina o formulário.
- **Rótulo da versão** é uma legenda livre. O número da versão é dado ao publicar e aparece ao lado do estado.

## Condições de envio

A publicação permite a partilha e os editores integrados. Não garante envios por View/Run. A captura suporta ServiceRequest e campos de resposta ativos com Extração em Observation e pelo menos um código. Um formulário de texto personalizado sem extração não pode ser enviado. Os modelos Patient e Facility continuam disponíveis nos seus editores próprios.

O editor e a página de captura indicam esta capacidade antes da introdução de dados. Para uma observação, abra o campo, selecione um código de terminologia em Códigos e marque Extração em Observation em Mapeamento. Ative o campo, guarde e publique. Preencha pelo menos um campo de extração: um campo vazio ou oculto não produz uma Observation.

Esta verificação cobre a configuração. As respostas obrigatórias, as referências e o fluxo de ingestão ativo ainda precisam de passar na validação.

## Estrutura da lista de campos

- **Qual entrada de uma lista um campo preenche.** Um campo ligado a uma entrada de uma lista FHIR mostra uma segunda linha sob o seu caminho, por exemplo `system = urn:x`. Dois campos em `Location.identifier.value` diferem apenas por esta linha.
- **Posições de uma mesma lista.** Os campos que partilham uma lista e têm um discriminador e um campo de valor ficam sob um cabeçalho. O cabeçalho mostra o nome da lista, o seu caminho e quantas posições tem. A lista deduz o cabeçalho dos campos, por isso não pode ser arrastado nem eliminado.
- **Os formulários fornecidos.** O formulário Patient agrupa o nome próprio e o apelido sob `Patient.name`, e o telefone sob `Patient.telecom`. O formulário Users agrupa o nome próprio e o apelido sob `Practitioner.name`, e o e-mail sob `Practitioner.telecom`. O formulário Facility coloca o seu código sob `Location.identifier`, e o formulário Lab order coloca o seu número de referência sob `ServiceRequest.identifier`. Uma instalação cujo operador editou um destes formulários mantém os seus próprios campos.
- **Grupos dentro de grupos.** Defina o **Grupo** de um grupo para o colocar dentro de outro grupo, a qualquer profundidade. O seletor nunca oferece o próprio grupo nem o que já está dentro dele.
- **O ícone de repetição.** Um campo que aceita mais de uma resposta, ou um grupo que contém várias entradas, mostra um ícone de repetição. Um grupo contém uma só entrada quando está ligado a um elemento único, como `Location.address`, ou quando **Máx. de itens** é 1. A exportação Questionnaire marca esse grupo como não repetível.
- A introdução de dados ainda mostra cada grupo uma vez. Adicionar entradas a um grupo durante a introdução de dados chega numa versão posterior.

## Editar um campo

- **Qual entrada de uma lista.** Em Mapeamento, marque **Elemento de lista (discriminador)**. Cada condição é um elemento, um operador e um valor, por exemplo `system` `equals` `urn:x`. Os operadores são `equals`, `not equals` e `starts with`. Com duas ou mais condições, escolha **Todas** quando todas têm de se cumprir, ou **Alguma** quando basta uma. **Campo de valor** indica o elemento que guarda a resposta, normalmente `value`.
- O discriminador é usado pelas verificações do formulário e pela exportação Questionnaire. A introdução de dados ainda não o usa, com uma exceção: quando um pedido Lab order é submetido, o seu número de referência leva o `system` que o seu discriminador indica.
- **Outra posição.** Sob a última posição de uma lista, **+ Adicionar posição com nome** acrescenta uma cópia com o mesmo caminho, o mesmo campo de valor e o mesmo tipo, e valores de discriminador em branco. A propriedade API, os códigos e as traduções ficam em branco.
- **Partes de um grupo.** O editor de um grupo lista as suas partes depois de Mapeamento. Clique numa parte para a editar. As alterações do grupo ainda não guardadas são guardadas primeiro. **+ Adicionar parte** acrescenta um campo dentro do grupo, sem caminho FHIR.
- **Campos reference.** Um campo referência tem um bloco **Configuração da referência** depois de Geral. **Destino** é `Patient` ou um sistema de códigos ativo. **Pesquisável** é guardado e exportado, mas a introdução de dados ainda não o usa. **Depende de** é usado num só caso: um campo que depende de um campo Tests ligado à lista de exames deste laboratório só oferece as amostras aceites pelos exames escolhidos. O pedido de exames entregue já não o usa: cada exame tem a sua própria amostra (ver Catálogo de exames). Qualquer outra definição **Depende de** é guardada mas não usada.
- **Campos bloqueados.** Um campo bloqueado não pode ser desativado nem eliminado a partir da lista. Pode ainda mudar o rótulo, a ordem e a tradução.
- **Formulários de inquérito.** Quando o Tipo de recurso do formulário é `Questionnaire`, o editor esconde Caminho FHIR, Propriedade da API e o discriminador. Extração em Observation e as outras definições mantêm-se.

## Opções e ValueSets

- Um campo lista ou lista múltipla pode tirar as opções de um ValueSet. No bloco Opções, pesquise um ValueSet e escolha-o. Os códigos dele são copiados para as opções, e o campo guarda uma ligação ao ValueSet com uma força. Uma força required impede que a introdução de dados aceite outros valores.
- **Desligar**, no menu ⋯ do bloco Opções, retira a ligação e mantém as opções. **Guardar como novo conjunto de valores** transforma opções escritas num ValueSet reutilizável; só aparece se puder gerir a terminologia.
- Por baixo do Caminho FHIR, **ligado:** indica o ValueSet a que o próprio FHIR liga esse elemento, e com que força. **Carregar da terminologia**, no menu ⋯ do bloco Opções, preenche as opções a partir desse ValueSet.
- Escolher um caminho que o FHIR liga como required ou extensible, num campo sem ValueSet, faz a ligação por si e torna-o uma lista. As ligações preferred e example ficam à sua escolha, tal como um campo que já indica uma fonte de referência.
- Um campo de referência escolhe o ValueSet no bloco Reference Configuration. Pesquisa o ValueSet em direto, por isso nada é copiado.
- Todas as instalações têm os 672 ValueSets padrão do FHIR. Os formulários de inquérito não têm elementos ligados, por isso não mostram a linha **ligado:**.

## Códigos sugeridos

- Num campo com Caminho FHIR, o bloco Códigos mostra **Códigos sugeridos** por cima da pesquisa de termos.
- Um código **Ligação** vem do ValueSet do campo, ou do ValueSet a que o FHIR liga o elemento. **Os seus formulários · N** significa que N outros formulários põem esse código no mesmo caminho.
- Clique numa linha para pôr o código no campo.
- **não está na sua terminologia** marca um código que o CE não tem. Adicioná-lo também o adiciona à sua terminologia, e o painel indica-o, com **Anular**. O Undo retira-o da sua terminologia; o código fica no campo.
- Só um utilizador que possa gerir a terminologia pode adicionar esse código. Os outros autores veem-no a cinzento.
- Um código de um sistema de codificação que o CE não tem é recusado. Adicione primeiro o sistema na página Terminology.
- Uma lista vazia significa que a sua terminologia está incompleta, não que nenhum código exista. Pesquise abaixo, ou adicione códigos na página Terminology.
- Quando um ValueSet tem muitos códigos, o painel mostra 50 que nenhum formulário usa, e indica quantos mais existem.

## Pacotes iniciais

- Um pacote inicial é uma lista de campos pronta para um Tipo de recurso, tirada dos formulários que o OpenLDR traz: Location (Facility), Practitioner (Users), Patient e ServiceRequest (Lab order).
- Quando escolhe um Tipo de recurso num formulário vazio, o pacote abre sozinho num painel lateral. Num formulário que já tem campos, escolha **Começar a partir de um pacote** no menu ⋯.
- Cada entrada diz porque está lá. Desmarque o que não recolhe e depois escolha **Adicionar N campos** no menu ⋯ do painel. O acréscimo desfaz-se de uma só vez.
- Uma entrada bloqueada fica marcada, porque a página que o formulário alimenta não consegue guardar um registo sem ela.
- As entradas que já estão no formulário não aparecem no painel.
- As entradas codificadas tiram as opções da lista do próprio FHIR. O pacote Lab order deixa de fora **Ward / Department**, porque os códigos dele são locais; acrescente-o a partir de **Biblioteca** e dê-lhe opções.
- Os formulários de inquérito e os formulários sem Tipo de recurso não têm pacote.

## O painel Biblioteca

- O painel à direita lista os elementos FHIR do Tipo de recurso do formulário que nenhum campo usa ainda. Clique num elemento para o acrescentar como campo; o editor dele abre.
- Acima dos elementos, **Deixados fora do pacote** lista as entradas do pacote que o formulário não tem, pela ordem do pacote. Clique numa para a acrescentar.
- Um campo acrescentado assim recebe o nome e o tipo do elemento. Um elemento codificado passa a ser uma lista, com opções quando o elemento lista os seus códigos. As datas chegam como campos de texto; mude o tipo no editor.
- Um elemento que pertence a um grupo já presente no formulário entra nesse grupo.
- A pesquisa filtra por nome e por caminho. A lista desce dois níveis, por exemplo `Location.address.city`.
- Um formulário de inquérito não tem **Biblioteca**.
- Quando o editor tem menos de 980 pixels de largura, **Formulário** e **Biblioteca** passam a ser separadores. Acrescentar a partir de **Biblioteca** volta a **Formulário**. Recolher a barra lateral pode mostrar de novo os dois painéis.

## Trabalhar com vários campos

- Clique num campo para abrir o editor dele. Shift-clique seleciona todos os campos entre o último clicado e este. Ctrl-clique (Cmd-clique num Mac) acrescenta ou retira um campo. Nenhum dos dois abre o editor.
- Ctrl+A (Cmd+A) seleciona todos os campos que a lista mostra. Escape limpa a seleção.
- Com dois ou mais selecionados, o cabeçalho da lista mostra quantos são, e o menu ⋯ dele move-os para uma secção, ativa-os ou desativa-os, ou elimina-os. A eliminação pede confirmação. Cada ação desfaz-se de uma só vez.
- **Ativar ou desativar** desativa todos quando pelo menos metade está ativa, e ativa todos no caso contrário. Ignora os campos bloqueados, tal como **Eliminar**.
- Quando nenhuma caixa ou menu tem o foco: j e k (ou as setas) descem e sobem na lista, Enter abre o campo, Espaço ativa-o ou desativa-o, d elimina-o e Ctrl+D duplica-o. Com dois ou mais selecionados, Espaço e d atuam sobre todos. Ctrl+F leva o cursor para a pesquisa de campos.
- Um telemóvel não tem teclas Shift nem Ctrl, por isso num telemóvel seleciona um campo de cada vez.

## Secções

- Arraste um campo pela pega. Enquanto arrasta, um painel no topo da lista mostra **(sem secção)** e cada secção, com o número de campos. Largue o campo numa delas para o mover para lá. O painel só aparece quando o formulário tem secções.
- Na lista Secções, o menu ⋯ de cada secção tem **Editar visibilidade**, **Subir**, **Descer** e **Eliminar**.
- **Editar visibilidade** abre o mesmo editor de regras de um campo. Só os campos ativos podem ser usados numa condição. A introdução de dados esconde a secção enquanto a regra não se cumpre.
- Um campo ou secção com uma regra de visibilidade mostra um ícone de ramificação.

## Exemplo: enviar um pedido de laboratório

Use uma instalação de teste com um paciente existente, terminologia LOINC carregada e o fluxo de ingestão ativo. Precisa de permissão para editar e publicar formulários e enviar respostas.

1. Em Forms, abra o menu ⋯ da página e escolha New. Dê ao formulário o nome Exemplo de pedido.
2. Selecione R4, o tipo ServiceRequest e a página de destino Forms. Abra o editor.
3. Adicione um campo referência ativo e obrigatório, com o rótulo Patient. Em **Configuração da referência**, defina Destino como Patient. Em Mapeamento, defina Caminho FHIR como ServiceRequest.subject.
4. Adicione um campo referência ativo e obrigatório, com o rótulo Tests. Em **Configuração da referência**, defina Destino como o sistema LOINC instalado, http://loinc.org, e Caminho FHIR como ServiceRequest.code. Selecione códigos na terminologia, sem inventar códigos.
5. Guarde cada campo no respetivo menu ⋯. Confirme a mensagem de configuração. Extração em Observation não é necessário neste formulário ServiceRequest.
6. No menu ⋯ do editor, escolha Publish. Resolva eventuais erros. A publicação também guarda o esquema atual.
7. Volte a Forms e escolha View/Run no menu ⋯ do formulário. Selecione um paciente existente e um teste carregado nas listas.
8. Escolha Submit em Form actions. Aguarde Response captured. A resposta e o ServiceRequest derivado passam pelo fluxo de ingestão.
9. Verifique a execução do fluxo e o pedido guardado antes de repetir o envio. Se houver armazenamento parcial, inspecione primeiro a execução: uma repetição pode criar duplicados.

Se uma lista estiver vazia, verifique a fonte e a terminologia carregada. Ative um fluxo desativado antes de repetir. As mensagens de campos obrigatórios usam o rótulo visível.


## Escolher exames no pedido de exames

Escreva pelo menos dois caracteres do código ou do nome de um exame no campo Tests para o procurar. Se não conhece nenhum dos dois, abra o menu ⋯ ao lado do rótulo Tests e escolha **Ver todos os exames**. O painel lista todo o catálogo página a página, com uma pesquisa e um filtro por categoria.

Escolha um exame para o juntar aos que já estão escolhidos. Um exame que este laboratório não faz aparece marcado **Não oferecido aqui** e não pode ser escolhido, porque o pedido seria recusado no envio. Quem pode gerir o catálogo ativa-o na página Catálogo de exames.

Uma instalação sem catálogo carregado não tem nada para ver, e o painel diz isso. Os exames vêm da página Catálogo de exames, onde um laboratório importa a sua lista. O OpenLDR não traz exames.

## Resultados no pedido de exames

Cada exame escolhido num pedido recebe uma linha por baixo do campo Tests. A linha mostra o código e o nome do exame, e se a amostra está definida. Abrir uma linha mostra a escolha da amostra, o intervalo de referência que corresponde a este doente, e um campo por parâmetro de resultado.

Um valor fora do intervalo é assinalado ao lado do campo. Nunca é recusado: quem decide é a bancada.

Cada resultado numérico tem um seletor de intervalo por baixo do campo, que lista cada intervalo pelo nome, ou, quando não tem nome, por quem é. Começa no intervalo que corresponde ao doente. Escolher um intervalo que não corresponde mostra um aviso e continua permitido. O sinal segue o intervalo escolhido. Se os intervalos do exame mudaram depois de o painel ter sido aberto, o envio do pedido é recusado. Reabra o exame e escolha um intervalo novamente.

Um exame pode ser recusado no menu da sua linha, com um motivo de uma lista. Um exame recusado fica registado com o motivo, mas o motivo não chega aos relatórios. No seu pedido, o exame aparece como uma linha de resultado sem valor.

O pedido inteiro pode ser recusado no menu da página, com **Recusar o pedido**. Escolha um motivo da lista. Se os motivos não puderem ser lidos, o painel diz isso e não é possível recusar. Nada tenta de novo sozinho, por isso feche o painel e abra-o outra vez. Depois de recusado, uma linha por baixo do cabeçalho mostra o motivo, e cada linha de exame mostra "Pedido recusado" e fica fechada à escrita. Os valores já escritos ficam no ecrã mas não são gravados. **Anular a recusa**, no mesmo menu, volta a abrir as linhas.

Um pedido recusado fica marcado como recusado, com o código e o texto do motivo. O motivo chega ao registo do laboratório (o código e o motivo de recusa no pedido), por isso um relatório pode contá-lo. O código de recusa do pedido fica no mesmo lugar que os códigos de recusa que chegam do sistema do laboratório, por isso um relatório que agrupa por código vê os dois tipos. Nenhum resultado é escrito para um pedido recusado.

Cada resultado escrito fica ligado ao seu pedido, para que os relatórios possam juntar um resultado ao pedido de onde veio.

Um pedido enviado escreve um registo de resultado por valor escrito. Os resultados são escritos junto com o pedido, de uma só vez. Ainda não há forma de reabrir um pedido enviado para os adicionar mais tarde.

## Validação dos caminhos FHIR

Quando um formulário corresponde a um tipo de recurso FHIR, o construtor verifica o caminho FHIR de cada campo na lista de elementos. Um distintivo vermelho é um erro que bloqueia a publicação. Um amarelo é um aviso que não bloqueia, mas deve ser revisto. O construtor só verifica nove tipos de recurso comuns. Os outros tipos não têm distintivos, porque os caminhos não são verificados.

- **unknown-fhir-path (erro).** O caminho não é um elemento deste tipo de recurso. Normalmente um erro de escrita: verifique a ortografia e a profundidade.
- **facility-admin-order (erro).** Os níveis administrativos da unidade estão ligados às partes de morada FHIR pela ordem errada. FHIR Address tem quatro níveis, o registo seis. Zone é o nível sem lugar: limpe o caminho FHIR do campo Zone e deixe-o sem correspondência. Um formulário Facility guardado por uma migração antiga pode ainda ligar Zone a `address.district`. Nenhuma migração o corrige: limpe esse caminho à mão.
- **fhir-path-cardinality (aviso).** O caminho passa por um elemento que se repete sem discriminador. Junte um discriminador FHIR ao campo para escolher a ocorrência.
- **fhir-path-type-mismatch (aviso).** Um campo simples está ligado a um elemento FHIR estruturado que um só valor não preenche. Mude o tipo de campo, ou ligue um caminho mais específico.

## Na linha de comandos

- `openldr forms lint` dá as mesmas verificações sem o studio. Passe um id de formulário para verificar só um, e `--json` para saída estruturada. O comando sai com erro quando existe algum erro.
- `openldr forms versions <id>` lista as versões publicadas de um formulário, a mais recente primeiro.
- `openldr forms restore <id> <versão> --force` repõe uma versão publicada sobre o rascunho atual. Recusa sem `--force`.

## Limites

- **Um Lab order editado mantém o Referring Facility antigo.** A atualização só altera o Lab order incluído se ninguém o tiver editado. Numa cópia editada, Referring Facility continua a ser uma caixa de texto, e o pedido não o guarda. Para corrigir, abra o campo. Defina **Tipo de campo** como `referência`: aparece o bloco **Configuração da referência**. Nele, defina **Destino** como `urn:openldr:cs:facility-registry`. Defina **Caminho FHIR** como `ServiceRequest.requester`. Marque **Elemento de lista (discriminador)** e faça corresponder `type` igual a `Organization`. Depois dê o mesmo caminho a **Requesting Clinician**, com `type` igual a `Practitioner`.
- **A introdução de dados mostra cada grupo uma vez.** Juntar entradas a um grupo durante a introdução ainda não é possível.
- **Um pedido enviado não se edita.** Os resultados escrevem-se com o pedido, de uma só vez.

## Num telemóvel

Os formulários funcionam num telemóvel. **View/Run** põe cada rótulo por cima da sua caixa. A pré-visualização do construtor abre também num painel. Um telemóvel não tem teclas Shift nem Ctrl, por isso no construtor seleciona-se um campo de cada vez. Abaixo de 980 píxeis de largura, **Formulário** e **Biblioteca** passam a separadores.

## Resolução de problemas

- **O campo Tests do Lab order está vazio.** Nenhum exame está ativado neste laboratório. Veja [Catálogo de exames](/docs/test-catalog).
- **A pesquisa de pacientes não encontra ninguém.** Precisa de parte do nome, de um identificador ou de um telefone. Sem **View patient identifiers**, só encontra um identificador exato. Veja [Pacientes](/docs/patients).
- **O envio falha.** Leia a mensagem. Um campo obrigatório está vazio, ou o fluxo Ingest está desligado.
- **O envio parece não fazer nada.** Cada ação confirma-se com uma mensagem. Sem mensagem, a ação não correu.
- **Publish não está disponível.** Complete os metadados obrigatórios ou corrija um campo mal configurado.
- **Um campo desativado continua a aparecer.** Confirme que a caixa está desmarcada e guarde.

## Guias relacionados

- [Catálogo de exames](/docs/test-catalog)
- [Pacientes](/docs/patients)
- [Terminologia](/docs/terminology)
- [Fluxos de trabalho](/docs/workflows)
- [Marketplace](/docs/marketplace)

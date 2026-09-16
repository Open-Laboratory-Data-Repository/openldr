# Formulários

## Condições de envio

A publicação permite a partilha e os editores integrados. Não garante envios por View/Run. A captura suporta ServiceRequest e campos de resposta ativos com Observation Extract e pelo menos um código. Um formulário de texto personalizado sem extração não pode ser enviado. Os modelos Patient e Facility continuam disponíveis nos seus editores próprios.

O editor e a página de captura indicam esta capacidade antes da introdução de dados. Para uma observação, abra o campo, selecione um código de terminologia em Codes e marque Observation Extract em Mapping. Ative o campo, guarde e publique. Preencha pelo menos um campo de extração: um campo vazio ou oculto não produz uma Observation.

Esta verificação cobre a configuração. As respostas obrigatórias, as referências e o fluxo de ingestão ativo ainda precisam de passar na validação.

## Estrutura da lista de campos

- **Qual entrada de uma lista um campo preenche.** Um campo ligado a uma entrada de uma lista FHIR mostra uma segunda linha sob o seu caminho, por exemplo `system = urn:x`. Dois campos em `Location.identifier.value` diferem apenas por esta linha.
- **Posições de uma mesma lista.** Os campos que partilham uma lista e têm um discriminador e um campo de valor ficam sob um cabeçalho. O cabeçalho mostra o nome da lista, o seu caminho e quantas posições tem. A lista deduz o cabeçalho dos campos, por isso não pode ser arrastado nem eliminado.
- **Os formulários fornecidos.** O formulário Patient agrupa o nome próprio e o apelido sob `Patient.name`, e o telefone sob `Patient.telecom`. O formulário Users agrupa o nome próprio e o apelido sob `Practitioner.name`, e o e-mail sob `Practitioner.telecom`. O formulário Facility coloca o seu código sob `Location.identifier`, e o formulário Lab order coloca o seu número de referência sob `ServiceRequest.identifier`. Uma instalação cujo operador editou um destes formulários mantém os seus próprios campos.
- **Grupos dentro de grupos.** Defina o **Group** de um grupo para o colocar dentro de outro grupo, a qualquer profundidade. O seletor nunca oferece o próprio grupo nem o que já está dentro dele.
- **O ícone de repetição.** Um campo que aceita mais de uma resposta, ou um grupo que contém várias entradas, mostra um ícone de repetição. Um grupo contém uma só entrada quando está ligado a um elemento único, como `Location.address`, ou quando **Max Items** é 1. A exportação Questionnaire marca esse grupo como não repetível.
- A introdução de dados ainda mostra cada grupo uma vez. Adicionar entradas a um grupo durante a introdução de dados chega numa versão posterior.

## Editar um campo

- **Qual entrada de uma lista.** Em Mapping, marque **Array element (discriminator)**. Cada condição é um elemento, um operador e um valor, por exemplo `system` `equals` `urn:x`. Os operadores são `equals`, `not equals` e `starts with`. Com duas ou mais condições, escolha **All** quando todas têm de se cumprir, ou **Any** quando basta uma. **Value Field** indica o elemento que guarda a resposta, normalmente `value`.
- O discriminador é usado pelas verificações do formulário e pela exportação Questionnaire. A introdução de dados ainda não o usa, com uma exceção: quando um pedido Lab order é submetido, o seu número de referência leva o `system` que o seu discriminador indica.
- **Outra posição.** Sob a última posição de uma lista, **+ Add a named slot** acrescenta uma cópia com o mesmo caminho, o mesmo campo de valor e o mesmo tipo, e valores de discriminador em branco. A propriedade API, os códigos e as traduções ficam em branco.
- **Partes de um grupo.** O editor de um grupo lista as suas partes depois de Mapping. Clique numa parte para a editar. As alterações do grupo ainda não guardadas são guardadas primeiro. **+ Add a part** acrescenta um campo dentro do grupo, sem caminho FHIR.
- **Campos reference.** Um campo reference tem um bloco **Reference Configuration** depois de General. **Target** é `Patient` ou um sistema de códigos ativo. **Searchable** é guardado e exportado, mas a introdução de dados ainda não o usa. **Depends On** é usado num só caso: um campo que depende de um campo Tests ligado à lista de exames deste laboratório só oferece as amostras aceites pelos exames escolhidos. O pedido de exames entregue já não o usa: cada exame tem a sua própria amostra (ver Catálogo de exames). Qualquer outra definição **Depends On** é guardada mas não usada.
- **Campos bloqueados.** Um campo bloqueado não pode ser desativado nem eliminado a partir da lista. Pode ainda mudar o rótulo, a ordem e a tradução.
- **Formulários de inquérito.** Quando o Resource Type do formulário é `Questionnaire`, o editor esconde FHIR Path, API Property e o discriminador. Observation Extract e as outras definições mantêm-se.

## Opções e ValueSets

- Um campo select ou multiselect pode tirar as opções de um ValueSet. No bloco Options, pesquise um ValueSet e escolha-o. Os códigos dele são copiados para as opções, e o campo guarda uma ligação ao ValueSet com uma força. Uma força required impede que a introdução de dados aceite outros valores.
- **Unbind**, no menu ⋯ do bloco Options, retira a ligação e mantém as opções. **Save as a new ValueSet** transforma opções escritas num ValueSet reutilizável; só aparece se puder gerir a terminologia.
- Por baixo do FHIR Path, **bound:** indica o ValueSet a que o próprio FHIR liga esse elemento, e com que força. **Load from terminology**, no menu ⋯ do bloco Options, preenche as opções a partir desse ValueSet.
- Escolher um caminho que o FHIR liga como required ou extensible, num campo sem ValueSet, faz a ligação por si e torna-o um select. As ligações preferred e example ficam à sua escolha, tal como um campo que já indica uma fonte de referência.
- Um campo de referência escolhe o ValueSet no bloco Reference Configuration. Pesquisa o ValueSet em direto, por isso nada é copiado.
- Todas as instalações têm os 672 ValueSets padrão do FHIR. Os formulários de inquérito não têm elementos ligados, por isso não mostram a linha **bound:**.

## Códigos sugeridos

- Num campo com FHIR Path, o bloco Codes mostra **Suggested codes** por cima da pesquisa de termos.
- Um código **Binding** vem do ValueSet do campo, ou do ValueSet a que o FHIR liga o elemento. **Your forms · N** significa que N outros formulários põem esse código no mesmo caminho.
- Clique numa linha para pôr o código no campo.
- **not in your terminology** marca um código que o CE não tem. Adicioná-lo também o adiciona à sua terminologia, e o painel indica-o, com **Undo**. O Undo retira-o da sua terminologia; o código fica no campo.
- Só um utilizador que possa gerir a terminologia pode adicionar esse código. Os outros autores veem-no a cinzento.
- Um código de um sistema de codificação que o CE não tem é recusado. Adicione primeiro o sistema na página Terminology.
- Uma lista vazia significa que a sua terminologia está incompleta, não que nenhum código exista. Pesquise abaixo, ou adicione códigos na página Terminology.
- Quando um ValueSet tem muitos códigos, o painel mostra 50 que nenhum formulário usa, e indica quantos mais existem.

## Pacotes iniciais

- Um pacote inicial é uma lista de campos pronta para um Resource Type, tirada dos formulários que o OpenLDR traz: Location (Facility), Practitioner (Users), Patient e ServiceRequest (Lab order).
- Quando escolhe um Resource Type num formulário vazio, o pacote abre sozinho num painel lateral. Num formulário que já tem campos, escolha **Start from a pack** no menu ⋯.
- Cada entrada diz porque está lá. Desmarque o que não recolhe e depois escolha **Add N fields** no menu ⋯ do painel. O acréscimo desfaz-se de uma só vez.
- Uma entrada bloqueada fica marcada, porque a página que o formulário alimenta não consegue guardar um registo sem ela.
- As entradas que já estão no formulário não aparecem no painel.
- As entradas codificadas tiram as opções da lista do próprio FHIR. O pacote Lab order deixa de fora **Ward / Department**, porque os códigos dele são locais; acrescente-o a partir de **Library** e dê-lhe opções.
- Os formulários de inquérito e os formulários sem Resource Type não têm pacote.

## O painel Library

- O painel à direita lista os elementos FHIR do Resource Type do formulário que nenhum campo usa ainda. Clique num elemento para o acrescentar como campo; o editor dele abre.
- Acima dos elementos, **Left out of the pack** lista as entradas do pacote que o formulário não tem, pela ordem do pacote. Clique numa para a acrescentar.
- Um campo acrescentado assim recebe o nome e o tipo do elemento. Um elemento codificado passa a ser um select, com opções quando o elemento lista os seus códigos. As datas chegam como campos de texto; mude o tipo no editor.
- Um elemento que pertence a um grupo já presente no formulário entra nesse grupo.
- A pesquisa filtra por nome e por caminho. A lista desce dois níveis, por exemplo `Location.address.city`.
- Um formulário de inquérito não tem **Library**.
- Quando o editor tem menos de 980 pixels de largura, **Form** e **Library** passam a ser separadores. Acrescentar a partir de **Library** volta a **Form**. Recolher a barra lateral pode mostrar de novo os dois painéis.

## Trabalhar com vários campos

- Clique num campo para abrir o editor dele. Shift-clique seleciona todos os campos entre o último clicado e este. Ctrl-clique (Cmd-clique num Mac) acrescenta ou retira um campo. Nenhum dos dois abre o editor.
- Ctrl+A (Cmd+A) seleciona todos os campos que a lista mostra. Escape limpa a seleção.
- Com dois ou mais selecionados, o cabeçalho da lista mostra quantos são, e o menu ⋯ dele move-os para uma secção, ativa-os ou desativa-os, ou elimina-os. A eliminação pede confirmação. Cada ação desfaz-se de uma só vez.
- **Toggle enabled** desativa todos quando pelo menos metade está ativa, e ativa todos no caso contrário. Ignora os campos bloqueados, tal como **Delete**.
- Quando nenhuma caixa ou menu tem o foco: j e k (ou as setas) descem e sobem na lista, Enter abre o campo, Espaço ativa-o ou desativa-o, d elimina-o e Ctrl+D duplica-o. Com dois ou mais selecionados, Espaço e d atuam sobre todos. Ctrl+F leva o cursor para a pesquisa de campos.
- Um telemóvel não tem teclas Shift nem Ctrl, por isso num telemóvel seleciona um campo de cada vez.

## Secções

- Arraste um campo pela pega. Enquanto arrasta, um painel no topo da lista mostra **(no section)** e cada secção, com o número de campos. Largue o campo numa delas para o mover para lá. O painel só aparece quando o formulário tem secções.
- Na lista Sections, o menu ⋯ de cada secção tem **Edit visibility**, **Move up**, **Move down** e **Delete**.
- **Edit visibility** abre o mesmo editor de regras de um campo. Só os campos ativos podem ser usados numa condição. A introdução de dados esconde a secção enquanto a regra não se cumpre.
- Um campo ou secção com uma regra de visibilidade mostra um ícone de ramificação.

## Exemplo: enviar um pedido de laboratório

Use uma instalação de teste com um paciente existente, terminologia LOINC carregada e o fluxo de ingestão ativo. Precisa de permissão para editar e publicar formulários e enviar respostas.

1. Em Forms, abra o menu ⋯ da página e escolha New. Dê ao formulário o nome Exemplo de pedido.
2. Selecione R4, o tipo ServiceRequest e a página de destino Forms. Abra o editor.
3. Adicione um campo reference ativo e obrigatório, com o rótulo Patient. Em **Reference Configuration**, defina Target como Patient. Em Mapping, defina FHIR Path como ServiceRequest.subject.
4. Adicione um campo reference ativo e obrigatório, com o rótulo Tests. Em **Reference Configuration**, defina Target como o sistema LOINC instalado, http://loinc.org, e FHIR Path como ServiceRequest.code. Selecione códigos na terminologia, sem inventar códigos.
5. Guarde cada campo no respetivo menu ⋯. Confirme a mensagem de configuração. Observation Extract não é necessário neste formulário ServiceRequest.
6. No menu ⋯ do editor, escolha Publish. Resolva eventuais erros. A publicação também guarda o esquema atual.
7. Volte a Forms e escolha View/Run no menu ⋯ do formulário. Selecione um paciente existente e um teste carregado nas listas.
8. Escolha Submit em Form actions. Aguarde Response captured. A resposta e o ServiceRequest derivado passam pelo fluxo de ingestão.
9. Verifique a execução do fluxo e o pedido guardado antes de repetir o envio. Se houver armazenamento parcial, inspecione primeiro a execução: uma repetição pode criar duplicados.

Se uma lista estiver vazia, verifique a fonte e a terminologia carregada. Ative um fluxo desativado antes de repetir. As mensagens de campos obrigatórios usam o rótulo visível.


## Resultados no pedido de exames

Cada exame escolhido num pedido recebe uma linha por baixo do campo Tests. A linha mostra o código e o nome do exame, e se a amostra está definida. Abrir uma linha mostra a escolha da amostra, o intervalo de referência que corresponde a este doente, e um campo por parâmetro de resultado.

Um valor fora do intervalo é assinalado ao lado do campo. Nunca é recusado: quem decide é a bancada.

Um exame pode ser recusado no menu da sua linha, e o pedido inteiro no menu da página, cada um com um motivo de uma lista. Um exame recusado fica registado com o motivo, e ainda não aparece nos relatórios.

Um pedido enviado escreve um registo de resultado por valor escrito. Os resultados são escritos junto com o pedido, de uma só vez. Ainda não há forma de reabrir um pedido enviado para os adicionar mais tarde.

# Receção

A receção é o balcão do laboratório. Quando chega uma amostra, encontra o pedido pelo número de requisição, regista o pedido se o laboratório não tiver registo dele, associa o paciente e regista a amostra com a sua condição. O pessoal da receção e os gestores de laboratório usam-na.

Precisa de **Receive samples** para abrir **Receção**. As funções incluídas **Reception** e **Lab Manager** têm-na. Um utilizador com um limite de dados não pode abrir a receção, seja qual for a sua função.

Os nomes das funções e das capacidades aparecem em inglês no ecrã. Por isso este guia escreve-os em inglês.

**Devolver um pedido ao seu local, rejeitar uma amostra, as listas de trabalho e a revisão de resultados não fazem parte desta versão.** Chegam em versões posteriores.

## Encontrar um pedido

O código de barras de uma requisição contém o seu número de requisição. Um leitor escreve o número na caixa e prime Enter por si.

1. Selecione **Receção** no menu principal.
2. Leia o código de barras da requisição, ou escreva o número de requisição na caixa no topo e prima Enter.

**Resultado esperado:** cada pedido com esse número aparece num painel. O painel mostra o número, a origem do pedido, **Unidade sanitária** e **Paciente**. Mostra também **Prioridade**, **Clínico** e **Nota** quando o pedido os tem. Por baixo estão as análises do pedido, com **Análise**, **Código** e **Estado**, e as suas **Amostras**.

Depois de uma pesquisa, o número fica selecionado na caixa. A leitura seguinte substitui-o, por isso nunca precisa de limpar a caixa.

A etiqueta ao lado do número diz de onde veio o pedido: **Registado na receção**, **Formulário de pedido** ou **De outro sistema**.

Duas unidades sanitárias podem usar o mesmo número. Nesse caso vê um painel para cada uma. Confira **Unidade sanitária** antes de continuar.

Quando nenhum pedido tem o número, a página diz, por exemplo, `Não foi encontrado nenhum pedido CS-0001. Use o menu para o registar.`

## Registar um pedido que não foi encontrado

Faça isto quando tem a requisição à sua frente mas o laboratório não tem registo do pedido.

1. Pesquise o número, como na tarefa acima.
2. Abra o menu de pontos à direita da caixa e selecione **Registar este pedido**.
3. Confira o número em **Número de requisição**. Vem preenchido da sua pesquisa.
4. Em **Unidade sanitária**, escreva duas letras do nome ou do código e escolha a unidade na lista.
5. Em **Análises**, escreva parte do nome de uma análise e marque cada análise pedida.
6. Abra o menu de pontos do painel e selecione **Encontrar ou registar paciente**. Depois siga a tarefa seguinte.
7. Escolha **Prioridade**, e escreva **Clínico** e **Nota** se a requisição os indicar.
8. Abra o menu de pontos do painel e selecione **Registar pedido**.

**Resultado esperado:** uma mensagem diz, por exemplo, `Pedido CS-0001 registado.` O pedido aparece num painel marcado **Registado na receção**.

A unidade sanitária, o número e as análises não podem ser alterados depois do registo. Confira-os antes do passo 8.

Um pedido precisa de um número, de uma unidade sanitária, de pelo menos uma análise e de um paciente. Se faltar um deles, nada é guardado.

**Registar este pedido** fica no menu depois de qualquer pesquisa, mesmo quando foi encontrado um pedido, porque outra unidade sanitária pode usar o mesmo número. O mesmo número da mesma unidade sanitária não pode ser registado duas vezes.

## Encontrar o paciente

O painel **Paciente** abre a partir de **Encontrar ou registar paciente** no painel de registo, ou de **Associar paciente** no menu de pontos de um pedido.

1. Escreva o identificador do paciente em **Identificador**. Ou escreva o nome próprio e o apelido em **Nome completo** e escolha a **Data de nascimento**.
2. Abra o menu de pontos ao lado de **Encontrar** e selecione **Pesquisar**.
3. Selecione o paciente na lista.
4. Abra o mesmo menu de pontos e selecione **Usar este paciente**.

**Resultado esperado:** o painel fecha. O nome do paciente aparece ao lado de **Paciente**.

Uma pesquisa só mostra um paciente com um identificador exato, ou um nome completo com a data de nascimento completa. Parte de um nome, ou um nome sem data de nascimento, não encontra ninguém. Assim pode confirmar um paciente que já conhece sem percorrer a lista de pacientes.

Uma pesquisa por identificador usa os sistemas de identificador que o seu laboratório tornou pesquisáveis.

## Registar um paciente novo

Faça isto quando a pesquisa diz `Nenhum paciente corresponde. Registe-o abaixo.`

1. Em **Novo paciente**, escreva **Nome próprio** e **Apelido**.
2. Escolha **Sexo**.
3. Escolha **Data de nascimento**. Se ninguém a souber, escreva antes a idade em **Idade em anos**.
4. Se o paciente tiver um identificador, escreva **Sistema do identificador** e **Valor do identificador**.
5. Abra o menu de pontos ao lado de **Encontrar** e selecione **Registar paciente**.

**Resultado esperado:** uma mensagem diz que o paciente foi registado. O painel fecha, e o paciente novo é usado no pedido.

Com uma idade em vez de uma data de nascimento, o OpenLDR estima a data de nascimento como 1 de janeiro do ano que a idade indica. O registo do paciente diz que a data de nascimento é uma estimativa.

Um identificador precisa do sistema e do valor. Deixe os dois vazios quando o paciente não tem nenhum.

## Associar o paciente a um pedido encontrado

Faça isto quando um pedido mostra **Nenhum paciente associado**, ou o paciente errado.

1. Abra o menu de pontos do painel do pedido e selecione **Associar paciente**.
2. Encontre o paciente, ou registe um novo, como nas duas tarefas acima.
3. Selecione **Usar este paciente**, ou **Registar paciente** para um novo.

**Resultado esperado:** uma mensagem diz que o paciente foi associado ao pedido. O painel mostra o nome do paciente.

A associação fica guardada como uma correção, com o seu nome e o motivo `Paciente associado na receção`.

## Receber a amostra

1. Abra o menu de pontos do painel do pedido e selecione **Receber amostra**.
2. Escolha **Tipo de amostra**. A lista tem os tipos de amostra que as análises do pedido aceitam, segundo o catálogo de exames.
3. Escolha **Condição**, ou deixe **Não indicada**.
4. Em **Para as análises**, mantenha marcadas as análises a que esta amostra se destina.
5. Abra o menu de pontos do painel e selecione **Receber amostra**.

**Resultado esperado:** uma mensagem diz, por exemplo, `Amostra recebida para o pedido CS-0001.` A amostra aparece em **Amostras**, com a sua condição e a hora em que foi recebida.

Um pedido guarda uma amostra de cada tipo. Receber de novo o mesmo tipo atualiza essa amostra.

A lista de condições vem do conjunto de valores de condições de amostra do seu laboratório. Se o painel disser `As análises deste pedido não indicam nenhum tipo de amostra.`, acrescente os tipos de amostra a essas análises no catálogo de exames.

## Corrigir um erro de escrita num pedido

Uma correção pode alterar a prioridade, o clínico e a nota. Para mudar o paciente, use **Associar paciente**.

1. Abra o menu de pontos do painel do pedido e selecione **Corrigir pedido**.
2. Altere **Prioridade**, **Clínico** ou **Nota**.
3. Escreva a razão em **Motivo**, por exemplo `Nome do clínico mal escrito`.
4. Abra o menu de pontos do painel e selecione **Guardar correção**.

**Resultado esperado:** uma mensagem diz, por exemplo, `Pedido CS-0001 corrigido.` O painel mostra os valores novos.

Cada correção fica guardada com o seu nome e o motivo, e é registada em **Auditoria**.

Um número de requisição, uma unidade sanitária ou uma lista de análises errados não podem ser corrigidos. Marque o registo como introduzido por erro e registe o pedido de novo. Para um pedido do **Formulário de pedido**, alguém que pode marcar registos como introduzidos por erro faz isto no separador **Registos** do formulário. Leia [Formulários](/docs/forms).

## Limites

- Devolver um pedido ao seu local, rejeitar uma amostra, as listas de trabalho e a revisão de resultados chegam em versões posteriores.
- Um pedido registado na receção não pode ser marcado como introduzido por erro nesta versão. Confira o número, a unidade sanitária e as análises antes de o registar.
- Cada análise de um pedido novo é o seu próprio pedido de análise. Um pedido guardado antes desta versão mantém todas as análises num só pedido de análise, e a receção lista-as todas.
- Um utilizador com um limite de dados perde **Receive samples** e **Return and reject**, por isso a receção não aparece no seu menu.

## Resolução de problemas

- **Receção não aparece no menu principal.** A sua conta não tem **Receive samples**, ou tem um limite de dados. Peça a um administrador. Leia [Utilizadores](/docs/users).
- **Uma pesquisa não encontra o pedido esperado.** Confira o número na requisição. Um pedido criado por outro sistema aparece quando os dados desse sistema chegam ao OpenLDR. Se um pedido que sabe estar guardado continuar a não aparecer, um administrador pode reconstruir a pesquisa com `openldr lab requisitions rebuild --force`.
- **A pesquisa não encontra nenhum paciente.** Confira o identificador, ou escreva o nome completo com a data de nascimento. Se o paciente continuar sem aparecer, registe-o.
- **Guardar correção diz `Nada foi alterado.`** Altere primeiro pelo menos um de **Prioridade**, **Clínico** ou **Nota**.

## Guias relacionados

- [Configuração do laboratório](/docs/lab-setup)
- [Formulários](/docs/forms)
- [Funções](/docs/roles)
- [Utilizadores](/docs/users)

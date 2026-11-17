# Map to FHIR

Map to FHIR é um nó de workflow que transforma as linhas próprias de um laboratório em registos FHIR que o OpenLDR pode guardar. Também deixa passar o FHIR, transforma as respostas a um formulário aceite em registos, e retém com um motivo o que não consegue mapear. Os responsáveis de laboratório configuram-no uma vez para cada ficheiro do laboratório.

## Adicionar Map to FHIR a um workflow

Na biblioteca de nós, o nó chama-se **Map to FHIR**. As definições do nó e o painel de mapeamento têm o título **Mapear para FHIR**. Coloque o nó depois do passo que fornece as linhas, como um acionador **Webhook** ou **Extract from File**.

1. Abra o workflow.
2. Na biblioteca de nós, pesquise `Map to FHIR`.
3. Arraste **Map to FHIR** para junto do passo que fornece as linhas.
4. Arraste o ponto à direita desse passo até ao ponto à esquerda de **Map to FHIR**.
5. Selecione **Map to FHIR** e depois a roda dentada **Configure** acima dele.
6. Preencha **Caminho de origem**. Depois de um webhook, escreva `body`. Depois de **Extract from File**, deixe em branco.
7. Escolha o **Destino**. **Lab result** é o destino que o OpenLDR fornece.
8. Em **Formulários aceites**, adicione um formulário apenas se os emissores enviarem respostas a esse formulário.

**Resultado esperado:** o nó mostra duas saídas, **saída** e **retidos**.

## Obter uma amostra

O painel mapeia as colunas de uma amostra real. Obtenha uma antes de escolher as colunas.

1. Guarde o workflow.
2. Nas definições do nó, abra o menu de pontos **Ações do nó** e selecione **Abrir o mapeamento**.
3. Abra o menu de pontos **Ações do mapeamento**, no canto superior direito do painel.
4. Selecione **Escutar**.
5. No minuto seguinte, envie uma mensagem para o workflow a partir do sistema do laboratório.

**Resultado esperado:** a linha por baixo de **Destino** conta as linhas da amostra.

Para usar uma execução que já chegou, selecione **Usar a última execução guardada** em vez dos passos 4 e 5. Quando o editor tem uma execução própria, o painel carrega-a como amostra ao abrir. **Usar a última execução deste editor** volta a carregá-la.

**Escutar** para na primeira execução nova que dê linhas a este nó, ou ao fim de um minuto. Para enviar uma mensagem, envie-a para o endereço do webhook do workflow, como mostra o guia Workflows. Para enviar um ficheiro, envie-o com o cabeçalho `Content-Type: application/octet-stream` para um workflow que comece por um **Webhook** e **Extract from File**. Nesse caso, defina o formato de Extract from File como `csv`. Num workflow com webhook, uma execução iniciada no editor não tem corpo, por isso não dá linhas.

O painel guarda as primeiras 20 linhas da amostra. Essas linhas nem sempre têm as mesmas colunas. A lista **Forma da amostra** mostra então cada grupo de linhas com o seu número de campos e de linhas. Escolha o grupo a mapear.

## Escolher uma coluna para cada campo

Cada linha do painel é um campo do destino. Uma estrela marca um campo obrigatório. **Lab result** exige três: **Número do paciente**, **Data de colheita** e **Análise**.

1. Na linha de um campo, abra a lista em **Dos seus dados** e escolha a coluna que o preenche.
2. Escolha antes **Valor fixo** quando todas as linhas têm o mesmo valor, e escreva-o.
3. Deixe **Não mapeado** num campo que o seu ficheiro não tem.
4. Num campo que se repete, selecione **Adicionar outra coluna** para juntar uma segunda coluna.
5. Quando uma linha cinzenta **Sugestão** indicar uma coluna, selecione **Aceitar** para a usar.

**Resultado esperado:** o painel conta os campos obrigatórios mapeados e mostra um exemplo da amostra ao lado de cada coluna escolhida.

Uma sugestão só aparece num campo sem coluna. O campo fica sem coluna até selecionar **Aceitar**.

Mapeie **Sistema do número do paciente** da mesma forma em todos os ficheiros, por exemplo como **Valor fixo** com o mesmo texto de cada vez. Sem ele, o identificador do registo Patient vem apenas do número do paciente, e a deteção de duplicados não consegue comparar estes pacientes pelo número.

## Adicionar uma regra a um campo

Use uma regra quando a célula não tem o valor na forma que o FHIR exige.

1. Na linha do campo, abra a lista em **Regra**.
2. Escolha o tipo de regra.
3. Preencha as definições que aparecem por baixo da linha.
4. Quando aparecer uma linha cinzenta **Regra sugerida**, selecione **Aceitar** para a usar.

**Resultado esperado:** as definições da regra aparecem por baixo da linha do campo.

Estes são os tipos de regra.

- **Data** lê uma data no **Formato** que escrever, por exemplo `dd/MM/yyyy`.
- **Valores** traduz cada valor do seu ficheiro num código, uma linha por valor.
- **Lista de códigos** procura o valor numa lista de códigos. **A lista de códigos do próprio laboratório** contém os mapeamentos adicionados no separador **Mappings** de um termo, em Terminology. As outras listas são os recursos ConceptMap guardados no OpenLDR.
- **Dividir** mantém uma parte da célula.
- **Retirar espaços** tira os espaços do início e do fim.
- **Número** lê um número com o **Separador decimal** que escolher.

O painel sugere uma regra a partir da forma dos valores de exemplo, por exemplo uma vírgula decimal ou um formato de data. Confirme uma data sugerida quando o dia e o mês podem ambos ser 12 ou menos.

## Adicionar um campo que o destino não mostra

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Adicionar um caminho FHIR**.
3. Escolha o **Registo**, por exemplo Patient ou Observation.
4. Escolha o **Caminho FHIR**.
5. Escolha a coluna da nova linha.

**Resultado esperado:** aparece no painel uma nova linha com o caminho FHIR como nome.

## Testar o mapeamento

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Testar**.
3. Leia os resultados no bloco ao fundo do painel, uma linha por cada linha da amostra: **Linha 1**, **Linha 2** e assim por diante.
4. Uma linha que termina em **passa** dá registos que cumprem as verificações do OpenLDR. Nas outras, leia o motivo. Indica o campo sempre que consegue.
5. Corrija a coluna ou a regra desse campo e selecione de novo **Testar**.

**Resultado esperado:** todas as linhas da amostra passam, ou sabe porque é que uma linha não passa.

O teste envia as linhas da amostra do grupo que está no ecrã, no máximo 20. Os motivos estão em inglês.

## Guardar o mapeamento

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Guardar**.
3. Feche o painel.
4. Selecione **Save** na barra de ferramentas do workflow.
5. No **Ingest**, leia o aviso e selecione **Save anyway**.

**Resultado esperado:** **Mapeamentos guardados**, nas definições do nó, conta o novo mapeamento.

O painel recusa guardar enquanto um campo obrigatório não tiver coluna nem valor fixo, ou enquanto uma regra não estiver concluída. Guardar substitui um mapeamento guardado do mesmo nó cujas colunas estão todas no novo. O painel avisa antes de guardar.

## Ligar a saída dos retidos

Numa instalação nova, o workflow fornecido **Ingest** usa Map to FHIR. **saída** segue para **Persist store**, e nada está ligado a **retidos**, de propósito. Por isso o Ingest recusa uma mensagem inteira quando alguma parte dela não pode ser guardada. A execução falha, o emissor recebe um erro, e nada dessa mensagem é guardado. Uma instalação feita antes desta versão mantém o grafo Ingest antigo. **Reset to default** aplica o novo e elimina qualquer alteração feita ao antigo.

Ligue **retidos** no seu próprio workflow, quando as linhas boas devem ser guardadas e as más postas de parte. No **Ingest**, deixe esta saída sem ligação.

1. Pesquise `Log` na biblioteca de nós.
2. Arraste **Log** para junto de **Map to FHIR**.
3. Arraste o ponto **retidos** de **Map to FHIR** até ao ponto à esquerda do nó Log.
4. Nas definições do nó Log, defina **Message** como `Held: {{ $json.reason }}`.
5. Guarde o workflow.

**Resultado esperado:** em **History**, o nó Log mostra o motivo da primeira linha retida da execução.

Em **History**, o resultado do nó Map to FHIR lista até 20 motivos. Registe apenas o motivo, porque um item retido também contém a linha tal como chegou.

## Limites

- Uma linha corresponde a um mapeamento guardado quando todas as suas colunas são conhecidas do mapeamento. **Extract from File** deixa de fora as células vazias, que por isso não contam. Num envio JSON, uma chave conta mesmo quando o valor está vazio. Quando dois mapeamentos guardados do mesmo nó servem para uma linha, o nó retém-na. Use um nó Map to FHIR por cada ficheiro do laboratório.
- Uma linha sem número do paciente fica retida.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Cada identificador de registo vem dos identificadores da própria linha. O do paciente usa o número do paciente e o seu sistema. O da amostra junta o número da amostra ou, na falta dele, a data de colheita. O do pedido junta o código de análise quando mapeado, e o do resultado junta a análise.
- Se um ficheiro mapear **Sistema do número do paciente** e outro não, o mesmo paciente fica com dois registos Patient.
- A deteção de pacientes duplicados só compara números de paciente quando **Sistema do número do paciente** está mapeado. Só compara nomes e datas de nascimento quando o paciente tem apelido, nome próprio e data de nascimento. Um paciente sem uma coisa nem outra é guardado, mas nunca aparece como duplicado.
- Sem nada ligado a **retidos**, uma única linha retida faz falhar o nó e a execução. Os passos seguintes não correm.
- Dentro de um ciclo, o ciclo só passa adiante o que os últimos nós do seu corpo dão. Ligue **saída** e **retidos** cada um a um nó dentro do corpo do ciclo.
- O OpenLDR nunca grava valores da amostra no workflow. O painel esquece a amostra quando o fecha.
- A regra **Data** lê apenas uma data. Uma célula com uma hora depois da data não corresponde ao formato, e a linha fica retida.
- **Extract from File** lê a célula CSV `12,5` como o número 125. A regra **Número** mantém então 125. Envie antes estes dados em JSON para um webhook. Aí `"12,5"` continua a ser texto, e a regra **Número** com vírgula lê 12,5.
- **Extract from File** também lê algumas datas CSV como números, por exemplo `01/12/2024` e `2025-04-23`. A regra **Data** retém então a linha.
- Este nó não lê mensagens HL7 v2.

## Resolução de problemas

- **no mapping for this shape.** A linha tem uma coluna que nenhum mapeamento guardado do nó conhece. Obtenha uma amostra com essa linha e guarde um mapeamento para ela.
- **more than one saved mapping fits this row.** Dois mapeamentos guardados conhecem todas as suas colunas. Mantenha um mapeamento por ficheiro, ou use um nó por ficheiro.
- **A execução falha com "held port is not connected".** No **Ingest**, é assim que uma mensagem que não pode ser guardada é recusada. O erro indica os primeiros motivos. Corrija os dados ou o mapeamento e envie de novo. No seu próprio workflow, ligue **retidos** a um nó Log para guardar as linhas boas e pôr as más de parte.
- **nothing at body.** O item não tem nada em `body`. Depois de **Extract from File**, deixe **Caminho de origem** em branco. Depois de um webhook, confirme que o emissor envia um corpo.
- **not a row.** A lista no caminho de origem contém algo que não é uma linha, como um número ou um texto. Cada elemento da lista tem de ser um objeto com colunas.
- **Escutar não encontra nada.** Guarde primeiro o workflow. Depois selecione **Escutar** e envie a mensagem dentro de um minuto.

## Guias relacionados

- [Workflows](/docs/workflows)
- [Formulários](/docs/forms)
- [Terminologia](/docs/terminology)

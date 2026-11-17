# Map to FHIR

Map to FHIR é um nó de workflow. Transforma as linhas próprias de um laboratório em registos FHIR que o OpenLDR pode guardar. Também deixa passar o FHIR tal como chega, e transforma as respostas a um formulário aceite em registos. O que não consegue mapear segue para a saída **retidos**, com um motivo. Os responsáveis de laboratório configuram-no uma vez para cada ficheiro do laboratório.

Numa instalação nova, o workflow fornecido **Ingest** usa este nó. O webhook envia para **Map to FHIR**, e **saída** segue para **Persist store**. **retidos** segue para um nó Log chamado **Held: not mapped**. Uma instalação feita antes desta versão mantém o grafo Ingest antigo. **Reset to default** aplica o novo e elimina qualquer alteração feita ao antigo.

## Adicionar Map to FHIR a um workflow

Coloque o nó depois do passo que fornece as linhas, como um acionador **Webhook** ou **Extract from File**.

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

A folha mapeia as colunas de uma amostra real. Obtenha uma antes de escolher as colunas.

1. Guarde o workflow.
2. Nas definições do nó, abra o menu de pontos **Ações do nó** e selecione **Abrir o mapeamento**.
3. Abra o menu de pontos **Ações do mapeamento**, no canto superior direito da folha.
4. Selecione **Escutar** e envie uma mensagem ou um ficheiro para o workflow a partir do sistema do laboratório.
5. Em alternativa, selecione **Usar a última execução guardada** para ler uma execução que já chegou.

**Resultado esperado:** a linha por baixo de **Destino** conta as linhas da amostra.

**Escutar** para na primeira execução nova que dê linhas a este nó, ou ao fim de um minuto. **Usar a última execução deste editor** lê a última execução iniciada no editor. Num workflow com webhook, uma execução iniciada no editor não tem corpo. Nesse caso use **Escutar** ou **Usar a última execução guardada**.

## Escolher uma coluna para cada campo

Cada linha da folha é um campo do destino. Uma estrela marca um campo obrigatório. **Lab result** exige três: **Número do paciente**, **Data de colheita** e **Análise**.

1. Na linha de um campo, abra a lista em **Dos seus dados** e escolha a coluna que o preenche.
2. Escolha antes **Valor fixo** quando todas as linhas têm o mesmo valor, e escreva-o.
3. Deixe **Não mapeado** num campo que o seu ficheiro não tem.
4. Num campo que se repete, selecione **Adicionar outra coluna** para juntar uma segunda coluna.
5. Quando uma linha cinzenta **Sugestão** indicar uma coluna, selecione **Aceitar** para a usar.

**Resultado esperado:** a folha conta os campos obrigatórios mapeados e mostra um exemplo da amostra ao lado de cada coluna escolhida.

Uma sugestão só conta depois de selecionar **Aceitar**. Até lá, o campo mantém a coluna que escolheu, ou nenhuma.

## Adicionar uma regra a um campo

Use uma regra quando a célula não tem o valor na forma que o FHIR exige.

1. Na linha do campo, abra a lista em **Regra**.
2. Escolha **Data** e escreva o **Formato**, por exemplo `dd/MM/yyyy`.
3. Ou escolha **Valores** para traduzir cada valor do seu ficheiro num código, uma linha por valor.
4. Ou escolha **Lista de códigos** para procurar o valor numa lista de códigos de Terminology.
5. Ou escolha **Dividir** para manter uma parte da célula, **Retirar espaços**, ou **Número** com o seu **Separador decimal**.
6. Quando aparecer uma linha cinzenta **Regra sugerida**, selecione **Aceitar** para a usar.

**Resultado esperado:** as definições da regra aparecem por baixo da linha do campo.

A folha sugere uma regra a partir da forma dos valores de exemplo, como uma vírgula decimal ou um formato de data. Confirme uma data sugerida quando o dia e o mês podem ambos ser 12 ou menos.

## Adicionar um campo que o destino não mostra

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Adicionar um caminho FHIR**.
3. Escolha o **Registo**, por exemplo Patient ou Observation.
4. Escolha o **Caminho FHIR**.
5. Escolha a coluna da nova linha.

**Resultado esperado:** aparece na folha uma nova linha com o caminho FHIR como nome.

## Testar o mapeamento

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Testar**.
3. Leia o resultado por baixo de cada linha. Uma linha que passa dá registos que cumprem as verificações do OpenLDR.
4. Numa linha que não passa, leia o motivo. Indica o campo sempre que consegue.
5. Corrija a coluna ou a regra desse campo e selecione de novo **Testar**.

**Resultado esperado:** todas as linhas da amostra passam, ou sabe porque é que uma linha não passa.

O teste envia no máximo 20 linhas da amostra. Os motivos estão em inglês.

## Guardar o mapeamento

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Guardar**.
3. Feche a folha.
4. Selecione **Save** na barra de ferramentas do workflow.
5. No **Ingest**, leia o aviso e selecione **Save anyway**.

**Resultado esperado:** **Mapeamentos guardados**, nas definições do nó, conta o novo mapeamento.

A folha recusa guardar enquanto um campo obrigatório não tiver coluna nem valor fixo, ou enquanto uma regra não estiver concluída. Um mapeamento que cobre mais colunas substitui um mapeamento guardado do mesmo nó que cobre menos. A folha avisa antes de guardar.

## Ligar a saída dos retidos

1. Pesquise `Log` na biblioteca de nós.
2. Arraste **Log** para junto de **Map to FHIR**.
3. Arraste o ponto **retidos** de **Map to FHIR** até ao ponto à esquerda do nó Log.
4. Nas definições do nó Log, defina **Message** como `Held: {{ $json.reason }}`.
5. Guarde o workflow.

**Resultado esperado:** em **History**, uma linha retida mostra o motivo nesse nó Log.

Registe apenas o motivo. Um item retido também contém a linha tal como chegou.

## Limites

- Uma linha corresponde a um mapeamento guardado quando todas as suas colunas são conhecidas do mapeamento. As células vazias não contam. Quando dois mapeamentos guardados do mesmo nó servem a uma linha, o nó retém-na. Use um nó Map to FHIR por cada ficheiro do laboratório.
- Uma linha sem número do paciente fica retida.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Os identificadores dos registos vêm do número do paciente, do número da amostra ou, na falta dele, da data de colheita, e da análise.
- Se um ficheiro mapear **Sistema do número do paciente** e outro não, o mesmo paciente fica com dois registos Patient.
- Um paciente sem nome ou sem data de nascimento é guardado. A deteção de pacientes duplicados só o encontra então por um identificador partilhado, não pelo nome e data de nascimento.
- Sem nada ligado a **retidos**, uma única linha retida faz falhar o nó e a execução. Os passos seguintes não correm.
- Dentro de um ciclo, o ciclo só passa adiante o que os últimos nós do seu corpo dão. Ligue **saída** e **retidos** cada um a um nó dentro do corpo do ciclo.
- A folha só guarda a amostra enquanto está aberta. O OpenLDR nunca grava valores da amostra no workflow. Obtenha uma nova amostra sempre que abrir a folha.
- A regra **Data** lê apenas uma data. Uma célula com uma hora depois da data não corresponde ao formato, e a linha fica retida.
- **Extract from File** lê uma célula CSV como `12,5` como o número 125. A regra **Número** mantém então 125. Envie antes estes dados em JSON para um webhook. Aí `"12,5"` continua a ser texto, e a regra **Número** com vírgula lê 12,5.
- **Extract from File** também lê algumas datas CSV, como `01/12/2024`, como números. A regra **Data** retém então a linha.
- Este nó não lê mensagens HL7 v2.

## Resolução de problemas

- **no mapping for this shape.** A linha tem uma coluna que nenhum mapeamento guardado do nó conhece. Obtenha uma amostra com essa linha e guarde um mapeamento para ela.
- **more than one saved mapping fits this row.** Dois mapeamentos guardados conhecem todas as suas colunas. Mantenha um mapeamento por ficheiro, ou use um nó por ficheiro.
- **A execução falha com "held port is not connected".** Ligue **retidos** a um nó Log.
- **nothing at body.** O caminho de origem não aponta para as linhas. Depois de um webhook, defina **Caminho de origem** como `body`.
- **Escutar não encontra nada.** Guarde primeiro o workflow. Depois selecione **Escutar** e envie a mensagem dentro de um minuto.

## Guias relacionados

- [Workflows](/docs/workflows)
- [Formulários](/docs/forms)
- [Terminologia](/docs/terminology)

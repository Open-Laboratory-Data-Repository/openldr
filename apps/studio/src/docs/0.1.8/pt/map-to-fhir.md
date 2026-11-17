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

**Escutar** para na primeira execução nova que dê linhas a este nó, ou ao fim de um minuto. Para enviar uma mensagem, envie-a para o endereço do webhook do workflow, como mostra o guia Workflows. Para enviar um ficheiro, envie-o com o cabeçalho `Content-Type: application/octet-stream` para um workflow que comece por um **Webhook** e **Extract from File**. Nesse caso, defina o formato de Extract from File como `csv` e ative **Read every cell as text**. Num workflow com webhook, uma execução iniciada no editor não tem corpo, por isso não dá linhas.

O painel guarda as primeiras 20 linhas da amostra. Lista todas as colunas encontradas nas linhas da amostra, mesmo uma coluna preenchida só depois da 20.ª linha. Essa coluna não tem exemplo.

Sem amostra, o painel mostra o mapeamento guardado do nó, o mais largo quando há vários. A lista **Mapeamento guardado** escolhe outro. Não aparece nenhum exemplo, e nenhuma coluna aparece marcada como fora da amostra, porque não há amostra. Pode alterar o mapeamento e guardá-lo. **Testar** precisa de uma amostra.

## Escolher uma coluna para cada campo

Cada linha mostra o campo de origem e o seu exemplo, seguidos do **Destino**. O destino apresenta um nome de laboratório e o caminho FHIR. Pode mapear pelo nome sem escrever um caminho FHIR.

Cada linha do painel é um campo do destino. Uma estrela marca um campo obrigatório. **Lab result** exige três: **Número do paciente**, **Data de colheita** e **Análise**.

1. Na linha de um campo, abra a lista em **Dos seus dados** e escolha a coluna que o preenche.
2. Escolha antes **Valor fixo** quando todas as linhas têm o mesmo valor, e escreva-o.
3. Deixe **Não mapeado** num campo que o seu ficheiro não tem.
4. Num campo que se repete, selecione **Adicionar outra coluna** e marque cada coluna a juntar. Escreva em **Filtrar colunas** para encurtar uma lista longa. **Selecionar todas as mostradas** marca cada coluna da lista.
5. Quando uma linha cinzenta **Sugestão** indicar uma coluna, selecione **Aceitar** para a usar.

**Resultado esperado:** o painel conta os campos obrigatórios mapeados e mostra um exemplo da amostra ao lado de cada coluna escolhida.

Uma sugestão só aparece num campo sem coluna. O campo fica sem coluna até selecionar **Aceitar**.

## Mapear um ficheiro com uma coluna por análise

Uma folha de laboratório ou uma exportação WHONET tem muitas vezes uma coluna por análise, por exemplo `AMP`, `CIP` e `GEN`. Cada célula tem o resultado dessa análise.

1. Em **Resultado (texto)**, ou no campo de resultado que serve aos seus valores, escolha a primeira coluna de análise em **Dos seus dados**.
2. Selecione **Adicionar outra coluna** e marque as outras colunas de análise.
3. Confira a análise ao lado de cada coluna. Começa com o nome da coluna. Escreva outra análise quando o nome não for o código que quer.
4. Deixe **Análise** como está. Mostra **Definido para cada coluna em Resultado (texto)**, com o nome do campo real.
5. Para transformar as análises em códigos padrão, junte uma regra **Lista de códigos** em **Análise**. Ela aplica-se à análise de cada coluna.

**Resultado esperado:** cada coluna aparece na sua própria linha, com a sua análise ao lado. Uma linha dá então um resultado por cada coluna de análise com valor, todos ligados ao paciente, à amostra e ao pedido da linha. Uma célula vazia não dá resultado.

Uma regra no campo de resultado aplica-se a todas as colunas. O painel recusa guardar enquanto uma análise estiver vazia, ou duas colunas tiverem a mesma análise. Só um campo de resultado tem as análises. Outro campo de resultado com várias colunas usa as análises das mesmas linhas, por isso precisa do mesmo número de colunas. Quando voltar a uma só coluna, **Análise** volta a ter a sua própria lista de colunas.

Mapeie **Sistema do número do paciente** da mesma forma em todos os ficheiros, por exemplo como **Valor fixo** com o mesmo texto de cada vez. Sem ele, o identificador do registo Patient vem apenas do número do paciente, e a deteção de duplicados não consegue comparar estes pacientes pelo número.

## Adicionar uma regra a um campo

Use uma regra quando a célula não tem o valor na forma que o FHIR exige.

1. Na linha do campo, abra a lista em **Regra**.
2. Escolha o tipo de regra.
3. Preencha as definições que aparecem por baixo da linha.
4. Quando aparecer uma linha cinzenta **Regra sugerida**, selecione **Aceitar** para a usar.

**Resultado esperado:** as definições da regra aparecem por baixo da linha do campo.

Estes são os tipos de regra.

- **Data** lê uma data no **Formato** que escrever, por exemplo `dd/MM/yyyy`. Para uma coluna de data de um ficheiro Excel, ponha **A data é** em **Uma célula de data do Excel**. O Excel guarda uma data como um número de dia, e esta regra lê-o.
- **Valores** traduz cada valor do seu ficheiro num código, uma linha por valor.
- **Lista de códigos** procura o valor numa lista de códigos. **A lista de códigos do próprio laboratório** contém os mapeamentos adicionados no separador **Mappings** de um termo, em Terminologia. Tem códigos de vários sistemas, por isso escolha também o seu **Sistema de origem**. O painel recusa guardar sem ele. As outras listas são os recursos ConceptMap guardados no OpenLDR.
- **Dividir** mantém uma parte da célula.
- **Retirar espaços** tira os espaços do início e do fim.
- **Número** lê um número com o **Separador decimal** que escolher. Em **Resultado (número)**, um `<`, `<=`, `>=` ou `>` no início fica como comparador, por isso `>100000` é guardado como mais de 100000. Funciona com ou sem a regra.

O painel sugere uma regra a partir da forma dos valores de exemplo, por exemplo uma vírgula decimal ou um formato de data. Confirme uma data sugerida quando o dia e o mês podem ambos ser 12 ou menos.

Quando os valores de um campo codificado não são os seus códigos, o painel sugere **Valores**. **Aceitar** abre a regra com uma linha por cada valor distinto da amostra, no máximo 20. Quando um valor é um código, ou o nome de um código, sem contar maiúsculas, esse código já vem escolhido no lado **Para**. Indique o que querem dizer os outros valores. Uma linha só é guardada quando o seu lado **Para** está preenchido. Um campo com a lista própria do FHIR, como **Sexo**, escolhe dessa lista. Quando cada exemplo de uma coluna de data é um número de dia, o painel sugere a célula de data do Excel.

Um texto simples num campo codificado, como **Análise**, é guardado como o código do próprio laboratório, sem sistema. Uma regra **Lista de códigos** guarda antes um código padrão. Um código escolhido no lado **Para** de uma regra **Valores** é guardado com o seu sistema.

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
4. Uma linha que termina em **passa** dá registos que cumprem as verificações do OpenLDR. Nas outras, leia o motivo. Indica o campo sempre que consegue. Quando um valor não é um dos que um campo codificado aceita, e o campo não tem regra **Valores** nem **Lista de códigos**, a linha pede para adicionar uma regra Valores.
5. Corrija a coluna ou a regra desse campo e selecione de novo **Testar**.

**Resultado esperado:** todas as linhas da amostra passam, ou sabe porque é que uma linha não passa.

O teste envia as linhas da amostra, no máximo 20. Os motivos estão em inglês. O teste verifica cada linha sozinha. Duas linhas que dão o mesmo resultado com outros valores passam ambas no teste, enquanto uma execução retém a segunda.

## Ver os registos gerados

1. Abra **Ações do mapeamento** e selecione **Testar**.
2. Encontre uma linha que passa nos resultados ao fundo do painel.
3. Abra o menu de pontos **Ações da linha** dessa linha.
4. Selecione **Ver FHIR gerado**.
5. Confira os valores e as referências em **FHIR gerado**.
6. Abra **Ações dos registos gerados** e selecione **Copiar JSON**.

**Resultado esperado:** o painel mostra apenas os registos gerados para essa linha da amostra. O teste não guarda esses registos.

Alterar uma origem, regra, destino ou amostra limpa os resultados do teste anterior. Selecione **Testar** novamente para ver o novo mapeamento.

## Guardar o mapeamento

1. Abra o menu de pontos **Ações do mapeamento**.
2. Selecione **Guardar**.
3. Feche o painel.
4. Selecione **Save** na barra de ferramentas do workflow.
5. No **Ingest**, leia o aviso e selecione **Save anyway**.

**Resultado esperado:** **Mapeamentos guardados**, nas definições do nó, conta o novo mapeamento.

O painel recusa guardar enquanto um campo obrigatório não tiver coluna nem valor fixo, enquanto uma regra não estiver concluída, ou enquanto a análise de uma coluna estiver vazia ou repetida. Guardar substitui um mapeamento guardado do mesmo nó cujas colunas estão todas no novo. Quando esse mapeamento tem menos colunas do que o novo, o painel avisa antes de guardar.

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
- Uma unidade só é guardada com um número. Quando uma linha tem unidade mas não tem número, por exemplo um resultado em texto, o resultado é guardado sem a unidade, e a execução regista-o.
- Um número inteiro enviado sem aspas e demasiado longo para ser guardado exatamente, acima de 9 007 199 254 740 991, como um número de amostra com 19 dígitos, mantém todos os dígitos. O webhook lê-o como texto, e a saída do gatilho no **History** nomeia o campo em `notes`. Mapeie-o para um campo de texto como **Número da amostra**. **Resultado (número)** recusa-o e retém a linha, porque um número não consegue guardar tantos dígitos exatamente. Peça ao laboratório que envie esses identificadores entre aspas.
- Uma análise com resultado vazio, nulo ou em falta não dá registo de resultado. O pedido mantém a análise, e a execução regista-o. Um zero é um resultado e é mantido.
- Um registo de resultado tem um só valor. Uma linha que preenche **Resultado (número)** e **Resultado (texto)** para a mesma análise fica retida com o motivo de ter mais de um valor de resultado.
- Uma linha de JSON aninhado é lida achatada. `{ "patient": { "number": "P-1" } }` dá a coluna `patient.number`. Uma lista de objetos dá uma coluna lista por chave: `results: [{ code, value }, …]` dá `results.code` e `results.value`, e mapear **Análise** e **Resultado (número)** para elas dá um resultado por entrada. Só é lido um nível de lista. Uma lista dentro de uma entrada de lista, como os resultados de antibióticos de cada isolado de uma cultura, não é guardada. **Test** mostra uma nota por baixo da linha, e o resultado do nó em **History** lista-a em `notes`. Para manter esses dados, envie-os como FHIR. Duas colunas que acabam com o mesmo nome, como uma chave `patient.number` ao lado de um objeto `patient`, retêm a linha.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Cada identificador de registo vem dos identificadores da própria linha. O do paciente usa o número do paciente e o seu sistema. O da amostra junta o número da amostra ou, na falta dele, a data de colheita. O do pedido junta o código de análise quando mapeado. O do resultado junta a análise e, quando mapeada, a data do resultado. Quando o campo **Análises pedidas** do pedido não está mapeado, o pedido recebe os códigos de análise de todos os seus resultados da execução, cada um uma vez, e o seu identificador não muda. Uma execução seguinte substitui-os pelos seus próprios códigos.
- Numa mesma execução, as linhas que dão o mesmo paciente, a mesma amostra ou o mesmo pedido fazem um só registo. Uma linha seguinte só preenche o que uma linha anterior deixou vazio.
- Um ficheiro com menos colunas enviado depois de um mais completo substitui o paciente guardado. Os campos que o ficheiro mais pobre não tem ficam vazios. **History** guarda a versão antiga.
- Um paciente já guardado com outro identificador e o mesmo número do paciente, por exemplo a partir de um formulário, fica com um segundo registo Patient. Nada procura um paciente pelo número antes de guardar.
- Numa mesma execução, uma segunda linha que dá o mesmo resultado com outros valores é retida, com o motivo `this row gives a result that an earlier row of this run already gave, with other values`.
- Se um ficheiro mapear **Sistema do número do paciente** e outro não, o mesmo paciente fica com dois registos Patient.
- A deteção de pacientes duplicados só compara números de paciente quando **Sistema do número do paciente** está mapeado. Só compara nomes e datas de nascimento quando o paciente tem apelido, nome próprio e data de nascimento. Um paciente sem nenhuma das duas é guardado, mas nunca aparece como duplicado.
- Sem nada ligado a **retidos**, uma única linha retida faz falhar o nó e a execução. Os passos seguintes não correm.
- Dentro de um ciclo, o ciclo só passa adiante o que os últimos nós do seu corpo dão. Ligue **saída** e **retidos** cada um a um nó dentro do corpo do ciclo.
- O OpenLDR nunca grava valores da amostra no workflow. O painel esquece a amostra quando o fecha.
- A regra **Data** lê apenas uma data. Uma célula com uma hora depois da data não corresponde ao formato, e a linha fica retida.
- Ative **Read every cell as text** em **Extract from File** antes de um nó Map to FHIR. Cada célula CSV chega então como o texto do ficheiro: `12,5`, `007` e `03/11/2026` chegam como foram escritos. Leia-os com as regras **Número** e **Data**. Um nó adicionado a partir da biblioteca de nós tem a opção ativa. Um nó guardado antes desta versão tem-na desativada. Sem ela, `12,5` chega como o número 125, `007` como 7, e uma data como `01/12/2024` como um número de dia, que a regra **Data** retém. As definições de Map to FHIR avisam quando o nó anterior tem a opção desativada.
- Num ficheiro Excel, uma célula de data chega como um número de dia. Use a regra **Data** com **Uma célula de data do Excel**. Ela só lê o sistema de datas 1900 habitual do Excel. Um livro guardado no sistema de datas 1904, num Mac antigo, dá datas quatro anos e um dia mais cedo.
- **A lista de códigos do próprio laboratório** precisa de um **Sistema de origem**. Sem ele, nenhum código corresponde. Quando um código dá dois destinos, a linha é retida com `more than one match in the code list`.
- Este nó não lê mensagens HL7 v2.

## Resolução de problemas

- **no mapping for this shape.** A linha tem uma coluna que nenhum mapeamento guardado do nó conhece. Obtenha uma amostra com essa linha e guarde um mapeamento para ela.
- **more than one saved mapping fits this row.** Dois mapeamentos guardados conhecem todas as suas colunas. Mantenha um mapeamento por ficheiro, ou use um nó por ficheiro.
- **A execução falha com "held port is not connected".** No **Ingest**, é assim que uma mensagem que não pode ser guardada é recusada. O erro indica os primeiros motivos. Corrija os dados ou o mapeamento e envie de novo. No seu próprio workflow, ligue **retidos** a um nó Log para guardar as linhas boas e pôr as más de parte.
- **nothing at body.** O item não tem nada em `body`, ou só uma lista vazia ou um valor único. Depois de **Extract from File**, deixe **Caminho de origem** em branco. Depois de um webhook, confirme que o emissor envia um corpo.
- **not a row.** A lista no caminho de origem contém algo que não é uma linha, como um número ou um texto. Cada elemento da lista tem de ser um objeto com colunas.
- **Escutar não encontra nada.** Guarde primeiro o workflow. Depois selecione **Escutar** e envie a mensagem dentro de um minuto.

## Guias relacionados

- [Workflows](/docs/workflows)
- [Formulários](/docs/forms)
- [Terminologia](/docs/terminology)

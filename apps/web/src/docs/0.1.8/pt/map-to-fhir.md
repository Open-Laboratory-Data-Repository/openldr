# Mapear dados do laboratório para FHIR

<!-- operator-platform -->

Map to FHIR é um nó de workflow. Lê o que um laboratório envia e produz registos FHIR que o OpenLDR guarda. Reconhece três tipos de entrada:

- FHIR, como Bundle, lista de recursos ou um único recurso. O nó passa-o adiante como recursos.
- Respostas a um formulário que o nó aceita. O nó verifica-as pelo formulário e transforma-as em registos.
- As linhas próprias de um laboratório, como as de uma exportação CSV ou de uma lista JSON. O nó só as transforma em registos quando alguém guardou no nó um mapeamento para as suas colunas.

Cada conjunto de registos passa pelas verificações do OpenLDR ao nível de validação configurado. O que o nó não consegue mapear, ou o que falha uma verificação, segue para a saída **retidos** com um motivo. Nada de uma linha retida é guardado.

## Quando usar

Use-o quando um sistema de laboratório envia a sua própria exportação e não consegue enviar FHIR. Uma pessoa mapeia as colunas uma vez, no studio, sobre uma amostra real. Depois disso, cada ficheiro novo com essas colunas é mapeado sem ajuda.

Numa instalação nova, o workflow fornecido **Ingest** já o usa. O webhook, `/api/workflows/hooks/ingest`, envia cada pedido para Map to FHIR. **saída** segue para **Persist store**, e **retidos** segue para um nó Log chamado **Held: not mapped**. Uma instalação feita antes desta versão mantém o grafo Ingest antigo. **Reset to default** no workflow Ingest aplica o novo e elimina qualquer alteração feita ao antigo.

O guia da aplicação **Map to FHIR** mostra passo a passo como mapear um ficheiro.

Use um nó Map to FHIR por cada ficheiro do laboratório. Uma linha só é mapeada quando exatamente um mapeamento guardado do nó conhece todas as suas colunas. Quando dois mapeamentos guardados servem a uma linha, o nó retém-na.

## O que o emissor vê

O webhook responde pela execução inteira. Uma execução concluída responde `ok: true` com o seu `runId`, mesmo quando o nó reteve linhas. Consulte o nó Log dos retidos em **History** para as ver.

Se nada estiver ligado a **retidos**, uma única linha retida faz falhar o nó e a execução. O webhook responde então HTTP 500, e os passos seguintes não correm.

## Experimentar um mapeamento guardado na linha de comandos

`workflows map-test` aplica os mapeamentos guardados de um nó Map to FHIR a uma lista `.json` ou a um ficheiro `.csv`. Mostra contagens e os motivos das linhas retidas, nunca um valor de linha, e não guarda nada. Lê o workflow guardado, por isso guarde primeiro o workflow no studio. No workflow fornecido Ingest, o identificador do workflow é `wf-ingest` e o do nó é `map-1`.

```sh
{{operator:data-map-test}}
```

![Experimentar os mapeamentos guardados de um nó Map to FHIR num ficheiro.](guide:operator-data-map-test)

O comando termina com 0 quando todas as linhas passam e com 1 quando alguma linha fica retida. Acrescente `--json` para mostrar o resultado completo de cada linha. Uma execução sobre um CSV lê cada célula como texto e deixa de fora as células vazias. Por isso pode dar um resultado diferente do mesmo ficheiro lido por **Extract from File**.

## Limites

- Uma linha sem número do paciente fica retida.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Os identificadores dos registos vêm do número do paciente, do número da amostra ou, na falta dele, da data de colheita, e da análise.
- Se um ficheiro mapear o sistema do número do paciente e outro não, o mesmo paciente fica com dois registos Patient.
- **Extract from File** lê uma célula CSV como `12,5` como o número 125, e a regra **Número** mantém 125. Também lê algumas datas CSV, como `01/12/2024`, como números, e a regra **Data** retém então a linha. Envie antes estes dados em JSON para um webhook. Aí `"12,5"` continua a ser texto.
- A regra **Data** lê apenas uma data, sem hora.
- O nó não lê mensagens HL7 v2.
- Os motivos estão em inglês.

## Resolução de problemas

Estes são os motivos de retenção mais frequentes. O motivo de uma regra começa pelo nome da coluna, e o de uma verificação pelo registo em causa.

- **no mapping for this shape.** A linha tem uma coluna que nenhum mapeamento guardado do nó conhece. Mapeie uma amostra que tenha essa coluna.
- **more than one saved mapping fits this row.** Dois mapeamentos guardados do nó conhecem todas as suas colunas. Mantenha um mapeamento por ficheiro, ou use um nó por ficheiro.
- **Patient ID is required and has no value.** A célula do número do paciente está vazia. A etiqueta no motivo indica o campo.
- **expected a date in the format dd/MM/yyyy.** A célula não segue o formato da regra **Data**. O motivo indica o formato que definiu.
- **value is not in the translation list.** Uma regra **Valores** não tem linha para este valor. Acrescente uma.
- **value has no match in the code list.** A regra **Lista de códigos** não encontrou uma única correspondência para o valor.
- **not a FHIR Bundle this node can unwrap.** O corpo parece FHIR mas não pode ser dividido.
- **laboratory result must reference a ServiceRequest (basedOn).** Um resultado de laboratório FHIR chegou sem pedido. Envie o pedido no mesmo envio.
- **basedOn ServiceRequest not found in batch or store.** Um resultado de laboratório FHIR indica um pedido que não está na mesma execução nem guardado.
- **nothing at body.** O caminho de origem do nó não aponta para as linhas. Depois de um webhook, defina-o como `body`.
- **held port is not connected.** É uma falha da execução, não um motivo de retenção. Ligue **retidos** a um nó Log.

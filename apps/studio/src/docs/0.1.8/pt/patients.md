# Pacientes

**Pacientes** lista todos os pacientes que o OpenLDR recebeu com dados de laboratório, e onde foram testados. O sistema de origem, como um sistema hospitalar ou de laboratório, é o dono de cada paciente. O OpenLDR mostra os pacientes e nunca os altera.

Este guia leva cerca de 15 minutos. Usa os dados de exemplo da documentação, por isso carregue-os primeiro. Selecione uma imagem ou um clip para o ampliar.

![Pacientes com os dados de exemplo carregados: 25 pacientes.](patients-list.png)

## Quem pode fazer o quê

Os nomes das permissões aparecem em inglês.

| Permissão | O que permite |
| --- | --- |
| View patient index | Abrir **Pacientes**. Os nomes e identificadores aparecem mascarados, e a pesquisa só encontra um identificador exato. |
| View patient identifiers | Ver por inteiro nomes, identificadores, data de nascimento, telefone e e-mail, e pesquisar por parte do nome. Cada vista sem máscara fica auditada. |
| Manage patient index | Dar nome aos sistemas de identificadores, e escolher quais aparecem e são pesquisados. Marcar grupos de duplicados. |

### O que a máscara esconde

Sem **View patient identifiers**:

- Um nome mostra a primeira letra, como `J*** M***`.
- Um identificador mostra os últimos quatro caracteres.
- Vê o ano de nascimento, não a data, e nem telefone nem e-mail.
- A pesquisa só encontra um identificador exato. Uma pesquisa por parte do nome revelaria os nomes letra a letra.

Com ela, vê tudo, e a pesquisa também encontra parte do nome. Cada lista e cada paciente aberto ficam no registo de auditoria. O registo guarda quantos pacientes coincidiram, nunca o que pesquisou.

## Antes de começar

Os exemplos precisam dos dados de exemplo da documentação. Se **Total Orders** no painel de exemplo mostrar 0, carregue-os primeiro. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).

Com o exemplo carregado, a lista mostra 25 pacientes: os 24 pacientes de exemplo e um paciente que uma instalação nova cria sozinha, **Seed Sample**. As idades são calculadas a partir da data de hoje, por isso as suas podem diferir um ano das imagens.

## Exemplo 1: abrir um paciente

![Selecionar Chausiku Demo para abrir a ficha do paciente.](patients-sheet.mp4)

1. Abra **Pacientes**.
2. Selecione a linha **Chausiku Demo**, com 32 anos e 4 pedidos.

![A ficha do paciente: identidade, identificadores e pedidos.](patients-sheet-detail.png)

**Resultado esperado:** a ficha **Paciente**. **Identidade** mostra sexo M, data de nascimento 1994-05-14 e **Identificador de origem** SAMPLE-0004. **Identificadores** lista `urn:openldr:sample:patient` SAMPLE-0004. **Pedidos** lista quatro pedidos, o mais recente primeiro, com o painel, a unidade requisitante, o estado e o número de resultados. Um Full blood count está **revoked**, com 0 resultados.

Também pode abrir um paciente com **Ver** no menu da sua linha. Se um registo foi fundido noutro, o menu da ficha oferece **Abrir o paciente em que este registo foi fundido**.

Se a ficha disser que a lista está desatualizada, o servidor reiniciou. Recarregue a página.

## Exemplo 2: dar nome a um identificador e pesquisar por ele

Cada identificador chega com um **sistema**: um URI que diz que tipo de identificador é, como um número de identificação nacional ou um número TARV. Os pacientes de exemplo usam `urn:openldr:sample:patient`. Por predefinição nenhum sistema aparece na lista, por isso a coluna **Identificadores** está vazia.

![Dar o nome Sample ID ao sistema de exemplo, mostrá-lo na lista e pesquisar SAMPLE-0007.](patients-identifier-system.mp4)

1. Abra o separador **Sistemas de identificadores**. Lista cada sistema visto, com quantos pacientes o têm. O sistema de exemplo tem 24.
2. Abra o menu da linha `urn:openldr:sample:patient` e selecione **Editar**.
3. Em **Etiqueta**, escreva `Sample ID`.
4. Ative **Mostrar na lista**. Deixe **A pesquisa encontra-o** ativo.
5. Abra o menu de ações da ficha e selecione **Guardar**.
6. Volte ao separador **Pacientes**. Em **Pesquisar nome ou identificador**, escreva `SAMPLE-0007`.

**Resultado esperado:** um só paciente, **Hamisi Sample**, F, com `Sample ID: SAMPLE-0007` na coluna **Identificadores**.

![Pesquisa pelo identificador de exemplo: um resultado.](patients-search.png)

- Deixe **Etiqueta** vazia para usar o nome que o sistema de origem envia.
- **Mostrar na lista** junta o sistema à coluna **Identificadores**.
- **A pesquisa encontra-o** deixa a pesquisa encontrar pacientes por ele.
- Um laboratório que recebe estas etiquetas do central não as pode mudar.

Precisa de **Manage patient index** para editar um sistema.

## Encontrar um paciente

Escreva qualquer identificador, como um número MPI ou de identificação nacional, e o OpenLDR encontra o paciente, seja qual for o identificador. **Filtrar** e **Estado** mostram também os registos fundidos. **Colunas** escolhe o que a lista mostra.

## Duplicados

O separador **Duplicados** lista pacientes que parecem ser a mesma pessoa.

![O separador Duplicados com os dados de exemplo: Não há duplicados prováveis.](patients-duplicates.png)

Com os dados de exemplo mostra **Não há duplicados prováveis.** O OpenLDR encontra dois tipos:

- **Mesmo identificador.** Dois ou mais pacientes têm o mesmo valor no mesmo sistema de identificadores, como o mesmo NRC. Identificadores sem sistema, e sistemas em que **A pesquisa encontra-o** está desligado, não contam.
- **Mesmo nome e data de nascimento.** Apelido, nome próprio e data de nascimento coincidem, sem contar maiúsculas, espaços a mais ou acentos. Pacientes com sexos diferentes não são juntados. Um paciente sem data de nascimento nunca é juntado assim.

O exemplo tem dois pacientes chamados Amina Demo. Não formam um grupo de duplicados: as datas de nascimento e os sexos são diferentes.

Só os pacientes ativos são comparados. O OpenLDR não funde pacientes. Corrija os duplicados no sistema de origem, e a próxima atualização dele limpa o grupo aqui.

- Selecione um grupo para ver os seus pacientes. **Abrir paciente**, no menu de um paciente, abre o registo completo.
- A lista mostra no máximo 50 pacientes por grupo, e diz quantos mostra do total. Um grupo maior não pode ser marcado aqui. Corrija-o no sistema de origem, ou desligue **A pesquisa encontra-o** para esse sistema de identificadores. Um identificador provisório partilhado por muitos pacientes é a causa habitual.
- Com **Manage patient index**, **Marcar como não duplicados**, no menu do grupo, regista que são pessoas diferentes. Pode juntar um motivo. Use **Estado** para voltar a ver esses grupos, e **Mostrar de novo** para desfazer.
- Com **View patient identifiers**, **Exportar CSV**, no menu do separador, envia os grupos abertos à equipa do sistema de origem. Cada exportação fica auditada.

## Num telemóvel

A lista de pacientes e a ficha funcionam num telemóvel.

![Pacientes num telemóvel.](patients-phone.png)

## Depois de atualizar

Os pacientes recebidos antes desta versão não mostram identificadores até correr `openldr db reproject --force` uma vez. Isto também preenche o que o OpenLDR precisa para encontrar pacientes com o mesmo nome e data de nascimento.

## Na linha de comandos

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--limit <n>] [--offset <n>] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]` e `restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`

A saída fica mascarada a não ser com `--identifiers`. `patients list` e `patients show` com `--identifiers` ficam auditados. O mesmo para `duplicates list` com `--identifiers` e `duplicates export`, que nunca é mascarado. `duplicates dismiss` e `restore` também ficam auditados.

Por exemplo, a mesma etiqueta do exemplo 2:

```bash
./openldr patients identifier-systems set urn:openldr:sample:patient --label "Sample ID" --list-column on
```

## Resolução de problemas

- **Os nomes aparecem como `J*** M***`.** A sua função não tem **View patient identifiers**.
- **A pesquisa não encontra nada por parte do nome.** Sem **View patient identifiers**, a pesquisa só encontra um identificador exato.
- **A coluna Identificadores está vazia.** Nenhum sistema de identificadores tem **Mostrar na lista** ativo. Veja o [Exemplo 2](#exemplo-2-dar-nome-a-um-identificador-e-pesquisar-por-ele).
- **A pesquisa não encontra um paciente por um identificador.** Esse sistema tem **A pesquisa encontra-o** desligado.
- **Um paciente não tem identificadores depois de atualizar.** Corra `openldr db reproject --force` uma vez.
- **A ficha diz que a lista está desatualizada.** Recarregue a página.

## Guias relacionados

- [Unidades](/docs/facilities)
- [Catálogo de exames](/docs/test-catalog)
- [Exposição de dados](/docs/data-exposure)

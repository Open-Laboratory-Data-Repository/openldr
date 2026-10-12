# Pacientes

O índice de pacientes lista os pacientes que o CE recebeu com os dados do laboratório. O sistema de origem, por exemplo um HIMS, é o dono de cada paciente. O CE mostra os pacientes e nunca os edita.

Abra **Pacientes** na barra lateral. Precisa da permissão Ver índice de pacientes.

## O que vê

Sem a permissão Ver identificadores de pacientes, os nomes e os identificadores estão ocultos. Um nome mostra a primeira letra, por exemplo `J*** M***`. Um identificador mostra os últimos quatro caracteres. Vê o ano de nascimento, não a data, e não vê telefone nem e-mail. A pesquisa só encontra então um identificador exato, porque pesquisar parte de um nome revelaria os nomes letra a letra.

Com Ver identificadores de pacientes, vê tudo, e a pesquisa também encontra parte de um nome. Cada lista e cada paciente que abre fica registado no registo de auditoria. O registo guarda quantos pacientes corresponderam, nunca o que pesquisou.

## Encontrar um paciente

Escreva um identificador, por exemplo um número MPI ou um identificador nacional, e o CE encontra o paciente seja qual for o identificador. Use **Filtrar** e **Estado** para mostrar registos fundidos.

A coluna **Identificadores** mostra os sistemas escolhidos no separador **Sistemas de identificadores**.

## A ficha de um paciente

Clique numa linha, ou escolha **Ver** no menu ⋯. A ficha mostra os dados do paciente, cada identificador com a sua etiqueta e os pedidos de laboratório, do mais recente para o mais antigo. Se o registo foi fundido noutro, escolha **Abrir o paciente em que este registo foi fundido** no menu ⋯.

Se a ficha disser que a lista está desatualizada, o servidor reiniciou. Recarregue a página.

## Sistemas de identificadores

Cada identificador chega com um sistema, um URI que diz que tipo de identificador é. Este separador lista cada sistema que o CE viu, com quantos pacientes o têm.

Com a permissão Gerir índice de pacientes, escolha **Editar** no menu ⋯ de uma linha para dar uma etiqueta ao sistema, por exemplo NRC ou número TARV. Deixe a etiqueta vazia para usar o nome que o sistema de origem envia. **Mostrar na lista** acrescenta-o à coluna Identificadores. **A pesquisa encontra-o** permite encontrar pacientes por ele. Escolha **Guardar** no menu ⋯ da ficha.

Um laboratório que recebe estas etiquetas do central não as pode alterar.

## Depois de atualizar

Os pacientes recebidos antes desta versão não têm identificadores listados até executar `openldr db reproject --force` uma vez.

## Na linha de comandos

- `openldr patients list [--search <texto>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <sistema> [--label <texto>] [--list-column on|off] [--searchable on|off]`

A saída está oculta, a não ser que passe `--identifiers`, que fica registado na auditoria.

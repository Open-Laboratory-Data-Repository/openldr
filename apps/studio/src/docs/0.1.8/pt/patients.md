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

## Duplicados

O separador **Duplicados** lista pacientes que parecem ser a mesma pessoa. O CE encontra dois tipos:

- **Mesmo identificador.** Dois ou mais pacientes têm o mesmo valor no mesmo sistema de identificadores, por exemplo o mesmo NRC. Os identificadores sem sistema, e os sistemas em que **A pesquisa encontra-o** está desligado, não são usados.
- **Mesmo nome e data de nascimento.** O apelido, o nome próprio e a data de nascimento coincidem, sem contar maiúsculas, espaços a mais nem acentos. Pacientes de sexos diferentes não são juntados. Um paciente sem data de nascimento nunca é juntado desta forma.

Só os pacientes ativos são comparados. O CE não funde pacientes: corrija os duplicados no sistema de origem, e a atualização seguinte remove o grupo aqui.

Clique num grupo para ver os seus pacientes. Escolha **Abrir paciente** no menu ⋯ de um paciente para ver o registo completo.

Um grupo pode ser grande. A lista mostra no máximo 50 pacientes por grupo, e a ficha indica quantos mostra do total. Um grupo com mais pacientes do que isso não pode ser marcado aqui como não duplicados. Corrija-o no sistema de origem, ou desligue **A pesquisa encontra-o** para esse sistema de identificadores. A causa habitual é um identificador de substituição partilhado por muitos pacientes.

Com a permissão Gerir índice de pacientes, escolha **Marcar como não duplicados** no menu ⋯ do grupo quando os pacientes são pessoas diferentes. Pode acrescentar um motivo. Use **Estado** para voltar a ver esses grupos, e **Mostrar de novo** para anular.

Com a permissão Ver identificadores de pacientes, escolha **Exportar CSV** no menu ⋯ do separador para enviar os grupos abertos à equipa do sistema de origem. Cada exportação fica registada na auditoria.

## Depois de atualizar

Os pacientes recebidos antes desta versão não têm identificadores listados até executar `openldr db reproject --force` uma vez. Também preenche o que o CE precisa para encontrar pacientes com o mesmo nome e data de nascimento.

## Na linha de comandos

- `openldr patients list [--search <texto>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <sistema> [--label <texto>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <texto>]` e `restore <idA> <idB>`
- `openldr patients duplicates export [--out <ficheiro>]`

A saída está oculta, a não ser que passe `--identifiers`. `patients list` e `patients show` com `--identifiers` ficam registados na auditoria. `duplicates export` nunca é ocultado e fica registado na auditoria. `duplicates dismiss` e `restore` ficam registados na auditoria.

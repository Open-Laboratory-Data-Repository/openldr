# Configurar um laboratório

O módulo de laboratório permite que um laboratório receba amostras, trabalhe com listas de trabalho e reveja resultados dentro do OpenLDR. Esta versão traz a primeira parte, a receção. Também prepara o resto. Define as secções do laboratório, que exames precisam de revisão, se uma pessoa pode validar os resultados que introduziu, e limites críticos nos intervalos de referência. Também dá às pessoas as novas funções do laboratório.

**As listas de trabalho e a revisão de resultados não fazem parte desta versão.** Chegam em versões posteriores. As definições de revisão e de autovalidação abaixo ficam guardadas já agora. Guardá-las não muda nada no trabalho atual do laboratório.

O guia da aplicação **Configuração do laboratório** mostra cada passo no ecrã. Esta página dá a ordem e os comandos, para uma instalação gerida na linha de comandos.

## O que precisa

- Um servidor OpenLDR desta versão ou mais recente, em funcionamento.
- Uma conta com **Lab settings** para as secções, a revisão e a autovalidação.
- **Manage terminology** para os limites críticos, porque fazem parte dos intervalos de referência de um exame.
- **Manage roles** para dar as funções do laboratório.

## A ordem dos passos

1. Adicione as secções do laboratório, como a hematologia. Um exame só pode ser arquivado numa secção que exista. Um laboratório sem secções pode saltar este passo.
2. Arquive cada exame na sua secção e diga se precisa de revisão. Um exame precisa de revisão até a desligar.
3. Decida sobre a autovalidação. Vem desligada por predefinição, por isso a pessoa que introduziu um resultado não o pode validar.
4. Adicione limites críticos aos intervalos de referência dos exames que os têm. Use os limites aprovados pelo seu laboratório.
5. Dê às pessoas as funções **Reception**, **Lab Technician** e **Lab Manager**.

Os passos 1 a 3 fazem-se na página de definições do laboratório e no catálogo de exames. O passo 4 faz-se no catálogo de exames. O passo 5 faz-se em Utilizadores. Os passos 1 a 3 são também comandos `openldr`.

## Os comandos

Cada comando passa pelo servidor OpenLDR em execução, como uma pessoa que tem **Lab settings**. Em Linux e macOS, inicie sessão primeiro com `./openldr login`, ou defina uma chave de acesso em `OPENLDR_KEY`. Em Windows, `.\openldr.ps1` inicia sessão apenas com uma chave de acesso, por isso defina primeiro `OPENLDR_KEY`. Os comandos não foram corridos em Windows. [Início de sessão do CLI e chaves de acesso](/docs/cli-access) explica como iniciar sessão. Cada comando fica registado no registo de auditoria com a sua conta.

```sh
openldr lab sections add haem Hematologia
openldr lab sections list
openldr lab tests set HGB --section haem --needs-review true
openldr lab tests set HGB --no-section
openldr lab settings set allow-self-authorise false
openldr lab sections remove haem --force
openldr lab requisitions rebuild --force
```

- `lab sections add <code> <name>` adiciona uma secção. O código usa letras minúsculas, algarismos e hífenes, a começar por uma letra. Não pode mudar depois.
- `lab sections list` mostra o código e o nome de cada secção.
- `lab tests set <code>` arquiva um exame numa secção com `--section <code>`, tira-o com `--no-section`, e define a revisão com `--needs-review true` ou `false`. Um campo que não indicar mantém o valor guardado.
- `lab settings set allow-self-authorise true|false` liga ou desliga a autovalidação.
- `lab sections remove <code> --force` remove uma secção. Recusa sem `--force`, porque uma remoção não pode ser desfeita. Também recusa enquanto um exame usar a secção, com `section <code> is used by <n> tests`.
- `lab requisitions rebuild --force` reconstrói o índice que a receção usa para encontrar um pedido pelo número de requisição. O OpenLDR mantém esse índice atualizado sozinho, por isso execute-o só quando um pedido que sabe estar guardado não aparecer na receção. Mostra `Indexed <n> orders by requisition number.` Recusa sem `--force`, porque reescreve o índice inteiro.

Numa cópia do código-fonte, ponha `pnpm` à frente, por exemplo `pnpm openldr lab sections list`.

## As funções

- **Reception** pode receber amostras, devolver um pedido ao seu local, rejeitar uma amostra ou uma análise, ver as listas de trabalho e abrir o índice de pacientes mascarado.
- **Lab Technician** pode preencher e submeter formulários, devolver e rejeitar, introduzir resultados e ver as listas de trabalho. Não tem **Receive samples**, por isso não pode abrir a receção.
- **Lab Manager** tem as sete capacidades do laboratório.

Numa instalação que usava uma versão anterior, Reception aparece no primeiro arranque do servidor nesta versão. Lab Technician e Lab Manager recebem as novas capacidades nesse arranque, uma só vez. Uma capacidade tirada depois continua tirada.

## A receção

A receção é o balcão do laboratório no studio. Encontra um pedido por um número de requisição lido ou escrito, regista um pedido de que o laboratório não tem registo, encontra ou regista o paciente, recebe a amostra com a sua condição e corrige um erro de escrita num pedido, e cancela um pedido registado na receção para o registar de novo. Também devolve um pedido ao seu local, rejeita uma amostra ou uma análise, e associa uma nova colheita ao pedido que ela substitui. O guia da aplicação **Receção** mostra cada passo.

- A receção precisa de **Receive samples**. As funções Reception e Lab Manager têm-na.
- Devolver e rejeitar precisam também de **Return and reject**. Reception, Lab Technician e Lab Manager têm-na. Associar uma nova colheita precisa só de **Receive samples**.
- Um utilizador com um limite de dados perde **Receive samples** e **Return and reject**, por isso não tem a receção.
- O formulário Lab order agora só pede testes. Já não tem o campo **Results**. Os resultados vão ser introduzidos e validados no laboratório numa versão posterior. Também já não tem o campo **Order rejection**. Numa instalação atualizada, o OpenLDR retira esse campo de um formulário Lab order que ninguém alterou. Um formulário alterado pelo seu laboratório mantém-no.
- Cada teste de um pedido novo é guardado como o seu próprio pedido de análise. Os pedidos guardados antes desta versão ficam como foram guardados, e a receção lista todos os seus testes.
- Um local ainda não consegue ver um pedido devolvido ou um pedido de nova colheita no seu próprio ecrã. O laboratório avisa o local.
- Uma nova colheita precisa de um novo número de requisição. O número antigo continua a identificar o pedido rejeitado.
- Numa instalação atualizada, Lab Technician recebe **Return and reject** no primeiro arranque nesta versão, uma só vez. Se depois a tirar, ela continua tirada.
- Devolver, rejeitar e associar uma nova colheita ainda não são comandos `openldr`.

## Motivos de devolução e de rejeição

As listas que a receção oferece são conjuntos de valores. Um laboratório pode acrescentar os seus próprios códigos a cada uma em **Terminologia**, no studio.

| Lista | Conjunto de valores |
|------|-----------|
| Porque um pedido volta ao seu local | `urn:openldr:valueset:order-return-reason` |
| Porque uma amostra é rejeitada | `urn:openldr:valueset:order-reject-reason` |
| Porque uma análise é rejeitada | `urn:openldr:valueset:test-reject-reason` |
| A condição da amostra | `urn:openldr:valueset:sample-condition` |

O OpenLDR traz alguns códigos em cada uma, como `Form incomplete` para uma devolução e `Clotted` para uma amostra. Estes códigos aparecem em inglês.

## Resolução de problemas

- **`lab sections remove` diz que há exames a usar a secção.** Mova esses exames com `lab tests set <code> --section <outra>` ou `--no-section`, e depois remova-a de novo.
- **`lab tests set` diz `no section <code>`.** Adicione primeiro a secção com `lab sections add`.
- **Um comando diz que a conta não tem a capacidade.** A conta não tem **Lab settings**. Dê-lhe a função Lab Manager, ou uma função com essa capacidade.

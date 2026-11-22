# Configurar um laboratório

O módulo de laboratório vai permitir que um laboratório receba amostras, trabalhe com listas de trabalho e reveja resultados dentro do OpenLDR. Esta versão prepara-o. Define as secções do laboratório, que exames precisam de revisão, se uma pessoa pode validar os resultados que introduziu, e limites críticos nos intervalos de referência. Também dá às pessoas as novas funções do laboratório.

**A receção, as listas de trabalho e a revisão de resultados não fazem parte desta versão.** Chegam em versões posteriores. As definições abaixo ficam guardadas já agora. Guardá-las não muda nada no trabalho atual do laboratório.

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

Inicie sessão primeiro com `openldr login`, como uma pessoa que tem **Lab settings**. [Início de sessão do CLI e chaves de acesso](/docs/cli-access) explica como iniciar sessão. Cada comando fica registado no registo de auditoria com a sua conta.

```sh
openldr lab sections add haem Hematologia
openldr lab sections list
openldr lab tests set HGB --section haem --needs-review true
openldr lab tests set HGB --no-section
openldr lab settings set allow-self-authorise false
openldr lab sections remove haem --force
```

- `lab sections add <code> <name>` adiciona uma secção. O código usa letras minúsculas, algarismos e hífenes, a começar por uma letra. Não pode mudar depois.
- `lab sections list` mostra o código e o nome de cada secção.
- `lab tests set <code>` arquiva um exame numa secção com `--section <code>`, tira-o com `--no-section`, e define a revisão com `--needs-review true` ou `false`. Um campo que não indicar mantém o valor guardado.
- `lab settings set allow-self-authorise true|false` liga ou desliga a autovalidação.
- `lab sections remove <code> --force` remove uma secção. Recusa sem `--force`, porque uma remoção não pode ser desfeita. Também recusa enquanto um exame usar a secção, com `section <code> is used by <n> tests`.

Numa cópia do código-fonte, ponha `pnpm` à frente, por exemplo `pnpm openldr lab sections list`.

## As funções

- **Reception** pode receber amostras, devolver um pedido ao seu local, rejeitar uma amostra, ver as listas de trabalho e abrir o índice de pacientes mascarado.
- **Lab Technician** pode preencher e submeter formulários, introduzir resultados e ver as listas de trabalho.
- **Lab Manager** tem as sete capacidades do laboratório.

Numa instalação que usava uma versão anterior, Reception aparece no primeiro arranque do servidor nesta versão. Lab Technician e Lab Manager recebem as novas capacidades nesse arranque, uma só vez. Uma capacidade tirada depois continua tirada.

## Resolução de problemas

- **`lab sections remove` diz que há exames a usar a secção.** Mova esses exames com `lab tests set <code> --section <outra>` ou `--no-section`, e depois remova-a de novo.
- **`lab tests set` diz `no section <code>`.** Adicione primeiro a secção com `lab sections add`.
- **Um comando diz que a conta não tem a capacidade.** A conta não tem **Lab settings**. Dê-lhe a função Lab Manager, ou uma função com essa capacidade.

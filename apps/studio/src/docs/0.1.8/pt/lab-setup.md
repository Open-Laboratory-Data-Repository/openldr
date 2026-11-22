# Configuração do laboratório

A configuração do laboratório prepara este laboratório para o módulo de laboratório. Adiciona as secções do laboratório, escolhe que exames precisam de revisão, decide se uma pessoa pode validar os resultados que introduziu e define limites críticos nos intervalos de referência. Os gestores de laboratório e os administradores fazem isto uma vez, antes de o laboratório começar a trabalhar.

**A receção, as listas de trabalho e a revisão de resultados não fazem parte desta versão.** Chegam em versões posteriores. Esta versão guarda as definições que elas vão usar. Guardá-las não muda nada no trabalho atual do laboratório.

Precisa de **Lab settings** para alterar as secções, o interruptor de revisão e a autovalidação. Os limites críticos fazem parte dos intervalos de referência de um exame. Por isso precisam de **Manage terminology**, como o resto da definição do exame. Abrir **Catálogo de exames** precisa de **Browse terminology**.

Os nomes das funções e das capacidades aparecem em inglês no ecrã. Por isso este guia escreve-os em inglês.

Siga as tarefas pela ordem abaixo. Um exame só pode ser arquivado numa secção que exista.

## Adicionar as secções do laboratório

Uma secção é uma parte do laboratório, como a hematologia ou a microbiologia. As listas de trabalho vão filtrar por secção. Um laboratório sem secções pode saltar esta tarefa.

1. Abra o seu menu de utilizador no canto inferior esquerdo e selecione **Definições**.
2. Selecione **Laboratório**.
3. Abra o menu de pontos no canto superior direito e selecione **Adicionar secção**.
4. Escreva o código em **Código**, por exemplo `haem`. Use letras minúsculas, algarismos e hífenes, a começar por uma letra.
5. Escreva o nome em **Nome**, por exemplo `Hematologia`.
6. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** uma mensagem diz **Secção haem adicionada.** A secção aparece na tabela **Secções**. Aparece logo no catálogo de exames.

O código não pode mudar depois de guardado. Para mudar um código, remova a secção e adicione-a de novo.

## Remover uma secção

1. Abra **Definições** e depois **Laboratório**.
2. Encontre a secção na tabela **Secções**.
3. Abra o menu de pontos da sua linha e selecione **Remover**.
4. Leia o pedido de confirmação e selecione **Remover**.

**Resultado esperado:** uma mensagem diz que a secção foi removida, e ela sai da tabela. Esta ação não pode ser desfeita.

O OpenLDR recusa remover uma secção que um exame ainda usa. Mova primeiro esses exames para outra secção, ou para **Sem secção**.

## Escolher que exames precisam de revisão e a sua secção

Cada exame tem a sua própria secção e definição de revisão neste laboratório. Um exame novo precisa de revisão até a desligar.

1. Abra **Catálogo de exames** e selecione o separador **Testes**.
2. Abra o menu de pontos da linha do exame e selecione **Editar**.
3. Em **Este laboratório**, escolha a secção em **Secção**, ou escolha **Sem secção**.
4. Ligue ou desligue **Requer revisão**.
5. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** uma mensagem diz que o exame foi guardado. A secção e o interruptor mantêm a sua escolha quando volta a abrir o exame.

Com **Requer revisão** ligado, um segundo passo vai validar cada resultado antes de ser libertado. Com ele desligado, um resultado sem valor crítico vai ser libertado sem esse passo. Um valor crítico vai sempre para revisão.

**Secção** fica oculto enquanto o laboratório não tiver secções. Sem **Lab settings** pode ler os dois campos, mas não os pode alterar.

## Decidir sobre a autovalidação

Por predefinição, a pessoa que introduziu um resultado não o pode validar. Ligue esta definição só quando o seu laboratório permite que uma pessoa faça as duas coisas, por exemplo um laboratório com um só técnico no turno da noite.

1. Abra **Definições** e depois **Laboratório**.
2. Encontre **Permitir que uma pessoa autorize os resultados que introduziu**.
3. Ligue ou desligue o interruptor.

**Resultado esperado:** uma mensagem diz **Guardado.** O interruptor guarda assim que o muda. Não há um passo de guardar à parte.

## Adicionar limites críticos a um intervalo de referência

Um limite crítico é um valor tão fora do intervalo que alguém tem de agir logo. A introdução de resultados vai assinalar um valor que o atinja ou ultrapasse. Use os limites aprovados pelo seu laboratório. Não copie números de um exemplo.

1. Abra **Catálogo de exames** e abra o exame com **Editar**.
2. Encontre o campo de resultado e o seu intervalo de referência.
3. Escreva o limite inferior em **Limite crítico inferior**.
4. Escreva o limite superior em **Limite crítico superior**.
5. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** uma mensagem diz que o exame foi guardado. Os limites ficam guardados com o intervalo.

Pode preencher um limite, os dois ou nenhum. O OpenLDR verifica três regras ao guardar:

- **Limite crítico inferior** tem de ser menor ou igual a **Limite inferior**.
- **Limite crítico superior** tem de ser maior ou igual a **Limite superior**.
- **Limite crítico inferior** tem de ser menor que **Limite crítico superior**.

Uma regra só é verificada quando o intervalo tem os dois valores. Uma recusa indica o campo de resultado e o intervalo. A mensagem vem do servidor, em inglês, por exemplo `HGB range 1: the critical low limit must be at or below the low limit.`

## Dar as funções do laboratório

Três funções incluídas cobrem o trabalho do laboratório.

- **Reception** pode receber amostras, devolver um pedido ao seu local, rejeitar uma amostra, ver as listas de trabalho e abrir o índice de pacientes mascarado.
- **Lab Technician** pode preencher e submeter formulários, introduzir resultados e ver as listas de trabalho.
- **Lab Manager** tem todas as capacidades do laboratório, incluindo **Lab settings**.

A página **Funções** lista as sete capacidades do laboratório no grupo **Lab**: **Receive samples**, **Return and reject**, **Enter results**, **Authorise results**, **Amend results**, **View worklists** e **Lab settings**.

Precisa de **Manage roles** para dar uma função a uma pessoa.

1. Abra **Utilizadores**.
2. Encontre a conta, abra o menu de pontos da sua linha e selecione **Editar**.
3. Abra **Função** e selecione **Reception**, **Lab Technician** ou **Lab Manager**.
4. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** o painel fecha. Volte a abrir a conta para verificar a função guardada.

Numa instalação que usava uma versão anterior, **Reception** aparece no primeiro arranque do servidor nesta versão. **Lab Technician** e **Lab Manager** recebem as novas capacidades no mesmo arranque, uma só vez. Se depois tirar uma capacidade a uma delas, ela continua tirada.

A maior parte destas capacidades abre ecrãs que chegam em versões posteriores. Hoje só **Lab settings** muda o que uma pessoa pode fazer.

## Configurar o laboratório na linha de comandos

Cada tarefa acima, exceto os limites críticos e as funções, é também um comando `openldr`. Inicie sessão primeiro com `openldr login`, como uma pessoa que tem **Lab settings**. Leia [Comece aqui](/docs/start-here) para a CLI instalada e a de desenvolvimento.

Exemplo numa cópia de desenvolvimento:

```shell
pnpm openldr lab sections add haem Hematologia
pnpm openldr lab sections list
pnpm openldr lab tests set HGB --section haem --needs-review true
pnpm openldr lab tests set HGB --no-section
pnpm openldr lab settings set allow-self-authorise false
pnpm openldr lab sections remove haem --force
```

Numa cópia instalada em Linux ou macOS, use `./openldr` em vez de `pnpm openldr`. Em Windows, use `.\openldr.ps1` a partir da pasta de instalação.

`lab sections remove` recusa sem `--force`, porque uma remoção não pode ser desfeita. Cada comando fica registado no registo de auditoria com a sua conta.

## Limites

- A receção, as listas de trabalho e a revisão de resultados não fazem parte desta versão. Estas definições passam a ter efeito quando chegarem.
- Uma secção tem um código e um nome. O código não pode mudar.
- A secção e a definição de revisão pertencem a este laboratório. Um catálogo partilhado pelo central não as define.

## Resolução de problemas

- **Adicionar secção não está no menu de pontos.** A sua conta não tem **Lab settings**.
- **Secção não está no painel do exame.** O laboratório ainda não tem secções. Adicione uma em **Laboratório**.
- **Uma secção não é removida.** Um exame ainda a usa. A mensagem diz quantos. Mova primeiro esses exames.
- **Guardar recusa um limite crítico.** Leia a mensagem. Indica o intervalo e a regra que falhou.

## Guias relacionados

- [Laboratório](/docs/laboratory)
- [Catálogo de testes](/docs/test-catalog)
- [Funções](/docs/roles)
- [Utilizadores](/docs/users)

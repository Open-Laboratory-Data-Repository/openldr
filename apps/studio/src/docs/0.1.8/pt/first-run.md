# Primeiro arranque

O primeiro arranque são três passos curtos que o Studio mostra logo depois de criar o primeiro administrador. Dá nome ao laboratório, carrega dados de exemplo se quiser, e vê que verificações ainda precisam de si. É para a pessoa que prepara uma instalação nova.

O primeiro arranque aparece uma só vez, e só numa instalação que usa o início de sessão do próprio OpenLDR. Só a pessoa que criou o primeiro administrador o vê, na janela ou no separador do navegador onde o criou. Pode saltar os dois primeiros passos. Depois, Definições, Verificações de instalação guarda a mesma lista e pode carregar os dados de exemplo mais tarde.

## Dar nome ao laboratório

Os relatórios imprimem este nome como laboratório emissor. Os dias são contados neste fuso horário. A página mostra **Passo 1 de 3** e **Dar nome ao laboratório**.

1. Em **Nome**, escreva o nome do seu laboratório, por exemplo `Laboratório do Hospital Central`.
2. Selecione **Fuso horário**. O fuso do seu computador vem escolhido de início.
3. Em **Procurar um fuso horário**, escreva parte do nome do fuso, por exemplo `Maputo`.
4. Escolha o fuso, por exemplo `Africa/Maputo`.
5. Selecione **Guardar**.

**Resultado esperado:** abre-se o passo seguinte. É **Dados de exemplo**, ou **Está tudo pronto** quando o Studio não oferece dados de exemplo.

Para deixar o nome e o fuso como estão, selecione **Saltar** em vez de **Guardar**. Pode definir os dois mais tarde. Veja [Laboratório](/docs/laboratory).

## Carregar dados de exemplo

A página diz o que são os dados de exemplo: **Os dados de exemplo acrescentam um paciente e um laboratório fictícios, com formulários, fluxos de trabalho e painéis, para experimentar o OpenLDR antes de chegarem dados reais.**

1. Em **Dados de exemplo**, selecione **Carregar dados de exemplo**.
2. Aguarde enquanto a página mostra **A carregar os dados de exemplo…**.

**Resultado esperado:** abre-se **Está tudo pronto**.

Para continuar sem eles, selecione **Saltar**.

O Studio só oferece dados de exemplo enquanto a instalação não tiver dados de laboratório. Um paciente, um pedido de análise, uma amostra, um resultado ou uma resposta de formulário guardada contam como dados de laboratório. Uma organização ou um local também. Assim que existir um, este passo deixa de aparecer, e um segundo carregamento é recusado.

Se saltar este passo, pode carregar os dados mais tarde a partir do menu de pontos de Definições, Verificações de instalação, enquanto a instalação continuar sem dados de laboratório. Veja [Verificações da configuração](/docs/setup-checks).

## Ver o que ainda precisa de si

O último passo lista as verificações que mostram um aviso ou uma falha. As verificações aprovadas ou ignoradas não aparecem.

1. Aguarde enquanto a página mostra **A executar as verificações…**.
2. Leia cada verificação, o estado e a indicação.
3. Para corrigir uma já, selecione a ligação dela, por exemplo **Abrir Laboratório**.
4. Caso contrário, selecione **Abrir o OpenLDR**.

**Resultado esperado:** o Studio abre. Uma ligação abre antes a página dela. Em ambos os casos, o primeiro arranque termina e não volta a aparecer.

Quando nada precisa de si, a página diz **Nada precisa de si por agora. A lista completa fica em Definições, Verificações de instalação.**

## Limites

- O primeiro arranque só aparece com o início de sessão do próprio OpenLDR. Uma instalação que inicia sessão através do Keycloak ou de outro fornecedor nunca o mostra. Use aí [Verificações da configuração](/docs/setup-checks).
- Aparece uma só vez. Depois de **Abrir o OpenLDR**, de uma ligação ou de terminar sessão, não volta.
- Recarregar a página a meio recomeça o primeiro arranque no passo 1. Um nome já guardado continua guardado. Fechar esse separador a meio termina o primeiro arranque de vez.
- Os dados de exemplo só são oferecidos enquanto a instalação não tiver dados de laboratório.

## Resolução de problemas

- **O passo dos dados de exemplo não apareceu.** A instalação já tem dados de laboratório, ou o Studio não conseguiu perguntar ao servidor. Abra Definições, Verificações de instalação, e procure **Carregar dados de exemplo** no menu de pontos.
- **Não foi possível guardar o laboratório:** seguido de um motivo. Selecione **Guardar** de novo. Ou selecione **Saltar** e defina o nome mais tarde em Definições, Laboratório.
- **Não foi possível carregar os dados de exemplo:** seguido de um motivo. O carregamento não terminou. Parte dos dados de exemplo pode já estar lá. Uma segunda tentativa é então recusada, por isso selecione **Saltar**. O registo do servidor indica o erro.
- **Não foi possível executar as verificações:** seguido de um motivo. Selecione **Abrir o OpenLDR**. Depois abra Definições, Verificações de instalação e selecione **Executar de novo** no menu de pontos.

## Guias relacionados

- [Início de sessão e palavras-passe](/docs/sign-in)
- [Verificações da configuração](/docs/setup-checks)
- [Laboratório](/docs/laboratory)

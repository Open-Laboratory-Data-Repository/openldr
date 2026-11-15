# Primeiro arranque

O primeiro arranque são três passos curtos que o Studio mostra logo depois de criar o primeiro administrador. Dá um nome ao seu laboratório, carrega dados de exemplo se quiser, e revê as verificações de instalação que precisam de atenção. É para a pessoa que prepara uma instalação nova.

O primeiro arranque aparece uma só vez, e só numa instalação que usa o início de sessão do próprio OpenLDR. Só a pessoa que criou o primeiro administrador o vê, na janela ou no separador do navegador onde o criou. Pode saltar os dois primeiros passos. Mais tarde, pode rever as mesmas verificações e carregar os dados de exemplo em Definições → Verificações de instalação.

## Dar um nome ao seu laboratório

O nome do laboratório aparece nos relatórios como laboratório emissor. Os relatórios usam este fuso horário para saber a que dia pertence cada registo. A página mostra **Passo 1 de 3** e **Dê um nome ao seu laboratório**.

1. Em **Nome do laboratório**, escreva o nome do seu laboratório, por exemplo `Laboratório do Hospital Central`.
2. Selecione **Fuso horário**. O Studio começa pelo fuso do seu computador.
3. Em **Procurar um fuso horário**, escreva parte do nome do fuso, por exemplo `Maputo`.
4. Escolha o fuso, por exemplo `Africa/Maputo`.
5. Selecione **Guardar**.

**Resultado esperado:** abre-se o passo seguinte. É **Dados de exemplo**, ou **O OpenLDR está pronto** quando o Studio não oferece dados de exemplo.

Para deixar o nome e o fuso como estão, selecione **Saltar** em vez de **Guardar**. Pode definir os dois mais tarde. Veja [Laboratório](/docs/laboratory).

## Carregar dados de exemplo

A página diz o que os dados de exemplo contêm: **Os dados de exemplo acrescentam 60 pedidos fictícios, 39 deles com resultados, e um painel de exemplo, para que possa experimentar o OpenLDR antes de chegarem os seus próprios dados. Não é possível remover mais tarde apenas os registos de exemplo. Não os carregue numa instalação destinada a dados reais de pacientes.**

1. Em **Dados de exemplo**, selecione **Carregar dados de exemplo**.
2. Aguarde enquanto a página mostra **A carregar os dados de exemplo…**.

**Resultado esperado:** abre-se **O OpenLDR está pronto**.

Para continuar sem eles, selecione **Saltar**.

O Studio só oferece dados de exemplo enquanto a instalação não tiver dados de laboratório. Um paciente, um pedido de análise, uma amostra, um resultado ou uma resposta de formulário guardada contam como dados de laboratório. Uma organização ou um local também. Assim que existir um, este passo deixa de aparecer, e um segundo carregamento é recusado.

Se saltar este passo, pode carregar os dados mais tarde a partir do menu de pontos de Definições → Verificações de instalação, enquanto a instalação continuar sem dados de laboratório. Veja [Verificações da configuração](/docs/setup-checks).

## Rever as verificações de instalação

O último passo lista as verificações que mostram um aviso ou uma falha. As verificações aprovadas ou ignoradas não aparecem.

1. Aguarde enquanto a página mostra **A executar as verificações de instalação…**.
2. Leia cada verificação, o estado e a indicação.
3. Para corrigir uma já, selecione a ligação dela, por exemplo **Abrir Laboratório**.
4. Caso contrário, selecione **Continuar para o OpenLDR**.

**Resultado esperado:** o Studio abre. Uma ligação abre antes a página dela. Em ambos os casos, o primeiro arranque termina e não volta a aparecer.

Quando nenhuma verificação mostra um aviso ou uma falha, a página diz **Todas as verificações de instalação passaram. Pode revê-las a qualquer momento em Definições → Verificações de instalação.**

## Limites

- O primeiro arranque só aparece com o início de sessão do próprio OpenLDR. Uma instalação que inicia sessão através do Keycloak ou de outro fornecedor nunca o mostra. Use aí [Verificações da configuração](/docs/setup-checks).
- Aparece uma só vez. Depois de **Continuar para o OpenLDR**, de uma ligação ou de terminar sessão, não volta.
- Recarregar a página a meio recomeça o primeiro arranque no passo 1. Um nome já guardado continua guardado. Fechar esse separador a meio termina o primeiro arranque de vez.
- Os dados de exemplo só são oferecidos enquanto a instalação não tiver dados de laboratório.
- Depois de carregados, os 60 pedidos de exemplo e os seus resultados ficam. Nenhuma ação remove apenas esses pedidos. A **Redefinição de fábrica**, em **Zona de perigo**, deixa-os ficar. O `openldr db reset --force` remove-os, mas apaga também todos os outros dados das duas bases de dados.
- Se esta instalação enviar mais tarde os seus dados para uma instalação central do OpenLDR, os pedidos de exemplo são enviados com eles.

## Resolução de problemas

- **O passo dos dados de exemplo não apareceu.** A instalação já tem dados de laboratório, ou o Studio não conseguiu perguntar ao servidor. Abra Definições → Verificações de instalação, e procure **Carregar dados de exemplo** no menu de pontos.
- **Não foi possível guardar os dados do laboratório:** seguido de um motivo. Selecione **Guardar** de novo. Ou selecione **Saltar** e defina o nome mais tarde em Definições → Laboratório.
- **Não foi possível carregar os dados de exemplo:** seguido de um motivo. O carregamento não terminou. Parte dos dados de exemplo pode já estar lá. Uma segunda tentativa é então recusada, por isso selecione **Saltar**. O registo do servidor indica o erro.
- **Não foi possível executar as verificações de instalação:** seguido de um motivo. Selecione **Continuar para o OpenLDR**. Depois abra Definições → Verificações de instalação e selecione **Executar de novo** no menu de pontos.

## Guias relacionados

- [Início de sessão e palavras-passe](/docs/sign-in)
- [Verificações da configuração](/docs/setup-checks)
- [Laboratório](/docs/laboratory)

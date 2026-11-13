# Verificações da configuração

Setup checks verifica os serviços e definições necessários nesta instalação. Use a página após instalar ou alterar a configuração e siga as indicações de cada aviso ou falha.

Precisa de View settings. Alterar uma definição ligada pode exigir outra permissão. Estas verificações usam a mesma lista que `openldr doctor`. Leia [Começar aqui](/docs/start-here) para configurar a linha de comandos.

Consulte os resultados da sua instalação. As capturas mostram uma instalação de desenvolvimento isolada com configuração em falta intencional. Não são necessários dados de exemplo.

## Ler o relatório atual de preparação

Faça estas verificações antes de disponibilizar a instalação ao pessoal. Executam-se ao abrir a página.

### 1. Abrir Settings e Setup checks

Abra o menu de utilizador no canto inferior esquerdo, escolha **Settings** e depois **Setup checks**.

![Abrir o menu de utilizador no canto inferior esquerdo.](setup-checks-guide-user-menu.png)

![Escolher Settings.](setup-checks-guide-settings-menu.png)

![Selecionar Setup checks em Settings.](setup-checks-guide-setup-page.png)

### 2. Ler o resumo

Leia o número de falhas e avisos. Se não existir nenhum, o resumo indica All checks passed.

![Ler o número de falhas e avisos.](setup-checks-guide-summary.png)

### 3. Ler primeiro as falhas

Leia os detalhes do serviço e a ação sugerida. Esta instalação de teste indica uma falha no armazenamento de objetos. Siga as indicações para o seu resultado.

![Ler os detalhes e a ação sugerida junto de uma falha.](setup-checks-guide-failed-service.png)

### 4. Ler os avisos

Um aviso exige revisão mesmo quando o serviço está disponível. O exemplo avisa que Laboratory name ainda usa o valor fornecido por predefinição.

![Ler cada aviso antes de considerar a instalação pronta.](setup-checks-guide-warning.png)

### 5. Verificar os itens ignorados

**Skipped** significa que a verificação não se aplicava. Não significa que uma função não utilizada foi configurada.

![Skipped indica uma verificação não aplicável, não uma configuração aprovada.](setup-checks-guide-skipped.png)

**Resultado esperado:** sabe que verificações exigem atenção e que indicações se aplicam à instalação.

## Seguir um aviso e verificar a correção

Use a página ligada para corrigir um problema. Este exemplo corrige o nome do laboratório e o fuso horário em falta no PostgreSQL.

### 1. Abrir a página ligada

Selecione **Open Laboratory** junto do aviso Laboratory name.

![Seguir a ligação para a definição que exige atenção.](setup-checks-guide-open-laboratory.png)

### 2. Introduzir o nome do laboratório

Introduza o nome real do laboratório emissor. A captura usa `Documentation laboratory` numa instalação de teste.

![Introduzir o nome real do laboratório. O exemplo usa um nome fictício.](setup-checks-guide-correct-name.png)

### 3. Definir o fuso horário quando aplicável

No PostgreSQL ou MySQL, introduza o nome do fuso horário local. O exemplo usa `Africa/Dar_es_Salaam`. No SQL Server, siga as indicações da página e forneça o fuso Windows em cada execução de relatório.

![Usar um fuso horário local com nome no PostgreSQL ou MySQL.](setup-checks-guide-correct-zone.png)

### 4. Guardar a correção

Abra o menu de pontos de Laboratory e escolha **Save**.

![Abrir o menu de pontos de Laboratory.](setup-checks-guide-laboratory-actions.png)

![Escolher Save para guardar as correções.](setup-checks-guide-laboratory-save.png)

### 5. Regressar a Setup checks

Selecione **Setup checks** em Settings. A abertura executa novamente as verificações.

![Laboratory name e Time zone indicam agora Passed.](setup-checks-guide-corrected-result.png)

**Resultado esperado:** as verificações Laboratory name e Time zone corrigidas indicam Passed. Os restantes avisos e falhas ainda exigem atenção.

## Executar novamente as verificações

Use esta ação após alterar a configuração ou recuperar um serviço.

### 1. Abrir as ações da página

Selecione os pontos no canto superior direito de Setup checks.

![Abrir o menu de pontos de Setup checks.](setup-checks-guide-setup-actions.png)

### 2. Escolher Run again

Selecione **Run again**. Aguarde o fim das verificações.

![Escolher Run again após uma correção.](setup-checks-guide-run-again.png)

**Resultado esperado:** o novo resumo mostra o resultado atual. Leia as falhas e avisos restantes.

![Ler o novo resumo e tratar as falhas e avisos restantes.](setup-checks-guide-rerun-result.png)

## Carregar dados de exemplo

Use esta ação para experimentar o OpenLDR numa instalação nova. Carrega os mesmos dados de exemplo que o passo dos dados de exemplo do [Primeiro arranque](/docs/first-run). O menu só a oferece enquanto a instalação não tiver dados de laboratório. Precisa da permissão Zona de perigo. Administrator tem-na.

### 1. Abrir as ações da página

Selecione os pontos no canto superior direito da página.

### 2. Escolher Carregar dados de exemplo

Selecione **Carregar dados de exemplo**. Abre-se uma caixa com o título **Dados de exemplo** e uma frase sobre o que contêm.

### 3. Confirmar

Selecione **Carregar dados de exemplo** na caixa. Para sair sem carregar, selecione **Cancelar**. Durante o carregamento, a página mostra **A carregar os dados de exemplo…**.

**Resultado esperado:** as verificações voltam a ser executadas. **Carregar dados de exemplo** já não está no menu, porque a instalação tem agora dados de laboratório.

## Ler as verificações num telemóvel

Use a mesma página no telemóvel. Cada verificação inclui o estado e as indicações.

### 1. Ler o resumo

Abra Setup checks e leia o resumo no topo.

![Ler o resumo no topo no telemóvel.](setup-checks-guide-phone-summary.png)

### 2. Percorrer as verificações

Leia os detalhes de cada verificação e as ligações ou ações propostas.

![Percorrer as verificações para ler os detalhes e indicações.](setup-checks-guide-phone-check.png)

## Prática opcional

Não são necessários registos de prática. Numa instalação de teste, corrija um aviso real do nome ou fuso horário, guarde e execute novamente as verificações. Não provoque uma falha de serviço para este exercício.

## Limites

O relatório descreve as verificações no momento da execução. All checks passed não comprova todos os relatórios, fluxos ou tarefas do pessoal. Algumas correções exigem configuração do servidor fora do Studio.

## Resolução de problemas

**As verificações não puderam executar-se.** Verifique a ligação à API e o registo do servidor e tente Run again.

**Os serviços falharam.** Siga as indicações da ferramenta de diagnóstico apresentada e examine o serviço indicado.

**Um aviso indica que a autenticação está desligada.** Desligue o desvio de autenticação de desenvolvimento na configuração do servidor antes da utilização real.

**Início de sessão avisa que ainda não existe nenhum administrador.** A instalação usa o início de sessão próprio do OpenLDR, e ninguém terminou a configuração. O `openldr doctor` mostra `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Até lá, o Studio mostra a página **Criar o administrador**, e não esta página. Veja [Início de sessão e palavras-passe](/docs/sign-in).

**Uma página ligada está indisponível.** Peça ajuda a um administrador com permissão para alterar essa definição.

**Carregar dados de exemplo não está no menu.** A instalação já tem dados de laboratório, ou a sua função não tem a permissão Zona de perigo. Um paciente, um pedido de análise, uma amostra, um resultado, uma resposta de formulário guardada, uma organização ou um local contam como dados de laboratório.

**Não foi possível carregar os dados de exemplo:** seguido de um motivo. O carregamento não terminou. Parte dos dados de exemplo pode já estar lá, e o menu deixa então de oferecer o carregamento. O registo do servidor tem o motivo.

## Guias relacionados

Leia [Laboratório](/docs/laboratory) para os dados do laboratório emissor, [Conectores](/docs/connectors) para testar ligações e [Começar aqui](/docs/start-here) para a instalação e a linha de comandos. Leia [Primeiro arranque](/docs/first-run) para os passos depois de criar o primeiro administrador.

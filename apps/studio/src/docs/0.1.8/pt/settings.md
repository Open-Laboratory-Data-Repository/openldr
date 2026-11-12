# Definições

General mostra informações da aplicação, funções opcionais e limites de execução. Também contém definições de validação dos dados e ações destrutivas de manutenção.

View settings permite abrir General. Edit general settings permite alterar limites numéricos e validação. Manage feature flags permite os interruptores de funções opcionais. Danger zone permite manutenção destrutiva.

Use as suas opções operacionais aprovadas. As capturas mostram uma instalação de teste isolada. Os exemplos destrutivos executaram apenas nessa instalação descartável, após verificar a propriedade da base e do fornecedor de identidade. Não são necessários dados de prática.

Em Settings, use as páginas ligadas Laboratory, Setup checks, Connectors, Roles, Layouts e Data Exposure. Este guia cobre General. Leia [Começar aqui](/docs/start-here) para configurar a linha de comandos.

## Ler a versão e o estado de atualização

Use esta tarefa ao comunicar um problema ou decidir se agenda uma atualização.

### 1. Abrir Settings e General

Abra o menu de utilizador no canto inferior esquerdo, escolha **Settings** e depois **General**.

![Abrir o menu de utilizador no canto inferior esquerdo.](settings-guide-user-menu.png)

![Escolher Settings.](settings-guide-settings-menu.png)

![Selecionar General em Settings.](settings-guide-general-page.png)

### 2. Ler About

Leia a **Version** em execução, o ambiente e os serviços configurados em About.

![About mostra a versão em execução e os serviços configurados.](settings-guide-about.png)

### 3. Ler Latest

Leia **Latest** e a hora da última verificação. Use as ligações disponíveis para notas de versão e procedimento ao planear uma atualização. Esta página não instala atualizações.

![Ler Latest e a hora da última verificação de atualizações.](settings-guide-update-state.png)

**Resultado esperado:** conhece a versão em execução e o resultado atual da verificação do servidor.

## Alterar as verificações automáticas de atualizações

Use esta tarefa para decidir se o servidor deve procurar versões disponíveis.

### 1. Alterar Auto update check

Ligue ou desligue **Auto update check** em About. A alteração guarda imediatamente.

![Auto update check determina se o servidor procura versões disponíveis.](settings-guide-update-switch.png)

### 2. Ler o estado resultante

Quando desligada, Latest indica **update check is off**. Ligar permite novamente as verificações. Não atualiza a instalação.

![Desligar reflete-se em Latest. Não instala uma atualização.](settings-guide-update-off.png)

**Resultado esperado:** a escolha de verificação fica guardada.

## Ativar ou desativar uma função opcional

Decida primeiro que funções opcionais a instalação deve oferecer. Leia a descrição antes de alterar um interruptor.

### 1. Alterar o interruptor da função

Em **Feature Flags**, ligue ou desligue a opção pretendida. O exemplo liga **Dashboard raw SQL**.

![Ligar ou desligar a função opcional. O exemplo ativa Dashboard raw SQL.](settings-guide-flag.png)

### 2. Verificar a mensagem de gravação

A alteração guarda imediatamente. Verifique a mensagem **Saved**. Estas funções não têm um botão Save separado.

![As alterações dos interruptores de funções guardam imediatamente.](settings-guide-flag-saved.png)

**Resultado esperado:** a nova escolha aplica-se imediatamente. O exemplo repôs o estado desligado original após a captura.

## Alterar um limite de execução

Use esta tarefa para ajustar um limite sem reiniciar. Leia a descrição e escolha um valor para a sua carga.

### 1. Introduzir o valor

Em **Limits & tuning**, introduza o número pretendido. O exemplo altera **Dashboard SQL row cap** para `5000`.

![Introduzir o limite pretendido. O exemplo define um máximo de 5000 linhas.](settings-guide-number-value.png)

### 2. Sair do campo para guardar

Selecione outro campo ou prima Tab. Sair do campo numérico guarda o valor. O servidor limita os valores ao intervalo aceite.

![Sair do campo numérico guarda o valor.](settings-guide-number-saved.png)

### 3. Verificar o valor guardado

Reabra General para confirmar a persistência. Leia o valor que o servidor manteve.

![O limite guardado mantém-se após reabrir General.](settings-guide-number-reopened.png)

**Resultado esperado:** o limite numérico permanece guardado após reabrir General.

## Alterar a validação dos dados recebidos

Use esta tarefa para alterar que dados recebidos a instalação aceita. Aumentar o rigor pode rejeitar dados antes aceites. Reduzir permite mais dados incompletos.

### 1. Abrir Data validation

Desloque até **Danger Zone** e abra **Data validation**.

![Abrir Data validation em Danger Zone.](settings-guide-validation-menu.png)

### 2. Escolher o nível

Escolha Low, Medium ou High conforme necessário. O exemplo muda High para **Medium**.

![Escolher o nível necessário. O exemplo muda para Medium.](settings-guide-validation-level.png)

### 3. Ler o efeito

Leia o aviso de confirmação correspondente ao sentido da alteração.

![Ler como o novo rigor afeta os dados recebidos.](settings-guide-validation-warning.png)

### 4. Introduzir a frase de confirmação

Introduza exatamente o nível em minúsculas apresentado. O exemplo escreve `medium`.

![Introduzir a frase em minúsculas apresentada na confirmação.](settings-guide-validation-phrase.png)

### 5. Aplicar a alteração

Selecione **Apply**. Escolha Cancel para manter o nível anterior.

![Escolher Apply para guardar o novo rigor.](settings-guide-validation-apply.png)

**Resultado esperado:** Data validation apresenta o nível guardado.

![Data validation apresenta agora o nível Medium guardado.](settings-guide-validation-result.png)

## Repor todos os painéis no exemplo

Use apenas para remover todos os painéis e repor o exemplo integrado. Esta operação é irreversível.

### 1. Abrir os pontos da ação

Em Danger Zone, selecione os pontos junto de **Reset dashboards**.

![Abrir os pontos junto de Reset dashboards.](settings-guide-reset-dashboards-actions.png)

### 2. Escolher Reset

Selecione **Reset**.

![Escolher Reset.](settings-guide-reset-dashboards-menu.png)

### 3. Ler o que a ação remove

Verifique o título e o aviso. Cancele se a ação não corresponde à sua intenção.

![Ler o que Reset dashboards remove antes de confirmar.](settings-guide-reset-dashboards-warning.png)

### 4. Introduzir a frase exata

Introduza `reset dashboards` exatamente como apresentado.

![Introduzir a frase de confirmação exata apresentada pela aplicação.](settings-guide-reset-dashboards-phrase.png)

### 5. Confirmar Reset

Selecione **Reset** para executar a operação. Aguarde a conclusão.

![Confirmar Reset apenas para a operação pretendida.](settings-guide-reset-dashboards-confirm.png)

**Resultado esperado:** todos os painéis são eliminados e o exemplo integrado é recriado.

![A página indica a conclusão de Reset dashboards.](settings-guide-reset-dashboards-result.png)

## Limpar eventos de auditoria e histórico de execuções

Use apenas para remover permanentemente a auditoria e o histórico de execuções dos workflows. Esta operação é irreversível.

### 1. Abrir os pontos da ação

Em Danger Zone, selecione os pontos junto de **Clear audit log**.

![Abrir os pontos junto de Clear audit log.](settings-guide-clear-audit-actions.png)

### 2. Escolher Clear

Selecione **Clear**.

![Escolher Clear.](settings-guide-clear-audit-menu.png)

### 3. Ler o que a ação remove

Verifique o título e o aviso. Cancele se a ação não corresponde à sua intenção.

![Ler o que Clear audit log remove antes de confirmar.](settings-guide-clear-audit-warning.png)

### 4. Introduzir a frase exata

Introduza `clear audit` exatamente como apresentado.

![Introduzir a frase de confirmação exata apresentada pela aplicação.](settings-guide-clear-audit-phrase.png)

### 5. Confirmar Clear

Selecione **Clear** para executar a operação. Aguarde a conclusão.

![Confirmar Clear apenas para a operação pretendida.](settings-guide-clear-audit-confirm.png)

**Resultado esperado:** os eventos antigos e o histórico dos workflows são removidos. A própria limpeza escreve um novo evento de auditoria.

![A página indica a conclusão de Clear audit log.](settings-guide-clear-audit-result.png)

## Repor as predefinições internas de fábrica

Use apenas para apagar todos os dados internos e os repor. Remove formulários, conectores, painéis, workflows, terminologia, utilizadores locais, auditoria e outros registos internos. Esta operação é irreversível.

### 1. Abrir os pontos da ação

Em Danger Zone, selecione os pontos junto de **Factory reset**.

![Abrir os pontos junto de Factory reset.](settings-guide-factory-reset-actions.png)

### 2. Escolher Factory reset

Selecione **Factory reset**.

![Escolher Factory reset.](settings-guide-factory-reset-menu.png)

### 3. Ler o que a ação remove

Verifique o título e o aviso. Cancele se a ação não corresponde à sua intenção.

![Ler o que Factory reset remove antes de confirmar.](settings-guide-factory-reset-warning.png)

### 4. Introduzir a frase exata

Introduza `factory reset` exatamente como apresentado.

![Introduzir a frase de confirmação exata apresentada pela aplicação.](settings-guide-factory-reset-phrase.png)

### 5. Confirmar Factory reset

Selecione **Factory reset** para executar a operação. Aguarde a conclusão.

![Confirmar Factory reset apenas para a operação pretendida.](settings-guide-factory-reset-confirm.png)

**Resultado esperado:** a base interna é apagada e as predefinições de fábrica são recriadas. Os dados externos de destino e as contas do fornecedor de identidade ficam fora desta reposição. Com o início de sessão próprio do OpenLDR, todas as contas e palavras-passe são também removidas. Para voltar a iniciar sessão é preciso um novo código de configuração obtido na linha de comandos do servidor.

![A página indica a conclusão de Factory reset.](settings-guide-factory-reset-result.png)

## Ler General num telemóvel

Use a mesma página General no telemóvel. A página desloca-se verticalmente.

### 1. Ler About

Leia a versão e as informações de atualização perto do topo.

![Ler as informações de General no telemóvel.](settings-guide-phone-about.png)

### 2. Deslocar até aos limites

Leia a descrição do campo antes de alterar um limite numérico.

![Deslocar até aos limites. Os controlos mantêm-se dentro da largura do telemóvel.](settings-guide-phone-limit.png)

### 3. Ler Danger Zone com atenção

Desloque até à ação e leia a descrição antes de abrir os pontos.

![Deslocar até Danger Zone e ler a descrição antes de abrir os pontos.](settings-guide-phone-danger.png)

## Prática opcional

Use uma instalação de teste descartável. Altere uma opção reversível ou um limite, confirme que guardou e reponha o valor. Não pratique manutenção destrutiva com dados do pessoal.

## Limites

A verificação de atualizações não instala uma versão. Os interruptores guardam imediatamente. Os campos numéricos guardam ao sair. As ações destrutivas afetam a base interna e não podem ser anuladas nesta página.

## Resolução de problemas

**Falta um controlo.** Verifique a permissão separada para funções, alterações gerais ou ações Danger Zone.

**Um valor muda após guardar.** O servidor limita-o ao intervalo aceite. Leia o valor guardado.

**Uma confirmação permanece desativada.** Introduza a frase exata apresentada.

**Latest não confirma uma atualização.** Leia o erro da última verificação e resolva a ligação de saída do servidor antes de confiar no resultado.

## Guias relacionados

Leia [Verificações da configuração](/docs/setup-checks) para preparação e [Laboratório](/docs/laboratory) para os dados do laboratório emissor. Leia [Auditoria](/docs/audit) para as ações administrativas registadas.

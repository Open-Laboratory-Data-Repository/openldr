# Cartões e painéis laterais dos plugins

Alguns plugins instalados acrescentam um cartão ao painel ou um painel lateral. Use um painel lateral para manter o plugin visível ao mudar de página.

Só vê o cartão e o painel quando pode aceder ao plugin. As restrições por papel do plugin também se aplicam aqui.

Os administradores com acesso à gestão do mercado podem ocultar um cartão ou painel para todo o laboratório. A página do plugin e as outras funções permanecem ativas.

Use um plugin já instalado pela sua organização. As capturas usam o Reference Plugin opcional numa instalação de teste. A versão atual do exemplo acompanha o tema claro ou escuro da aplicação. Não são necessários dados clínicos de exemplo.

## Ler um cartão de plugin

Um plugin tem de declarar um cartão antes de este aparecer. O conteúdo vem do plugin.

### 1. Abrir Dashboard

Leia o cartão por baixo dos widgets. Os cartões aparecem fora do editor normal de widgets. Não pode movê-los nem redimensioná-los nesse editor.

![Um cartão declarado aparece por baixo dos widgets.](plugin-sites-guide-dashboard.png)

**Resultado esperado:** o exemplo indica Drawn in: widget. O seu plugin apresenta o respetivo conteúdo.

## Abrir um painel enquanto trabalha

Um painel só está disponível quando um plugin ativo o declara e tem acesso a esse plugin.

### 1. Abrir Side panels

Selecione **Side panels** junto do sino de notificações. O botão aparece apenas quando existe um painel disponível.

![Side panels aparece quando um plugin disponível declara um painel.](plugin-sites-guide-panel-button.png)

### 2. Escolher um painel

Selecione o título. O exemplo usa **Reference panel**.

![Escolher o painel pelo título.](plugin-sites-guide-panel-choice.png)

### 3. Ler o painel

O painel abre à direita. No computador, a página principal continua disponível ao lado.

![O painel lateral abre junto da página atual.](plugin-sites-guide-panel-open.png)

### 4. Mudar para outra página

Escolha outra página no menu principal. O painel permanece aberto com o conteúdo atual. O exemplo muda para Forms.

![O painel permanece aberto enquanto muda de página.](plugin-sites-guide-navigate.png)

### 5. Fechar o painel

Selecione **Close** no canto superior direito do painel.

![Close devolve o espaço à página principal.](plugin-sites-guide-close.png)

**Resultado esperado:** fechar devolve o espaço à página principal. Terminar sessão ou desativar o plugin ou o painel também o fecha.

## Ocultar um cartão ou painel

Estes interruptores aplicam-se a todo o laboratório. Cada alteração guarda imediatamente. Não existe uma ação Save separada.

### 1. Abrir Marketplace

Abra **Settings** e depois **Marketplace**.

![Abrir Settings e depois Marketplace.](plugin-sites-guide-marketplace.png)

### 2. Escolher Installed

Use o separador **Installed**.

![Escolher Installed para encontrar o plugin.](plugin-sites-guide-installed.png)

### 3. Abrir o plugin

Escolha o plugin instalado que fornece o cartão ou painel.

![Abrir o cartão do plugin instalado.](plugin-sites-guide-plugin.png)

### 4. Abrir as ações

Selecione os pontos nos detalhes do plugin.

![Abrir os pontos nos detalhes do plugin.](plugin-sites-guide-actions.png)

### 5. Escolher Places

Selecione **Places**. Esta ação aparece apenas quando o plugin declara um cartão ou painel.

![Places aparece apenas para um plugin que declara um cartão ou painel.](plugin-sites-guide-places.png)

### 6. Alterar Dashboard card

Desligue **Dashboard card** para ocultar o cartão. Ligue para o repor.

![Dashboard card guarda cada alteração imediatamente.](plugin-sites-guide-card-switch.png)

## Controlar o painel separadamente

Continue em Places. Cada interruptor controla o respetivo local. Não desativa o plugin inteiro.

### 1. Verificar o estado guardado

Um interruptor desligado significa que o cartão está oculto. Uma falha ao guardar apresenta um erro e mantém o estado anterior.

![O interruptor do cartão está agora desligado para todo o laboratório.](plugin-sites-guide-card-off.png)

### 2. Alterar Side panel separadamente

Desligue **Side panel** para ocultar o painel. Tem um interruptor separado.

![Side panel pode ser alterado separadamente.](plugin-sites-guide-panel-switch.png)

### 3. Verificar o resultado

Feche Places e regresse a Dashboard. O exemplo oculta os dois locais, mas Reference Plugin permanece no menu principal.

![Os locais desativados desaparecem e a página do plugin continua disponível.](plugin-sites-guide-hidden.png)

**Resultado esperado:** a página do plugin e as outras funções permanecem ativas. Cada alteração aparece em Audit como plugin.sites.update.

## Usar um painel num telemóvel

No telemóvel, o painel cobre a página principal por baixo do cabeçalho da aplicação.

### 1. Escolher o painel

Abra Side panels no cabeçalho e escolha o painel.

![Usar Side panels no cabeçalho no telemóvel.](plugin-sites-guide-phone-menu.png)

### 2. Ler o painel

Use o conteúdo do painel. A página por baixo fica coberta.

![No telemóvel, o painel cobre a página por baixo do cabeçalho.](plugin-sites-guide-phone-panel.png)

### 3. Regressar à página principal

Selecione **Close** no canto superior direito do painel.

![Fechar o painel para regressar à página principal.](plugin-sites-guide-phone-close.png)

**Resultado esperado:** as capturas verificam a disposição a 375 píxeis. Só um telemóvel real pode confirmar o acesso junto das barras retráteis do navegador.

## Consultar ou alterar locais pela linha de comandos

Leia [Começar aqui](/docs/start-here) para configurar a CLI. A partir de `openldr_ce`, use o identificador do plugin. `widget` designa Dashboard card e `panel` designa Side panel.

```shell
pnpm openldr market sites <plugin-id>
pnpm openldr market sites <plugin-id> widget off
pnpm openldr market sites <plugin-id> widget on
pnpm openldr market sites <plugin-id> panel off
pnpm openldr market sites <plugin-id> panel on
```

## Prática opcional com Reference Plugin

Use o seu plugin instalado para o trabalho normal. Numa instalação de teste a partir do código, o plugin de referência demonstra um cartão, um painel e uma página separada. A compilação exige Rust e o destino `wasm32-wasip1`.

A partir de `openldr_ce`, execute `pnpm build:ui-reference` e depois `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`. A instalação passa pela API em execução, por isso inicie-a e inicie sessão primeiro. Recarregue Studio. Dashboard mostra Reference card e Side panels oferece Reference panel. O plugin não declara assinatura do editor. Use-o apenas numa instalação de teste.

A captura indica Drawn in: widget ou Drawn in: panel conforme o local. A nota de teste é fictícia. Remova-o depois com `pnpm openldr plugin remove ui-reference`.

## Resolução de problemas

**Falta o botão Side panels.** Verifique que um plugin ativo e autorizado declara um painel e tem Side panel ligado.

**Falta a ação Places.** O plugin pode não declarar cartão ou painel. Places não acrescenta funções ao plugin.

**Falta o cartão.** Verifique Dashboard card em Places, o estado ativo do plugin e o acesso do seu papel.

**O exemplo de referência mantém as cores antigas.** Compile e reinstale o exemplo a partir da sua cópia atual e recarregue o Studio. Os pacotes instalados mantêm o HTML incluído no pacote.

## Guias relacionados

[Mercado](/docs/marketplace) explica a instalação e o estado dos plugins. [Painéis](/docs/dashboard) explica os widgets habituais.

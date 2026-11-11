# Cartões e painéis laterais de plugins

## Resultado

Alguns plugins mostram mais do que a sua própria página. Um plugin pode acrescentar um cartão ao painel inicial, um painel lateral que fica aberto quando muda de página, ou os dois. Um administrador pode desativar qualquer um deles.

## Cartões do painel

Os cartões dos plugins ficam numa linha própria, por baixo dos widgets do painel. Aparecem em todos os painéis. Não os pode mover nem redimensionar no editor do painel.

Cada cartão é a página do próprio plugin, em tamanho pequeno. O que mostra depende do plugin.

## Painéis laterais

1. Selecione o botão dos painéis no cabeçalho, ao lado do sino das notificações. Só aparece quando pelo menos um plugin oferece um painel.
2. Escolha um painel na lista.
3. O painel abre à direita. Continue a trabalhar na página ao lado. Se mudar de página, o painel fica aberto e mantém o conteúdo.
4. Selecione o botão de fechar no topo do painel para o fechar.

Num telemóvel, o painel ocupa todo o ecrã por baixo do cabeçalho. Feche-o para voltar a ver a página.

O painel fecha quando termina a sessão, e quando o plugin é desativado ou o painel é desligado.

## Quem os vê

Só vê o cartão e o painel de um plugin se puder ver o próprio plugin. Se um plugin for só para certas funções, as outras funções não veem nenhum dos dois.

## Para administradores: desligar um cartão ou um painel

1. Abra **Definições**, depois **Marketplace**, depois **Instalado**.
2. Abra o plugin.
3. Abra o menu ⋯ e escolha **Locais**. Este item só aparece para um plugin que tenha um cartão ou um painel.
4. Desligue **Cartão do painel** ou **Painel lateral**. Cada interruptor guarda assim que o muda.

Esta definição vale para todo o laboratório. Esconde o cartão ou o painel para todos. A página do plugin, a sua entrada na barra lateral e o resto do seu trabalho continuam. Para parar o plugin inteiro, use **Desativar** no mesmo menu.

O registo de auditoria guarda cada alteração como `plugin.sites.update`.

Na linha de comandos:

```bash
openldr market sites <plugin-id>
```

```bash
openldr market sites <plugin-id> widget off
```

O primeiro comando lista o cartão e o painel do plugin e diz se cada um está ligado. O segundo muda um deles. Use `widget` ou `panel`, e `on` ou `off`.

## Experimentar com o plugin de teste

O repositório tem um plugin de referência com um cartão e um painel. Use-o numa instalação de teste, a partir de uma cópia do código-fonte. Para o construir são precisos o Rust e o destino `wasm32-wasip1`. Veja **Construir plugins** na página Desenvolvimento do site.

1. Na pasta do repositório, execute `pnpm build:ui-reference`. O comando constrói o plugin test-sink e coloca `plugin.wasm` e `manifest.json` em `reference-plugins/ui-reference/`.
2. Execute `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`.
3. Volte a carregar o estúdio.
4. Abra **Painel**. Um cartão chamado **Reference card** aparece por baixo dos widgets.
5. Selecione **Painéis laterais**, o botão dos painéis ao lado do sino das notificações, e escolha **Reference panel**.

**Resultado esperado:** o cartão mostra **Drawn in: widget** e o painel mostra **Drawn in: panel**. A barra lateral tem também uma entrada **Reference Plugin**, que abre a página do plugin.

O plugin de referência não indica nenhum editor, por isso instala-se sem assinatura. A página dele usa texto escuro, difícil de ler no tema escuro. Para o remover, execute `pnpm openldr plugin remove ui-reference`.

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

# As suas preferências

O seu tema, o estado da barra lateral, a sua página inicial e o seu idioma ficam guardados na sua conta. Acompanham-no em qualquer navegador, computador ou telemóvel onde inicie sessão.

Leva cerca de 5 minutos. Selecione uma imagem ou um clip para o ampliar.

## Quem pode fazer o quê

Todos. As preferências pertencem a cada utilizador. Não são uma definição do laboratório, e não é preciso nenhuma função nem capacidade para mudar as suas.

## O que fica guardado

| Preferência | Como a mudar |
| --- | --- |
| Tema | O botão de sol ou lua no cabeçalho, ou a tecla `d`. |
| Barra lateral aberta ou recolhida | O botão de recolher no topo da barra lateral (só no computador). |
| Página inicial | Abra o menu do utilizador no fundo da barra lateral, escolha **Página inicial** e uma página. |
| Idioma | Abra o menu do utilizador no fundo da barra lateral, escolha **Idioma** e um idioma. |

Cada alteração fica guardada logo. Não há botão Guardar.

## Exemplo 1: abrir em Relatórios depois de iniciar sessão

![Abrir o menu do utilizador, apontar para Página inicial e escolher Relatórios.](user-preferences-start-page.mp4)

1. Selecione o seu nome no fundo da barra lateral. Abre-se o menu do utilizador: **Idioma**, **Página inicial**, **Definições**, **Terminar sessão**.
2. Aponte para **Página inicial**. A lista mostra as páginas da sua barra lateral.
3. Selecione **Relatórios**. Uma mensagem diz **Relatórios abre primeiro depois de iniciar sessão.**
4. Abra o OpenLDR no endereço principal, ou termine e volte a iniciar sessão.

**Resultado esperado:** abre **Relatórios**, e não o painel.

![O OpenLDR a abrir em Relatórios.](user-preferences-reports-first.png)

Como funciona a página inicial:

- É o painel, a não ser que escolha outra. Escolha **Painel** para voltar à predefinição.
- A lista só mostra as páginas da sua barra lateral. A sua função decide quais são.
- Abre uma vez, ao iniciar sessão ou no endereço principal do OpenLDR. Depois, a ligação **Painel** abre sempre o painel.
- Uma ligação para uma página concreta abre sempre essa página.
- Se a sua função mudar e já não puder abrir a página inicial, abre o painel.

## Exemplo 2: passar ao tema claro

![Selecionar o botão de sol no cabeçalho.](user-preferences-theme.mp4)

1. Selecione o botão de sol no canto superior direito, ou carregue em `d` fora de uma caixa de texto.

**Resultado esperado:** o studio fica claro, e continua claro no próximo início de sessão e nos outros dispositivos. Carregue em `d` outra vez para voltar.

![O studio no tema claro.](user-preferences-light.png)

## Exemplo 3: trabalhar em francês

![Abrir o menu do utilizador, apontar para Idioma e escolher Français.](user-preferences-language.mp4)

1. Abra o menu do utilizador e aponte para **Idioma**.
2. Selecione **Français**.

**Resultado esperado:** os menus e as páginas passam logo a francês. A barra lateral mostra **Tableau de bord**, **Rapports** e assim por diante. Escolha **English** ou **Português** da mesma forma.

![O studio em francês.](user-preferences-french.png)

A documentação integrada também segue o seu idioma, quando existe tradução.

## Num dispositivo novo

No primeiro início de sessão num navegador novo, o OpenLDR carrega as preferências guardadas e aplica-as. Se nunca guardou um tema, o tema desse navegador passa a ser o seu tema guardado.

O idioma funciona da mesma forma, com uma diferença. Um idioma já escolhido nesse navegador passa a ser o seu idioma guardado. Um navegador onde nunca escolheu um mostra inglês, e isso não fica guardado, por isso não pode substituir o idioma escolhido noutro dispositivo.

## Na linha de comandos

Um administrador pode ler ou corrigir as preferências de um utilizador:

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

As chaves são `theme` (`light` ou `dark`), `sidebarCollapsed` (`true` ou `false`), `startPage` (um caminho de página como `/reports`) e `language` (`en`, `fr` ou `pt`). O valor `none` limpa uma chave. O id do utilizador vem de `openldr user list`.

## Num telemóvel

O menu do utilizador, o botão do tema e o idioma funcionam da mesma forma num telemóvel. A barra lateral não tem lá botão de recolher: abre-se pelo botão de menu no canto superior esquerdo.

## Resolução de problemas

- **A página inicial não abre.** Só abre no endereço principal ou depois de iniciar sessão. Um favorito para outra página abre essa página.
- **Não foi possível guardar a página inicial.** Verifique a ligação e escolha-a outra vez.
- **Outro dispositivo mostra outro tema.** Tinha um tema antes de guardar algum. Mude o tema uma vez em qualquer dispositivo e fica guardado para todos.
- **Um colega fica preso numa página que já não pode abrir.** Abre o painel em vez dela. Para limpar: `openldr user preferences set <user-id> startPage none`.

## Guias relacionados

- [Comece aqui](/docs/start-here)
- [Utilizadores e funções](/docs/users)

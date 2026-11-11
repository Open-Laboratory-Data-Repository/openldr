# As suas preferências

## Resultado

O seu tema, o estado da barra lateral, a sua página inicial e o seu idioma ficam guardados na sua conta. Acompanham-no em qualquer navegador, computador ou telemóvel onde iniciar sessão.

## O que é guardado

| Preferência | Como alterar |
| --- | --- |
| Tema | Use o botão do sol ou da lua no cabeçalho da página, ou prima `d`. |
| Barra lateral aberta ou recolhida | Use o botão de recolher no topo da barra lateral (só no computador). |
| Página inicial | Abra o menu do utilizador no fundo da barra lateral, escolha **Página inicial** e depois uma página. |
| Idioma | Abra o menu do utilizador no fundo da barra lateral, escolha **Idioma**, e escolha um idioma. |

Cada alteração é guardada no momento em que a faz. Não há botão Guardar.

## Página inicial

A página inicial é a página que abre depois de iniciar sessão. É o Painel, a menos que escolha outra.

- A lista mostra só as páginas da sua barra lateral. O seu papel decide quais são.
- A página inicial abre uma vez, quando inicia sessão ou abre o OpenLDR no endereço principal. Depois disso, a ligação **Painel** abre sempre o Painel.
- Uma ligação para uma página específica continua a abrir essa página.
- Se o seu papel mudar e deixar de poder abrir a sua página inicial, abre o Painel.
- Escolha **Painel** para voltar à predefinição.

## Num dispositivo novo

Na primeira vez que inicia sessão num navegador novo, o OpenLDR carrega as suas preferências guardadas e aplica-as. Se nunca guardou um tema, o tema que esse navegador mostra passa a ser o seu tema guardado.

O idioma funciona da mesma forma, com uma diferença. Um idioma que já tinha escolhido nesse navegador passa a ser o seu idioma guardado. Um navegador onde nunca escolheu nenhum mostra inglês, e essa predefinição não é guardada, por isso não pode substituir o idioma que escolheu noutro dispositivo.

## Para administradores

As preferências pertencem a cada utilizador. Não são uma definição do laboratório, e não é preciso nenhum papel nem capacidade para as usar. Um administrador pode ler ou corrigir as preferências de um utilizador na linha de comandos:

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

As chaves são `theme` (`light` ou `dark`), `sidebarCollapsed` (`true` ou `false`), `startPage` (um caminho de página como `/reports`) e `language` (`en`, `fr` ou `pt`). O valor `none` limpa uma chave. Obtenha o identificador do utilizador com `openldr user list`.

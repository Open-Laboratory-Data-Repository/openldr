# Primeiros passos

O OpenLDR recebe dados de laboratório e disponibiliza-os para painéis e relatórios. É gratuito. Todos os níveis incluem as mesmas funções da aplicação. Escolha o percurso adequado ao que precisa de fazer.

## Começar pela aplicação de ambiente de trabalho

Escolha a aplicação de ambiente de trabalho para executar o OpenLDR num só computador. Inclui a sua própria base de dados e não precisa de contentores Docker. Existem pacotes para Linux x64, Windows x64 e macOS em Apple silicon.

1. Siga o [guia da aplicação de ambiente de trabalho](/docs/desktop-app) para o seu sistema.
2. Abra o OpenLDR no menu de aplicações do computador.
3. Crie o primeiro administrador e siga os passos do primeiro arranque no Studio. Os dados de exemplo são opcionais.
4. Continue em [Usar o Studio](/docs/using-studio) para encontrar os guias do trabalho diário.

O instalador precisa atualmente de um comando de terminal. O guia da aplicação apresenta o comando para o seu sistema. Depois da instalação, use o OpenLDR na sua própria janela.

## Usar a instalação do seu laboratório

Se o seu laboratório já usa o OpenLDR, peça ao administrador o endereço do Studio e a sua conta. Abra esse endereço num navegador no computador ou no telemóvel.

Não precisa de outra instalação. [Usar o Studio](/docs/using-studio) explica onde encontrar os guias depois de iniciar sessão.

## Administrar um servidor partilhado

Este percurso destina-se a quem instala e mantém o OpenLDR para outras pessoas. Os utilizadores abrem o Studio num navegador. O servidor usa contentores Docker.

Comece pelos [requisitos do servidor](/docs/requirements) e siga [Instalar](/docs/install). No Windows Server, prepare primeiro o ambiente Linux descrito em [Windows Server](/docs/windows-server).

Para manutenção, use [Atualizações planeadas](/docs/upgrading), [Variáveis de ambiente](/docs/environment) e [Fornecedores de autenticação](/docs/auth-providers). As instruções detalhadas de terminal continuam nesses guias.

## Usar a linha de comandos ou alterar o código

Use estes guias para automatizar tarefas, executar comandos de administração ou desenvolver o OpenLDR:

- [Início de sessão na CLI e chaves de acesso](/docs/cli-access) explica o acesso para pessoas e scripts.
- [Interface de linha de comandos](/docs/cli) lista os comandos e as tarefas de administração.
- [Executar sem Docker](/docs/standalone) permite compilar e executar o lançador autónomo a partir das fontes.
- [Desenvolvimento](/docs/development) prepara um ambiente de desenvolvimento separado.

## Estado do nível Enterprise

O Enterprise baseia-se em Servidor, com uma instalação prevista para várias máquinas, distribuição de carga e cópias de segurança redundantes. Continua em desenvolvimento e teste. Ainda não existe um instalador Enterprise. Use a [instalação Servidor](/docs/install) para a instalação partilhada disponível.

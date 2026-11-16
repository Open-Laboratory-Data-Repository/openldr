# Primeiros passos

Instale o OpenLDR num computador controlado pela sua organização. Use a aplicação de ambiente de trabalho ou abra o Studio num navegador. O OpenLDR recebe dados de laboratório, converte-os para FHIR R4, um formato padrão para dados de saúde, e disponibiliza-os para painéis e relatórios.

Estes guias web tratam da instalação, configuração do servidor e resolução de problemas. Os guias dentro do Studio explicam como usar a aplicação. Pode usar os seus próprios dados. Os dados de exemplo são opcionais.

## Escolher onde executar o OpenLDR

Escolha o computador que vai guardar os dados e executar o OpenLDR. Deve ficar ligado enquanto as pessoas usam o Studio. Um telemóvel ou outro computador que abre o Studio num navegador não precisa de uma instalação própria.

O OpenLDR é gratuito em todos os níveis. Os níveis descrevem como executar o software.

| Nível | Como funciona | Por onde começar |
| --- | --- | --- |
| Autónomo | Um computador, com PostgreSQL incluído e ficheiros numa pasta local. Sem contentores Docker. | A [aplicação de ambiente de trabalho](/docs/desktop-app) instala-se em Linux x64, Windows x64 ou macOS em Apple silicon. Os programadores podem [compilar o lançador autónomo](/docs/standalone) a partir do código-fonte. |
| Servidor | Um servidor partilhado com contentores Docker, PostgreSQL e armazenamento de ficheiros compatível com S3. As contas locais são a predefinição; Keycloak é opcional. | Leia os [requisitos do servidor](/docs/requirements) e siga [Instalar](/docs/install). No Windows Server, prepare primeiro o ambiente Linux descrito em [Windows Server](/docs/windows-server). |
| Enterprise | Uma instalação baseada em Servidor, prevista para várias máquinas, distribuição de carga e cópias de segurança redundantes. | Ainda em desenvolvimento e teste. Ainda não existe um instalador Enterprise. Use a [instalação Servidor](/docs/install) para a instalação partilhada disponível. |

O [desenvolvimento a partir do código-fonte](/docs/development) usa comandos do projeto. Para uma instalação Servidor existente, siga [Atualizações planeadas](/docs/upgrading). Para uma aplicação de ambiente de trabalho existente, siga os passos de atualização em [Aplicação de ambiente de trabalho](/docs/desktop-app).

## Instalar e verificar o resultado

Siga o guia do nível escolhido.

1. Para Autónomo, instale e abra a [aplicação de ambiente de trabalho](/docs/desktop-app). Inicia a base de dados e o servidor, depois mostra o Studio na sua janela.
2. Para Servidor, siga [Instalar](/docs/install). O instalador cria a configuração, gera palavras-passe e inicia os contentores.
3. Guarde a pasta de dados e siga as instruções de cópia de segurança do seu guia.

A ilustração abaixo mostra o **instalador Servidor**. Não descreve o arranque da aplicação de ambiente de trabalho.

![Ilustração da saída do instalador. As linhas destacadas mostram o endereço do servidor e o código de configuração. O código é um marcador de posição.](guide:install-result)

**Resultado esperado:** A aplicação de ambiente de trabalho mostra o Studio. O instalador Servidor apresenta **OpenLDR is ready** e o endereço a abrir. Se apresentar **OpenLDR is starting**, consulte `docker compose ps` e `docker compose logs` na pasta de instalação antes de continuar.

A aplicação de ambiente de trabalho abre apenas no seu computador por predefinição. Para uma instalação Servidor partilhada, configure um nome de anfitrião com [Instalar](/docs/install). Noutro dispositivo, `localhost` refere-se a esse dispositivo.

## Primeiro início de sessão

A aplicação de ambiente de trabalho preenche o código de configuração para um OpenLDR que inicia por si. Escolha o nome e a palavra-passe do primeiro administrador e siga os passos do primeiro arranque do Studio. [Aplicação de ambiente de trabalho](/docs/desktop-app) explica o que fazer se o campo do código estiver vazio.

Para Servidor ou o lançador autónomo compilado a partir das fontes, introduza o código apresentado no terminal. É válido durante 30 minutos. [Instalar](/docs/install) mostra cada ecrã de criação do administrador. Uma instalação Servidor com Keycloak usa as credenciais App sign-in geradas.

## Continuar na aplicação

Abra **Documentação** no menu principal do Studio e leia **Comece aqui**. Esse guia explica a CLI instalada e a de desenvolvimento e aponta para os guias ilustrados.

As unidades de saúde, o catálogo de testes e as definições de pacientes são opcionais. O OpenLDR pode receber e processar dados antes de os configurar. Recomendamos que os configure durante a utilização do sistema. Os guias da aplicação **Configurar o seu sistema** começam por Terminologia.

Use os guias dos painéis e relatórios no trabalho diário. Funcionam com os seus próprios dados; os ficheiros de prática são opcionais.

## Escolher a próxima tarefa

- [Carregar e enviar dados](/docs/load-data): importe os primeiros dados de laboratório.
- [Interface de linha de comandos](/docs/cli): execute comandos no anfitrião OpenLDR.
- [Fornecedores de autenticação](/docs/auth-providers): configure quem pode iniciar sessão.
- [Variáveis de ambiente](/docs/environment): altere a configuração do servidor.
- [Atualizações planeadas](/docs/upgrading): prepare uma cópia de segurança e passe a uma nova versão.

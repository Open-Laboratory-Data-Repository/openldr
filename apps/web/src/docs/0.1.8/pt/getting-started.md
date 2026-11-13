# Primeiros passos

Instale o OpenLDR num computador controlado pela sua organização e abra o Studio num navegador. O OpenLDR recebe dados de laboratório, converte-os para FHIR R4, um formato padrão para dados de saúde, e disponibiliza-os para painéis e relatórios.

Estes guias web tratam da instalação, configuração do servidor e resolução de problemas. Os guias dentro do Studio explicam como usar a aplicação. Pode usar os seus próprios dados. Os dados de exemplo são opcionais.

## Escolher onde executar o OpenLDR

Escolha o computador que vai guardar os dados e executar o OpenLDR. Deve ficar ligado enquanto as pessoas usam o Studio. Um portátil ou telemóvel que abre o Studio num navegador não precisa de uma instalação própria.

| O seu anfitrião | Por onde começar |
| --- | --- |
| Linux, macOS ou Windows 10/11 | Leia os [Requisitos](/docs/requirements) e siga [Instalar](/docs/install). |
| Windows Server | Siga [Windows Server](/docs/windows-server) para preparar um ambiente Linux e instale aí o OpenLDR. |
| Código-fonte para desenvolvimento | Siga [Desenvolvimento](/docs/development). Este método usa os comandos do projeto em vez da CLI instalada. |
| Instalação OpenLDR existente | Siga [Atualizações planeadas](/docs/upgrading). Não precisa de uma nova instalação. |

O OpenLDR existe em três níveis. O servidor OpenLDR é o mesmo em todos. Só mudam a base de dados, o armazenamento dos ficheiros e o início de sessão.

| Nível | Base de dados | Ficheiros armazenados | Início de sessão | Por onde começar |
| --- | --- | --- | --- | --- |
| Autónomo | Postgres 16, incluído no OpenLDR | Uma pasta no disco | As contas do próprio OpenLDR | [Executar sem Docker](/docs/standalone). Um só computador, sem Docker. Só o Linux foi testado. |
| Servidor | Postgres em Docker | Armazenamento Garage em Docker | As contas do próprio OpenLDR por predefinição, Keycloak se o escolher | Os [Requisitos](/docs/requirements) e depois [Instalar](/docs/install). |
| Grande escala | Várias bases de dados | Ainda não decidido | Keycloak ou o início de sessão de um ministério | Previsto. Este nível ainda não tem instalação própria. |

## Instalar e verificar o resultado

O instalador cria a configuração, gera palavras-passe e inicia os serviços. Execute-o no anfitrião escolhido.

1. Abra o guia adequado ao seu anfitrião acima. Verifique os requisitos antes de executar comandos.
2. Siga os passos de instalação desse guia. Aguarde até os serviços estarem prontos.
3. Guarde o endereço e o código **Setup code** apresentados no final. O código de configuração é válido durante 30 minutos.

![Ilustração da saída do instalador. As linhas destacadas mostram o endereço e o código de configuração. O código é um marcador de posição.](guide:install-result)

**Resultado esperado:** O instalador apresenta **OpenLDR is ready** e o endereço a abrir. Se apresentar **OpenLDR is starting**, alguns serviços ainda não estão prontos. Consulte `docker compose ps` e `docker compose logs` na pasta de instalação antes de continuar.

O endereço ilustrado é o predefinido numa instalação local. Para aceder a partir de outros computadores, configure um nome de anfitrião com [Instalar](/docs/install). Noutro computador, `localhost` refere-se a esse computador, não ao anfitrião OpenLDR.

## Primeiro início de sessão

Siga os percursos ilustrados em [Instalar](/docs/install). Uma instalação local nova usa o código de configuração para criar o primeiro administrador. Keycloak usa as credenciais App sign-in geradas. Cada percurso apresenta uma captura em cada passo.

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

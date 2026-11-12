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

## Instalar e verificar o resultado

O instalador cria a configuração, gera palavras-passe e inicia os serviços. Execute-o no anfitrião escolhido.

1. Abra o guia adequado ao seu anfitrião acima. Verifique os requisitos antes de executar comandos.
2. Siga os passos de instalação desse guia. Aguarde até os serviços estarem prontos.
3. Guarde o endereço e as credenciais **App sign-in** apresentados no final. A palavra-passe de administrador do Keycloak serve separadamente para gerir a autenticação.

![Ilustração da saída do instalador. As linhas destacadas mostram o endereço e as credenciais App sign-in. As palavras-passe são marcadores de posição.](guide:install-result)

**Resultado esperado:** O instalador apresenta **OpenLDR is ready** e o endereço a abrir. Se apresentar **OpenLDR is starting**, alguns serviços ainda não estão prontos. Consulte `docker compose ps` e `docker compose logs` na pasta de instalação antes de continuar.

O endereço ilustrado é o predefinido numa instalação local. Para aceder a partir de outros computadores, configure um nome de anfitrião com [Instalar](/docs/install). Noutro computador, `localhost` refere-se a esse computador, não ao anfitrião OpenLDR.

## Iniciar sessão no Studio

Use as credenciais da aplicação para entrar no Studio pela primeira vez.

1. Abra o endereço apresentado pelo instalador. Numa instalação remota, use o nome de anfitrião configurado.
2. Inicie sessão como `labadmin`, com a palavra-passe gerada na linha **App sign-in**.
3. Altere a palavra-passe inicial quando lhe for pedido.

**Resultado esperado:** O Studio abre. Uma nova instalação inclui um painel de exemplo, salvo se escolheu a opção sem dados iniciais. Numa atualização, os dados e as permissões existentes determinam o que aparece.

A instalação local predefinida usa um certificado autoassinado. É esperado um aviso do navegador neste caso. Confirme que abriu o endereço da sua própria instalação antes de o aceitar. Consulte [Instalar](/docs/install) para obter um certificado reconhecido pelos navegadores.

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

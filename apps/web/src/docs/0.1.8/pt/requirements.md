# Requisitos

Verifique o computador que vai alojar o OpenLDR antes de executar o instalador. Outros computadores e telemóveis abrem o Studio num navegador. Não precisam de Docker nem da CLI OpenLDR.

Esta página trata da instalação com as imagens fornecidas. O [desenvolvimento a partir do código-fonte](/docs/development) tem requisitos próprios. Os dados de exemplo são opcionais.

## Escolher um anfitrião compatível

O OpenLDR usa **contentores Linux**. Docker configurado para contentores Windows não basta.

A construção predefinida destina-se a **Linux AMD64**, para processadores Intel e AMD de 64 bits. A imagem publicada `openldr-api:latest` contém atualmente `linux/amd64` sem imagem ARM64 nativa. O suporte de Docker num computador ARM não prova compatibilidade das imagens OpenLDR. Apple Silicon e outros anfitriões ARM precisam de uma verificação separada antes de serem escolhidos para esta instalação.

| Anfitrião | Preparação |
| --- | --- |
| Linux em Intel/AMD de 64 bits | [Docker Engine](https://docs.docker.com/engine/install/) e o plugin Compose numa distribuição Linux suportada. |
| Windows cliente em Intel/AMD de 64 bits | [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) numa versão do Windows atualmente suportada pelo Docker. Use os contentores Linux e ative a virtualização de hardware. |
| Mac Intel | [Docker Desktop para Mac](https://docs.docker.com/desktop/setup/install/mac-install/) numa versão de macOS suportada. |
| Windows Server | Docker Engine dentro de um ambiente Linux. O [guia Windows Server](/docs/windows-server) cobre WSL2 no Server 2022/2025 atualizado e uma VM Linux Hyper-V. Docker Desktop não é suportado no Windows Server. |

A Microsoft documenta o [WSL no Server 2022 e 2025](https://learn.microsoft.com/en-us/windows/wsl/install-on-server). Para versões anteriores, use a VM Linux do nosso guia em vez de assumir que WSL significa WSL2.

## Preparar o software e os acessos

| Item | Requisito |
| --- | --- |
| Docker | Docker Engine ou Docker Desktop com manutenção atual. O serviço deve estar a funcionar e acessível à conta que executa o instalador. |
| Compose | O comando `docker compose` deve funcionar. O comando antigo `docker-compose`, sozinho, não satisfaz o instalador. |
| Terminal Linux/macOS | Um interpretador de comandos e `curl` para descarregar e executar o instalador. |
| Terminal Windows | Windows PowerShell 5.1 ou posterior para descarregar e executar o instalador PowerShell. |
| Pasta de instalação | A conta deve poder criar a pasta escolhida e escrever nela. Docker Desktop deve poder partilhá-la com a VM Linux. |
| Geração de certificado | OpenSSL local é opcional. Sem ele, o instalador tenta gerar o certificado num contentor Docker auxiliar. Também pode fornecer o seu próprio certificado. |

A instalação normal inclui PostgreSQL, armazenamento de ficheiros e o serviço de início de sessão. **Não precisa** de instalar Node.js, pnpm, Git, PostgreSQL ou SQL Server separadamente no anfitrião. Uma base analítica externa só é necessária se escolher essa opção de instalação.

## Planear processador, memória e armazenamento

Os valores são **orientação para planeamento, não um mínimo medido nem capacidade garantida**. O [guia de VM Windows Server](/docs/windows-server) começa com **4 processadores virtuais, 8 GB de RAM e 100 GB de disco** para uma nova VM Linux.

Importações, terminologias, utilizadores simultâneos, relatórios e ficheiros guardados podem precisar de mais recursos.

- Atribua recursos ao anfitrião Linux Docker para toda a instalação, não só para a API. Reserve recursos para o sistema operativo anfitrião.
- Com Docker Desktop, verifique os limites da VM Linux, não apenas a RAM instalada. O Docker documenta as [definições de recursos da VM](https://docs.docker.com/desktop/settings-and-maintenance/settings/#vm-resources). WSL2 tem limites próprios.
- Reserve espaço para imagens, dados PostgreSQL, ficheiros, registos, cópias de segurança e crescimento. Contentores de bases opcionais têm necessidades próprias.
- Os volumes Docker guardam a base e os ficheiros. Espaço livre junto ao instalador não prova espaço suficiente no disco Docker ou no disco da VM.

Docker Desktop tem requisitos próprios. Por exemplo, os requisitos Windows atuais incluem 8 GB de RAM do sistema. Esse valor não mede a capacidade de trabalho do OpenLDR.

## Preparar o acesso à rede

Para o instalador normal, permita descarregamentos HTTPS de saída do GitHub e do GitHub Container Registry, incluindo os redirecionamentos das imagens. O contentor SQL Server de avaliação também usa o registo da Microsoft. Configure o proxy necessário tanto no terminal como no Docker.

| Modo de acesso | Necessário |
| --- | --- |
| Apenas no anfitrião | `https://localhost` e o certificado autoassinado gerado. Não é necessário domínio público. |
| Rede privada ou Tailscale | Um nome ou endereço IP acessível aos outros dispositivos. Configure-o durante a instalação para os redirecionamentos de início de sessão. Os dispositivos devem alcançar a porta HTTPS escolhida. |
| Domínio público com Let's Encrypt | Um domínio apontado ao anfitrião, entrada TCP 80 e 443 e a configuração Linux do certificado descrita em [Instalar](/docs/install). |

A porta de entrada usa as portas do anfitrião **80 e 443 por omissão**. Devem estar livres, ou deve escolher outras antes de instalar. PostgreSQL, armazenamento e Keycloak comunicam na rede Docker. A instalação predefinida não exige abrir as portas internas aos utilizadores.

## Verificar o anfitrião antes de instalar

Estas verificações não alteram dados. Abra Terminal no Linux/macOS ou PowerShell no Windows. Execute-as no computador que aloja o Docker.

O texto azul terminado em `$` ou `>` é o **prompt**. O terminal mostra-o; não o escreva. Escreva o comando a seguir e prima **Enter**. As linhas mais discretas abaixo são o **resultado** do programa; leia-as sem as escrever. Por exemplo, `docker --version` é um comando e `Docker version 29.5.2, build 79eb04c` é a resposta. Os blocos para copiar contêm apenas comandos. Os nomes, caminhos e versões podem ser diferentes. Algumas ilustrações mostram comandos sem o resultado; espere que cada comando termine antes do seguinte.

### 1. Verificar o sistema e o processador dos contentores

```
docker info --format '{{.OSType}}/{{.Architecture}}'
```

Para as imagens AMD64 fornecidas, espere `linux/x86_64` ou `linux/amd64`. Se indicar contentores Windows, mude para contentores Linux. Se não ligar, inicie o serviço e verifique o acesso Docker da conta atual. Se indicar ARM, resolva a compatibilidade das imagens antes de continuar.

![Ilustração da verificação do motor. O exemplo mostra Linux num anfitrião Intel/AMD de 64 bits.](guide:install-runtime)

### 2. Verificar o Compose

```
docker compose version
```

Deve aparecer uma versão sem erro. Pode ser diferente da ilustração. Se faltar o comando, instale o plugin Compose ou atualize o Docker Desktop.

![Ilustração da verificação de Compose. A sua versão pode ser diferente.](guide:install-compose)

### 3. Rever o armazenamento Docker e o espaço livre

```
docker system df
```

Isto mostra **espaço já usado pelo Docker**, não espaço livre. Verifique também o espaço livre na unidade que guarda os dados Docker. Com Docker Desktop, verifique a alocação do disco da VM e o espaço livre na unidade anfitriã.

![Ilustração do comando para consultar o uso de armazenamento Docker. Não mede espaço livre.](guide:install-storage)

**Resultado esperado:** Docker responde em modo Linux, o processador corresponde à imagem e Compose funciona. Verificou os limites de recursos, o espaço livre e a rede. Continue para [Instalar](/docs/install).

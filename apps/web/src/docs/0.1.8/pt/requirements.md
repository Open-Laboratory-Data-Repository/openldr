# Requisitos

O OpenLDR é distribuído como um conjunto de imagens de contentor **Linux** e funciona em
qualquer sistema com Docker e o plugin Compose.

## Software

- **Docker** 24+ com o plugin Compose (`docker compose`), na versão 2.20 ou posterior. O instalador para com um Compose mais antigo. Verifique o seu com `docker compose version`.
- **OpenSSL** (para o certificado autoassinado que o instalador gera). Vem instalado por
  omissão no Linux e no macOS.
- **curl** (Linux/macOS) ou PowerShell 5+ (Windows) para executar o instalador de uma linha.

## Hardware

- **4 GB de RAM** livres (8 GB recomendados depois de carregar terminologias e painéis).
- **~5 GB de disco** para imagens e volumes. Reserve **20 GB+** para um laboratório em
  funcionamento, com terminologias, ficheiros carregados e dados analíticos.
- No mínimo 2 núcleos de CPU.

## Plataformas

- **Linux**: o alvo principal. Qualquer distribuição recente com Docker Engine.
- **macOS**: através do Docker Desktop.
- **Windows**: Windows 10/11 com Docker Desktop, ou **Windows Server através do WSL2**.

> **Windows Server:** o Docker Desktop **não** é suportado no Windows Server, e o motor
> Docker nativo só executa contentores Windows. O caminho suportado é o **Docker CE
> dentro de uma distribuição Ubuntu no WSL2**, que exige o Windows Server **2022 (com todas
> as atualizações)** ou **2025**. O Server 2019 não consegue executar o WSL2 atual. Consulte
> [Windows Server (WSL2)](/docs/windows-server) para o procedimento completo.

## Rede

- Um **nome de domínio** público que aponte para o anfitrião, e as portas de entrada **TCP 80
  e 443** abertas, se quiser um certificado reconhecido (Let's Encrypt). Sem isto, o
  instalador usa um certificado autoassinado, o que serve para uma instalação local ou de
  laboratório.

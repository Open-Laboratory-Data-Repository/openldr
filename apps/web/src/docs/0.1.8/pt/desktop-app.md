# Aplicação de computador

A aplicação de computador do OpenLDR executa o OpenLDR num único computador, na sua própria janela. Não precisa de Docker nem de terminal. A aplicação inicia a base de dados Postgres incluída e o servidor OpenLDR, mostra o Studio, e para os dois quando sai. Usa o mesmo lançador que [Executar sem Docker](/docs/standalone), com a mesma pasta de dados.

Existem pacotes para Linux x64, macOS em Apple silicon e Windows x64. Só o Linux foi experimentado. Os pacotes para Windows e macOS são novos. São construídos em Linux, e ainda ninguém os executou em Windows ou macOS.

## Instalar

O instalador procura a versão mais recente do OpenLDR com um pacote para o seu sistema. Descarrega o pacote, verifica-o com o ficheiro `SHA256SUMS` da versão, e coloca a aplicação nas suas próprias pastas. Precisa de 2 GB livres no disco. Cada pacote tem cerca de 500 a 600 MB, porque o Studio inclui as imagens dos seus guias integrados. Numa ligação lenta, o descarregamento demora alguns minutos.

### Linux e macOS

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash
```

Para instalar uma versão concreta, acrescente-a no fim: `| bash -s -- --version 0.1.12`.

### Windows

Execute isto no PowerShell. Não precisa de direitos de administrador.

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1 | iex
```

`irm | iex` não passa opções. Para instalar uma versão concreta, use antes esta forma:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Version 0.1.12
```

O instalador coloca a aplicação aqui:

| Sistema | A aplicação | Como a abrir |
| --- | --- | --- |
| Linux | `~/.local/share/openldr-desktop` | **OpenLDR** no menu de aplicações |
| macOS | `~/Applications/OpenLDR.app` | Launchpad, ou abra-a no Finder |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR` | **OpenLDR** no menu Iniciar |

### A palavra-passe de administrador no Linux

A aplicação mostra o Studio numa área protegida, que mantém as páginas web afastadas do resto do computador. No Ubuntu 24.04 e versões seguintes, o sistema não deixa uma aplicação iniciar essa área protegida sem um perfil AppArmor. O AppArmor é a parte do Linux que limita o que cada programa pode fazer. Nesse caso, o instalador instala um pequeno perfil com `sudo` e pede a palavra-passe de administrador uma vez. Avisa antes de pedir:

```text
→ This system does not let an app start its sandbox without an AppArmor profile.
→ This script will install a small profile for OpenLDR at /etc/apparmor.d/openldr-desktop-1000 with sudo, which asks for the administrator password once.
```

O número no fim do nome do ficheiro é o seu número de utilizador. Se recusar, nada é instalado, e o instalador termina com `✗ The sandbox profile was not installed, so OpenLDR was not installed.` A aplicação instalada não pode funcionar com a área protegida desligada.

Num sistema sem esta regra, o instalador não pede nada. A regra está ativa quando `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` contém `1`. Uma atualização só volta a pedir a palavra-passe quando o perfil tem de mudar.

### A aplicação não está assinada

O macOS e o Windows podem verificar quem fez um programa antes de o abrir. A aplicação OpenLDR não tem a assinatura de nenhum editor nesses dois sistemas. Ainda ninguém a abriu em macOS ou Windows, por isso esta página não diz o que mostram.

No macOS, o instalador assina a aplicação no seu Mac com `codesign`, com uma assinatura que não nomeia nenhum editor. Não está provado que o macOS a abra depois.

## O primeiro arranque

1. Abra a aplicação. A janela mostra **A iniciar o OpenLDR** enquanto a base de dados e o servidor arrancam.
2. O Studio mostra **Criar o administrador**. A aplicação preenche **Código de configuração**, e a indicação por baixo do campo diz **Preenchido pela aplicação OpenLDR.**
3. Escolha um nome de utilizador e uma palavra-passe, e selecione **Criar o administrador**.
4. Seguem-se três passos. Dê nome ao laboratório, carregue dados de exemplo, e veja que verificações ainda precisam de si. Pode saltar os dois primeiros.

O guia do Studio, **Primeiro arranque**, descreve os três passos. Os dados de exemplo só são oferecidos enquanto a instalação não tiver dados de laboratório. Se os saltar, Definições, Verificações de instalação pode carregá-los mais tarde, a partir do menu de pontos.

A aplicação abre o Studio em `http://127.0.0.1:3000/studio/`. Usa a porta 3000 quando está livre. Caso contrário, escolhe outra porta livre e guarda-a, para que o endereço fique o mesmo a partir daí.

A aplicação só preenche o código de configuração para um OpenLDR que ela própria iniciou. O OpenLDR pode já estar a funcionar quando a aplicação arranca, porque o iniciou num terminal, ou porque uma aplicação terminada à força o deixou a funcionar. A aplicação mostra então esse OpenLDR, e o campo do código fica vazio. Saia da aplicação e abra-a de novo. Ou execute `openldr-standalone cli -- auth setup-code` e escreva o código mostrado.

## A janela e a área de notificação

Fechar a janela deixa o OpenLDR a funcionar. Para parar o OpenLDR, use **Sair**.

A aplicação tem um ícone na área de notificação, a parte da barra de tarefas ou da barra superior com os pequenos ícones dos programas em execução. O menu dele tem quatro itens:

| Item | O que faz |
| --- | --- |
| **Abrir o OpenLDR** | Mostra de novo a janela. |
| **Iniciar ao entrar na sessão** | Uma caixa, desmarcada de início. Marcada, a aplicação arranca quando entra na sessão do computador, sem abrir a janela. |
| **Abrir a pasta de registos** | Abre `logs` na pasta de dados. |
| **Sair** | Mostra **A parar o OpenLDR**, para o servidor e a base de dados, e fecha a aplicação. |

**Sair** para o OpenLDR mesmo quando a aplicação mostrava um OpenLDR que não foi ela a iniciar.

Abrir a aplicação de novo enquanto está a funcionar traz a janela de volta. As ligações que saem do OpenLDR abrem no seu navegador. As páginas da própria aplicação seguem a língua do sistema: inglês, francês ou português.

### Quando não aparece nenhum ícone

Alguns ambientes de trabalho Linux não mostram ícones de notificação. Aí, abra a aplicação de novo a partir do menu de aplicações para trazer a janela de volta. Para parar o OpenLDR, prima Alt na janela para mostrar a barra de menus, e use o item para sair no menu File. Ou execute `openldr-standalone stop` num terminal.

## Atualizar

Saia do OpenLDR e execute de novo a linha de instalação. Ela substitui a aplicação e não mexe na pasta de dados. O arranque seguinte atualiza a base de dados.

O instalador recusa enquanto o OpenLDR estiver a funcionar, antes de descarregar o que quer que seja. No Linux e no macOS, mostra:

```text
✗ OpenLDR is running. Quit it from its tray icon, or run: "/home/you/.local/share/openldr-desktop/openldr-standalone" stop. Then run this again.
```

No Windows, mostra:

```text
X OpenLDR is running. Quit it from its tray icon, or run: & "C:\Users\you\AppData\Local\Programs\OpenLDR\openldr-standalone.cmd" stop. Then run this again.
```

O caminho na mensagem é o comando `openldr-standalone` da sua instalação. Execute essa linha, e depois a linha de instalação de novo.

## Remover

Saia primeiro do OpenLDR. No Linux e no macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash -s -- --uninstall
```

No Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Uninstall
```

Isto remove a aplicação e a pasta `OpenLDR Desktop` da própria aplicação. Remove também:

- no Linux, a entrada no menu, a entrada de arranque ao entrar na sessão, a ligação `openldr-standalone` em `~/.local/bin` e o perfil AppArmor, que volta a pedir a palavra-passe de administrador;
- no macOS, a ligação `openldr-standalone` em `~/.local/bin`;
- no Windows, o atalho no menu Iniciar e a entrada de arranque ao entrar na sessão.

No macOS, se pôs a aplicação a arrancar ao entrar na sessão, retire-a você mesmo dos itens de início de sessão nas Definições do Sistema.

A pasta de dados fica. A última linha diz onde está, por exemplo `Your data was left alone. It is in /home/you/.local/share/openldr`. Para remover também os dados, apague essa pasta você mesmo. Ela contém dados de doentes.

## Onde ficam os dados

| Sistema | Pasta de dados | Pasta da própria aplicação |
| --- | --- | --- |
| Linux | `~/.local/share/openldr`, ou `$XDG_DATA_HOME/openldr` quando `XDG_DATA_HOME` tem um caminho completo | `~/.config/OpenLDR Desktop` |
| macOS | `~/Library/Application Support/OpenLDR` | `~/Library/Application Support/OpenLDR Desktop` |
| Windows | `%LOCALAPPDATA%\OpenLDR` | `%APPDATA%\OpenLDR Desktop` |

A pasta de dados guarda a base de dados, os ficheiros armazenados, os registos e a chave dos segredos. [Executar sem Docker](/docs/standalone) descreve o que contém. A pasta da própria aplicação guarda as definições dela (a porta, o arranque ao entrar na sessão e o tamanho da janela), o registo `desktop.log` e os dados de navegador da janela. As definições não guardam nenhum segredo.

A pasta de dados é a mesma que o `openldr-standalone` usa. A aplicação traz esse comando:

| Sistema | O comando |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR\openldr-standalone.cmd` |

No Linux e no macOS, o instalador liga-o como `~/.local/bin/openldr-standalone` quando essa pasta está no seu PATH. Então `openldr-standalone` funciona num terminal novo. No Windows, nada é acrescentado ao seu PATH, por isso execute-o pelo caminho completo.

Aceita os comandos de [Executar sem Docker](/docs/standalone), sem `pnpm` à frente: `openldr-standalone status`, `openldr-standalone stop` e `openldr-standalone cli -- doctor`. Só funciona um lançador por pasta de dados. Se iniciar primeiro o OpenLDR num terminal, a aplicação mostra esse.

## Quando não arranca

A aplicação mostra então **O OpenLDR não está em execução**, a última mensagem do OpenLDR, **Os registos estão em:** com os ficheiros de registo, e **Tentar novamente**. Os ficheiros de registo são:

| Ficheiro | Onde |
| --- | --- |
| `server.log` | `logs` na pasta de dados |
| `postgres.log` | `logs` na pasta de dados |
| `desktop.log` | A pasta da própria aplicação |

Leia primeiro a mensagem, depois os registos. `desktop.log` é o registo da aplicação. Mostra o que ela fez, e os eventos e linhas de erro que recebeu do OpenLDR.

| Mensagem | O que fazer |
| --- | --- |
| `This data folder was last used by OpenLDR <newer>. This is OpenLDR <older>, which is older and cannot open it. Install OpenLDR <newer> or newer.` | Instale essa versão ou uma mais recente. Veja abaixo. |
| `OpenLDR is not running. A recovery command is using the database (process <n>). Try again when it has finished.` | Um comando como `openldr-standalone cli -- doctor` está a usar a pasta de dados. Espere que termine, e selecione **Tentar novamente**. |
| `O OpenLDR não respondeu quando a aplicação verificou se está em execução.` | Selecione **Tentar novamente**. Se a mensagem voltar, leia `desktop.log`. |
| `O OpenLDR parou inesperadamente.` | Leia `server.log` e `postgres.log`, e selecione **Tentar novamente**. |
| `O OpenLDR já não está em execução.` | Algo parou o OpenLDR fora da aplicação, como `openldr-standalone stop` num terminal. Selecione **Tentar novamente**. |
| `O OpenLDR não está compilado. Compile-o e volte a abrir a aplicação.` | Numa aplicação instalada, quer dizer que faltam ficheiros. Execute de novo a linha de instalação. |

A pasta de dados guarda `last-version.json`, que indica a versão do OpenLDR que a iniciou pela última vez. Uma versão mais recente pode alterar a base de dados de uma forma que uma mais antiga não sabe ler. Por isso, uma aplicação mais antiga recusa a pasta com a primeira mensagem acima, e não inicia nada.

Cada arranque escreve `last-version.json` logo antes de o servidor arrancar, porque o servidor pode alterar a base de dados mesmo que depois falhe. Apagar o ficheiro deixa arrancar a aplicação mais antiga. Isso só é seguro quando a versão mais recente nunca alterou a base de dados. Na dúvida, assuma que alterou. A aplicação mais antiga falha então mais tarde com um erro de base de dados. Instalar a versão mais recente é o caminho seguro de volta.

No Windows, o Postgres incluído pode precisar do runtime Microsoft Visual C++, que o pacote não inclui. Ainda não está confirmado.

## Limites

- Só este computador. A aplicação inicia o OpenLDR em `127.0.0.1`, por isso um telemóvel ou outro computador não lhe chega. [Executar sem Docker](/docs/standalone) mostra como abrir o OpenLDR a outros dispositivos.
- A aplicação não se atualiza sozinha. Execute de novo a linha de instalação.
- A aplicação não está assinada em macOS nem em Windows.
- Os pacotes para Windows e macOS são construídos em Linux, e ainda ninguém os executou.
- No macOS, a janela pode abrir quando a aplicação arranca ao entrar na sessão. Não está provado.
- `desktop.log` cresce sem limite, tal como `server.log` e `postgres.log`. Apague-o com a aplicação fechada.
- Os limites de [Executar sem Docker](/docs/standalone) também se aplicam, como a falta de TLS e a cópia de segurança feita a copiar a pasta de dados com o OpenLDR parado.

## Guias relacionados

- [Executar sem Docker](/docs/standalone)
- [Instalar](/docs/install)
- [Primeiros passos](/docs/getting-started)
- [Referência da CLI](/docs/cli)

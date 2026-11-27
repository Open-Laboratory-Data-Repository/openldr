# Aplicação de computador

A aplicação de computador do OpenLDR executa o OpenLDR num único computador, na sua própria janela. Não precisa de Docker nem de terminal. A aplicação inicia a base de dados Postgres incluída e o servidor OpenLDR, mostra o Studio, e para os dois quando sai. Usa o mesmo lançador que [Executar sem Docker](/docs/standalone), com a mesma pasta de dados.

Existem pacotes para Linux x64, macOS em Apple silicon e Windows x64. São construídos em Linux. Em 2026-11-15, o operador relatou execuções bem-sucedidas nos três sistemas. A secção Testes relatados abaixo indica o alcance e as verificações ainda em falta.

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

O macOS e o Windows podem verificar quem fez um programa antes de o abrir. A aplicação OpenLDR não tem a assinatura de nenhum editor nesses dois sistemas. O operador abriu-a nos dois sistemas. O registo não descreve os avisos de segurança apresentados.

No macOS, o instalador assina a aplicação no seu Mac com `codesign`, com uma assinatura que não nomeia nenhum editor. Em 2026-11-15, o operador relatou que a aplicação abriu num Mac mini depois deste passo.

## O primeiro arranque

1. Abra a aplicação. A janela mostra **A iniciar o OpenLDR** enquanto a base de dados e o servidor arrancam.
2. O Studio mostra **Criar o administrador**. A aplicação introduz o código em **Código de configuração**, e a indicação por baixo do campo diz **A aplicação OpenLDR introduziu este código por si.**
3. Escolha um nome de utilizador e uma palavra-passe, e selecione **Criar o administrador**.
4. Seguem-se três passos. Dá um nome ao seu laboratório, carrega dados de exemplo, e revê as verificações de instalação que precisam de atenção. Pode saltar os dois primeiros.

O guia do Studio, **Primeiro arranque**, descreve os três passos. Os dados de exemplo acrescentam 60 pedidos fictícios, 39 deles com resultados, e um painel de exemplo. Nenhuma ação remove mais tarde apenas os pedidos de exemplo, e a Redefinição de fábrica deixa-os ficar. Só apagar todos os seus dados os remove, por exemplo apagando a pasta de dados. Os dados de exemplo só são oferecidos enquanto a instalação não tiver dados de laboratório. Se os saltar, pode carregá-los mais tarde a partir do menu de pontos em Definições → Verificações de instalação.

A aplicação abre o Studio em `http://127.0.0.1:3000/studio/`. Usa a porta 3000 quando está livre. Caso contrário, escolhe outra porta livre e guarda-a. O endereço fica então o mesmo enquanto essa porta estiver livre.

A aplicação só introduz o código de configuração para um OpenLDR que ela própria iniciou. O OpenLDR pode já estar a funcionar quando a aplicação arranca. Pode tê-lo iniciado num terminal. Ou uma aplicação terminada à força deixou-o a funcionar. A aplicação mostra então esse OpenLDR, e o campo do código fica vazio. A indicação por baixo do campo diz **Selecione Sair no menu da área de notificação e volte a abrir o OpenLDR. Depois, a aplicação introduz o código por si.**

O mais simples é selecionar **Sair** no menu da área de notificação e abrir a aplicação de novo. A aplicação inicia então o OpenLDR ela própria e introduz o código. Também pode executar o comando `openldr-standalone` da aplicação, e escrever o código mostrado:

| Sistema | Comando |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone cli -- auth setup-code` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone cli -- auth setup-code` |
| Windows, no PowerShell | `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" cli -- auth setup-code` |

## A janela e a área de notificação

Fechar a janela deixa o OpenLDR a funcionar. Para parar o OpenLDR, use **Sair**.

A aplicação tem um ícone na área de notificação, a parte da barra de tarefas ou da barra superior com os pequenos ícones dos programas em execução. O menu dele tem sete itens, e mais enquanto o OpenLDR está partilhado:

| Item | O que faz |
| --- | --- |
| **Abrir o OpenLDR** | Mostra de novo a janela. |
| **Iniciar ao entrar na sessão** | Uma caixa, desmarcada de início. Marcada, a aplicação arranca quando entra na sessão do computador, sem abrir a janela. |
| **Partilhar na rede do laboratório** | Um visto, desligado no início. Veja **Partilhar na rede do laboratório** mais abaixo. |
| **Ligar a um servidor de laboratório...** | Pergunta e reinicia a aplicação como ecrã para outro PC. Veja **Ligar ao servidor do laboratório** mais abaixo. |
| **Bloquear este PC no OpenLDR...** | Pede um PIN e bloqueia este PC no OpenLDR. Veja **Bloquear este PC no OpenLDR** mais abaixo. |
| **Abrir a pasta de registos** | Abre `logs` na pasta de dados. |
| **Sair** | Mostra **A parar o OpenLDR**, para o servidor e a base de dados, e fecha a aplicação. |

**Sair** para o OpenLDR mesmo quando a aplicação mostrava um OpenLDR que não foi ela a iniciar.

Abrir a aplicação de novo enquanto está a funcionar traz a janela de volta. As ligações que saem do OpenLDR abrem no seu navegador. As páginas da própria aplicação seguem a língua do sistema: inglês, francês ou português.

### Partilhar na rede do laboratório

Marque **Partilhar na rede do laboratório** para que outros PC do laboratório abram este OpenLDR. A aplicação pergunta primeiro. O OpenLDR reinicia depois, e quem o estiver a usar espera um momento.

Enquanto está partilhado, o menu mostra também o endereço que os outros PC usam, e mais três itens. O menu mostra um só endereço. Se não abrir noutro PC, execute `openldr-standalone status --json` num terminal e experimente os outros endereços em `share.addresses`. **Onde ficam os dados** mais abaixo indica o caminho completo do comando, necessário no Windows.

| Item | O que faz |
| --- | --- |
| **Copiar o endereço de rede** | Copia o endereço `https` para dar aos outros PC. |
| **Copiar a impressão digital do certificado** | Copia a impressão digital para comparar no outro PC. |
| **Guardar o certificado...** | Guarda o certificado num ficheiro, para um programa que precise dele. |

Noutro PC, abra o endereço num navegador. O navegador avisa sobre o certificado na primeira vez. Compare a impressão digital SHA-256 com a da área de notificação, e aceite-o só se forem iguais.

Os outros PC usam a porta 3443. Se outro programa usar essa porta, a aplicação mostra `Port 3443 is already in use. Choose another with --share-port.` Para outra porta, saia da aplicação, acrescente `"sharePort": 8443` a `settings.json`, e volte a abri-la. O ficheiro está na pasta da aplicação, `OpenLDR Desktop`. **Onde ficam os dados** mais abaixo indica o sítio em cada sistema.

Se o OpenLDR foi iniciado fora da aplicação, o visto fica guardado e aplica-se da próxima vez que a aplicação o iniciar. [Executar sem Docker](/docs/standalone) diz mais sobre o certificado.

### Quando não aparece nenhum ícone

Alguns ambientes de trabalho Linux não mostram ícones de notificação. Aí, abra a aplicação de novo a partir do menu de aplicações para trazer a janela de volta. Para parar o OpenLDR, prima Alt na janela para mostrar a barra de menus, e use o item para sair no menu File. Ou execute `openldr-standalone stop` num terminal.

## Ligar ao servidor do laboratório

Um laboratório precisa de um só OpenLDR. Em cada outro PC, a aplicação pode mostrar esse OpenLDR em vez de executar o seu. O PC não executa então nem servidor nem base de dados, e não guarda dados. [Escolher uma instalação para o laboratório](/docs/lab-setups) diz quando usar isto.

### Escolher no primeiro arranque

Num PC sem dados do OpenLDR, a aplicação pergunta **Como é que este PC vai usar o OpenLDR?** antes de iniciar seja o que for.

1. Selecione **Ligar ao servidor do laboratório**.
2. Em **Endereço do servidor**, escreva o endereço do OpenLDR do laboratório, por exemplo `https://labpc:3443/studio/`. Numa aplicação de computador partilhada, é o endereço que o menu da área de notificação mostra.
3. Selecione **Ligar**.
4. Se a aplicação mostrar **Verifique o certificado do servidor**, compare a impressão digital. Veja a secção seguinte.

O Studio abre então a partir do servidor. Inicie sessão com o seu nome de utilizador e a sua palavra-passe do OpenLDR. A aplicação lembra-se do endereço e vai direta a ele no arranque seguinte.

O endereço tem de começar por `https`. Um PC que já guarda dados do OpenLDR não recebe a pergunta. Fica como está.

Neste modo, a aplicação não introduz nenhum código de configuração. Crie o primeiro administrador no próprio servidor.

### Verificar o certificado do servidor

Uma aplicação de computador partilhada cria o seu próprio certificado, por isso o sistema do seu PC não o conhece. A aplicação mostra então a impressão digital SHA-256 do certificado e pergunta.

1. No servidor, abra o menu da área de notificação e selecione **Copiar a impressão digital do certificado**. Com o lançador, leia a linha `Certificate fingerprint (SHA-256):` no terminal.
2. Compare-a com a impressão digital na aplicação, par a par.
3. Selecione **Corresponde** só quando forem iguais. Caso contrário, selecione **Cancelar**.

A aplicação lembra-se desse certificado só para esse endereço. Um servidor cujo certificado o seu sistema já reconhece não dá origem a pergunta.

Se a aplicação mostrar mais tarde **O certificado do servidor mudou**, pare e descubra porquê. Um novo nome ou um novo endereço de rede do servidor cria um novo certificado. Se ninguém mudou o servidor, selecione **Cancelar**. Depois de **Corresponde**, a aplicação fecha-se e volta a abrir sozinha.

### Quando o servidor não responde

No arranque, a aplicação mostra **Não é possível alcançar o servidor** quando o servidor está desligado ou a rede falha. Tenta de novo a cada 10 segundos e mostra o Studio sozinha assim que o servidor responde. **Tentar novamente** tenta de imediato.

Enquanto trabalha, a aplicação nunca substitui o Studio por si. Se o servidor se desligar, o Studio fica no ecrã com o que escreveu, e os pedidos dele falham até o servidor voltar.

### Mudar de servidor ou de modo

Neste modo, o menu da área de notificação tem estes itens:

| Item | O que faz |
| --- | --- |
| **Abrir o OpenLDR** | Mostra de novo a janela. |
| **Iniciar ao entrar na sessão** | Inicia a aplicação quando entra na sessão do computador. |
| O endereço do servidor | Uma linha que não se pode premir. |
| **Mudar de servidor...** | Esquece o servidor e pede outro endereço. |
| **Usar este PC para os dados do laboratório...** | Pergunta e reinicia a aplicação para que o OpenLDR e a sua base de dados funcionem neste PC. |
| **Bloquear este PC no OpenLDR...** | Veja **Bloquear este PC no OpenLDR** mais abaixo. |
| **Abrir a pasta de registos** | Abre a pasta da própria aplicação, que contém `desktop.log`. |
| **Sair** | Fecha a aplicação. O servidor continua a funcionar. |

**Mudar de servidor** é também um botão no ecrã **Não é possível alcançar o servidor**. Depois de ligar a outro servidor, a aplicação pode fechar-se e voltar a abrir sozinha.

Um PC que guarda os dados do laboratório tem **Ligar a um servidor de laboratório...** no menu. O item pergunta, para o OpenLDR neste PC e reinicia a aplicação como ecrã para outro PC. Os dados deste PC ficam onde estão e não são usados.

## Bloquear este PC no OpenLDR

Numa sala partilhada, um PC pode ficar definido para mostrar o OpenLDR e mais nada. O bloqueio funciona nos dois modos.

### Ativar o bloqueio

1. Abra o menu da área de notificação e selecione **Bloquear este PC no OpenLDR...**.
2. Escreva um PIN com pelo menos 4 caracteres.
3. Selecione **Bloquear**.

A janela ocupa então o ecrã inteiro. Enquanto o PC está bloqueado:

- Fechar a janela não faz nada.
- As ligações para outros sítios não abrem.
- A aplicação arranca quando entra na sessão do computador.
- O menu da área de notificação tem três itens: **Abrir o OpenLDR**, **Desbloquear este PC...** e **Sair**.
- **Sair** pede o PIN, a partir da área de notificação, do menu e do teclado.

### Desbloquear

Prima `Ctrl+Shift+L` na janela, ou selecione **Desbloquear este PC...** no menu da área de notificação. Escreva o PIN e selecione **Desbloquear**. Uma janela pequena por cima pede o PIN, por isso o que escreveu no Studio mantém-se. Um PIN errado é recusado ao fim de dois segundos.

### O que o bloqueio não impede

O bloqueio trava um utilizador ocasional. Não impede isto:

- As teclas do próprio sistema, como Alt+Tab ou a tecla Windows. Bloqueá-las cabe ao sistema.
- Desligar o PC ou terminar a sessão. A aplicação sai então sem PIN, para que o OpenLDR pare de forma limpa.
- Alguém que possa editar ficheiros com a conta do PC. Pode retirar o bloqueio do ficheiro de definições.

Para fechar estas falhas no Windows, execute a aplicação como programa de quiosque de uma conta Windows separada. Para um programa de ambiente de trabalho, é a funcionalidade Shell Launcher do Windows Enterprise e Education, ou um perfil de quiosque que liste `%LOCALAPPDATA%\Programs\OpenLDR\OpenLDR.exe`. O guia da Microsoft "Configure kiosks and digital signs on Windows" tem os passos. Não testámos isto.

### Um PIN esquecido

1. Abra `settings.json` na pasta da própria aplicação com um editor de texto. **Onde ficam os dados** mais abaixo indica onde está.
2. Retire toda a entrada `"lock"` e guarde o ficheiro.
3. Na janela da aplicação, prima `Ctrl+Shift+L`.

A aplicação desbloqueia sem PIN quando a entrada já não existe. Para chegar ao ficheiro a partir de um PC bloqueado, use as teclas do próprio sistema para abrir uma janela de ficheiros, ou termine a sessão e entre com outra conta que chegue a ele.

## Atualizar

Saia do OpenLDR e execute de novo a linha de instalação. Ela substitui a aplicação e não mexe na pasta de dados. O arranque seguinte atualiza a base de dados.

O instalador recusa enquanto o OpenLDR estiver a funcionar, antes de descarregar o que quer que seja. No Linux e no macOS, mostra:

```text
✗ OpenLDR is running. Quit it from its tray icon, then run this again. Or stop it with: "/home/you/.local/share/openldr-desktop/openldr-standalone" stop
```

No Windows, mostra:

```text
X OpenLDR is running. Quit it from its tray icon, then run this again. Or stop it with: & "C:\Users\you\AppData\Local\Programs\OpenLDR\openldr-standalone.cmd" stop
```

O caminho na mensagem é o comando `openldr-standalone` da sua instalação. Saia do OpenLDR pelo ícone de notificação, ou execute essa linha `stop`. Depois execute de novo a linha de instalação.

Se o instalador continuar a recusar, uma base de dados deixada por um OpenLDR terminado à força pode ainda estar a funcionar. `stop` diz então `OpenLDR is not running.`, porque só resta a base de dados. Abra a aplicação uma vez e espere pelo Studio. Quando a aplicação inicia o OpenLDR, o OpenLDR para primeiro uma base de dados que tenha ficado a funcionar na mesma pasta de dados. Selecione depois **Sair** no menu da área de notificação, e execute de novo a linha de instalação.

## Remover

Saia primeiro do OpenLDR. Se o instalador recusar com `OpenLDR is running.`, siga os passos de **Atualizar**. No Linux e no macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash -s -- --uninstall
```

No Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Uninstall
```

Isto remove a aplicação e a pasta `OpenLDR Desktop` da própria aplicação. Remove também:

- no Linux, a entrada no menu, a entrada de arranque ao entrar na sessão, a ligação `openldr-standalone` em `~/.local/bin` e o perfil AppArmor, se tiver sido instalado, o que volta a pedir a palavra-passe de administrador;
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

A pasta de dados guarda a base de dados, os ficheiros armazenados, os registos e a chave dos segredos. [Executar sem Docker](/docs/standalone) descreve o que contém. A pasta da própria aplicação guarda as definições dela, o registo `desktop.log` e os dados de navegador da janela. As definições são a porta, o arranque ao entrar na sessão, o tamanho da janela, a partilha do OpenLDR na rede do laboratório, e a porta da partilha quando define uma. Em modo de ligação guardam também o endereço do servidor e a impressão digital do certificado que aceitou. Um PC bloqueado junta o bloqueio, guardado como um hash com sal do PIN. Não guardam nenhuma palavra-passe nem chave.

A pasta de dados é a mesma que o `openldr-standalone` usa. A aplicação traz esse comando:

| Sistema | O comando |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR\openldr-standalone.cmd` |

No Linux e no macOS, o instalador liga-o como `~/.local/bin/openldr-standalone` quando essa pasta existe e está no seu PATH. Então `openldr-standalone` funciona num terminal novo. No Windows, nada é acrescentado ao seu PATH, por isso execute-o pelo caminho completo.

Aceita os comandos de [Executar sem Docker](/docs/standalone), sem `pnpm` à frente: `openldr-standalone status`, `openldr-standalone stop` e `openldr-standalone cli -- doctor`. Só funciona um lançador por pasta de dados. Se iniciar primeiro o OpenLDR num terminal, a aplicação mostra esse.

## Quando não arranca

A aplicação mostra então **O OpenLDR não está em execução**, a última mensagem do OpenLDR e **Tentar novamente**. A maioria dos erros mostra também **Os registos estão em:** com os ficheiros de registo. Os ficheiros de registo são:

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
| `O OpenLDR não respondeu a uma verificação de estado.` | Selecione **Tentar novamente**. Se a mensagem voltar, leia `desktop.log`. |
| `O OpenLDR parou inesperadamente.` | Leia `server.log` e `postgres.log`, e selecione **Tentar novamente**. |
| `O OpenLDR já não está em execução.` | Algo parou o OpenLDR fora da aplicação, como `openldr-standalone stop` num terminal. Selecione **Tentar novamente**. |
| `O OpenLDR não está compilado. Compile-o e volte a abrir a aplicação.` | Numa aplicação instalada, quer dizer que faltam ficheiros. Execute de novo a linha de instalação. |

A pasta de dados guarda `last-version.json`, que indica a versão do OpenLDR que a iniciou pela última vez. Uma versão mais recente pode alterar a base de dados de uma forma que uma mais antiga não sabe ler. Por isso, uma aplicação mais antiga recusa a pasta com a primeira mensagem acima, e não inicia nada.

Cada arranque escreve `last-version.json` logo antes de o servidor arrancar, porque o servidor pode alterar a base de dados mesmo que depois falhe. Apagar o ficheiro deixa arrancar a aplicação mais antiga. Isso só é seguro quando a versão mais recente nunca alterou a base de dados. Na dúvida, assuma que alterou. A aplicação mais antiga falha então mais tarde com um erro de base de dados. Instalar a versão mais recente é o caminho seguro de volta.

No Windows, o Postgres incluído pode precisar do runtime Microsoft Visual C++, que o pacote não inclui. Ainda não está confirmado.

## Testes relatados

Estes são relatos do operador de 2026-11-15, com pacotes construídos a partir de `90caabca`. Não provam que todas as verificações de plataforma passaram.

- Linux: instalação, preenchimento automático do código de configuração, passos do primeiro arranque e carregamento de 60 pedidos de exemplo no painel.
- Windows: instalação, remoção, ícone na área de notificação, preenchimento automático do código, primeiro arranque com 60 pedidos, saída pela área de notificação e regresso à janela existente num segundo lançamento.
- macOS num Mac mini: o operador relatou que a aplicação abriu e funcionou. O registo não identifica todos os passos experimentados.

Ainda sem relato:

- Windows: recusa de atualização durante a execução, estado do lançador, terminar a aplicação pelo Gestor de Tarefas e arranque sem o runtime Visual C++.
- macOS: seleção da janela enquanto outra aplicação Electron está aberta, ícone da Dock, arranque no início de sessão e ficheiros deixados após remoção.
- Os três sistemas: encerramento do computador e fim de sessão enquanto o OpenLDR está em execução.

## Limites

- Só este computador, exceto se **Partilhar na rede do laboratório** estiver marcado. A aplicação inicia o OpenLDR em `127.0.0.1`. A partilha abre uma segunda porta, cifrada, para os outros PC da rede do laboratório.
- A aplicação não se atualiza sozinha. Execute de novo a linha de instalação.
- A aplicação não tem a assinatura de nenhum editor em macOS nem em Windows.
- No macOS, a janela pode abrir quando a aplicação arranca ao entrar na sessão. Não está provado.
- `desktop.log` cresce sem limite, tal como `server.log` e `postgres.log`. Apague-o depois de selecionar **Sair**.
- Os limites de [Executar sem Docker](/docs/standalone) também se aplicam, como a cópia de segurança feita a copiar a pasta de dados com o OpenLDR parado.

## Guias relacionados

- [Escolher uma instalação para o laboratório](/docs/lab-setups)
- [Usar o Studio](/docs/using-studio)
- [Executar sem Docker](/docs/standalone)
- [Instalar](/docs/install)
- [Primeiros passos](/docs/getting-started)
- [Referência da CLI](/docs/cli)

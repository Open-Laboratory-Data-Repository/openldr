# Windows Server

Prepare um ambiente Linux no Windows Server e instale o OpenLDR dentro dele. As imagens fornecidas destinam-se a Linux AMD64. O Docker Desktop não é suportado no Windows Server.

Escolha apenas um percurso. Se já tem uma VM Ubuntu com Docker disponível, avance para **Instalar o OpenLDR no Linux**. Os dados de exemplo são opcionais. Consulte o [percurso ilustrado de início de sessão](/docs/install).

| Servidor | Percurso |
| --- | --- |
| Server 2022 ou 2025 atualizado com WSL2 disponível | WSL2 ou VM Linux Hyper-V. |
| Server 2019 | VM Linux Hyper-V. WSL1 não basta para executar contentores Linux. |
| Servidor sem intervenção após reiniciar | Prefira uma VM Hyper-V com arranque automático. WSL precisa de um mecanismo separado. |

Leia [Requisitos](/docs/requirements). Precisa de acesso administrativo no Windows, virtualização de hardware e recursos para Windows e toda a instalação Linux. Se o Windows for uma VM, o hipervisor deve permitir virtualização aninhada.

Os exemplos usam `Ubuntu-24.04`, a VM `OpenLDR` e a pasta Linux `~/Downloads/openldr_ce`. Substitua `openldr.example.org` por um endereço acessível aos utilizadores. As imagens são ilustrações vetoriais dos comandos, não capturas de uma instalação Windows Server concluída. Selecione uma imagem para ampliar.

O texto azul terminado em `$` ou `>` é o **prompt**. O terminal mostra-o; não o escreva. Escreva o comando a seguir e prima **Enter**. As linhas mais discretas abaixo são o **resultado** do programa; leia-as sem as escrever. Por exemplo, `docker --version` é um comando e `Docker version 29.5.2, build 79eb04c` é a resposta. Os blocos para copiar contêm apenas comandos. Os nomes, caminhos e versões podem ser diferentes. Algumas ilustrações mostram comandos sem o resultado; espere que cada comando termine antes do seguinte.

## Verificar o Windows antes de escolher

Abra o PowerShell como Administrador nesse servidor. Use uma consola ou ligação de gestão que permita retomar após reiniciar.

### 1. Ler a versão e as informações de virtualização

```powershell
{{server:host-check}}
```

Verifique o produto, a compilação e as informações Hyper-V. Atualize o Windows antes do percurso WSL2. Consulte as [instruções Microsoft para WSL no Server](https://learn.microsoft.com/en-us/windows/wsl/install-on-server) em caso de erro. Este guia não impõe um limite de atualização cumulativa sem verificação.

![Ilustração do comando: Ler a versão e as informações de virtualização.](guide:server-host-check)

## Percurso A: preparar WSL2

Execute os comandos Windows no PowerShell administrativo e os comandos Linux no Ubuntu. A distribuição pertence à conta Windows que a instala. Use essa mesma conta depois.

### 1. Instalar Ubuntu com WSL2

```powershell
{{server:wsl-install}}
```

Reinicie o Windows se solicitado e reabra o PowerShell na mesma conta. Se este nome não estiver disponível, consulte `wsl --list --online` e as instruções Microsoft. Não substitua por uma distribuição WSL1.

![Ilustração do comando: Instalar Ubuntu com WSL2.](guide:server-wsl-install)

### 2. Atualizar WSL e verificar a versão

```powershell
{{server:wsl-version}}
```

A linha Ubuntu deve mostrar **VERSION 2**. Se mostrar 1, execute `wsl --set-version Ubuntu-24.04 2` e verifique novamente. Resolva erros antes de continuar.

![Ilustração do comando: Atualizar WSL e verificar a versão.](guide:server-wsl-version)

### 3. Abrir Ubuntu e criar a conta Linux

```powershell
{{server:wsl-open}}
```

No primeiro arranque, crie o nome de utilizador e a palavra-passe Linux pedidos. Esta palavra-passe é distinta da do Windows. Normalmente não aparecem caracteres ao escrevê-la. Use a pasta pessoal Linux, não `/mnt/c`, para Docker e OpenLDR.

![Ilustração do comando: Abrir Ubuntu e criar a conta Linux.](guide:server-wsl-open)

### 4. Verificar o gestor de serviços Linux

```bash
{{server:systemd-check}}
```

No Ubuntu, espere `systemd`. O Ubuntu WSL atual pode já o ativar. Nesse caso, ignore os dois passos seguintes e avance para **Instalar Docker no Linux**.

![Ilustração do comando: Verificar o gestor de serviços Linux.](guide:server-systemd-check)

### 5. Ativar systemd apenas se estiver em falta

```bash
{{server:systemd-edit}}
```

No Ubuntu, mantenha os outros parâmetros do ficheiro. Na secção `[boot]` existente, defina `systemd=true`. Se a secção não existir, acrescente:

```ini
[boot]
systemd=true
```

Guarde com **Ctrl+O**, prima **Enter** e saia com **Ctrl+X**. Não substitua todo o ficheiro. A Microsoft documenta os [requisitos systemd](https://learn.microsoft.com/en-us/windows/wsl/systemd), incluindo WSL 0.67.6 ou posterior.

![Ilustração do comando: Ativar systemd apenas se estiver em falta.](guide:server-systemd-edit)

### 6. Reiniciar WSL e repetir a verificação

```powershell
{{server:wsl-restart}}
```

Termine os trabalhos e feche o Ubuntu. Execute estes comandos no PowerShell. `--shutdown` para todas as distribuições dessa conta. No Ubuntu reaberto, `ps -p 1 -o comm=` deve mostrar `systemd`. Ativar Docker dentro do Ubuntu não configura o arranque da distribuição com o Windows.

![Ilustração do comando: Reiniciar WSL e repetir a verificação.](guide:server-wsl-restart)

## Percurso B: preparar uma VM Linux Hyper-V

A VM tem o seu próprio endereço. O exemplo atribui **4 processadores virtuais, 8 GB de RAM e 100 GB de disco**. São valores de planeamento, não mínimos medidos. Reserve recursos para Windows. Se já existir uma VM adequada, avance para Docker. Instalar Hyper-V reinicia o servidor. Criar um comutador externo pode interromper a rede. Prepare acesso por consola.

### 1. Ativar Hyper-V

```powershell
{{server:hyperv-enable}}
```

Execute no PowerShell como Administrador no Windows Server. O servidor reinicia. Reabra o PowerShell depois. Se falhar, siga o [guia Microsoft Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v).

![Ilustração do comando: Ativar Hyper-V.](guide:server-hyperv-enable)

### 2. Encontrar um comutador ou o adaptador físico correto

```powershell
{{server:switch-list}}
```

Reutilize um comutador externo adequado. Caso contrário, identifique o adaptador da rede pretendida. `Ethernet` no passo seguinte é um exemplo, não um nome para copiar sem verificar.

![Ilustração do comando: Encontrar um comutador ou o adaptador físico correto.](guide:server-switch-list)

### 3. Criar um comutador externo apenas se necessário

```powershell
{{server:switch-create}}
```

Substitua `Ethernet` pelo nome identificado. Use uma consola que tolere interrupções de rede. Se reutilizar um comutador, substitua `OpenLDR-External` nos comandos seguintes. Consulte os [comutadores externos Microsoft](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines).

![Ilustração do comando: Criar um comutador externo apenas se necessário.](guide:server-switch-create)

### 4. Descarregar e localizar o ISO Ubuntu Server

```powershell
{{server:iso-check}}
```

Descarregue uma imagem AMD64 Ubuntu Server LTS no [Ubuntu](https://ubuntu.com/download/server). O exemplo usa Ubuntu 24.04 LTS. Guarde em `C:\iso\ubuntu-server-amd64.iso` ou corrija o caminho. Espere `True`. Mantenha esta janela aberta para reutilizar `$iso`.

![Ilustração do comando: Descarregar e localizar o ISO Ubuntu Server.](guide:server-iso-check)

### 5. Criar uma VM e disco novos

```powershell
{{server:vm-create}}
```

Na mesma janela PowerShell, use um nome e um disco novos. Não reutilize o disco de uma VM existente. Adapte os recursos à carga. O limite do disco virtual não prova que exista espaço físico suficiente.

![Ilustração do comando: Criar uma VM e disco novos.](guide:server-vm-create)

### 6. Montar o ISO e configurar o arranque

```powershell
{{server:vm-boot}}
```

O modelo Secure Boot compatível com Linux permite arrancar Ubuntu. O arranque automático inicia a VM depois do Windows. Verifique separadamente o arranque de Docker e dos contentores.

![Ilustração do comando: Montar o ISO e configurar o arranque.](guide:server-vm-boot)

### 7. Abrir a consola e instalar Ubuntu

```powershell
{{server:vm-console}}
```

Este comando requer ambiente de trabalho Windows e ferramentas Hyper-V. No Server Core, use Hyper-V Manager num computador de gestão. Siga o [tutorial ilustrado Ubuntu](https://ubuntu.com/tutorials/install-ubuntu-server). Selecione apenas o disco novo, crie uma conta Linux e ative OpenSSH se planear usar SSH. Termine e reinicie. A imagem abaixo ilustra como abrir a consola, não os ecrãs do instalador Ubuntu.

![Ilustração do comando: Abrir a consola e instalar Ubuntu.](guide:server-vm-console)

### 8. Retirar o ISO e preparar um endereço estável

```powershell
{{server:vm-eject}}
```

No PowerShell Windows, retire o ISO e leia o endereço MAC. Faça uma reserva DHCP para esse MAC ou configure um endereço estático adequado no Linux. Verifique com `hostname -I` no Ubuntu. O nome OpenLDR deve apontar para essa VM. Continue no Ubuntu por consola ou SSH.

![Ilustração do comando: Retirar o ISO e preparar um endereço estável.](guide:server-vm-eject)

## Instalar Docker no Linux

Ambos os percursos chegam aqui. Execute os comandos **dentro do Ubuntu**, não no PowerShell. Seguem o [repositório Ubuntu do Docker](https://docs.docker.com/engine/install/ubuntu/). O script de conveniência destina-se a testes e desenvolvimento. Se Docker ou containerd já existir, consulte os conflitos nessa documentação antes de alterar pacotes usados por outras aplicações.

### 1. Verificar Ubuntu, processador e gestor de serviços

```bash
{{server:linux-check}}
```

Este exemplo espera Ubuntu 24.04, `amd64` e `systemd`. Consulte a limitação de arquitetura das imagens em [Requisitos](/docs/requirements).

![Ilustração do comando: Verificar Ubuntu, processador e gestor de serviços.](guide:server-linux-check)

### 2. Adicionar a chave de assinatura Docker

```bash
{{server:docker-key}}
```

Execute o bloco completo no Ubuntu. Pare se uma transferência ou comando de pacotes falhar.

![Ilustração do comando: Adicionar a chave de assinatura Docker.](guide:server-docker-key)

### 3. Adicionar o repositório de pacotes Docker

```bash
{{server:docker-repo}}
```

Inclua a linha final `EOF`. Este ficheiro é específico do Docker e não substitui as fontes principais do Ubuntu.

![Ilustração do comando: Adicionar o repositório de pacotes Docker.](guide:server-docker-repo)

### 4. Instalar Docker Engine e Compose

```bash
{{server:docker-install}}
```

Instala o motor, as ferramentas e o módulo Compose, depois ativa e inicia o serviço Docker.

![Ilustração do comando: Instalar Docker Engine e Compose.](guide:server-docker-install)

### 5. Dar acesso Docker à conta de instalação

```bash
{{server:docker-access}}
```

`newgrp` abre uma shell com a nova associação ao grupo. O grupo Docker concede privilégios root no Linux. Use a conta que manterá o OpenLDR. Consulte os [passos Docker após instalação](https://docs.docker.com/engine/install/linux-postinstall/).

![Ilustração do comando: Dar acesso Docker à conta de instalação.](guide:server-docker-access)

### 6. Verificar motor, Compose e um contentor de teste

```bash
{{server:docker-check}}
```

Espere um motor Linux AMD64, uma versão Compose e a mensagem de sucesso `hello-world`. O último comando transfere uma pequena imagem e remove o contentor terminado. Resolva erros antes de instalar OpenLDR.

![Ilustração do comando: Verificar motor, Compose e um contentor de teste.](guide:server-docker-check)

## Instalar o OpenLDR no Linux

Escolha o nome **antes da primeira instalação**. No Hyper-V, deve alcançar a VM Ubuntu. No WSL2 com o encaminhamento abaixo, deve alcançar Windows. Substitua `openldr.example.org` por esse nome ou um IP acessível. Uma rede privada ou Tailscale pode usar o certificado autoassinado gerado.

### 1. Descarregar o instalador Linux

```bash
{{server:install-download}}
```

O ficheiro fica em `~/Downloads/openldr-install.sh` dentro do Ubuntu. Não use o instalador PowerShell Windows aqui.

![Ilustração do comando: Descarregar o instalador Linux.](guide:server-install-download)

### 2. Instalar com o endereço acessível aos utilizadores

```bash
{{server:install-run}}
```

Substitua o nome de exemplo. `--seedless` exclui dashboards e dados de demonstração. Omita a opção se os quiser nesta instalação nova. Os seus dados não dependem dos exemplos. Mantenha as credenciais privadas. Um certificado público exige a tarefa separada em [Instalação](/docs/install), incluindo acesso à porta 80. Consulte o [percurso ilustrado de início de sessão](/docs/install).

![Ilustração do comando: Instalar com o endereço acessível aos utilizadores.](guide:server-install-run)

### 3. Verificar o estado real dos serviços

```bash
{{server:install-status}}
```

Verifique os contentores e a saúde da API. `-k` serve apenas para o certificado autoassinado local. Isto não prova acesso remoto nem início de sessão no Studio. Em caso de erro, veja `docker compose logs --tail 100` nesta pasta. O código de saída do instalador sozinho não comprova disponibilidade.

![Ilustração do comando: Verificar o estado real dos serviços.](guide:server-install-status)

## Permitir que outros computadores alcancem WSL2

Ignore esta tarefa no Hyper-V. A VM tem ligação LAN, mas encaminhamento e firewalls devem permitir as portas da gateway. Para NAT no WSL2, o [guia de rede Microsoft](https://learn.microsoft.com/en-us/windows/wsl/networking) descreve o encaminhamento explícito. As instruções de rede espelhada destinam-se ao Windows 11, não a este percurso Server.

### 1. Ler o endereço Ubuntu e verificar portas Windows

```powershell
{{server:wsl-address}}
```

No PowerShell administrativo da conta proprietária da distribuição, identifique o IPv4 Ubuntu. Verifique se IIS ou outro serviço ocupa 80/443. Uma lista vazia significa que não foi encontrado um serviço TCP correspondente. Não pare serviços existentes sem verificar a sua função.

![Ilustração do comando: Ler o endereço Ubuntu e verificar portas Windows.](guide:server-wsl-address)

### 2. Encaminhar as portas para Ubuntu

```powershell
{{server:wsl-proxy}}
```

Confirme que `$wslIp` corresponde ao IPv4 identificado. As regras escutam em todas as interfaces IPv4 Windows. Encaminham apenas as portas da gateway, não serviços internos. Se escolheu outras portas, adapte ambas as extremidades.

![Ilustração do comando: Encaminhar as portas para Ubuntu.](guide:server-wsl-proxy)

### 3. Permitir os clientes previstos e examinar as regras

```powershell
{{server:wsl-firewall}}
```

Este exemplo permite HTTPS à sub-rede local num perfil Windows Domain ou Private. Para Tailscale ou outra rede encaminhada, substitua `LocalSubnet` pelo intervalo cliente pretendido e escolha o perfil ativo. Acrescente uma regra TCP 80 semelhante apenas para redirecionamentos HTTP ou validação pública do certificado. Após reiniciar WSL, volte a verificar o IP e repita os encaminhamentos se mudou. As regras não iniciam Ubuntu.

![Ilustração do comando: Permitir os clientes previstos e examinar as regras.](guide:server-wsl-firewall)

## Verificar acesso remoto e comportamento após reiniciar

Faça o teste de rede noutro computador. Um teste no próprio servidor não prova o acesso dos utilizadores.

### 1. Testar o endereço noutro computador Windows

```powershell
{{server:remote-check}}
```

Substitua o nome pelo usado na instalação. Espere `TcpTestSucceeded: True`, que prova apenas ligação TCP. Abra `https://O_SEU_HOST` para testar a gateway. Confiança do certificado e início de sessão são verificações distintas. Não desative permanentemente a verificação de certificados.

![Ilustração do comando: Testar o endereço noutro computador Windows.](guide:server-remote-check)

### 2. Verificar o arranque previsto

```powershell
{{server:vm-reboot-check}}
```

No Hyper-V, a propriedade deve ser `Start`. Num reinício de manutenção, verifique novamente VM, Docker, saúde dos contentores e acesso remoto. No WSL2, prepare e teste um mecanismo de arranque na conta proprietária. Um serviço systemd não inicia WSL com Windows. Sem esse teste, não considere a instalação autónoma. Prefira Hyper-V quando precisar de arranque automático.

![Ilustração do comando: Verificar o arranque previsto.](guide:server-vm-reboot-check)

**Resultado esperado:** Docker Linux executa OpenLDR, o nome configurado alcança a gateway a partir da rede pretendida e verificou o regresso após reiniciar. O início de sessão Studio continua a ser uma tarefa separada numa instalação nova.

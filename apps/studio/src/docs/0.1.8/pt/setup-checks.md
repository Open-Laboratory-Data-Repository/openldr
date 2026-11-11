# Verificações de instalação

**Verificações de instalação** mostra o que ainda falta a esta instalação antes do uso real, e abre a página que resolve cada ponto. É o primeiro sítio a ver depois de instalar, e depois de qualquer alteração no servidor.

Leva cerca de 5 minutos. Selecione uma imagem ou um clip para o ampliar.

![As verificações numa instalação de teste nova: três avisos, para o início de sessão, o nome do laboratório e o fuso horário.](setup-checks-tour.png)

## Quem pode fazer o quê

Precisa de **View settings**. Os administradores do laboratório têm-na. Resolver um ponto precisa da capacidade da página que o resolve, por exemplo **Edit general settings** para a página Laboratório.

## Abrir as verificações

Abra **Definições** e depois **Verificações de instalação**, a segunda da lista. O CE corre as verificações ao abrir a página. Para as correr outra vez, abra o menu **⋯** e escolha **Executar de novo**.

Cada verificação mostra um estado:

| Estado | Significado |
| --- | --- |
| Passou | Nada a fazer. |
| Aviso | O CE funciona, mas algo não está como um laboratório real precisa. |
| Falhou | Algo está avariado ou inseguro. Corrija antes do uso real. |
| Ignorado | A verificação não se aplica a esta instalação. |

Um aviso ou uma falha diz o que mudar. Quando uma página de definições o resolve, uma ligação como **Abrir Laboratório** abre essa página. O topo da página conta os avisos e as falhas, ou diz **Todas as verificações passaram.**

## Exemplo 1: ler as verificações de uma instalação nova

1. Abra **Definições** e depois **Verificações de instalação**.

**Resultado esperado** numa instalação de teste nova com `AUTH_DEV_BYPASS` ligado: **3 avisos**.

| Verificação | Estado | Porquê |
| --- | --- | --- |
| Serviços | Passou | |
| Início de sessão | Aviso | O início de sessão está desligado (`AUTH_DEV_BYPASS`). Qualquer pessoa que chegue a este servidor é tratada como administrador. |
| Chave dos segredos | Passou | |
| Nome do laboratório | Aviso | O nome está vazio ou ainda é o predefinido. |
| Fuso horário | Aviso | Nenhum fuso horário está definido. |
| Conectores | Passou, 1 de 1 | O conector do armazém incluído responde. |
| Sincronização com o central | Ignorado | A sincronização está desligada. |

Numa instalação de produção, o início de sessão aparece como **Falhou**, e não como aviso.

## Exemplo 2: resolver dois avisos

![Abrir Laboratório a partir da verificação, definir o nome e o fuso horário, guardar e correr de novo.](setup-checks-fix.mp4)

1. Em **Nome do laboratório**, selecione **Abrir Laboratório**.
2. Em **Nome do laboratório**, escreva o nome do seu laboratório, por exemplo `Sample Central Laboratory`.
3. Em **Fuso horário**, escreva o seu fuso, por exemplo `Africa/Dar_es_Salaam`.
4. Abra o menu de três pontos da página e selecione **Guardar**.
5. Volte a **Verificações de instalação**, abra **⋯** e selecione **Executar de novo**.

**Resultado esperado:** **1 aviso**. O nome do laboratório e o fuso horário passam a **Passou** e mostram o que está definido. Só fica o início de sessão, que continua aviso numa instalação de teste.

![As verificações depois da correção: fica um aviso.](setup-checks-after.png)

Veja [Laboratório](/docs/laboratory) para o nome, o logótipo e o fuso horário.

## As verificações

| Verificação | O que vê | Se não estiver cumprida |
| --- | --- | --- |
| Serviços | O início de sessão, o armazenamento de ficheiros, os eventos e o armazém respondem. | O CE não consegue servir nem guardar dados. Corra `openldr health` no servidor para ver que serviço está parado. |
| Início de sessão | O início de sessão está ligado. | Com `AUTH_DEV_BYPASS` ligado, qualquer pessoa que chegue ao servidor é administrador. Falha numa instalação de produção e é aviso nas outras. |
| Chave dos segredos | `SECRETS_ENCRYPTION_KEY` está definido. | Um conector com palavra-passe não pode ser guardado nem lido. |
| Nome do laboratório | O nome está definido e não é o predefinido. | Os relatórios imprimem o nome do produto como laboratório emissor. |
| Fuso horário | Há um fuso horário definido. | O relatório mensal de transmissão conta os dias em UTC, por isso as chegadas à noite caem no dia errado. |
| Conectores | Cada conector de anfitrião ativo responde. | As importações e consultas nesse conector falham. A verificação diz qual é. |
| Sincronização com o central | A sincronização tem URL da central e site id, e o último ciclo correu bem. | Os resultados não chegam à central. |

Três verificações podem aparecer como Ignorado:

- **Fuso horário** num armazém SQL Server. A definição usa nomes de fuso IANA, que o SQL Server não usa. Deixe-a vazia e escreva o nome do fuso do Windows em cada execução de relatório.
- **Conectores** quando nenhum conector de anfitrião está ativo.
- **Sincronização com o central** quando a sincronização está desligada.

## O que as verificações não mostram

Uma verificação mostra um nome ou um número, nunca uma mensagem de erro. As mensagens de erro podem ter nomes de servidores e de utilizadores. Para o detalhe de um conector com falha, abra **Definições**, **Conectores** e escolha **Diagnosticar** nele. Veja [Ligações SQL Server e diagnóstico](/docs/connector-diagnose).

Cada execução fica no registo de auditoria, com os nomes das verificações que falharam ou deram aviso.

## Na linha de comandos

Um servidor sem interface mostra a mesma lista:

```bash
openldr doctor
```

Na instalação de teste do Exemplo 1, mostra:

```text
PASS  Services
WARN  Sign-in
      Sign-in is switched off (AUTH_DEV_BYPASS). Anyone who can reach this server is treated as an administrator. Turn it off before real use.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central

3 warnings.
```

Junte `--json` para saída legível por máquina. O comando sai com o código 1 quando uma verificação falhou. Os avisos não mudam o código, por isso este exemplo sai com 0.

## Num telemóvel

A página funciona num telemóvel. A mensagem de cada verificação passa para baixo do nome, e o estado fica ao lado do nome.

## Resolução de problemas

- **Serviços falhou.** Corra `openldr health` no servidor para ver que serviço está parado.
- **Conectores falhou.** A verificação diz qual é o conector. Corra **Diagnosticar** nele.
- **Sincronização com o central falhou.** O último ciclo falhou. **Definições**, **Sincronização distribuída**, **Atividade** diz porquê. Veja [Sincronização distribuída](/docs/sync).
- **Uma verificação não conseguiu correr.** O registo do servidor tem o motivo.

## Guias relacionados

- [Definições](/docs/settings)
- [Laboratório](/docs/laboratory)
- [Conectores](/docs/connectors)
- [Ligações SQL Server e diagnóstico](/docs/connector-diagnose)

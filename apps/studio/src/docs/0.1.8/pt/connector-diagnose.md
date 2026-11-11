# Ligar ao SQL Server e diagnosticar uma ligação

O CE consegue ligar-se a uma **instância com nome** do SQL Server e com uma **conta Windows**, como muitos sistemas de laboratório precisam. Quando uma ligação a uma base de dados falha, **Diagnosticar** verifica-a passo a passo e diz que passo falhou e o que mudar.

Leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

## Quem pode fazer o quê

Precisa de **Manage connectors**. Os administradores do laboratório têm-na.

## Antes de começar

- Saiba o nome do servidor, e o da instância se houver. O SQL Server Management Studio mostra-os como `SERVER\INSTANCE`.
- Saiba se a conta é um início de sessão SQL ou uma conta Windows.

## Exemplo 1: diagnosticar uma ligação que funciona

![Escolher Diagnosticar em Target Warehouse (Postgres). Todos os passos passam.](connector-diagnose-ok.mp4)

1. Abra **Definições** e depois **Conectores**.
2. Na linha **Target Warehouse (Postgres)**, abra **⋯** e selecione **Diagnosticar**.

**Resultado esperado:** **Todas as verificações passaram.** Cada passo mostra o que encontrou: o endereço, o nome resolvido para `127.0.0.1`, a porta aberta, o início de sessão e a versão do servidor.

![O diagnóstico do conector do armazém.](connector-diagnose-passed.png)

Nesta instalação de teste, o passo **Definições** mostra um aviso: o host é `localhost`. Quando o CE corre em Docker, `localhost` é o próprio contentor do CE, não a máquina que corre a base de dados. Use o nome ou o endereço IP do servidor.

## Exemplo 2: uma instância com nome que não responde

Junte um conector para uma base v1 numa instância com nome, e veja o diagnóstico encontrar o passo avariado.

![Adicionar um conector Microsoft SQL com localhost\SQLEXPRESS como host.](connector-diagnose-add.mp4)

1. Em **Conectores**, abra o menu **⋯** da página e selecione **Adicionar conector**.
2. Defina **Categoria** como **Anfitrião** e **Tipo de base de dados** como **Microsoft SQL**.
3. Preencha o formulário:

   | Campo | Valor de exemplo |
   | --- | --- |
   | Nome | `v1 database (example)` |
   | Host | `localhost\SQLEXPRESS` |
   | Base de dados | `OpenLDRData` |
   | Utilizador | `v1_reader` |
   | Senha | a palavra-passe da conta |

   ![O formulário Microsoft SQL.](connector-diagnose-form.png)

4. Abra o menu **⋯** do painel e selecione **Salvar**.
5. Na linha nova, abra **⋯** e selecione **Diagnosticar**.

![Diagnosticar o conector novo. Para em SQL Server Browser.](connector-diagnose-browser.mp4)

**Resultado esperado:** **A verificação falhou no passo: SQL Server Browser.** O nome do servidor passou. SQL Server Browser mostra **no reply from SQL Server Browser within 3000 ms**, com a correção: arrancar o serviço SQL Server Browser, abrir UDP 1434 na firewall, ou limpar o nome da instância e indicar a porta TCP fixa. Porta, Início de sessão e Versão do servidor não foram tentados.

![O diagnóstico, parado em SQL Server Browser.](connector-diagnose-failed.png)

A caixa Host mantém `localhost\SQLEXPRESS` tal como foi escrito. O CE separa-o em servidor e instância quando se liga, e é por isso que o passo SQL Server Browser correu. Corrija a instância ou a firewall e escolha **Executar de novo** no menu **⋯** do diagnóstico.

Para retirar o exemplo, abra o menu **⋯** da linha e selecione **Remover**.

## O formulário SQL Server

| Campo | O que escrever |
| --- | --- |
| Host | O nome ou o endereço IP do servidor. Também pode escrever `SERVER\INSTANCE`. O CE separa-o por si. |
| Nome da instância | A parte depois da barra invertida, por exemplo `SQLEXPRESS`. Deixe vazio para a instância predefinida. |
| Porta | Normalmente `1433`. O CE ignora a porta quando há nome de instância, porque o SQL Server Browser indica a porta da instância. |
| Base de dados | O nome da base de dados. |
| Domínio Windows | Deixe vazio para um início de sessão SQL. Preencha para uma conta Windows, por exemplo `LAB`. |
| Utilizador | O início de sessão SQL, ou o nome de utilizador Windows sem o domínio. |
| Senha | A palavra-passe. Fica guardada encriptada. |
| Encriptar | Ligado por predefinição. Desligue-o para um SQL Server antigo (2008 ou 2012) que só oferece TLS antigo. |
| Confiar no certificado do servidor | Ligue-o para um servidor da rede do laboratório que usa o seu próprio certificado. |

Quando o CE corre em Docker, `localhost` é o contentor do CE, não o seu servidor. Use o nome ou o endereço IP do servidor.

## Os passos de um diagnóstico

O CE corre-os por ordem e para na primeira falha. Os passos seguintes aparecem como ignorados.

| Passo | O que verifica |
| --- | --- |
| Definições | Há um host e a porta é um número válido. |
| Nome do servidor | O nome resolve para um endereço a partir do servidor CE. |
| SQL Server Browser | Só para uma instância com nome. O SQL Server Browser, na porta UDP 1434, lista a instância e a sua porta TCP. |
| Porta | A porta TCP responde. |
| Início de sessão | O CE consegue iniciar sessão e abrir a base de dados. |
| Versão do servidor | O CE consegue correr uma consulta, e mostra a versão do servidor. |

Cada passo que falha diz o que mudar.

## Resolução de problemas

- **O nome do servidor não resolve.** Use o endereço IP, ou junte o nome ao DNS ou ao ficheiro hosts do servidor CE.
- **Porta: sem resposta.** Uma firewall bloqueia a porta. Abra-a no servidor da base de dados, ou na rede entre as duas máquinas.
- **Porta: nada escuta.** O TCP/IP está desligado, ou a porta está errada. Ative o TCP/IP no SQL Server Configuration Manager.
- **SQL Server Browser: sem resposta.** Arranque o serviço SQL Server Browser e abra UDP 1434. Ou limpe o nome da instância e indique a porta TCP fixa da instância.
- **O SQL Server Browser respondeu, mas a instância não aparece.** Confirme o nome da instância e ative o TCP/IP para ela.
- **Início de sessão recusado.** Confirme o utilizador e a palavra-passe. O SQL Server pode só aceitar contas Windows. Nesse caso preencha o domínio Windows.
- **A base de dados não abre.** O início de sessão funcionou, mas a base não existe ou o utilizador não a pode abrir. Confirme o nome e o acesso.
- **Certificado não confiável.** Ligue **Confiar no certificado do servidor**.
- **TLS antigo recusado.** Desligue **Encriptar**, ou atualize o SQL Server.

## Na linha de comandos

Corra as mesmas verificações num servidor sem interface:

```bash
openldr connectors diagnose <connector-id>
```

Para o conector do armazém do Exemplo 1, mostra:

```text
WARN  config   localhost:5433
      When CE runs in Docker, localhost is the CE container itself. Use the server name or IP address of the machine that runs the database.
PASS  dns      localhost resolved to 127.0.0.1
PASS  tcp      port 5433 is open
PASS  login
PASS  version  PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

All checks passed.
```

Junte `--json` para saída legível por máquina. O comando sai com o código 1 quando um passo falha. O id vem de `GET /api/connectors`.

## Num telemóvel

O diagnóstico cobre quase todo o ecrã de um telemóvel, e a mensagem de cada passo passa para baixo dele. A tabela de conectores é mais larga do que o ecrã: deslize-a para o lado para chegar ao menu **⋯** de cada linha.

## Guias relacionados

- [Conectores](/docs/connectors)
- [Verificações de instalação](/docs/setup-checks)
- [Importar do OpenLDR v1](/docs/v1-import)

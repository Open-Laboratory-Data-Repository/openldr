# Ligar ao SQL Server e diagnosticar uma ligação

## Resultado

Pode ligar o CE a uma instância nomeada do SQL Server, ou com uma conta Windows. Quando uma ligação falha, vê qual passo falhou e o que mudar.

## Antes de começar

- Precisa da capacidade `connectors.manage` (os administradores do laboratório têm-na).
- Saiba o nome do servidor, e o nome da instância se existir. O SQL Server Management Studio mostra-os como `SERVIDOR\INSTANCIA`.
- Saiba se a conta é um início de sessão SQL ou uma conta Windows.

## Preencher o formulário do SQL Server

Abra **Definições > Conectores**, abra o menu **⋯** e escolha **Adicionar conector**. Escolha a categoria host e **Microsoft SQL**.

| Campo | O que introduzir |
| --- | --- |
| Host | O nome ou o endereço IP do servidor. Também pode escrever `SERVIDOR\INSTANCIA`. O CE separa-o por si. |
| Nome da instância | A parte depois da barra invertida, por exemplo `SQLEXPRESS`. Deixe vazio para a instância predefinida. |
| Porta | Normalmente `1433`. O CE ignora a porta quando há um nome de instância, porque o SQL Server Browser indica a porta da instância. |
| Base de dados | O nome da base de dados. |
| Domínio Windows | Deixe vazio para um início de sessão SQL. Preencha para uma conta Windows, por exemplo `LAB`. |
| Utilizador | O início de sessão SQL, ou o nome de utilizador Windows sem o domínio. |
| Palavra-passe | A palavra-passe. É guardada encriptada. |
| Encriptar | Ligado por predefinição. Desligue para um SQL Server antigo (2008 ou 2012) que só oferece TLS antigo. |
| Confiar no certificado do servidor | Ligue para um servidor na rede do laboratório que usa o seu próprio certificado. |

Quando o CE corre em Docker, `localhost` é o contentor do CE, não o seu servidor. Use o nome ou o endereço IP do servidor.

## Diagnosticar uma ligação

Abra o menu **⋯** da linha do conector e escolha **Diagnosticar**. O CE faz estas verificações por ordem e para na primeira falha. Os passos depois de uma falha aparecem como ignorados.

| Passo | O que verifica |
| --- | --- |
| Definições | Há um host e a porta é um número válido. |
| Nome do servidor | O nome é resolvido para um endereço a partir do servidor CE. |
| SQL Server Browser | Só para uma instância nomeada. O SQL Server Browser, na porta UDP 1434, lista a instância e a sua porta TCP. |
| Porta | A porta TCP responde. |
| Início de sessão | O CE consegue iniciar sessão e abrir a base de dados. |
| Versão do servidor | O CE consegue executar uma consulta, e mostra a versão do servidor. |

Cada passo falhado diz o que mudar. Corrija e escolha **Executar de novo** no menu **⋯** do painel.

## Correções comuns

- **Porta: sem resposta.** Uma firewall bloqueia a porta. Abra-a no servidor de base de dados, ou na rede entre as duas máquinas.
- **Porta: nada escuta.** O TCP/IP está desligado, ou a porta está errada. Ative o TCP/IP no SQL Server Configuration Manager.
- **SQL Server Browser: sem resposta.** Inicie o serviço SQL Server Browser e abra UDP 1434. Ou limpe o nome da instância e indique a porta TCP fixa da instância.
- **Início de sessão recusado.** Verifique o utilizador e a palavra-passe. O SQL Server pode aceitar só contas Windows. Nesse caso, preencha o domínio Windows.
- **Certificado não confiável.** Ligue **Confiar no certificado do servidor**.
- **TLS antigo recusado.** Desligue **Encriptar**, ou atualize o SQL Server.

## Na linha de comandos

Execute as mesmas verificações num servidor sem ecrã:

```bash
openldr connectors diagnose <connector-id>
```

Adicione `--json` para uma saída legível por máquina. O comando termina com o código 1 quando um passo falha.

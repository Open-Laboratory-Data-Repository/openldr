# Verificações de instalação

## Resultado

Vê o que ainda falta a esta instalação para estar pronta, e abre a página que corrige cada ponto.

## Antes de começar

- Precisa da capacidade `settings.view` (os administradores do laboratório têm-na).

## Abrir as verificações

Abra **Definições > Verificações de instalação**. O CE executa as verificações quando a página abre. Para as repetir, abra o menu **⋯** e escolha **Executar de novo**.

Cada verificação mostra um estado:

| Estado | Significado |
| --- | --- |
| Passou | Nada a fazer. |
| Aviso | O CE funciona, mas algo não está como um laboratório real precisa. |
| Falhou | Algo está avariado ou inseguro. Corrija antes do uso real. |
| Ignorado | A verificação não se aplica a esta instalação. |

Um aviso ou uma falha indica o que mudar. Quando uma página de definições o corrige, uma ligação abre essa página.

## As verificações

| Verificação | O que observa | Se não for cumprida |
| --- | --- | --- |
| Serviços | O início de sessão, o armazenamento de ficheiros, os eventos e o armazém respondem. | O CE não consegue servir nem guardar dados. Execute `openldr health` no servidor para ver que serviço está em baixo. |
| Início de sessão | O início de sessão está ligado. | Com `AUTH_DEV_BYPASS` ligado, qualquer pessoa que chegue ao servidor é administrador. É uma falha em produção e um aviso noutros casos. |
| Chave dos segredos | `SECRETS_ENCRYPTION_KEY` está definida. | Um conector com palavra-passe não pode ser guardado nem lido. |
| Nome do laboratório | O nome está definido, e não é o valor de origem. | Os relatórios imprimem o nome do produto como laboratório emissor. |
| Fuso horário | Há um fuso horário definido. | O relatório mensal de transmissão conta os dias em UTC, por isso as chegadas da noite caem no dia errado. |
| Conectores | Cada conector anfitrião ativo responde. | As importações e as consultas nesse conector falham. A verificação indica o nome do conector. |
| Sincronização com o central | A sincronização tem um URL do central e um identificador do local, e o último ciclo funcionou. | Os resultados não chegam ao central. |

Três verificações podem mostrar Ignorado:

- **Fuso horário** com um armazém SQL Server. A definição aceita nomes de fuso IANA, que o SQL Server não usa. Deixe-a vazia e escreva o nome de fuso Windows em cada execução de relatório.
- **Conectores** quando nenhum conector anfitrião está ativo.
- **Sincronização com o central** quando a sincronização está desligada.

## O que as verificações não mostram

Uma verificação mostra um nome ou uma contagem, nunca uma mensagem de erro. As mensagens de erro podem conter nomes de servidores e de utilizadores. Para o detalhe de um conector com falha, abra **Definições > Conectores** e escolha **Diagnosticar**.

Cada execução fica no registo de auditoria com os nomes das verificações que falharam ou deram aviso.

## Na linha de comandos

Um servidor sem ecrã mostra a mesma lista:

```bash
openldr doctor
```

Adicione `--json` para uma saída legível por máquina. O comando termina com o código 1 quando uma verificação falhou. Os avisos não alteram o código de saída.

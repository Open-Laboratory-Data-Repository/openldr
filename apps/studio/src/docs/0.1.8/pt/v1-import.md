# Importar do OpenLDR v1

O plugin **OpenLDR v1 import** copia pedidos, pacientes, resultados e resultados de antibiograma de uma base de dados SQL Server do OpenLDR v1 para o CE. A importação corre no servidor CE, página a página. Pode pará-la e continuar mais tarde, e voltar a corrê-la substitui os registos em vez de os duplicar.

O plugin nunca abre ele próprio uma ligação a uma base de dados. Fornece consultas só de leitura. O CE corre-as num conector que autorizar, e guarda o que o plugin converte.

Leva cerca de 10 minutos a ler. A importação de uma base v1 grande demora muito mais. Este guia ainda não tem imagens: o pacote do plugin não está publicado no marketplace, e é preciso uma base v1 para o mostrar a funcionar.

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **Manage connectors** | Autorizar ou retirar o acesso do plugin a um conector |
| Função Lab Admin | Abrir a página do plugin, correr verificações, ensaios e importações |

## Antes de começar

- O plugin **OpenLDR v1 import** está instalado. Instale-o em **Definições**, **Marketplace**, ou com `openldr plugin install` para um ficheiro de plugin. Veja [Marketplace](/docs/marketplace).
- Um conector Microsoft SQL aponta para a base v1. Veja [Ligar ao SQL Server e diagnosticar uma ligação](/docs/connector-diagnose). Corra primeiro **Diagnosticar** nele: todos os passos devem passar.
- Saiba o desvio UTC do laboratório que escreveu os dados v1, por exemplo `+02:00`.

## Exemplo 1: autorizar o plugin a ler o conector v1

1. Abra **Definições** e depois **Conectores**.
2. No conector SQL Server v1, abra **⋯** e escolha **Acesso de plugins**.
3. Ligue o interruptor de `openldr-v1-import`.

**Resultado esperado:** o interruptor fica ligado. A autorização e a retirada ficam ambas no registo de auditoria, com quem as fez. Desligue o interruptor para o plugin deixar de ler esse conector.

Se o painel disser que nenhum plugin instalado importa deste tipo de conector, o plugin não está instalado, ou o conector não é Microsoft SQL.

## Exemplo 2: verificar, ensaiar e importar

Abra **OpenLDR v1 import** na barra lateral. A página tem cinco passos.

| Passo | O que faz |
| --- | --- |
| 1. Origem | Escolha o conector. **Verificar a ligação** testa-o passo a passo. |
| 2. Opções | Defina o fuso horário do site. As outras opções são opcionais. |
| 3. Verificações | O CE conta as tabelas e linhas v1. Nada é importado. |
| 4. Ensaio | O CE lê e converte alguns pedidos e não guarda nada. |
| 5. Importação | Arranque a importação, acompanhe-a, pare-a ou retome-a. |

1. **Origem.** Escolha o conector v1 e selecione **Verificar a ligação**. Todos os passos devem passar.
2. **Opções.** Defina **Fuso horário do site**, por exemplo `+02:00`. Deixe o resto vazio para importar tudo.
3. **Verificações.** Têm de ser encontradas **4 de 4** tabelas: `Requests`, `LabResults`, `Patients` e `ASTResults`. Se faltar alguma, veja o nome da base no passo Opções.
4. **Ensaio.** Escreva `100` e escolha **Iniciar ensaio**. A página mostra quantos pedidos seriam guardados e quantos falharam, cada falha com um motivo. Pode continuar quando o ensaio terminar.
5. **Importação.** Escolha **Iniciar importação**.

**Resultado esperado:** a página mostra os pedidos lidos, guardados e com falha, o número de registos e a velocidade. Os contadores avançam uma página de cada vez. Uma página tem 500 pedidos, por isso os números podem ficar parados algum tempo.

- Pode sair da página. A importação continua no servidor. A página abre na importação em curso quando voltar.
- **Parar** termina a importação depois da página em que está a trabalhar.
- **Retomar** continua a partir do último pedido feito. Use-o depois de uma paragem, de uma falha ou de um reinício do servidor.
- Um pedido já importado é substituído, não duplicado. Voltar a correr a importação é seguro.

### Opções

| Opção | Significado |
| --- | --- |
| Fuso horário do local | Obrigatório. As datas v1 não têm fuso horário, por isso este valor define a hora guardada. Use a forma `+02:00`, ou `Z`. |
| Base de dados | Deixe vazio para usar a base de dados definida no conector. |
| Data inicial, Data final | Limitam a importação pela data de registo. Deixe ambas vazias para importar tudo. |
| Códigos de painel | Códigos de painel v1 separados por vírgulas. Deixe vazio para todos os painéis. |

## Pedidos com falha

Um pedido com falha não para a importação. A página lista os primeiros 100 com um motivo. O CE guarda apenas um código de motivo, nunca o conteúdo da linha.

| Código | Significado |
| --- | --- |
| `NO_REQUEST_ROWS` | O pedido não tem linhas na tabela Requests. |
| `NO_OBR_SET_ID` | Uma linha de pedido não tem OBRSetID. |
| `NO_OBX_ID` | Uma linha de resultado não tem OBXSetID ou OBXSubID. |
| `BAD_REQUEST_ID` | O RequestID não pode ser usado como identificador de registo. |
| `SAVE_FAILED` | O CE não conseguiu guardar o pedido. |
| `INVALID_RESOURCE` | O plugin devolveu um registo que o CE não aceita. |

## Auditoria e Atividade

- Cada importação aparece na página **Atividade** como uma única entrada. Mostra o plugin, quem a iniciou, e quantos pedidos foram importados ou falharam. O estado é Em curso, Parada, Concluída ou Falhou. Um ensaio não guarda nada e não é listado.
- A página **Auditoria** regista cada autorização, remoção, início, paragem, retoma e fim, com quem o fez.
- O CE escreve primeiro a entrada de auditoria. Se não puder ser escrita, o CE recusa autorizar um conector, e iniciar ou retomar uma importação.
- Cada registo importado guarda o identificador da importação, o plugin e a sua versão, e o sistema de origem.

Uma importação não inicia um fluxo de trabalho para cada pedido. Os fluxos que reagem ao evento `data.persisted` não correm para os registos importados.

## Na linha de comandos

Um servidor sem ecrã executa a mesma importação:

```bash
openldr import allow openldr-v1-import <connector-id>
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
```

```bash
openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
```

`Ctrl+C` para a importação na página seguinte. Outros comandos: `openldr import status`, `stop`, `resume`, `failures`, `allowed` e `revoke`. Adicione `--json` para uma saída legível por máquina.

## Num telemóvel

A página do plugin foi feita para caber num telemóvel. Arrancar uma importação longa continua a ser mais fácil num computador.

## Resolução de problemas

- **O plugin não está na barra lateral.** Instale-o a partir do Marketplace.
- **Acesso de plugins não lista nada.** O conector não é Microsoft SQL, ou o plugin não está instalado.
- **Verificar a ligação falha.** Corra **Diagnosticar** no conector e corrija o passo indicado.
- **As verificações encontram menos de 4 de 4 tabelas.** O nome da base está errado. Defina-o no passo Opções, ou no conector.
- **Os contadores não mexem.** Uma página tem 500 pedidos. Espere pela página seguinte antes de concluir que parou.
- **A importação recusa arrancar.** O CE não conseguiu escrever a entrada de auditoria, e recusa autorizar, arrancar ou retomar sem ela. Veja o registo do servidor.
- **Os fluxos não correram para os registos importados.** É normal. Uma importação não emite `data.persisted`.

## Guias relacionados

- [Ligar ao SQL Server e diagnosticar uma ligação](/docs/connector-diagnose)
- [Conectores](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Atividade](/docs/activity)
- [Auditoria](/docs/audit)

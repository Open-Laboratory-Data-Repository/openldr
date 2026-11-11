# Importar do OpenLDR v1

## Resultado

Pode copiar pedidos, pacientes, resultados e resultados AST de uma base de dados SQL Server do OpenLDR v1 para o CE. A importação corre no servidor do CE. Pode pará-la e retomá-la mais tarde.

## Antes de começar

- Precisa da função `lab_admin`, e da capacidade `connectors.manage` para autorizar o conector.
- O plugin **OpenLDR v1 import** está instalado. Instale-o em **Definições > Marketplace**, ou com `openldr plugin install` para um ficheiro de plugin.
- Um conector Microsoft SQL aponta para a base de dados v1. Veja [Ligar ao SQL Server e diagnosticar uma ligação](/docs/connector-diagnose).
- Saiba a diferença UTC do laboratório que escreveu os dados v1, por exemplo `+02:00`.

O plugin nunca abre ele próprio uma ligação a uma base de dados. Fornece consultas só de leitura. O CE executa-as num conector que autorizar, e guarda o que o plugin converte.

## Autorizar o conector

1. Abra **Definições > Conectores**.
2. Abra o menu **⋯** do conector SQL Server v1 e escolha **Acesso de plugins**.
3. Ligue o interruptor de `openldr-v1-import`.

Desligue o interruptor para o plugin deixar de ler esse conector. As duas alterações ficam no registo de auditoria.

## Executar a importação

Abra **OpenLDR v1 import** na barra lateral. A página tem cinco passos.

| Passo | O que faz |
| --- | --- |
| 1. Origem | Escolha o conector. **Verificar a ligação** testa-o passo a passo. |
| 2. Opções | Indique o fuso horário do local. As outras opções são opcionais. |
| 3. Verificações | O CE conta as tabelas e as linhas v1. Nada é importado. |
| 4. Ensaio | O CE lê e converte alguns pedidos e não guarda nada. |
| 5. Importação | Inicie a importação, acompanhe-a, pare-a ou retome-a. |

### Opções

| Opção | Significado |
| --- | --- |
| Fuso horário do local | Obrigatório. As datas v1 não têm fuso horário, por isso este valor define a hora guardada. Use a forma `+02:00`, ou `Z`. |
| Base de dados | Deixe vazio para usar a base de dados definida no conector. |
| Data inicial, Data final | Limitam a importação pela data de registo. Deixe ambas vazias para importar tudo. |
| Códigos de painel | Códigos de painel v1 separados por vírgulas. Deixe vazio para todos os painéis. |

### Verificações

A importação precisa de quatro tabelas: `Requests`, `LabResults`, `Patients` e `ASTResults`. Se a página mostrar menos de 4 de 4, verifique o nome da base de dados no passo Opções.

### Ensaio

Introduza quantos pedidos experimentar, de 1 a 5000, e escolha **Iniciar ensaio**. A página mostra quantos pedidos seriam guardados e quantos falharam. Cada pedido com falha aparece com um motivo. Pode continuar quando o ensaio terminar.

### Importação

Escolha **Iniciar importação**. A página mostra os pedidos lidos, guardados e com falha, o número de registos e a velocidade.

- Os contadores avançam uma página de cada vez. Uma página tem 500 pedidos, por isso os números podem ficar parados algum tempo.
- Pode sair da página. A importação continua no servidor. A página abre na importação em curso quando voltar.
- **Parar** termina a importação depois da página em que está a trabalhar.
- **Retomar** continua a partir do último pedido tratado. Use-o depois de uma paragem, de uma falha ou de um reinício do servidor.
- Um pedido já importado é substituído, não duplicado. Repetir a importação é seguro.

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

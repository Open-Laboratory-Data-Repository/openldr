# Importar do OpenLDR v1

O plugin **OpenLDR v1 import** copia pedidos, pacientes, resultados e resultados AST de uma base de dados SQL Server do OpenLDR v1 para o CE. O plugin nunca abre ele próprio uma ligação a uma base de dados. Fornece consultas só de leitura, e o CE executa-as num conector que um administrador autoriza.

Autorize primeiro o conector. Abra **Definições > Conectores**, abra o menu **⋯** do conector SQL Server v1, escolha **Acesso de plugins**, e ligue o interruptor do plugin.

Depois abra **OpenLDR v1 import** na barra lateral. A página tem cinco passos: escolher o conector, definir as opções, verificar as tabelas v1, experimentar alguns pedidos sem guardar, e executar a importação. O fuso horário do local é obrigatório, na forma `+02:00`, porque as datas v1 não têm fuso horário.

A importação corre no servidor do CE, por isso pode sair da página. **Parar** termina-a depois da página de 500 pedidos em curso. **Retomar** continua a partir do último pedido tratado, também depois de um reinício do servidor. Um pedido já importado é substituído, não duplicado. Um pedido com falha não para a importação. O CE lista-o com um código de motivo e nunca guarda o conteúdo da linha. Cada importação aparece na página Atividade como uma única entrada, e a página Auditoria regista quem a autorizou, iniciou, parou e retomou. O CE escreve primeiro a entrada de auditoria e recusa iniciar se não a puder escrever.

Num servidor sem ecrã, use `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, e `openldr import status`, `stop`, `resume` e `failures`.

# Import from OpenLDR v1

## English

The **OpenLDR v1 import** plugin copies requests, patients, results and AST results from an OpenLDR v1 SQL Server database into CE. The plugin never opens a database connection itself. It supplies read-only queries, and CE runs them on a connector an admin allows.

Allow the connector first. Open **Settings > Connectors**, open the **⋯** menu of the v1 SQL Server connector, choose **Plugin access**, and turn on the switch for the plugin.

Then open **OpenLDR v1 import** in the sidebar. The page has five steps: pick the connector, set the options, check the v1 tables, try a few requests without saving, and run the import. The site time zone is required, in `+02:00` style, because v1 dates have no time zone.

The import runs on the CE server, so you can leave the page. **Stop** ends it after the page of 500 requests it is working on. **Resume** carries on from the last request done, also after a server restart. A request imported before is replaced, not duplicated. A failed request does not stop the import. CE lists it with a reason code and never stores the row's content.

Headless servers use `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, and `openldr import status`, `stop`, `resume` and `failures`.

## Français

Le plugin **OpenLDR v1 import** copie les demandes, les patients, les résultats et les résultats AST d'une base SQL Server OpenLDR v1 vers CE. Le plugin n'ouvre jamais lui-même de connexion à une base. Il fournit des requêtes en lecture seule, et CE les exécute sur un connecteur qu'un administrateur autorise.

Autorisez d'abord le connecteur. Ouvrez **Paramètres > Connecteurs**, ouvrez le menu **⋯** du connecteur SQL Server v1, choisissez **Accès des plugins**, et activez l'interrupteur du plugin.

Ouvrez ensuite **OpenLDR v1 import** dans la barre latérale. La page compte cinq étapes : choisir le connecteur, régler les options, vérifier les tables v1, essayer quelques demandes sans enregistrer, et lancer l'import. Le fuseau horaire du site est obligatoire, sous la forme `+02:00`, car les dates v1 n'ont pas de fuseau.

L'import s'exécute sur le serveur CE, donc vous pouvez quitter la page. **Arrêter** le termine après la page de 500 demandes en cours. **Reprendre** continue à partir de la dernière demande traitée, même après un redémarrage du serveur. Une demande déjà importée est remplacée, pas dupliquée. Une demande en échec n'arrête pas l'import. CE la liste avec un code de raison et ne stocke jamais le contenu de la ligne.

Sur un serveur sans écran, utilisez `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, puis `openldr import status`, `stop`, `resume` et `failures`.

## Português

O plugin **OpenLDR v1 import** copia pedidos, pacientes, resultados e resultados AST de uma base de dados SQL Server do OpenLDR v1 para o CE. O plugin nunca abre ele próprio uma ligação a uma base de dados. Fornece consultas só de leitura, e o CE executa-as num conector que um administrador autoriza.

Autorize primeiro o conector. Abra **Definições > Conectores**, abra o menu **⋯** do conector SQL Server v1, escolha **Acesso de plugins**, e ligue o interruptor do plugin.

Depois abra **OpenLDR v1 import** na barra lateral. A página tem cinco passos: escolher o conector, definir as opções, verificar as tabelas v1, experimentar alguns pedidos sem guardar, e executar a importação. O fuso horário do local é obrigatório, na forma `+02:00`, porque as datas v1 não têm fuso horário.

A importação corre no servidor do CE, por isso pode sair da página. **Parar** termina-a depois da página de 500 pedidos em curso. **Retomar** continua a partir do último pedido tratado, também depois de um reinício do servidor. Um pedido já importado é substituído, não duplicado. Um pedido com falha não para a importação. O CE lista-o com um código de motivo e nunca guarda o conteúdo da linha.

Num servidor sem ecrã, use `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, e `openldr import status`, `stop`, `resume` e `failures`.

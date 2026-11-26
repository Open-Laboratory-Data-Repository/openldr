# O plugin de laboratório

O plugin de laboratório acrescenta uma página **Lab** ao studio. A receção do laboratório encontra um pedido pelo número de requisição, regista-o se for preciso, recebe amostras, e devolve ou rejeita o que não pode usar. O pessoal de um local regista os seus próprios pedidos e vê apenas os pedidos da sua unidade sanitária. A bancada introduz os resultados, e um validador valida-os. O plugin guarda os seus dados nas suas próprias tabelas, no esquema `plugin_lab`. O CE funciona da mesma forma sem ele.

Os resultados validados chegam aos relatórios do CE. Enquanto um resultado não for validado, o seu pedido, a amostra e os valores ficam nas tabelas do plugin. Um paciente registado de novo chega logo ao CE.

O plugin ainda não está no marketplace. Esta página diz como experimentar um pacote assinado numa instalação de teste.

## O que precisa

- Esta versão do CE. O plugin lê as unidades sanitárias, as análises e os pacientes pelas funções do anfitrião do CE.
- Unidades sanitárias no registo de unidades, e as análises do seu laboratório ligadas no catálogo de exames. Cada análise precisa de um tipo de amostra, ou a receção não pode receber uma amostra para ela.

## Instalar um pacote assinado

```sh
openldr artifact publish <bundle-directory> --to <registry-folder> --install --approve
```

Depois reinicie o servidor. Uma instalação pela linha de comandos só chega a um servidor em execução depois de reiniciar. A entrada **Lab** aparece então na barra lateral para quem tem uma das suas permissões.

## Dar acesso

O plugin acrescenta sete permissões. A função Administrador recebe todas na instalação. Dê-as a outras funções na página **Funções**, ou com `openldr roles grant <role> <key>`.

- `lab.receive`, **Receber amostras**: o separador **Receção**.
- `lab.reject`, **Rejeitar e devolver**: devolver um pedido ao seu local, e rejeitar amostras e análises.
- `lab.orders.enter`, **Registar pedidos**: o separador **Pedidos**, e novos pedidos nele.
- `lab.worklist.view`, **Ver os pedidos do laboratório**: o separador **Pedidos**, e os valores dos resultados de um pedido, só para leitura.
- `lab.results.enter`, **Registar resultados**: o separador **Resultados**.
- `lab.results.authorise`, **Autorizar resultados**: o separador **Validação**, para devolver ou validar resultados.
- `lab.settings`, **Definições do laboratório**: o separador **Definições**, que liga ou desliga a autovalidação.

`lab.reject` sozinho não abre nenhum separador. Dê-o com `lab.receive` ou `lab.worklist.view`.

A receção e os locais precisam também de `patients.find` (**Find a patient**, encontrar um paciente; a página Funções mostra-a em inglês) para encontrar e registar pacientes.

Um pedido guarda só uma ligação ao paciente, nunca o nome. O nome é lido no CE cada vez que um pedido é mostrado, com os direitos de quem olha. Um perfil com `patients.find` ou `patients.view`, e também `patients.view_identifiers` (**View patient identifiers**, ver identificadores de pacientes), vê o nome completo. Sem `patients.view_identifiers`, o nome aparece oculto, como nas páginas do CE. Um perfil sem nenhuma permissão de pacientes, por exemplo só com `lab.worklist.view`, vê **não disponível** no lugar do nome. Um utilizador de local limitado a uma unidade vê sempre os nomes ocultos, porque o limite retira `patients.view_identifiers`.

Limite cada utilizador de local à sua unidade com `openldr users scope <user> --facility <facility-id> --force`. Esse utilizador vê então apenas os pedidos dessa unidade. Um pedido de outra unidade é tratado como não encontrado.

## O que chega ao CE

Quando um validador valida um resultado, o plugin envia ao CE um ServiceRequest para a análise, um Specimen para cada amostra, uma Observation por parâmetro de resultado, e uma Provenance que diz quem o validou. Cada Observation é `final`. Leva o valor e a unidade, o sinalizador em `interpretation`, e o intervalo em `referenceRange`, com o nome do intervalo como `text`. O `subject` de cada registo é a ficha do paciente no CE. O CE guarda-os como os registos de qualquer outra fonte, e o seu armazém preenche `lab_requests` e `lab_results`, por isso os resultados aparecem nos relatórios e painéis.

O plugin mostra o código de teste às pessoas. Envia o teste como uma codificação com o sistema `urn:openldr:codesystem:test-catalog:test-code` e o código de teste. A codificação LOINC vem primeiro quando há uma, depois o código de teste, depois as codificações adicionais do teste, depois o identificador fixo como codificação em `urn:openldr:codesystem:test-catalog`.

Um resultado sim/não segue como `valueBoolean` e uma data como `valueDateTime`. Um campo de várias respostas envia uma Observation por resposta. No armazém, um sim/não chega como o texto `true` ou `false`, uma data como a data, e várias respostas como uma linha cada.

O plugin recusa um campo obrigatório vazio e um valor fora dos limites do campo definidos no catálogo de testes. Um campo opcional pode ficar vazio. Use o plugin publicado com este CE. Um plugin mais antigo trata os campos sim/não, data e de várias respostas como texto e recusa-os.

Uma análise rejeitada chega ao CE quando a rejeição é definitiva: logo, se for rejeitada sem nova colheita, ou quando o seu pedido de nova colheita é ligado. Chega como um ServiceRequest `revoked` com o motivo da rejeição, que preenche `lab_requests.rejection_code` e `rejection_reason`.

O CE só aceita estes registos de um utilizador sem limite de unidade, que tenha também `patients.find` ou `patients.view`. Por isso um validador tem de ver todas as unidades. Uma rejeição feita por um utilizador de local limitado a uma unidade aguarda no plugin até um utilizador sem limite agir, ou até um validador selecionar **Tentar de novo** no separador **Validação**.

Por omissão, quem introduziu um resultado não o pode validar. Quem tem `lab.settings` pode ligar **Permitir autovalidação**. A Provenance regista então `self-authorise`.

Um resultado validado fica bloqueado. O plugin ainda não o pode corrigir.

O separador **Guia** da página **Lab** mostra cada tarefa passo a passo.

## Uma edição está indisponível nos relatórios do CE

O módulo Laboratory pode abrir uma edição quando o CE regista as versões dos recursos no momento da emissão. Uma instalação anterior pode conter um DiagnosticReport com o mesmo identificador sem registo da edição. O painel do laboratório conserva a cópia emitida. A falta de um resultado histórico ou de permissões também torna a edição indisponível. A consulta no CE exige acesso aos dados sem restrições e permissões para ver relatórios, relatórios clínicos emitidos, pacientes e identificadores de pacientes.

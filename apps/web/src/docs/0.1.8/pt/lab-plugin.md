# O plugin de laboratório

O plugin de laboratório acrescenta uma página **Lab** ao studio. A receção do laboratório encontra um pedido pelo número de requisição, regista-o se for preciso, recebe amostras, e devolve ou rejeita o que não pode usar. O pessoal de um local regista os seus próprios pedidos e vê apenas os pedidos da sua unidade sanitária. O plugin guarda os seus dados nas suas próprias tabelas, no esquema `plugin_lab`. O CE funciona da mesma forma sem ele.

Os pedidos e as amostras ficam nas tabelas do plugin e ainda não chegam aos relatórios do CE. Só um paciente registado de novo chega ao CE.

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

O plugin acrescenta quatro permissões. A função Administrador recebe as quatro na instalação. Dê-as a outras funções na página **Funções**, ou com `openldr roles grant <role> <key>`.

- `lab.receive`, **Receber amostras**: o separador **Receção**.
- `lab.reject`, **Rejeitar e devolver**: devolver um pedido ao seu local, e rejeitar amostras e análises.
- `lab.orders.enter`, **Registar pedidos**: o separador **Pedidos**, e novos pedidos nele.
- `lab.worklist.view`, **Ver os pedidos do laboratório**: o separador **Pedidos**.

`lab.reject` sozinho não abre nenhum separador. Dê-o com `lab.receive` ou `lab.worklist.view`.

A receção e os locais precisam também de `patients.find` (**Find a patient**, encontrar um paciente; a página Funções mostra-a em inglês) para encontrar e registar pacientes.

Um pedido guarda só uma ligação ao paciente, nunca o nome. O nome é lido no CE cada vez que um pedido é mostrado, com os direitos de quem olha. Um perfil com `patients.find` ou `patients.view`, e também `patients.view_identifiers` (**View patient identifiers**, ver identificadores de pacientes), vê o nome completo. Sem `patients.view_identifiers`, o nome aparece oculto, como nas páginas do CE. Um perfil sem nenhuma permissão de pacientes, por exemplo só com `lab.worklist.view`, vê **não disponível** no lugar do nome. Um utilizador de local limitado a uma unidade vê sempre os nomes ocultos, porque o limite retira `patients.view_identifiers`.

Limite cada utilizador de local à sua unidade com `openldr users scope <user> --facility <facility-id> --force`. Esse utilizador vê então apenas os pedidos dessa unidade. Um pedido de outra unidade é tratado como não encontrado.

O separador **Guia** da página **Lab** mostra cada tarefa passo a passo.

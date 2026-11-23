# O plugin de laboratório

O plugin de laboratório acrescenta uma página **Lab** ao studio. A receção do laboratório encontra um pedido pelo número de requisição, regista-o se for preciso, recebe amostras, e devolve ou rejeita o que não pode usar. O pessoal de um local regista os seus próprios pedidos e vê apenas os pedidos da sua unidade sanitária. O plugin guarda os seus dados nas suas próprias tabelas, no esquema `plugin_lab`. O CE funciona da mesma forma sem ele.

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
- `lab.orders.enter`, **Registar pedidos**: novos pedidos no separador **Pedidos**.
- `lab.worklist.view`, **Ver os pedidos do laboratório**: o separador **Pedidos**.

A receção e os locais precisam também de `patients.find` para encontrar e registar pacientes. Limite cada utilizador de local à sua unidade com `openldr users scope <user> --facility <facility-id> --force`. Esse utilizador vê então apenas os pedidos dessa unidade. Um pedido de outra unidade é tratado como não encontrado.

O separador **Guia** da página **Lab** mostra cada tarefa passo a passo.

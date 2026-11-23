# Configurar um laboratório

Esta página diz o que o OpenLDR oferece a um laboratório nesta versão, e o que verificar depois de uma atualização. O guia na aplicação **Configuração do laboratório** mostra os passos no ecrã.

A receção e os pedidos vêm num plugin separado, o [plugin de laboratório](/docs/lab-plugin). Ainda não está no marketplace. A revisão de resultados está prevista numa versão seguinte.

## O que um laboratório tem nesta versão

- O formulário **Lab order** pede exames e introduz os seus resultados. Pode também registar uma **Order rejection**. O guia na aplicação **Formulários** mostra cada passo.
- Os intervalos de referência de um exame podem ter limites críticos, em **Limite crítico inferior** e **Limite crítico superior**. O OpenLDR guarda-os. Nada nesta versão assinala ainda um resultado em relação a eles. Defini-los precisa de **Gerir a terminologia**.
- Um índice encontra um pedido pelo seu número de requisição. O OpenLDR mantém-no atualizado sozinho. O comando `openldr lab requisitions rebuild` repara-o.

## Reconstruir o índice das requisições

O comando passa pelo servidor OpenLDR em execução, como uma pessoa que tem **Zona de perigo**. Em Linux e macOS, inicie sessão primeiro com `./openldr login`, ou defina uma chave de acesso em `OPENLDR_KEY`. Em Windows, `.\openldr.ps1` inicia sessão apenas com uma chave de acesso, por isso defina primeiro `OPENLDR_KEY`. O comando não foi corrido em Windows. [Início de sessão do CLI e chaves de acesso](/docs/cli-access) explica o início de sessão.

```sh
openldr lab requisitions rebuild --force
```

Reconstrua-o só se um erro deixou um pedido fora do índice, ou depois de pedidos serem apagados do armazenamento. Mostra `Indexed <n> orders by requisition number.` Recusa sem `--force`, porque reescreve o índice inteiro. Cada reconstrução fica registada no registo de auditoria com a sua conta. Numa cópia do código-fonte, ponha `pnpm` à frente: `pnpm openldr lab requisitions rebuild --force`.

## Depois de atualizar a partir de uma versão de desenvolvimento

Uma versão de desenvolvimento tinha uma página Receção, secções de laboratório, um interruptor de autovalidação e sete permissões de laboratório. Esta versão não os tem.

- Uma função **Reception** criada por essa versão de desenvolvimento fica. Agora é uma função comum. Um administrador pode eliminá-la na página **Funções** quando ninguém precisar dela.
- Uma função mantém qualquer permissão de laboratório antiga que tenha. O CE não a lista e não a pode conceder nem retirar. `openldr roles doctor` lista essas permissões em `kept` e termina com o código 0.
- Um formulário **Lab order** que ninguém editou recebe de volta os campos **Results** e **Order rejection** no primeiro arranque. Um formulário que o seu laboratório editou fica como está.

## Resolução de problemas

- **A reconstrução diz que a conta não tem a capacidade.** A conta não tem **Zona de perigo**. Use uma conta cuja função a tenha.
- **O formulário Lab order não tem o campo Results.** O seu laboratório editou o formulário, por isso a atualização deixou-o como estava. Adicione o campo de novo no construtor de formulários.

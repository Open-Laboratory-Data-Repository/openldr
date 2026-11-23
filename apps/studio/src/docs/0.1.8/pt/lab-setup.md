# Configuração do laboratório

A configuração do laboratório cobre o que o OpenLDR guarda para o próprio laboratório. Define limites críticos nos intervalos de referência de um exame. Um administrador pode também reconstruir o índice dos números de requisição. Este guia destina-se a gestores de laboratório e administradores.

O formulário **Lab order** pede exames e introduz os seus resultados. Pode também registar uma **Order rejection**. Leia [Formulários](/docs/forms).

Está previsto um plugin de laboratório para a receção e a revisão de resultados. Não faz parte desta versão.

Os limites críticos fazem parte dos intervalos de referência de um exame. Por isso precisam de **Gerir a terminologia**, como o resto da definição do exame. Abrir **Catálogo de exames** precisa de **Consultar a terminologia**. Reconstruir o índice precisa de **Zona de perigo**.

## Adicionar limites críticos a um intervalo de referência

Um limite crítico é um valor tão fora do intervalo que alguém tem de agir logo. Use os limites aprovados pelo seu laboratório. Não copie números de um exemplo.

1. Abra **Catálogo de exames** e abra o exame com **Editar**.
2. Encontre o campo de resultado e o seu intervalo de referência.
3. Escreva o limite inferior em **Limite crítico inferior**.
4. Escreva o limite superior em **Limite crítico superior**.
5. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** uma mensagem diz que o exame foi guardado. Os limites ficam guardados com o intervalo.

Pode preencher um limite, os dois ou nenhum. O OpenLDR verifica três regras ao guardar:

- **Limite crítico inferior** tem de ser menor ou igual a **Limite inferior**.
- **Limite crítico superior** tem de ser maior ou igual a **Limite superior**.
- **Limite crítico inferior** tem de ser menor que **Limite crítico superior**.

Uma regra só é verificada quando o intervalo tem os dois valores. Uma recusa indica o campo de resultado e o intervalo. A mensagem vem do servidor, em inglês, por exemplo `HGB range 1: the critical low limit must be at or below the low limit.`

O OpenLDR guarda os limites. Nada nesta versão assinala ainda um resultado em relação a eles.

## Reconstruir o índice das requisições

O OpenLDR mantém um índice que encontra um pedido pelo seu número de requisição. Mantém o índice atualizado sozinho à medida que os pedidos chegam. Reconstrua-o apenas se um erro deixou um pedido fora do índice, ou depois de pedidos serem eliminados do armazenamento.

Corra o comando através do servidor OpenLDR em execução, como uma pessoa que tem **Zona de perigo**. Em Linux e macOS, inicie sessão primeiro com `./openldr login`, ou defina uma chave de acesso em `OPENLDR_KEY`. Em Windows, defina primeiro uma chave de acesso em `OPENLDR_KEY`. Aí o CLI inicia sessão apenas com uma chave de acesso. Leia [Utilizadores](/docs/users) para criar uma chave de acesso. Leia [Comece aqui](/docs/start-here) para a CLI instalada e a de desenvolvimento.

Exemplo numa cópia de desenvolvimento:

```shell
pnpm openldr lab requisitions rebuild --force
```

Numa cópia instalada em Linux ou macOS, use `./openldr` em vez de `pnpm openldr`. Em Windows, use `.\openldr.ps1` a partir da pasta de instalação, com `OPENLDR_KEY` definida. Este comando não foi corrido em Windows.

**Resultado esperado:** o comando mostra, por exemplo, `Indexed 120 orders by requisition number.`

Recusa sem `--force`, porque reescreve o índice inteiro. Cada reconstrução fica registada no registo de auditoria com a sua conta.

## Limites

- A receção e a revisão de resultados não fazem parte desta versão. Está previsto um plugin de laboratório para elas.
- Os limites críticos ficam guardados, mas nenhum ecrã assinala ainda um resultado em relação a eles.
- Reconstruir o índice é apenas um comando. Não tem botão no studio.

## Resolução de problemas

- **Guardar recusa um limite crítico.** Leia a mensagem. Indica o intervalo e a regra que falhou.
- **A reconstrução diz que a conta não tem a capacidade.** A conta não tem **Zona de perigo**. Use uma conta cuja função a tenha.

## Guias relacionados

- [Catálogo de exames](/docs/test-catalog)
- [Formulários](/docs/forms)
- [Funções](/docs/roles)
- [Utilizadores](/docs/users)

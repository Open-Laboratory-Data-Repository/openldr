# Laboratório

**Definições → Laboratório** diz quem é o seu laboratório: o nome, a morada, o contacto e o logótipo impressos como cabeçalho em todos os relatórios. A página define também o registo de unidades predefinido e o fuso horário do laboratório.

Leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **View settings** | Abrir a página Laboratório |
| **Edit general settings** | Guardar as alterações |

Quem pode ver relatórios vê o cabeçalho que eles trazem.

## Exemplo 1: definir o cabeçalho

![Escrever o nome, a morada, o contacto e o fuso horário do laboratório, e guardar a partir do menu de três pontos.](laboratory-identity.mp4)

1. Abra **Definições** e depois **Laboratório**.
2. Em **Nome do laboratório**, escreva `Sample Central Laboratory`.
3. Em **Morada**, escreva `1 Sample Road, Sample City`. Carregue em Enter para mudar de linha.
4. Em **Contacto**, escreva `lab@example.org`. Também serve um telefone ou uma linha de acreditação.
5. Em **Fuso horário**, escreva `Africa/Dar_es_Salaam`. Numa instalação real, use o seu fuso.
6. Abra o menu de três pontos da página e selecione **Guardar**. Aparece a mensagem **Guardado.**
7. Recarregue a página e confirme que os valores continuam lá.

Nada fica guardado antes de **Guardar**. Isso inclui um logótipo novo ou um logótipo limpo. Se **Guardar** mostrar um erro, mantenha a página aberta, corrija o valor e guarde de novo.

### O logótipo

1. Selecione **Escolher ficheiro…** e escolha uma imagem PNG, JPEG ou WebP com menos de 256 KB. Aparece uma pré-visualização ao lado do botão.
2. Selecione **Guardar** no menu de três pontos.

**Limpar** retira o logótipo. Guarde para manter essa alteração. O logótipo tem de ser um ficheiro de imagem carregado, não um endereço web, porque uma imagem ligada não sai no PDF. É lido em cada relatório, daí o limite de tamanho.

## Exemplo 2: ver o cabeçalho num relatório

Este exemplo precisa dos dados de exemplo da documentação. Veja [Painéis, Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).

1. Abra **Relatórios** e selecione **Test Volume Over Time**.
2. Abra o menu de três pontos, selecione **Parâmetros** e defina **Date range** de 1 de setembro de 2026 a 31 de outubro de 2026.
3. Selecione **Executar**.

**Resultado esperado:** o relatório abre com o seu cabeçalho no topo: o logótipo, **Sample Central Laboratory**, a morada e o contacto. Por baixo vêm o título, o período e uma tabela de 10 linhas, uma por exame e por mês.

![O cabeçalho no topo de Test Volume Over Time: logótipo, nome, morada e contacto.](laboratory-letterhead.png)

| Month | Test | Count |
| --- | --- | --- |
| 2026-09 | Full blood count | 10 |
| 2026-09 | Malaria rapid test | 8 |
| 2026-10 | HIV viral load | 8 |

São 3 das 10 linhas. Juntas, as linhas somam 60, o número de pedidos do exemplo.

**Transferir** guarda um PDF com o mesmo cabeçalho. As saídas CSV e XLSX têm só os dados. Veja [Relatórios, Exemplo 1](/docs/reports#exemplo-1-executar-um-relatorio) para todos os passos.

### O cabeçalho nos seus modelos

Um modelo de relatório pode colocar cada parte do cabeçalho pelo nome. A página lista os quatro nomes por baixo do título:

| Nome | Imprime |
| --- | --- |
| `{{lab.name}}` | Nome do laboratório |
| `{{lab.address}}` | Morada |
| `{{lab.contact}}` | Contacto |
| `{{lab.logo}}` | Logótipo |

Veja o [Designer de relatórios](/docs/report-designer) para construir um modelo.

## Escolher um registo de unidades

**Registo de unidades** lista as fontes ativas registadas em [Unidades](/docs/facilities). A que escolher passa a ser o **Sistema** inicial quando alguém cria uma unidade à mão.

Escolha o registo a que pertencem os seus códigos de unidade. O endereço do sistema separa esses códigos dos de outro registo.

Guardar esta escolha não importa unidades. Não muda o nome, não move e não muda os códigos das unidades que já existem.

Se o registo que quer não aparece:

1. Abra [Unidades](/docs/facilities), inicie **Importar unidades** e registe a fonte.
2. Volte ao Laboratório e recarregue a página.
3. Selecione-o em **Registo de unidades** e guarde.

Uma lista vazia também pode querer dizer que as fontes não carregaram. Veja Unidades antes de concluir que não existe nenhuma.

## Fuso horário

O fuso horário decide a que dia pertence um resultado num relatório. Um resultado às 01:00 em Dar es Salaam ainda cai no dia anterior em UTC.

- Escreva um fuso com nome, como `Africa/Dar_es_Salaam`. Os desvios fixos são recusados. `+03:00` é recusado. `Etc/GMT+3` também, porque quer dizer UTC−3, o contrário do que parece.
- Define o valor inicial do filtro **Time zone** de cada relatório. Pode mudá-lo para uma execução.
- Uma execução agendada ou pela linha de comandos não o lê. Dê o fuso diretamente ao agendamento ou ao comando. Veja [Relatórios](/docs/reports).
- Não define a hora a que correm os agendamentos.
- **Armazém SQL Server:** deixe-o vazio. O SQL Server usa nomes de fuso do Windows, que este campo recusa. Escreva o fuso do Windows no filtro **Time zone** em cada execução do relatório.

## Na linha de comandos

`openldr settings lab` lê e escreve os mesmos valores que a página.

```bash
./openldr settings lab show
./openldr settings lab set --name "Sample Central Laboratory" --timezone Africa/Dar_es_Salaam
./openldr settings lab set --logo-file ./logo.png
```

- `--address` aceita `\n` para mudar de linha.
- Um valor vazio limpa um campo, por exemplo `--timezone ""`.
- `--logo-file` aceita um ficheiro PNG, JPEG ou WebP com o mesmo limite de 256 KB.

O registo de unidades só se define na página.

## Num telemóvel

A página funciona num telemóvel. As etiquetas ficam à esquerda das caixas, e as caixas estreitam. **Escolher ficheiro…** abre o seletor de ficheiros do telemóvel, por isso o logótipo pode vir das fotos ou dos ficheiros.

## Resolução de problemas

- **As alterações desapareceram depois de recarregar.** Não foram guardadas. Use **Guardar** no menu de três pontos e espere por **Guardado.**
- **O fuso horário não fica guardado.** Use um fuso com nome como `Africa/Dar_es_Salaam`, não um desvio.
- **O logótipo é recusado.** Tem de ser PNG, JPEG ou WebP e ter menos de 256 KB.
- **O relatório ainda mostra o nome antigo.** Execute o relatório outra vez. Um resultado já mostrado ou exportado mantém o cabeçalho com que foi feito.
- **A lista de registos está vazia.** Registe uma fonte em Unidades e recarregue esta página.
- **Não foi possível guardar a identidade do laboratório.** Leia primeiro a mensagem por baixo do campo. Se não houver nenhuma, a sua função pode não ter **Edit general settings**.

## Guias relacionados

- [Definições](/docs/settings)
- [Relatórios](/docs/reports)
- [Designer de relatórios](/docs/report-designer)
- [Unidades](/docs/facilities)

# Comece aqui

O OpenLDR Studio é onde os resultados de um laboratório se juntam. Lê-os em painéis e relatórios, consulta-os e define como os dados chegam. Esta página mostra-lhe o caminho e propõe uma primeira hora numa instalação nova, com os dados de exemplo carregados.

Selecione uma imagem ou um clip para o ampliar.

![O Studio depois de entrar. 1 Menu principal. 2 Notificações. 3 Claro ou escuro. 4 O seu menu de utilizador. 5 Dobrar o menu.](start-here-tour.png)

1. **Menu principal.** Uma entrada por área. Só vê as áreas que a sua função permite.
2. **Notificações.** O sino abre as suas notificações mais recentes.
3. **Claro ou escuro.** Muda o tema de cores.
4. **Menu de utilizador.** O seu nome, no canto inferior esquerdo. Tem **Idioma**, **Definições** e **Terminar sessão**.
5. **Dobrar o menu.** Reduz o menu principal a ícones, para dar mais espaço às páginas.

O escudo amarelo junto ao sino só aparece numa instalação de teste em que a autenticação está desligada. Uma instalação real não o mostra.

## O menu principal

| Entrada do menu | Para que serve | Guia |
| --- | --- | --- |
| Painel | Gráficos e números que se atualizam sozinhos | [Painéis](/docs/dashboard) |
| Relatórios | Relatórios imprimíveis que executa, exporta e agenda | [Relatórios](/docs/reports) |
| Designer de relatórios | Os modelos desses relatórios | [Designer de relatórios](/docs/report-designer) |
| Consulta | Percorrer o armazém e escrever SQL | [Consultas personalizadas](/docs/query) |
| Fluxos de trabalho | Como os dados chegam, são verificados e guardados | [Fluxos de trabalho](/docs/workflows) |
| Terminologia | Sistemas de códigos, como o LOINC, e os seus mapeamentos | [Terminologia](/docs/terminology) |
| Unidades | O registo das unidades de saúde | [Unidades](/docs/facilities) |
| Catálogo de exames | A lista nacional de exames, e os que este laboratório faz | [Catálogo de exames](/docs/test-catalog) |
| Pacientes | Encontrar um paciente e onde foi testado | [Pacientes](/docs/patients) |
| Formulários | Registar dados à mão, e construir os formulários | [Formulários](/docs/forms) |
| Utilizadores | Quem pode entrar, e com que funções | [Utilizadores e funções](/docs/users) |
| Auditoria | Quem mudou o quê, e quando | [Auditoria](/docs/audit) |
| Atividade | Cada envio de dados enquanto é tratado | [Atividade](/docs/activity) |
| Documentação | Este manual | Esta página |

**Definições** está no menu de utilizador, não no menu principal. Veja [Definições](/docs/settings).

Uma entrada em falta quer dizer que a sua função não a inclui. Peça a um administrador.

## A sua primeira hora

Siga estes passos numa instalação de teste. Cada passo leva ao guia completo.

1. **Carregue os dados de exemplo.** Uma instalação nova quase não tem dados de laboratório, por isso cada número mostra 0. Carregue o ficheiro de exemplo. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).
2. **Leia o painel de exemplo.** Abra **Painel**. Total Orders mostra 60. Filtre-o para outubro de 2026. Veja [Painéis](/docs/dashboard).
3. **Execute um relatório.** Abra **Relatórios** e execute **Test Volume Over Time** para setembro e outubro de 2026. Veja [Relatórios](/docs/reports).
4. **Veja os dados em bruto.** Abra **Consulta** e percorra `lab_requests`. Veja [Consultas personalizadas](/docs/query).
5. **Construa alguma coisa.** Crie o seu próprio painel com um gráfico de barras. Veja [Painéis](/docs/dashboard#exemplo-2-criar-um-painel-e-um-grafico-de-barras).

## Exemplo 1: mudar o idioma

O Studio fala inglês, francês e português.

![Abrir o menu de utilizador, depois Idioma, depois Français.](start-here-language.mp4)

1. Selecione o seu nome no canto inferior esquerdo.
2. Selecione **Idioma**.
3. Escolha **English**, **Français** ou **Português**.

**Resultado esperado:** o menu e a maioria dos ecrãs mudam de imediato. Alguns rótulos ainda não estão traduzidos e ficam em inglês. Os guias escrevem cada rótulo tal como aparece no ecrã. A documentação também muda para esse idioma. Uma página ainda não traduzida aparece em inglês, com uma nota no topo.

A sua escolha fica guardada neste navegador.

## Exemplo 2: encontrar uma resposta na documentação

![Pesquisar sample data na documentação, abrir Painéis e saltar para uma secção.](start-here-docs.mp4)

1. Abra **Documentação**.
2. Escreva na caixa de pesquisa, por exemplo `sample data`. A lista à esquerda reduz-se aos guias que coincidem.
3. Selecione um guia. Os guias longos listam as suas secções à direita, em **On this page**. Selecione uma para lá ir.

Num ecrã estreito, a lista de secções é um botão com um ícone de lista, no canto superior direito da página.

### Transferir a documentação

![O menu de transferência: esta página ou toda a documentação.](start-here-docs-download.png)

O botão de transferência no canto superior direito guarda **This page** ou **All docs** em **Markdown**, **PDF** ou **Word**. Os clips imprimem-se como imagem fixa em PDF e Word.

**Version**, ao lado, mostra a documentação de uma versão mais antiga.

## Filtrar qualquer tabela

A maioria das listas tem a mesma barra de ferramentas.

- **Pesquisar** encontra à medida que escreve.
- **Filtrar** deixa escolher uma coluna, um operador e um valor, depois **Aplicar**.
- **Ordenar** muda a ordem.
- **Colunas** esconde e mostra colunas.
- Tire uma etiqueta de filtro para limpar uma regra, ou use **Limpar tudo**.

Cada tabela tem paginação no fundo, com o número de linhas por página.

## As ações estão no menu de três pontos

O Studio põe as ações num menu marcado com três pontos, não em botões soltos. Procure-o no canto superior direito de uma página, em cada linha de uma tabela e no topo de um painel lateral. **Guardar** num painel lateral costuma estar também nesse menu.

## Num telemóvel

Há quem use o Studio no telemóvel. O menu principal fica dobrado por trás do botão de menu no canto superior esquerdo.

![O menu principal aberto num telemóvel.](start-here-phone-menu.png)

1. Selecione o botão de menu no canto superior esquerdo.
2. Escolha uma página. O menu fecha.

As páginas com uma lista lateral, como **Relatórios** e **Consulta**, começam com essa lista dobrada. A secção **Num telemóvel** de cada guia explica como a abrir.

## Resolução de problemas

- **Falta uma página no menu.** A sua função não a inclui. Peça a um administrador para rever as suas permissões.
- **Cada número mostra 0.** A instalação ainda não tem dados de laboratório. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).
- **Um botão está desativado.** Falta-lhe alguma coisa, muitas vezes um filtro obrigatório ou uma escolha numa lista.
- **Alguns rótulos estão em inglês depois de escolher português.** Esses rótulos ainda não estão traduzidos.
- **Uma imagem é demasiado pequena.** Selecione-a para a ampliar.
- **A pesquisa encontra demasiado.** Pesquise a tarefa, ou o texto exato do erro.

## Instalar e operar o OpenLDR

A instalação, a configuração, as atualizações e a linha de comandos estão no site do OpenLDR. Veja [Documentação de instalação e desenvolvimento](/docs/advanced-docs).

## Guias relacionados

- [Painéis](/docs/dashboard)
- [Relatórios](/docs/reports)
- [Documentação de instalação e desenvolvimento](/docs/advanced-docs)

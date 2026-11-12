# Exposição de dados

**Definições → Exposição de dados** decide que colunas extra o **Builder** dos painéis pode oferecer quando alguém junta outra tabela, por exemplo o sexo do paciente ou o local de colheita da amostra. Oculte aqui uma coluna e ela desaparece do Builder para todos.

Não cobre tudo. Leia [O que a página não cobre](#o-que-a-pagina-nao-cobre) antes de contar com ela para manter uma coluna privada.

Leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

![Exposição de dados: a tabela Patient, cada coluna com o seu distintivo DPI e um interruptor Visível ou Oculta.](data-exposure-tour.png)

## Quem pode fazer o quê

Uma só capacidade cobre esta página: **Manage data exposure**. Sem ela, a página não aparece em Definições.

## O que a página mostra

A página lista sete tabelas. Cada linha é uma coluna, com um interruptor: ligado quer dizer **Visível**, desligado quer dizer **Oculta**.

| Tabela | Colunas | Ocultas numa instalação nova | Marcadas DPI |
| --- | --- | --- | --- |
| Patient | 18 | 13 | 8: nomes, data de nascimento, identificador nacional, telefone, e-mail, GUID do paciente, chave de correspondência |
| Specimen | 13 | 7 | nenhuma |
| Request | 30 | 8 | `clinical_info` |
| Facility | 12 | 3 | nenhuma |
| Report | 20 | 5 | nenhuma |
| Facility Map | 16 | 2 | nenhuma |
| Test Map | 9 | 1 | nenhuma |

**DPI** quer dizer dados pessoais identificáveis. Um distintivo vermelho **DPI** marca essas colunas. Começam ocultas.

## Exemplo 1: ocultar uma coluna

Oculte a coluna `sex` do paciente e depois reponha-a.

![Desligar sex na tabela Patient e guardar a partir do menu Exposição de dados.](data-exposure-hide.mp4)

1. Abra **Definições** e depois **Exposição de dados**.
2. Em **Patient**, encontre `sex`. Está **Visível**.
3. Desligue-a. Passa a **Oculta**. Aparece **Alterações não guardadas**.
4. Abra o menu de três pontos da página e selecione **Guardar**. Aparece **Política de colunas guardada**.

**Resultado esperado:** `sex` continua **Oculta** depois de recarregar a página.

As alterações ficam só no seu ecrã até **Guardar**. **Descartar**, no mesmo menu, deita fora as alterações não guardadas e recarrega os valores guardados. Se **Guardar** mostrar um erro, não assuma que alguma alteração ficou. Recarregue e confirme.

Para a repor, ligue `sex` e selecione **Guardar** outra vez.

## Exemplo 2: ver a coluna desaparecer do Builder

Faça isto enquanto `sex` ainda está oculta pelo Exemplo 1.

1. Abra **Painéis** e edite um widget, ou adicione um. Veja [Painéis, Exemplo 1](/docs/dashboard#exemplo-1-criar-um-widget-de-pedidos-por-exame).
2. No Builder, selecione **Join data**. Defina a tabela como **Patient**.
3. Veja as colunas de Patient que oferece.

**Resultado esperado:** a lista oferece `managing_organization`, `active`, `source_system` e `created_at`. `sex` desapareceu. Torne-a visível, guarde e reabra o editor do widget: `sex` volta a aparecer.

Um widget guardado antes com `sex` deixa de correr quando a oculta. O servidor recusa a consulta, porque a coluna já não é permitida.

## Tornar visível uma coluna DPI

Ligar uma coluna com o distintivo **DPI** pergunta primeiro: **Tornar** *nome* **visível?** Selecione **Tornar visível** só quando essa coluna for mesmo precisa no Builder. Depois selecione **Guardar**.

## O que a página não cobre

Esta página controla as colunas extra que o Builder oferece em **Join data**. Controla-as quando a coluna é escolhida, quando a consulta corre e quando a consulta é convertida em SQL. Não é um filtro sobre todos os campos que o OpenLDR devolve.

**Não** se aplica:

- **Aos campos incluídos no Builder.** Os campos que cada modelo de dados oferece por predefinição continuam disponíveis.
- **Aos widgets SQL.** O SQL bruto lê tudo o que a conta da base de dados pode ler.
- **A uma consulta do Builder convertida em SQL.** Depois de convertida, já não segue as alterações feitas mais tarde nesta página.
- **Às consultas personalizadas, aos relatórios ligados a elas, aos dados do Designer de relatórios e aos nós de base de dados dos fluxos de trabalho.** Todos correm SQL através dos [Conectores](/docs/connectors). Ignoram esta página, mesmo quando o conector aponta para a base de dados do OpenLDR.

Para manter uma coluna privada nesses caminhos, limite antes a conta da base de dados. Dê à conta de cada conector, e à conta dos widgets SQL, acesso só às tabelas, colunas ou vistas aprovadas. As verificações de só leitura e os limites de linhas não ocultam colunas.

Ocultar uma coluna não apaga os dados já guardados, nem os ficheiros já exportados.

## Verificar o caminho certo

- Teste com dados que não sejam sensíveis.
- Um estado **Oculta** guardado só prova que a escolha ficou guardada. Verifique o Builder à parte, como no Exemplo 2.
- Verifique à parte os widgets SQL e os relatórios com conectores. Para um conector, corra uma consulta com a conta dele sobre uma vista aprovada e sobre uma coluna proibida.
- Verifique o relatório final antes de o partilhar.

## Na linha de comandos

```bash
./openldr data-exposure list
./openldr data-exposure hide patients sex
./openldr data-exposure show patients sex
```

`hide` e `show` recebem um nome de tabela e um ou mais nomes de coluna. Um servidor a correr só vê uma alteração feita na linha de comandos depois da próxima gravação nesta página, ou de um reinício. Reinicie o contentor api para a aplicar logo.

## Num telemóvel

A página funciona num telemóvel. Cada linha mantém o nome da coluna à esquerda e o interruptor à direita. Abra **Exposição de dados** a partir da fila de páginas de Definições no topo. É a última, por isso deslize a fila para o lado.

## Resolução de problemas

- **Uma coluna oculta ainda aparece no Builder.** Feche e reabra o editor do widget. Se a mudou na linha de comandos, reinicie o contentor api.
- **Um widget passou a falhar.** Usa uma coluna que ocultou. Torne-a visível ou mude o widget.
- **Um relatório ainda mostra uma coluna oculta.** O relatório passa por um conector, que esta página não cobre. Limite a conta da base de dados do conector.
- **Guardar falha.** Recarregue a página para ver o que ficou e tente outra vez.
- **A página não aparece em Definições.** Precisa de **Manage data exposure**.

## Guias relacionados

- [Definições](/docs/settings)
- [Painéis](/docs/dashboard)
- [Consultas personalizadas](/docs/query)
- [Conectores](/docs/connectors)
- [Relatórios](/docs/reports)

# Exposição de dados

Definições → Exposição de dados controla as colunas adicionais das tabelas ligadas no construtor de painéis interno. O acesso exige a capacidade `data_exposure.manage`.

## Compreender o alcance

A política controla as colunas adicionais escolhidas nas tabelas ligadas no construtor. As dimensões predefinidas do modelo continuam disponíveis. Não filtra todos os campos devolvidos.

Para estas colunas adicionais, a política aplica-se à seleção, à execução de consultas e à conversão para SQL. Não filtra os resultados dos widgets SQL direto. Após a conversão para SQL, as execuções não seguem futuras alterações desta política.

As consultas personalizadas usam conectores. Os relatórios ligados a essas consultas, os dados de consultas do desenhador de relatórios e os nós Base de dados dos workflows usam SQL dos conectores. Não aplicam esta política, mesmo quando o conector aponta para a base OpenLDR.

Limite a conta de base de dados de cada conector às tabelas, colunas ou vistas autorizadas. Reveja as permissões e o acesso às consultas antes de partilhar um relatório. A validação SELECT e os limites de linhas não ocultam colunas sensíveis. Restrinja também a conta usada pelos widgets SQL direto.

## Alterar a visibilidade

1. Abra Definições → Exposição de dados e encontre a tabela e a coluna.
2. Desative uma coluna para a marcar Oculta. Ative-a para a marcar Visível.
3. O distintivo DPI indica dados pessoais. Tornar essa coluna visível exige confirmação. Confirme apenas quando pretende usá-la no construtor interno.
4. As alterações ficam locais até escolher Guardar no menu ⋯. Verifique a notificação. Se ocorrer um erro, não presuma que todas as alterações foram guardadas.
5. Escolha Descartar no mesmo menu para recarregar os valores guardados e abandonar as alterações locais.
6. Volte a abrir a página e confirme os estados. Recarregue depois o construtor interno e verifique as colunas disponíveis. Execute uma consulta de teste sem dados sensíveis para confirmar o resultado ou a rejeição esperada.

## Verificar o percurso da consulta

Use dados de teste não sensíveis. Um estado Oculta guardado prova apenas a escolha persistida. Verifique separadamente o construtor interno, o SQL direto e os relatórios com conectores. Para um conector, teste a conta configurada nas vistas autorizadas e nas colunas proibidas. Confira o relatório resultante antes de o distribuir.

Esta política não elimina dados dos registos nem dos ficheiros já exportados.

## Guias relacionados

- [Definições](/docs/settings)
- [Painel](/docs/dashboard)
- [Consultas personalizadas](/docs/query)
- [Conectores](/docs/connectors)
- [Relatórios](/docs/reports)

# Primeiros passos

O OpenLDR Community Edition recolhe dados de laboratório de muitas fontes, converte-os para FHIR R4 e guarda-os numa base de dados que a sua organização controla. Depois oferece painéis, relatórios e vistas de vigilância, com grande atenção à resistência aos antimicrobianos (RAM). Foi feito para redes nacionais e regionais de laboratórios.

Estas páginas tratam da instalação, configuração e resolução de problemas de um servidor OpenLDR. Para aprender a usar o estúdio, abra **Documentação** no estúdio depois de iniciar sessão.

## 1. Instalar

Precisa de um anfitrião com Docker. Leia primeiro os [Requisitos](/docs/requirements).

O instalador de uma linha gera todos os segredos, arranca a pilha em `https://localhost` com um certificado autoassinado e mostra o URL e as credenciais de administrador. Todas as opções estão na página [Instalar](/docs/install).

Linux ou macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Iniciar sessão

1. Abra o URL que o instalador mostrou.
2. Inicie sessão com as credenciais de administrador que ele mostrou.
3. Abra **Documentação** no menu do estúdio e leia **Comece aqui**.

Para parar a pilha, execute `docker compose down` na pasta `openldr/` criada pelo instalador. Para a voltar a arrancar, execute `docker compose up -d` na mesma pasta.

## Configurar o seu sistema

O OpenLDR pode receber e processar dados antes de configurar as unidades de saúde, o catálogo de testes ou as definições de pacientes. Estas tarefas são opcionais. Recomendamos vivamente que as conclua durante a utilização do sistema.

- As unidades de saúde associam nomes e localizações consistentes aos códigos.
- O catálogo relaciona testes de diferentes fontes e fornece as opções do formulário Lab order.
- As definições de pacientes atribuem nomes aos sistemas de identificadores e ajudam a rever possíveis duplicados.

Abra **Documentação** no Studio e siga **Configurar o seu sistema**, começando por Terminologia. Os guias da aplicação explicam cada tarefa.

A documentação do Studio inclui tarefas ilustradas para Terminology, Facilities, Test catalog, Patients, Forms e Workflows. Siga os guias dos painéis e relatórios no trabalho diário, ou os guias das definições para gerir a instalação. Cada tarefa explica o objetivo e mostra os controlos a utilizar. Use os seus próprios dados; os ficheiros de prática são opcionais.

## 3. Próximos passos

- [Carregar e enviar dados](/docs/load-data): envie os primeiros dados de laboratório para o OpenLDR.
- [Variáveis de ambiente](/docs/environment): configure uma instalação.
- [Fornecedores de autenticação](/docs/auth-providers): inicie sessão com o Keycloak ou outro fornecedor OpenID Connect.
- [Atualizações planeadas](/docs/upgrading): passe para uma nova versão em segurança.
- [Interface de linha de comandos (CLI)](/docs/cli): use o OpenLDR a partir de um terminal, num servidor sem navegador.
- [Desenvolvimento](/docs/development): execute o OpenLDR a partir do código-fonte.

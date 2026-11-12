# Atualizações planeadas

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. As ilustrações de ficheiros mostram texto para editar no ficheiro indicado. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

## Preparar a versão

Planeie uma interrupção. Mantenha projeto, ficheiro de ambiente e sobreposições Compose. Preserve versões dos motores de base. Leia as notas da versão.

### 1. Registar imagens e serviços atuais

Guarde identificadores e versões fora da instalação. Os comandos seguintes usam esta pasta.

```sh
{{operator:upgrade-folder}}
```

![Registar imagens e serviços atuais.](guide:operator-upgrade-folder)

### 2. Guardar configuração e chaves

Substitua BEFORE_UPGRADE. Restrinja acesso. Inclua sobreposições, chaves de cifra e assinatura, certificados e ficheiros locais. Isto não copia volumes das bases nem dos objetos. Guarde o guia fora do Studio.

```sh
{{operator:upgrade-private-copy}}
```

![Guardar configuração e chaves.](guide:operator-upgrade-private-copy)

## Parar escritas e aguardar

Suspenda emissores, sincronização e escritas agendadas. Bloqueie tráfego novo. Pare tarefas CLI e todas as réplicas API, incluindo outros anfitriões.

### 1. Permitir terminar o trabalho ativo

Acrescente em services.api nas instalações antigas. Preveja o trabalho mais longo. O tempo explícito abaixo tem prioridade.

```text
{{operator:upgrade-grace}}
```

![Permitir terminar o trabalho ativo.](guide:operator-upgrade-grace)

### 2. Parar a API e verificar o encerramento

300 segundos é um exemplo. Tempo excedido, paragem forçada ou código 137 não prova trabalho concluído. Investigue tarefas e efeitos interrompidos.

```sh
{{operator:upgrade-stop}}
```

![Parar a API e verificar o encerramento.](guide:operator-upgrade-stop)

### 3. Parar escritas de identidade e ficheiros

Use nomes reais. O armazenamento antigo pode chamar-se minio. Mantenha PostgreSQL ativo para cópias lógicas. Pare também outros processos que escrevam nesses serviços.

```sh
{{operator:upgrade-stores-stop}}
```

![Parar escritas de identidade e ficheiros.](guide:operator-upgrade-stores-stop)

## Copiar e provar o restauro

Copie bases, funções e todos os objetos ou volumes parados no mesmo intervalo sem escritas. Nunca use docker compose down -v. Não copie um volume PostgreSQL ativo como cópia lógica.

### 1. Criar cada cópia PostgreSQL

Substitua DB_NAME e DB_USER. Repita para bases interna, analítica e Keycloak. Use também o procedimento nativo testado para SQL Server/MySQL.

```sh
{{operator:upgrade-dump}}
```

![Criar cada cópia PostgreSQL.](guide:operator-upgrade-dump)

### 2. Copiar cada ficheiro para fora dos volumes

O destino privado deve existir. Verifique cada código de saída. A cópia evita redirecionamento binário no PowerShell.

```sh
{{operator:upgrade-dump-copy}}
```

![Copiar cada ficheiro para fora dos volumes.](guide:operator-upgrade-dump-copy)

### 3. Guardar também as funções

Substitua DB_USER. Proteja globals.sql, que pode conter credenciais. Copie todos os buckets ou volumes parados com o procedimento testado.

```sh
{{operator:upgrade-roles}}
```

![Guardar também as funções.](guide:operator-upgrade-roles)

### 4. Restaurar num destino isolado

Use apenas um destino vazio isolado, nunca produção. Restaure funções e resolva conflitos iniciais. Copie o ficheiro para esse anfitrião. Listar o arquivo não prova restauro. Restaure objetos, compare somas e dados, decifre segredos com as chaves guardadas e verifique ligações a ficheiros antes de migrar.

```sh
{{operator:upgrade-restore}}
```

![Restaurar num destino isolado.](guide:operator-upgrade-restore)

## Preparar instalações antigas MinIO

Ignore se já usa Garage. Antes da migração, obtenha Compose e configuração da versão alvo e reponha o serviço guardado. Mantenha imagem exata, volume e credenciais antigas.

### 1. Preservar o serviço de origem antigo

Substitua todos os marcadores pela configuração guardada. Use o volume real se diferente de miniodata. As credenciais antigas explícitas continuam válidas após alterar S3. Não transfira uma imagem latest presumida.

```text
{{operator:upgrade-minio-config}}
```

![Preservar o serviço de origem antigo.](guide:operator-upgrade-minio-config)

### 2. Gerar novos valores Garage

Acrescente GK aos 24 caracteres hexadecimais. Gere separadamente 64 caracteres para segredo S3, segredo RPC e token admin. Mantenha privados.

```sh
{{operator:upgrade-garage-key}}
```

![Gerar novos valores Garage.](guide:operator-upgrade-garage-key)

### 3. Guardar os novos parâmetros de armazenamento

Substitua todos os marcadores. Inclua config/garage.toml e os ficheiros Compose alvo. Compose recusa segredos Garage em falta. Não inicie ainda a API.

```text
{{operator:upgrade-garage-config}}
```

![Guardar os novos parâmetros de armazenamento.](guide:operator-upgrade-garage-config)

## Migrar com a imagem API escolhida

Mantenha bases disponíveis e todas as escritas antigas paradas. Preserve versões dos motores e do armazenamento.

### 1. Fixar a versão aplicativa escolhida

Use a versão concreta escolhida nas notas, não o marcador. Não altere emissor nem chave de cifra.

```text
{{operator:upgrade-version}}
```

![Fixar a versão aplicativa escolhida.](guide:operator-upgrade-version)

### 2. Transferir apenas imagens aplicativas

Use todas as sobreposições existentes. Guarde imagens anteriores para recuperação. Isto não atualiza PostgreSQL nem Garage.

```sh
{{operator:upgrade-pull}}
```

![Transferir apenas imagens aplicativas.](guide:operator-upgrade-pull)

### 3. Executar migrações uma vez

Exija código 0 e migrações interna e alvo concluídas. Não inicia dependências nem o servidor API. Se falhar, pare. Algumas alterações podem estar gravadas. Não execute binários antigos num esquema alterado. Restaure bases, objetos, chaves e imagens em conjunto se necessário.

```sh
{{operator:upgrade-migrate}}
```

![Executar migrações uma vez.](guide:operator-upgrade-migrate)

## Copiar objetos antigos antes de reabrir escritas

Apenas para MinIO para Garage. Mantenha a API parada. As bases devem estar disponíveis para o CLI de manutenção.

### 1. Iniciar armazenamentos de origem e destino

Use nomes reais da configuração combinada. Não inclua api neste comando.

```sh
{{operator:upgrade-stores}}
```

![Iniciar armazenamentos de origem e destino.](guide:operator-upgrade-stores)

### 2. Copiar e verificar os objetos

Substitua OLD_KEY, OLD_SECRET e SOURCE_BUCKET. Segredos aparecem em argumentos e histórico. MinIO não é alterado. Repita após falha. Objetos do mesmo tamanho são ignorados; tamanho igual não prova conteúdo igual. Exija verificação concluída, compare somas e abra ficheiros. Guarde o volume antigo. A eliminação posterior é opcional.

```sh
{{operator:upgrade-storage-copy}}
```

![Copiar e verificar os objetos.](guide:operator-upgrade-storage-copy)

## Verificar antes de retomar tráfego

Inicie a API nova apenas após migração e cópia concluídas. Se o tráfego já voltou, reconcilie entregas e efeitos externos antes de restaurar um estado antigo.

### 1. Iniciar os serviços escolhidos e verificar estado

Mantenha versões e sobreposições. Leia registos e dados representativos antes de reabrir tráfego.

```sh
{{operator:upgrade-start}}
```

![Iniciar os serviços escolhidos e verificar estado.](guide:operator-upgrade-start)

### 2. Verificar saúde e trabalho pendente

HTTP 202 significa aceite, não concluído. Examine recibos webhook e execuções ligadas. Repita pedidos interrompidos apenas com Idempotency-Key e entrada originais. Saúde não prova restauro nem efeitos externos.

```sh
{{operator:upgrade-health}}
```

![Verificar saúde e trabalho pendente.](guide:operator-upgrade-health)

### 3. Reconstruir projeções antigas apenas se necessário

Para versões anteriores ao estado dos resultados, índice de pacientes ou duplicados, preenche campos novos. Reescreve o modelo de leitura e exige --force. Ignore quando desnecessário. Guarde cópia verificada e imagens anteriores segundo a política de retenção.

```sh
{{operator:upgrade-reproject}}
```

![Reconstruir projeções antigas apenas se necessário.](guide:operator-upgrade-reproject)

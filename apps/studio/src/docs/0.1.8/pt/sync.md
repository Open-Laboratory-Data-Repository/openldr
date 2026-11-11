# Sincronização distribuída

A **sincronização distribuída** liga vários laboratórios a um servidor OpenLDR **central**, por ligações lentas ou intermitentes. Cada laboratório corre uma instalação OpenLDR CE completa, trabalha sem ligação e põe-se em dia sempre que há ligação.

- **Para cima, do laboratório à central.** Os dados que o laboratório possui: pacientes, pedidos, resultados, amostras e relatórios. A central guarda uma cópia só de leitura que nunca altera. O laboratório continua a ser a fonte de verdade.
- **Para baixo, da central ao laboratório.** A configuração que a central possui: formulários, painéis, definições de relatórios e definições permitidas, mais a terminologia (sistemas de códigos e mapeamentos). Os laboratórios usam-nas só para leitura.
- **Marcação do site.** Cada registo leva o `site_id` do laboratório que o criou. A central organiza e remove duplicados por esse campo, por isso dois laboratórios nunca colidem, mesmo com os mesmos identificadores locais.

Leva cerca de 30 minutos, com duas instalações: uma central e um laboratório. As imagens vêm de uma só instalação, com a sincronização desligada: mostram as páginas, não uma ligação real. Selecione uma imagem ou um clip para o ampliar.

![A página Sincronização distribuída de um laboratório, no separador Definições.](sync-settings-tab.png)

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **View sync** | Ver o estado da sincronização e o separador Atividade |
| **Manage sync** | Configurar a sincronização, inscrever e gerir sites, resolver divergências |

As duas páginas estão em **Definições**: **Sites** na central, **Sincronização distribuída** num laboratório.

## Antes de começar

- A **central** inscreve laboratórios e guarda a cópia. Os **laboratórios** ligam-se à central e enviam os seus próprios dados.
- A inscrição cria clientes Keycloak, por isso o realm Keycloak da central tem de dar à conta de serviço de administração os papéis `manage-clients` e `view-clients`. A exportação de realm incluída no OpenLDR já os tem. Um contentor Keycloak arrancado pela primeira vez **antes** de existir a sincronização precisa de voltar a importar o realm, ou de receber esses dois papéis à mão. Caso contrário, a criação do cliente falha.
- Use HTTPS para o URL da central em produção. O segredo do cliente passa uma vez na inscrição, e os tokens do laboratório em cada sincronização.
- O laboratório chega à central **de servidor para servidor, por HTTPS**. Se a central tiver um certificado autoassinado, que é a predefinição do instalador, o laboratório tem de receber o certificado público da central. Passar o aviso num navegador **não** chega: o servidor do laboratório verifica o certificado sozinho. Veja o [Exemplo 2](#exemplo-2-confiar-no-certificado-da-central-no-laboratorio).

## Exemplo 1: inscrever um laboratório na central

A inscrição cria um cliente Keycloak confidencial, `sync-<siteId>`, com um mapeador de token `site_id`. Gera o segredo do cliente e junta uma linha à lista de sites. O segredo só aparece **uma vez** e nunca mais pode ser lido. Se se perder, rode-o.

![A página Sites da central e o seu menu: Inscrever site, Transferir certificado central, Atualizar.](sync-sites-menu.mp4)

1. Na central, abra **Definições** e depois **Sites**.
2. Abra o menu **⋯** da página e selecione **Inscrever site**. Preencha:

   | Campo | Notas |
   | --- | --- |
   | Site ID | Um identificador estável do laboratório, por exemplo `lab-site-01`. Minúsculas, algarismos e hífenes, 1 a 63 caracteres, sem hífen no início. É também o id do cliente Keycloak e a chave da lista de sites. |
   | Name | Um rótulo legível, opcional. |
   | Central URL | O endereço público pelo qual o laboratório chega à central, por exemplo `https://central.example.org`. Obrigatório. |

   ![A janela Inscrever um site, com Site ID, Name e Central URL.](sync-enroll-site.png)

3. Selecione **Inscrever**. Uma janela única mostra o que o laboratório precisa: **client id**, **client secret**, **OIDC issuer** e **central URL**. Copie cada um com o seu botão e entregue-os ao laboratório antes de fechar. O segredo não volta a aparecer. A mesma janela tem **Transferir certificado central**, para levar o certificado no mesmo passo.

**Resultado esperado:** o site aparece com um distintivo **active**. O menu da linha oferece **Rodar segredo**, que emite um segredo novo, e **Revogar**, que elimina o cliente e marca a linha como revogada.

### Transferir o certificado da central

Se o laboratório tiver de confiar numa central autoassinada, dê-lhe o certificado público da central. Selecione **Transferir certificado central** no menu **⋯** da página Sites, ou na janela de inscrição, para guardar `central-certificate.pem`. Vem de `GET /api/settings/sync/central-certificate`, só para administradores. É o certificado TLS público da central, não um segredo. Precisa de que `TLS_CERT_PATH` aponte para o certificado da central. O instalador define-o e monta o certificado por si.

### Na linha de comandos, na central

```bash
openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org
openldr sync list
openldr sync rotate lab-site-01
openldr sync revoke lab-site-01
```

`sync enroll` mostra uma vez o client id, o client secret, o site id, o URL da central e o emissor OIDC, com um aviso de que o segredo não volta a aparecer. `--central-url` é obrigatório. `sync list` mostra os sites inscritos e o estado, nunca um segredo. `sync rotate` mostra uma vez um segredo novo. `sync revoke` elimina o cliente e marca a linha como revogada, e pode correr duas vezes sem problema. Junte `--json` a qualquer um para saída legível por máquina.

## Exemplo 2: confiar no certificado da central no laboratório

Salte este passo se a central tiver um certificado em que o laboratório já confia, por exemplo do Let's Encrypt para um domínio real. É preciso quando a central usa um certificado **autoassinado**: a predefinição do instalador, e o caso habitual de uma central numa rede local ou num endereço IP.

**Porquê.** O processo de sincronização do laboratório abre uma ligação HTTPS à central para obter um token e enviar ou receber dados. O Node.js, que corre o servidor do laboratório, verifica o certificado da central com o seu próprio armazém de confiança e recusa o que não conhece, diga o navegador o que disser. Por isso a sincronização falha até o laboratório confiar no certificado.

1. Copie `central-certificate.pem` para o laboratório, por exemplo para `config/nginx/certs/central/fullchain.pem` ao lado do ficheiro compose.
2. Monte-o só de leitura no contentor `api` do laboratório, e defina `NODE_EXTRA_CA_CERTS` com o caminho dentro do contentor. No `docker-compose.yml` do laboratório, no serviço `api`:

   ```yaml
   volumes:
     - ./config/nginx/certs/central/fullchain.pem:/etc/ssl/central-ca.pem:ro
   ```

   e no `.env` do laboratório:

   ```bash
   NODE_EXTRA_CA_CERTS=/etc/ssl/central-ca.pem
   ```

3. Recrie a API do laboratório: `docker compose up -d api`.

**O certificado tem de corresponder ao endereço da central.** O TLS também verifica que o certificado foi emitido para o endereço a que o laboratório se liga. Se o laboratório chega à central por um IP, como `https://10.0.0.5`, o certificado da central tem de ter esse IP como **IP Subject Alternative Name**. Um certificado que só o tenha como nome DNS é recusado com `ERR_TLS_CERT_ALTNAME_INVALID`. Crie um certificado com IP SAN se for preciso:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout config/nginx/certs/privkey.pem -out config/nginx/certs/fullchain.pem \
  -subj "/CN=10.0.0.5" -addext "subjectAltName=IP:10.0.0.5,DNS:localhost,IP:127.0.0.1"
```

Depois reinicie a gateway da central com `docker compose restart gateway`, transfira o certificado outra vez e repita os passos acima no laboratório.

## Exemplo 3: ligar o laboratório à central

O operador do laboratório pega nos cinco valores da inscrição (client id, client secret, site id, URL da central e emissor OIDC) e introdu-los na página **Sincronização distribuída** do laboratório.

1. No laboratório, abra **Definições** e depois **Sincronização distribuída**. Tem dois separadores: **Definições**, a configuração, e **Atividade**, o estado ao vivo e os eventos recentes. Fique em **Definições**.
2. Preencha os campos:

   | Campo | Notas |
   | --- | --- |
   | Ativar sincronização | O interruptor principal. Desligado, os dois processos ficam parados. |
   | Direção | **Enviar para a central** só envia os dados do laboratório. **Obter da central** só recebe a configuração e a terminologia. **Bidirecional** faz as duas coisas. |
   | URL da central | O endereço da central dado na inscrição, por exemplo `https://central.example.org`. |
   | ID do site | O site id deste laboratório, por exemplo `lab-site-01`. |
   | URL do emissor OIDC | O emissor do realm dado na inscrição, por exemplo `https://central.example.org/auth/realms/openldr`. |
   | ID do cliente | O cliente criado, `sync-<siteId>`. |
   | Segredo do cliente | O segredo único da inscrição. Só de escrita e mascarado. Deixe-o em branco quando editar outros campos, para manter o valor guardado. |
   | Intervalo de sincronização (minutos) | A frequência, de 1 a 1440. 15 por predefinição. |

3. Selecione **Guardar**. Com a sincronização ligada, o URL da central, o site id, o emissor OIDC e o ID do cliente são obrigatórios. Guardar tem efeito imediato: ligar ou desligar, mudar a direção ou alterar um campo arranca, para ou reconfigura os processos ao vivo, **sem reiniciar**.

### Acompanhar a sincronização

![Abrir o separador Atividade.](sync-activity.mp4)

Abra o separador **Atividade**. Uma faixa de estado, atualizada a cada poucos segundos, mostra:

- Um distintivo **on** ou **off** para o conjunto.
- Uma linha de envio e uma de receção, cada uma `running` ou `idle`, com a última sequência e a hora da última sincronização. Uma direção que o modo exclui mostra **não iniciado**.
- **Envios pendentes**: quantas alterações locais esperam para subir.
- **Última verificação** e **Último sucesso**.

Por baixo, a tabela **Atividade recente** lista cada evento, o mais recente primeiro: direção, evento (`synced`, `failed`, `quarantined` ou `diverged`), número de registos, detalhe e hora. Selecione uma linha para o erro e os metadados completos. **Sincronizar agora** corre uma passagem logo, em vez de esperar pelo intervalo. Diz se a passagem arrancou, e não faz nada com a sincronização desligada.

![O separador Atividade numa instalação sem sincronização: não iniciado, 0 envios pendentes, nunca verificado, sem atividade.](sync-activity-tab.png)

**Resultado esperado** com uma ligação real: a central mostra o laboratório **active** em Sites. No laboratório, **Atividade** mostra o conjunto ligado, com as linhas de envio e receção a avançar e **Envios pendentes** a descer para zero. A cópia da central recebe os registos do laboratório, marcados com o site id. O laboratório recebe os formulários, painéis, relatórios e a terminologia da central.

### Na linha de comandos, no laboratório

```bash
openldr settings sync show
openldr settings sync set mode bidirectional
openldr sync status
openldr sync now
```

`settings sync set <field> <value>` escreve um campo: `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret` ou `intervalMinutes`. `sync status` mostra os processos ao vivo, os cursores e o atraso pendente. `sync now` corre uma passagem, e falha se a sincronização estiver desligada.

## Num telemóvel

As duas páginas funcionam num telemóvel. A tabela de atividade desliza para o lado para chegar ao detalhe de cada evento.

## Resolução de problemas

- **A sincronização fica desligada, ou nada acontece.** Confirme que a sincronização está ligada e que a direção é a esperada. Confirme o URL da central, o site id, o emissor OIDC e o ID do cliente. Um segredo em branco mantém o valor antigo, por isso um segredo errado precisa de ser colado de novo.
- **`503` "identity provider admin client is not configured" ao inscrever, na central.** A API não tem as credenciais da conta de serviço de administração do Keycloak. Defina `KEYCLOAK_ADMIN_CLIENT_ID` e `KEYCLOAK_ADMIN_CLIENT_SECRET` no `.env` da central e recrie a API. O registo de auditoria fica vazio, porque a inscrição só escreve a entrada depois de criar o cliente.
- **`403` ao inscrever, na central.** A conta de serviço de administração não tem `manage-clients` e `view-clients`. Volte a importar o realm da central, ou junte esses dois papéis à mão, e tente outra vez.
- **A inscrição falha com `fetch failed: connect ECONNREFUSED 127.0.0.1:443`, na central.** A API tenta chegar ao Keycloak pelo endereço público, que dentro do contentor é a própria API. Defina `OIDC_INTERNAL_ISSUER_URL` com o realm interno, por exemplo `http://keycloak:8080/auth/realms/openldr`, para as chamadas do servidor usarem o endereço interno. Recrie a API.
- **A sincronização do laboratório falha com `self-signed certificate`.** O laboratório não confia no certificado da central. Veja o [Exemplo 2](#exemplo-2-confiar-no-certificado-da-central-no-laboratorio).
- **A sincronização falha com `ERR_TLS_CERT_ALTNAME_INVALID`.** O certificado é aceite mas não lista o endereço a que o laboratório se liga. Crie o certificado da central com uma IP Subject Alternative Name para esse endereço, transfira-o outra vez e instale-o de novo no laboratório.
- **Segredo do cliente perdido.** Não se recupera, de propósito. Use **Rodar segredo** no site, no menu da linha em Sites ou com `openldr sync rotate <siteId>`, e cole o segredo novo no separador Definições do laboratório.
- **Tokens do laboratório recusados na central.** O site foi revogado, ou o ID do cliente ou o emissor OIDC do laboratório não corresponde ao que a central criou. Confirme que o site está ativo com `openldr sync list`, e que o emissor aponta para o realm da central.
- **Um laboratório revogado precisa de voltar.** Inscreva outra vez o mesmo site id na central. A linha reativa-se e é emitido um segredo novo.

## Guias relacionados

- [Definições](/docs/settings)
- [Utilizadores e funções](/docs/users)
- [Variáveis de ambiente](/docs/environment)

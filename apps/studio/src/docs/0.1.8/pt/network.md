# Rede

Rede contém duas listas mantidas por um administrador. A primeira reúne os certificados em que este OpenLDR confia quando contacta outro servidor por HTTPS, por exemplo um servidor central com o seu próprio certificado. A segunda reúne os anfitriões que um fluxo de trabalho pode contactar. Precisa da permissão **Gerir a confiança de rede**.

Este guia não tem clipe. Cada tarefa são poucos passos numa só página.

## Confiar no certificado de outro OpenLDR

Faça-o quando a sincronização com um servidor central falha com um erro de certificado, ou quando um fluxo de trabalho tem de contactar um servidor que criou o seu próprio certificado.

1. Peça a impressão digital do certificado à pessoa que gere o outro servidor. Obtenha-a por telefone ou em pessoa, não a partir da página do servidor.
2. Abra **Definições** e depois **Rede**.
3. Abra o menu de pontos no canto superior direito e selecione **Adicionar certificado**.
4. Em **Endereço**, escreva o endereço do outro servidor, por exemplo `hub.example.org` ou `hub.example.org:8443`.
5. Abra o menu de pontos do painel e selecione **Ler certificado**.
6. Compare a **Impressão digital** no ecrã com a que recebeu, par a par.
7. Se forem iguais, abra o menu de pontos do painel e selecione **Guardar**.
8. Reinicie o OpenLDR. Veja **Reiniciar o OpenLDR** abaixo.

**Resultado esperado:** depois do reinício, o **Estado** do certificado é **Em uso**. Antes, o estado é **Após reinício**.

Se as duas impressões digitais forem diferentes, pare. Não guarde.

Se tiver o certificado num ficheiro, cole o texto em **Ou cole-o** no passo 4 em vez de escrever um endereço. Nunca cole uma chave privada. O OpenLDR recusa-a e não guarda nada.

Na linha de comandos, com a aplicação de ambiente de trabalho ou o lançador autónomo:

```
openldr-standalone cli -- trust add --address hub.example.org:8443 --fingerprint <SHA-256>
```

Numa instalação Docker, o comando `openldr` não pode fazer perguntas. Indique a impressão digital, e ele só guarda se o certificado corresponder:

```
openldr trust add --address hub.example.org:8443 --fingerprint <SHA-256>
openldr trust add data/hub.pem --fingerprint <SHA-256>
```

Sem `--fingerprint`, o comando mostra a impressão digital do certificado e não guarda nada. Compare-a e volte a executar o comando com ela.

## Reiniciar o OpenLDR

O OpenLDR só lê os certificados de confiança quando arranca. Um certificado adicionado ou removido tem efeito depois de um reinício.

- **Aplicação de ambiente de trabalho:** abra o ícone do OpenLDR na área de notificação, selecione **Sair** e volte a abrir o OpenLDR.
- **Lançador autónomo:** execute `openldr-standalone stop` e depois `openldr-standalone start`.
- **Instalação Docker:** na pasta de instalação, execute `docker compose restart api`.

**Resultado esperado:** a coluna **Estado** passa de **Após reinício** para **Em uso**.

## Remover um certificado de confiança

1. Abra **Definições** e depois **Rede**.
2. Na linha do certificado, abra o menu de pontos e selecione **Remover**.
3. Leia a pergunta e selecione **Remover**.
4. Reinicie o OpenLDR.

**Resultado esperado:** antes do reinício, a linha mostra **Removido após reinício**. Depois, a linha desaparece, e o OpenLDR deixa de confiar num servidor que apresente esse certificado.

Na linha de comandos: `openldr trust remove <impressão digital> --force`.

## Permitir que um fluxo de trabalho contacte outro anfitrião

O passo HTTP de um fluxo de trabalho só pode contactar os anfitriões desta lista.

1. Abra **Definições** e depois **Rede**.
2. Selecione o separador **Anfitriões dos fluxos de trabalho**.
3. Abra o menu de pontos no canto superior direito e selecione **Adicionar anfitrião**.
4. Em **Anfitrião**, escreva o nome do anfitrião ou o endereço IP, por exemplo `hub.example.org`. Não indique porta nem caminho.
5. Abra o menu de pontos do painel e selecione **Guardar**.

**Resultado esperado:** o anfitrião fica na lista com a origem **Definido aqui**. Um fluxo de trabalho pode contactá-lo de imediato. Não é preciso reiniciar.

Um anfitrião aqui abrange todos os serviços web desse anfitrião, em qualquer porta.

Na linha de comandos: `openldr workflows hosts add hub.example.org`. Para remover um: `openldr workflows hosts remove hub.example.org --force`.

## Permitir que um fluxo de trabalho contacte este OpenLDR

Faça-o quando um fluxo de trabalho tem de contactar o endereço web deste próprio OpenLDR, por exemplo para ir buscar resultados a horas certas.

1. Abra **Definições** e depois **Rede**.
2. Selecione o separador **Anfitriões dos fluxos de trabalho**.
3. Ligue **Permitir que os fluxos de trabalho contactem este OpenLDR**.

**Resultado esperado:** o interruptor fica ligado. O endereço ao lado é o único que isto permite. Os outros programas do mesmo computador ficam fora de alcance.

Na linha de comandos: `openldr workflows hosts self on`, e `off` para desligar.

## Desbloquear a lista

Um corte de energia ou uma falha durante uma alteração pode deixar a lista de certificados bloqueada. A página indica então que uma alteração foi interrompida, e nenhuma alteração passa.

1. Confirme que mais ninguém está a alterar a lista neste momento.
2. Abra o menu de pontos no canto superior direito e selecione **Desbloquear**.
3. Leia a pergunta e selecione **Desbloquear**.

**Resultado esperado:** a nota desaparece e pode voltar a adicionar ou remover um certificado.

**Desbloquear** aparece quando o bloqueio tem 30 segundos. Essa idade não prova que a alteração parou. É por isso que o passo 1 vem primeiro.

Na linha de comandos: `openldr trust unlock --force`.

## Limites

- Um certificado adicionado ou removido só tem efeito depois de um reinício. Um anfitrião de fluxo de trabalho tem efeito de imediato.
- Um anfitrião com a origem **Definição do servidor** vem de `WORKFLOW_HTTP_ALLOWLIST` no servidor. Altere-o aí.
- A página pode mostrar a lista sem o deixar alterá-la. Nesse caso diz porquê no topo. Uma instalação feita antes de esta página existir pode precisar de uma alteração feita por quem gere o servidor. O guia de ambiente do site explica `TRUSTED_CA_FILE`.

## Resolução de problemas

- **Nada respondeu nesse endereço.** Verifique o endereço e a porta, e se o outro servidor está ligado. Este computador tem de conseguir alcançá-lo.
- **Esse certificado já é de confiança.** Está na lista. Verifique o **Estado**: pode ainda precisar de um reinício.
- **A lista está a ser alterada.** Outra pessoa está a guardar uma alteração. Tente de novo dentro de momentos. Se a página indicar que uma alteração foi interrompida, veja **Desbloquear a lista**.
- **Não foi possível atualizar a página.** O que vê pode estar desatualizado. Abra o menu de pontos no canto superior direito e selecione **Atualizar**.
- **A sincronização continua a falhar depois de adicionar o certificado.** Reinicie o OpenLDR e verifique se o estado é **Em uso**. Verifique também se o certificado indica o endereço que usa para o servidor central.

## Guias relacionados

- [Conectores](/docs/connectors)
- [Sincronização distribuída](/docs/sync)
- [Fluxos de trabalho](/docs/workflows)

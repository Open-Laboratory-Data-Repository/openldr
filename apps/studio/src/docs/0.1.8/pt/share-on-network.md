# Abrir o OpenLDR a partir de outro PC

Um laboratório precisa de um só OpenLDR, e não de um em cada PC. Partilhe-o na rede do laboratório. Os outros PC abrem-no então num navegador e iniciam sessão com os mesmos utilizadores e os mesmos dados. Este guia é para a pessoa que cuida do PC onde o OpenLDR corre.

Aplica-se à aplicação de ambiente de trabalho e ao lançador autónomo. Uma instalação Docker já é acessível pela rede, no seu próprio endereço.

Este guia não tem clipe. Os passos acontecem na área de notificação e noutro PC, fora do Studio.

## Partilhar o OpenLDR deste PC

Faça isto uma vez, no PC onde o OpenLDR corre.

1. Abra o ícone do OpenLDR na área de notificação, a parte da barra de tarefas com os ícones pequenos.
2. Selecione **Partilhar na rede do laboratório**.
3. Leia a pergunta e selecione **Partilhar**.
4. Aguarde enquanto a janela mostra **A parar o OpenLDR** e depois **A iniciar o OpenLDR**.
5. Abra o ícone outra vez e selecione **Copiar o endereço de rede**.

**Resultado esperado:** o menu mostra um endereço que começa por `https://`, e esse endereço fica copiado.

Se o OpenLDR foi iniciado fora da aplicação, nada reinicia. A aplicação diz que a alteração se aplica da próxima vez que ela iniciar o OpenLDR.

Num PC sem a aplicação de ambiente de trabalho, inicie o lançador com `openldr-standalone start --share`. Ele mostra o endereço, um segundo endereço com números, e a impressão digital do certificado.

## Abri-lo noutro PC

1. No outro PC, abra um navegador como o Chrome ou o Edge.
2. Na barra de endereço, escreva o endereço do primeiro PC, por exemplo `https://labpc:3443/studio/`.
3. Quando o navegador avisar sobre o certificado, verifique-o primeiro. Veja **Verificar o certificado** mais abaixo.
4. Aceite o certificado.
5. Inicie sessão com o seu nome de utilizador e a sua palavra-passe do OpenLDR.

**Resultado esperado:** o Studio abre, com os mesmos dados do primeiro PC.

Se o endereço com o nome do PC não abrir, use o que tem números, por exemplo `https://192.168.1.20:3443/studio/`. O lançador mostra os dois. A área de notificação mostra um. Para os outros, execute `openldr-standalone status --json` no primeiro PC e leia `share.addresses`.

## Verificar o certificado

O primeiro PC cria o seu próprio certificado, por isso um navegador não o conhece. Confirme que é o certo antes de o aceitar.

1. No primeiro PC, abra o ícone e selecione **Copiar a impressão digital do certificado**. Com o lançador, leia a linha que começa por `Certificate fingerprint (SHA-256):` no terminal dele.
2. Cole-a num sítio onde a possa ler, ou leia-a em voz alta à pessoa que está no outro PC.
3. No outro PC, abra os detalhes do certificado a partir do aviso do navegador.
4. Encontre a impressão digital **SHA-256**.
5. Compare as duas, par a par.

**Resultado esperado:** as duas impressões digitais são iguais. Aceite então o certificado. Se forem diferentes, pare e não inicie sessão.

## Usar a aplicação OpenLDR noutro PC

Faça isto no outro PC quando quiser lá a aplicação OpenLDR em vez de um navegador. A aplicação mostra então o OpenLDR deste laboratório e não guarda dados.

1. Instale a aplicação de computador OpenLDR no outro PC e inicie-a.
2. No primeiro ecrã, selecione **Ligar ao servidor do laboratório**.
3. Em **Endereço do servidor**, escreva o endereço do primeiro PC, por exemplo `https://labpc:3443/studio/`.
4. Selecione **Ligar**.
5. Compare a impressão digital que a aplicação mostra com a do primeiro PC. Veja **Verificar o certificado** acima.
6. Selecione **Corresponde**.
7. Inicie sessão com o seu nome de utilizador e a sua palavra-passe do OpenLDR.

**Resultado esperado:** o Studio abre na aplicação, com os mesmos dados do primeiro PC. A aplicação vai direta a ele no arranque seguinte.

Um PC que já guarda dados do OpenLDR não mostra o primeiro ecrã. Use **Ligar a um servidor de laboratório...** no menu da área de notificação.

## Bloquear um PC no OpenLDR

Faça isto num PC de uma sala partilhada que deve mostrar o OpenLDR e mais nada.

1. Abra o ícone do OpenLDR na área de notificação.
2. Selecione **Bloquear este PC no OpenLDR...**.
3. Escreva um PIN com pelo menos 4 caracteres.
4. Selecione **Bloquear**.

**Resultado esperado:** a janela ocupa o ecrã inteiro, fechá-la não faz nada, e as ligações para outros sítios não abrem.

Para desbloquear, prima `Ctrl+Shift+L`, escreva o PIN e selecione **Desbloquear**. Sair da aplicação também pede o PIN. O guia web da aplicação de computador diz o que o bloqueio não impede, e o que fazer com um PIN esquecido.

## Limites

- O primeiro PC tem de estar ligado, com o OpenLDR a correr, sempre que os outros o usam.
- Um novo endereço de rede ou um novo nome para o primeiro PC cria um certificado novo. Os outros PC veem então o aviso mais uma vez. Dê um endereço fixo ao primeiro PC para o evitar.
- Use-o só na rede do laboratório. Nunca o abra à Internet.

## Resolução de problemas

- **O menu mostra «Não foi encontrado nenhum endereço de rede».** O PC não está em nenhuma rede. Ligue-o a uma, saia do OpenLDR e volte a abri-lo.
- **A aplicação diz que a porta 3443 já está em uso.** Outro programa usa-a. O guia web da aplicação de ambiente de trabalho mostra como escolher outra porta.
- **O outro PC não consegue abrir o endereço.** Confirme que os dois PC estão na mesma rede, e que a firewall do primeiro PC permite a porta 3443.
- **A aplicação mostra «Não é possível alcançar o servidor».** O primeiro PC está desligado, ou a rede falhou. A aplicação volta sozinha quando o primeiro PC responde.
- **A aplicação mostra «O certificado do servidor mudou».** O primeiro PC tem um novo nome ou endereço de rede. Compare a nova impressão digital antes de selecionar **Corresponde**.

## Guias relacionados

- [Início de sessão e palavras-passe](/docs/sign-in)
- [Primeiro arranque](/docs/first-run)

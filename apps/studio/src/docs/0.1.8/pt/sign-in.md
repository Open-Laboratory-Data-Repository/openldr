# Início de sessão e palavras-passe

A sua conta OpenLDR tem um nome de utilizador e uma palavra-passe. Este guia explica como iniciar sessão, alterar a palavra-passe, e o que fazer depois de um bloqueio ou de um esquecimento. As últimas tarefas são para administradores, que juntam pessoas e repõem as suas palavras-passe.

Este guia aplica-se quando o seu laboratório usa o início de sessão próprio do OpenLDR. Reconhece-o por dois sinais: a página de início de sessão tem o título **Iniciar sessão no OpenLDR**, e o seu menu do utilizador tem **Alterar a palavra-passe**. Se o seu laboratório inicia sessão através do Keycloak ou de outro fornecedor, a sua palavra-passe é gerida lá. Pergunte ao seu administrador como a alterar.

## Iniciar sessão

1. Abra o endereço que usa para o Studio.
2. Em **Nome de utilizador ou e-mail**, escreva o seu nome de utilizador ou o seu endereço de e-mail.
3. Em **Palavra-passe**, escreva a sua palavra-passe.
4. Selecione **Iniciar sessão**.

**Resultado esperado:** o Studio abre. Se um administrador lhe deu uma palavra-passe temporária, abre antes a página **Escolha uma nova palavra-passe**.

As maiúsculas não contam no nome de utilizador nem no e-mail. O e-mail só funciona quando nenhuma outra conta tem o mesmo. A palavra-passe tem de estar exata.

Mantém a sessão iniciada enquanto usa o Studio. Uma sessão termina após 12 horas sem uso, ou 7 dias depois de iniciar sessão, o que acontecer primeiro. Depois disso, inicia sessão de novo.

## Escolher uma nova palavra-passe no primeiro início de sessão

Um administrador que o junta ou que repõe a sua palavra-passe dá-lhe uma palavra-passe temporária. O Studio pede-lhe que a substitua da primeira vez que a usa.

1. Inicie sessão com a palavra-passe temporária.
2. Em **Palavra-passe atual**, escreva a palavra-passe temporária.
3. Em **Nova palavra-passe**, escreva a palavra-passe que quer.
4. Em **Repetir a palavra-passe**, escreva-a de novo.
5. Selecione **Alterar a palavra-passe**.

**Resultado esperado:** o Studio abre. Enquanto não terminar esta página, o Studio não mostra mais nada. Para sair sem a alterar, selecione **Terminar sessão**.

Uma palavra-passe tem de 10 a 128 caracteres, e não pode ser o seu nome de utilizador. Não há regra sobre algarismos ou símbolos, e uma palavra-passe nunca expira. Uma frase longa que consiga lembrar funciona bem.

## Alterar a sua palavra-passe

1. Selecione o seu nome no canto inferior esquerdo do menu principal. Num telemóvel, abra primeiro o menu principal no canto superior esquerdo.
2. Selecione **Alterar a palavra-passe**. Abre-se um painel lateral.
3. Em **Palavra-passe atual**, escreva a palavra-passe que usa agora.
4. Em **Nova palavra-passe**, escreva a nova.
5. Em **Repetir a palavra-passe**, escreva-a de novo.
6. Abra o menu de três pontos no canto superior direito do painel e selecione **Guardar**.

**Resultado esperado:** aparece a mensagem **Palavra-passe alterada.** e o painel fecha. Continua com a sessão iniciada aqui. Todos os outros navegadores ou dispositivos onde tinha sessão iniciada terminam a sessão.

Uma palavra-passe atual errada conta como uma tentativa errada, tal como no início de sessão.

## Terminar sessão

1. Selecione o seu nome no canto inferior esquerdo do menu principal.
2. Selecione **Terminar sessão**.

**Resultado esperado:** abre-se a página **Iniciar sessão no OpenLDR**.

Por vezes o Studio não consegue contactar o servidor ao terminar sessão. A página de início de sessão diz então **O fim de sessão não chegou ao servidor. A sua sessão pode ainda estar aberta neste navegador.** Quando a ligação voltar, selecione **Tentar terminar sessão novamente**. Num computador partilhado, espere até essa mensagem desaparecer antes de sair.

## Se a sua conta estiver bloqueada

Cinco palavras-passe erradas seguidas bloqueiam a conta durante cinco minutos. Durante o bloqueio, até a palavra-passe certa é recusada.

A página de início de sessão mostra uma só mensagem para uma palavra-passe errada e para uma conta bloqueada: **Estes dados estão errados, ou a conta está bloqueada durante alguns minutos.** Não diz qual dos dois, para que um estranho não saiba se uma conta existe.

1. Aguarde cinco minutos.
2. Inicie sessão de novo e escreva a palavra-passe com cuidado.

**Resultado esperado:** o Studio abre.

Um bloqueio acaba sempre por si. Ninguém consegue bloquear uma conta de vez a adivinhar. Um início de sessão certo põe a contagem a zero, tal como uma reposição da palavra-passe feita por um administrador.

**Demasiadas tentativas. Aguarde um minuto e tente novamente.** é outro limite. Permite 30 tentativas de início de sessão por minuto a partir de um mesmo endereço, seja qual for a conta. Aguarde um minuto e tente novamente.

## Se se esquecer da palavra-passe

Peça a um administrador que a reponha. O início de sessão próprio do OpenLDR não lhe pode enviar uma ligação de reposição por e-mail.

O administrador dá-lhe uma palavra-passe temporária. Inicie sessão com ela e escolha uma nova, como em [Escolher uma nova palavra-passe no primeiro início de sessão](#escolher-uma-nova-palavra-passe-no-primeiro-inicio-de-sessao).

## Criar o primeiro administrador

Esta tarefa e as seguintes são para administradores.

Uma instalação nova não tem contas. Enquanto ninguém criar o primeiro administrador, o Studio mostra a página **Criar o administrador** a quem o abrir. O código de configuração prova que essa pessoa também tem acesso ao servidor.

1. No servidor, execute `openldr auth setup-code`. O comando mostra um código válido durante 30 minutos.
2. Abra o Studio. Abre-se a página **Criar o administrador**.
3. Em **Código de configuração**, escreva o código.
4. Em **Nome de utilizador**, escreva o nome de utilizador do administrador. Use 3 a 64 letras, algarismos, pontos, hífenes ou sublinhados.
5. Em **Palavra-passe** e **Repetir a palavra-passe**, escreva a palavra-passe.
6. Selecione **Criar o administrador**.

**Resultado esperado:** o Studio abre com a sessão do novo administrador iniciada, com a função **Administrator**. A página não volta a aparecer nesta instalação.

Executar o comando de novo substitui o código anterior. Enquanto o primeiro administrador não existir, o `openldr doctor` mostra um aviso na sua linha Sign-in. Veja [Verificações de instalação](/docs/setup-checks).

## Juntar uma pessoa com uma palavra-passe temporária

Precisa da permissão **Manage users**. A função Administrator tem-na.

1. Abra **Utilizadores** no menu principal.
2. Abra o menu de três pontos no canto superior direito e selecione **Novo utilizador**.
3. Em **Nome de utilizador**, escreva o nome de utilizador da pessoa.
4. Em **Palavra-passe**, escreva uma palavra-passe temporária com 10 caracteres ou mais.
5. Em **Confirmar palavra-passe**, escreva-a de novo.
6. Em **Função**, escolha uma função.
7. Abra o menu de três pontos do painel e selecione **Criar**.

**Resultado esperado:** aparece uma mensagem como **amina guardado**, e a pessoa está na lista. No primeiro início de sessão, tem de escolher a sua própria palavra-passe.

Entregue a palavra-passe temporária diretamente à pessoa, em pessoa ou por telefone. Se deixar **Palavra-passe** vazia, a conta não consegue iniciar sessão até repor a sua palavra-passe.

## Repor a palavra-passe de alguém

Faça-o quando uma pessoa se esquece da palavra-passe, ou quando pensa que outra pessoa a conhece. Precisa da permissão **Reset passwords**.

1. Abra **Utilizadores** no menu principal.
2. Na linha da pessoa, abra o menu de três pontos e selecione **Repor palavra-passe**.
3. Selecione **Gerar**. Uma nova palavra-passe de 16 caracteres preenche os dois campos.
4. Selecione o botão de copiar ao lado da palavra-passe, ou leia-a no campo.
5. Deixe **Exigir alteração da palavra-passe no próximo início de sessão** marcado.
6. Selecione **Repor palavra-passe**.

**Resultado esperado:** aparece uma mensagem como **Palavra-passe reposta para amina**. A sessão da pessoa termina em todo o lado de uma vez. No próximo início de sessão, tem de escolher uma nova palavra-passe. A reposição também acaba com um bloqueio.

Uma palavra-passe que escreva em vez de usar **Gerar** segue as mesmas regras: 10 a 128 caracteres, e não pode ser o nome de utilizador.

## Terminar as sessões de alguém

Faça-o quando uma pessoa perde um telemóvel ou um portátil, ou deixa um computador partilhado com a sessão iniciada. Precisa da permissão **Force logout**.

1. Abra **Utilizadores** no menu principal.
2. Na linha da pessoa, abra o menu de três pontos e selecione **Forçar término de sessão**.
3. Selecione **Forçar término de sessão** de novo para confirmar.

**Resultado esperado:** aparece uma mensagem como **Todas as sessões encerradas para amina**. Cada um dos seus navegadores e dispositivos perde o acesso no pedido seguinte. A palavra-passe não muda.

Não o pode fazer na sua própria linha. Use **Terminar sessão** em vez disso.

## Na linha de comandos

Um servidor de laboratório sem navegador tem as mesmas ações como comandos `openldr`. Execute-os no servidor.

```bash
openldr auth setup-code
openldr user create --username amina --name "Amina Hassan" --role lab_technician
openldr users list
openldr user assign-role <user-id> data_analyst
openldr user reset-password <username> --force
openldr user end-sessions <username>
```

- `auth setup-code` mostra um código de configuração para o primeiro administrador, válido durante 30 minutos. Recusa assim que existe um administrador.
- `user create` mostra o ID do novo utilizador e uma palavra-passe temporária, uma só vez. Copie a palavra-passe nesse momento, porque nada a volta a mostrar. O comando recusa uma função que não existe. Também recusa enquanto o primeiro administrador não existir.
- `users list` mostra o ID de cada utilizador no início da linha.
- `user assign-role` junta uma função. Recebe o ID do utilizador, não o nome de utilizador. Com um nome de utilizador, indica sucesso e não concede nada.
- `user reset-password` mostra uma só vez uma nova palavra-passe temporária e termina as sessões da pessoa. Sem `--force`, não altera nada.
- `user end-sessions` termina a sessão da pessoa em todo o lado.

`reset-password` e `end-sessions` comparam o nome de utilizador exatamente, incluindo maiúsculas.

## Limites

- Em HTTP simples, uma palavra-passe atravessa a rede sem cifra. Quem consiga observar a rede entre o seu computador e o servidor pode lê-la. HTTPS, ou uma rede privada como o Tailscale, resolve isso. Pergunte ao seu administrador o que o seu laboratório usa.
- Não há segundo fator, como um código de uma aplicação no telemóvel.
- Não há reposição da palavra-passe por e-mail. Um administrador repõe as palavras-passe.
- As pessoas não podem criar a sua própria conta. Um administrador junta-as.
- As cinco tentativas, o bloqueio de cinco minutos e as durações de sessão são fixos. Não são definições.

## Resolução de problemas

- **A página diz que os dados estão errados, mas tenho a certeza deles.** A conta pode estar bloqueada. Aguarde cinco minutos. Uma conta desativada recebe a mesma mensagem, por isso, se continuar a falhar, peça ajuda a um administrador.
- **O Studio mandou-me de volta para a página de início de sessão.** A sessão terminou. Isso acontece após 12 horas sem uso, após 7 dias, quando um administrador a termina, ou quando altera a palavra-passe noutro dispositivo. Inicie sessão de novo.
- **Não foi possível contactar o servidor. Tente novamente.** O Studio não consegue contactar o servidor. Verifique a sua ligação e tente novamente.
- **A página de configuração diz que o código está errado ou expirou.** Um código dura 30 minutos, e cada código novo substitui o anterior. Execute `openldr auth setup-code` de novo e escreva o código mais recente.
- **A página de configuração diz que o nome de utilizador já está em uso.** Escolha outro nome de utilizador.
- **A página de configuração diz que já existe um administrador.** Outra pessoa terminou a configuração primeiro. Selecione **Iniciar sessão**.
- **O último administrador esqueceu-se da palavra-passe.** Alguém com acesso ao servidor executa `openldr user reset-password <username> --force`. O comando mostra uma palavra-passe temporária.

## Guias relacionados

- [As suas preferências](/docs/user-preferences)
- [Utilizadores e funções](/docs/users)
- [Verificações de instalação](/docs/setup-checks)

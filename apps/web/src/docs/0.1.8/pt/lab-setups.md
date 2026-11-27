# Escolher uma instalação para o laboratório

Uma regra serve para todos os laboratórios. Cada local tem uma única instalação completa do OpenLDR, e cada outro PC do local é um ecrã para essa instalação. A instalação guarda os dados e os utilizadores. Os outros PC não guardam nada.

Esta página descreve quatro instalações. Escolha a que corresponde ao seu local e siga as ligações para os passos.

## Local pequeno com ligação fraca

Um local que analisa as suas próprias amostras e tem uma ligação à internet fraca. Pode enviar algumas amostras para um laboratório maior.

- **O que instalar.** A [aplicação de computador](/docs/desktop-app) num PC, definida para **Este PC guarda os dados do laboratório**.
- **Onde criar os utilizadores.** Nesse PC. O local tem os seus próprios utilizadores.
- **Quando a internet falha.** O trabalho continua. Os dados estão no PC, por isso nada no local precisa da ligação. Os registos para o OpenLDR nacional esperam até a ligação voltar.

Dê a este local a sua própria instalação, mesmo que haja um laboratório maior por perto. Um ecrã para o OpenLDR de outro local para sempre que a ligação cai.

## Laboratório com dois PC

Um PC guarda os dados e o segundo mostra-os.

- **O que instalar no PC 1.** A aplicação de computador, definida para **Este PC guarda os dados do laboratório**, com **Partilhar na rede do laboratório** marcado no menu da área de notificação.
- **O que instalar no PC 2.** A aplicação de computador, definida para **Ligar ao servidor do laboratório**, com o endereço do PC 1. Um navegador no PC 2 também serve.
- **Onde criar os utilizadores.** Uma vez, no PC 1. O PC 2 inicia sessão com os mesmos utilizadores.
- **Quando a rede falha.** O PC 1 funciona como antes. O PC 2 mostra **Não é possível alcançar o servidor** e volta sozinho quando consegue alcançar o PC 1.

O PC 1 tem de estar ligado, com o OpenLDR a funcionar, sempre que o PC 2 é usado. Faça cópias de segurança só do PC 1. O PC 2 não guarda dados.

## Laboratório maior com vários PC

Um laboratório com receção e várias bancadas. Outros locais podem enviar-lhe amostras.

- **O que instalar no servidor.** A edição de servidor, com Docker. Veja [Instalar](/docs/install). Tem HTTPS e foi feita para estar exposta a uma rede.
- **O que instalar em cada outro PC.** A aplicação de computador, definida para **Ligar ao servidor do laboratório**, ou um navegador.
- **Onde criar os utilizadores.** No servidor. É um único local com um único conjunto de utilizadores.
- **Quando a rede falha.** Um PC que não alcança o servidor mostra **Não é possível alcançar o servidor**. O servidor mantém os seus dados. Ligue o servidor a uma alimentação que aguente cortes curtos.

## PC ao lado de um analisador

Um PC colocado junto de um instrumento, que passa os resultados adiante.

- **O que instalar.** Nem servidor OpenLDR nem base de dados. O PC executa o programa que lê o instrumento. Esse programa vem com o plugin do instrumento e aponta para o OpenLDR do local.
- **Onde criar os utilizadores.** Em lado nenhum neste PC. O programa inicia sessão no OpenLDR do local com uma única conta. O guia do plugin diz que conta usar.
- **Quando a rede falha.** O guia do plugin diz o que o programa guarda e o que envia mais tarde.

Para que as pessoas usem também o Studio neste PC, junte a aplicação de computador definida para **Ligar ao servidor do laboratório**.

## Como escolher

| O seu local | Instalação |
| --- | --- |
| Um só PC, ou uma ligação que cai muitas vezes | Local pequeno com ligação fraca |
| Dois ou três PC numa sala | Laboratório com dois PC |
| Uma receção, várias bancadas, ou amostras de outros locais | Laboratório maior com vários PC |

## O que não muda

- Cada local mantém os seus próprios utilizadores. Iniciar sessão não precisa do OpenLDR nacional.
- Só o PC que guarda os dados precisa de cópia de segurança.
- Um PC ligado a um servidor mostra a versão do Studio do servidor. Atualize o servidor, e todos os ecrãs acompanham.
- A partilha é para a rede do próprio laboratório. Nunca abra à internet uma aplicação de computador partilhada.

## Limites

- Enviar uma amostra do OpenLDR de um local para o de outro não está nesta versão.
- Um PC em modo de ligação instala o mesmo pacote que um PC que guarda os dados, cerca de 500 a 600 MB. Um pacote mais pequeno fica para mais tarde.
- Estas instalações foram experimentadas com os dois lados num só computador. Falta um ensaio em dois PC reais.

## Guias relacionados

- [Aplicação de computador](/docs/desktop-app)
- [Executar sem Docker](/docs/standalone)
- [Instalar](/docs/install)
- [Requisitos](/docs/requirements)

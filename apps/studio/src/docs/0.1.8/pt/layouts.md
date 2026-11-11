# Disposições

## Resultado

Uma disposição é uma barra lateral com nome. Define as páginas que a barra lateral mostra e a página que abre primeiro depois de iniciar sessão. Um administrador cria as disposições e escolhe uma como predefinição para cada função. Cada utilizador pode escolher outra, ou a barra lateral completa.

Uma disposição só esconde páginas. Nunca mostra uma página que a sua função não pode abrir, e uma página escondida continua a abrir a partir de uma ligação. A documentação aparece sempre.

## Escolher a sua disposição

1. Abra o menu do utilizador no fundo da barra lateral.
2. Escolha **Disposição**. Só aparece quando existe pelo menos uma disposição.
3. Escolha uma opção:
   - **Predefinição da função** usa a disposição que o administrador definiu para a sua função. O nome entre parênteses indica qual.
   - Uma disposição pelo nome usa essa, seja qual for a predefinição da sua função.
   - **Barra lateral completa** mostra todas as páginas que a sua função pode abrir.

A sua escolha fica guardada na sua conta e acompanha-o em qualquer navegador ou telemóvel.

## Que página abre primeiro

1. A sua própria página inicial, se escolheu uma em **Página inicial** no menu do utilizador.
2. Caso contrário, a página inicial da sua disposição.
3. Caso contrário, o Painel.

A página inicial só abre se estiver na sua barra lateral. A lista **Página inicial** só oferece as páginas que a sua disposição mostra.

## Para administradores: criar uma disposição

1. Abra **Definições** e depois **Disposições**.
2. Abra o menu ⋯ no canto superior direito e escolha **Nova disposição**.
3. Dê-lhe um **Nome**.
4. Marque as **Páginas** que mostra.
5. Escolha uma **Página inicial** entre as páginas marcadas, ou deixe Painel.
6. Em **Predefinição para as funções**, marque cada função que deve receber esta disposição por predefinição. Uma função tem uma só predefinição. Marcar uma função aqui retira-a de qualquer outra disposição.
7. Abra o menu ⋯ da janela lateral e escolha **Guardar**.

Para mudar ou eliminar uma disposição, use o menu ⋯ da sua linha. Eliminar pede confirmação. Os utilizadores que tinham escolhido uma disposição eliminada voltam à predefinição da sua função.

Um utilizador com várias funções recebe a predefinição da primeira dessas funções, pela ordem da página Funções.

É preciso a capacidade `settings.edit_general` para mudar disposições. Qualquer utilizador com sessão iniciada vê a lista, porque o menu do utilizador a oferece. O registo de auditoria guarda cada alteração como `layout.create`, `layout.update` ou `layout.delete`.

## Na linha de comandos

```bash
openldr layouts list
```

```bash
openldr layouts set Bench --pages /forms,/patients --start-page /forms --roles lab_technician
```

```bash
openldr layouts delete Bench --force
```

`set` cria a disposição, ou substitui a que tem esse nome. Ao substituir, a página inicial e as funções que não indicar mantêm o valor atual. `--start-page none` limpa a página inicial.

Para definir a escolha de um utilizador:

```bash
openldr user preferences set <user-id> layout full
```

Use o id de uma disposição, `full` para a barra lateral completa, ou `none` para voltar à predefinição da função.

# Ambiente local

## O que está preparado

| Camada | Escolha | Situação |
| --- | --- | --- |
| Aplicação web | Next.js App Router, React e TypeScript | Base executável e checagem de tipos |
| Estilo | Tailwind CSS | Configurado e usado na página de preparação |
| Servidor | Route Handlers do Next.js | Endpoint de saúde; cliente OpenAI exclusivo do servidor |
| IA para documentos | SDK OpenAI, Responses API, `gpt-6.1-sol` | Cliente e teste de conexão; extração ainda não implementada |
| Validação | Zod e Structured Outputs | Teste técnico de JSON estruturado |
| Visualização de PDF | PDF.js | Dependência instalada; visualizador ainda não implementado |
| Persistência local | SQLite por `@libsql/client` | Driver verificado; esquema e dados do produto ainda não implementados |
| Voz | GPT-Live + Decisions | Direção mantida no PRD; sessão e interação ainda não implementadas |

SQLite é uma escolha para desenvolvimento local. Para uma demonstração publicada com duas sessões, será necessário banco compartilhado e armazenamento privado persistente. Não publicar um arquivo SQLite em um filesystem efêmero de funções e tratá-lo como banco compartilhado. O provedor será definido na etapa de publicação.

Os comandos usam o compilador Webpack, suportado pelo Next.js. Neste ambiente, o Turbopack falhou ao abrir a porta interna de um processo de CSS; o ajuste mantém o desenvolvimento local dentro das permissões disponíveis.

## Credenciais

John autorizou o uso da `OPENAI_API_KEY` existente no ambiente. Não é necessário gerar outra chave para continuar a preparação. Não imprimir a chave, incluí-la no Git, retorná-la por uma rota ou repassá-la ao navegador.

O `.env.example` contém apenas nomes de variáveis e valores não secretos. O teste da API usa uma frase sintética, `store: false`, limite de saída e nenhuma informação clínica. Nenhuma chamada à OpenAI ocorre ao abrir a página inicial ou durante o build.

Para a voz, o servidor negociará uma sessão conforme a documentação oficial; o navegador não deve receber a chave permanente. Confirmar acesso a GPT-Live e à permissão `api.decisions.write` antes de integrar a voz. Um teste bem-sucedido de Responses não comprova acesso a esses recursos.

## Implementação seguinte

1. Implementar as duas visões e o vínculo autorizado, com o mesmo caso sintético.
2. Implementar importação, visualização da fonte e revisão por item. A IA propõe um rascunho; a aplicação decide se pode ativá-lo.
3. Persistir o plano confirmado, ocorrências, registros e ajuda. Usar identificação de tentativas para impedir duplicação.
4. Conectar voz às mesmas ações validadas dos botões; informar sucesso somente depois da gravação.
5. Verificar a jornada em duas sessões e nos tamanhos de celular e desktop antes de publicar.

As decisões de produto em `docs/product/` prevalecem sobre telas antigas. Não implementar versões de plano, OCR separado, seleção manual de regiões ou fila offline apenas porque aparecem em um mockup anterior.

## Referências técnicas

- [Instalação do Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Entrada de imagens](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-Live e Decisions](https://developers.openai.com/api/docs/guides/decisions-voice)

## Contas no MVP de avaliação

A entrada oferece o caso pronto de demonstração e uma conta nova com um plano vazio. A conta nova tem o papel fixo de cuidador; autenticação, sessão e vínculo com seu caso são validados no servidor. As sessões de demonstração continuam separadas das contas, e conhecer um identificador de caso não permite abrir um caso de conta pelo endpoint de demonstração.

Os dados são locais a esta instalação. Cadastro, login, saída e retorno à sessão fazem parte desse recorte; confirmação de e-mail, recuperação de senha e convites entre contas ficam para uma evolução. A publicação ainda exige persistência adequada ao ambiente de hospedagem.

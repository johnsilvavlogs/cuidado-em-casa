# Cuidado em Casa

Web app para uma pessoa cuidada e um cuidador organizarem orientações recebidas, acompanharem a rotina e pedirem ajuda. Este repositório reúne a preparação técnica e as referências de produto; o fluxo completo ainda será implementado.

## Rodar localmente

Requer Node.js 22.16 ou superior e npm. Use a chave `OPENAI_API_KEY` já disponível no ambiente do servidor. Se preferir um arquivo local, use `.env.local`, que está excluído do Git. Nunca coloque a chave em uma variável `NEXT_PUBLIC_*`.

```sh
npm ci
npm run doctor
npm run dev
```

Abra [localhost:3000](http://localhost:3000). A página inicial identifica a base de desenvolvimento; `/api/health` confirma que o servidor responde.

```sh
npm run check          # lint, TypeScript e build
npm run check:openai   # uma chamada curta e cobrada à API, sem dados pessoais
```

## Referências para implementação

- [PRD e escopo](docs/product/prd.md)
- [Fluxo e decisões de produto](docs/product/direction.md)
- [Wireframes e imagens](docs/design/README.md)
- [Stack e próximos passos técnicos](docs/engineering/local-stack.md)
- [Documentos sintéticos de teste](testes/README.md)

## Stack preparada

Next.js com App Router, React, TypeScript e Tailwind CSS. Route Handlers mantêm as chamadas à OpenAI no servidor. O SDK oficial da OpenAI e Zod atendem à saída estruturada; PDF.js está instalado para o visualizador. SQLite via libSQL permite começar localmente sem provisionar outro serviço. As versões exatas estão em `package.json` e `package-lock.json`.

O MVP usa um único cuidador, confirmação humana por item e relatos opcionais de sono, alimentação e bem-estar. Dados da demonstração devem ser fictícios. Não confundir dependências instaladas com funcionalidades já implementadas.

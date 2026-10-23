# Cuidado em Casa

Web app para uma pessoa cuidada e um cuidador organizarem orientações recebidas, acompanharem a rotina e pedirem ajuda. Inclui as visões de paciente e cuidador, importação e revisão de documentos, registros compartilhados e integração de voz com OpenAI. Inclui revisão humana antes da ativação e confirmação antes de cada gravação por voz.

## Rodar localmente

Use Node.js 26.4.0 (versão em `.nvmrc`) e npm 11.17.0 para reproduzir o ambiente verificado. Use a chave `OPENAI_API_KEY` já disponível no ambiente do servidor. Se preferir um arquivo local, use `.env.local`, que está excluído do Git. Nunca coloque a chave em uma variável `NEXT_PUBLIC_*`.

```sh
npm ci
npm run doctor
npm run dev
```

Abra [localhost:3000](http://localhost:3000). Na entrada, explore a demonstração pronta com Helena e Marina ou crie uma conta para preparar um plano vazio. `/api/health` confirma que o servidor responde.

```sh
npm run check          # lint, TypeScript e build
npm run check:openai   # uma chamada curta e cobrada à API, sem dados pessoais
```

O [guia para outra máquina](docs/engineering/run-on-another-machine.md) inclui instalação, execução e como fixar um commit.

## Referências para implementação

- [PRD e escopo](docs/product/prd.md)
- [Fluxo e decisões de produto](docs/product/direction.md)
- [Wireframes e imagens](docs/design/README.md)
- [Arquitetura e execução local](docs/engineering/local-stack.md)
- [Documentos sintéticos de teste](testes/README.md)

## Stack implementada

Next.js com App Router, React, TypeScript e Tailwind CSS. Route Handlers mantêm as chamadas à OpenAI no servidor. O SDK oficial da OpenAI e Zod atendem à saída estruturada; PDF.js está instalado para o visualizador. SQLite via libSQL permite começar localmente sem provisionar outro serviço. As versões exatas estão em `package.json` e `package-lock.json`.

O MVP usa um único cuidador, confirmação humana por item e relatos opcionais de sono, alimentação e bem-estar. Dados da demonstração devem ser fictícios. Veja os resultados, limites e comandos reproduzíveis no [relatório de validação](docs/engineering/validation.md).

## Acesso para avaliar o MVP

- **Demonstração pronta:** explore uma rotina fictícia como paciente ou cuidadora e alterne entre as duas visões. O link compartilhado dá acesso apenas a esse caso de demonstração.
- **Começar do zero:** crie uma conta com nome, e-mail e senha. Ela entra como cuidador, com um plano vazio, e pode sair e entrar novamente para continuar. O caso da conta não pode ser aberto pelo link público da demonstração.

As contas e os planos ficam no banco desta instalação. Use dados e documentos fictícios durante a avaliação. Não há confirmação de e-mail, recuperação de senha ou convites para vincular outra conta nesta etapa. A demonstração com duas pessoas permanece disponível separadamente.

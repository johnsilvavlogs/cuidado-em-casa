# Rodar a mesma versão em outra máquina

O repositório contém código, imagens, PRD, referências visuais e os oito documentos sintéticos de teste. O banco local, documentos enviados, gravações de teste e chaves não são publicados. Cada máquina começa com seus próprios casos de exemplo.

## Instalação

É necessário acesso ao repositório privado no GitHub. O ambiente usado para verificar esta versão tem Node.js 26.4.0 e npm 11.17.0. A versão de Node também está em `.nvmrc`.

```sh
git clone https://github.com/johnsilvavlogs/cuidado-em-casa.git
cd cuidado-em-casa
# Se usar nvm:
nvm install
nvm use
npm ci
```

Para fixar exatamente a versão entregue, use o SHA do commit informado no PR/entrega:

```sh
git fetch origin
git checkout <SHA_DO_COMMIT>
npm ci
```

Em uma cópia existente, preserve alterações locais antes de trocar a revisão. `package-lock.json` fixa as dependências; use `npm ci` em vez de atualizar os pacotes.

## Chave e execução

Crie `.env.local` a partir de `.env.example` e preencha `OPENAI_API_KEY` com uma chave própria. Nunca coloque a chave no Git nem em variáveis `NEXT_PUBLIC_*`. A chave é usada apenas no servidor. Para testar toda a integração, a conta deve ter acesso aos modelos `gpt-6.1-sol`, `gpt-live-1` e `gpt-6-luna`, incluindo Responses, Live e Decisions. Chamadas à OpenAI podem ter custo.

```sh
cp .env.example .env.local
# Preencha OPENAI_API_KEY em .env.local com seu editor.
npm run doctor
npm run dev
```

Abra http://127.0.0.1:3000. Para rodar o build de produção local:

```sh
npm run build
npm start
```

O SQLite e os documentos enviados ficam em `.data/`, excluído do Git. O servidor fica limitado à própria máquina. Dois computadores não compartilham esse banco automaticamente.

## Conferência

```sh
npm run check
node --import tsx --test tests/ai/*.test.ts tests/backend/*.test.ts
```

Os testes de unidade usam dados locais. Os comandos abaixo fazem chamadas reais à OpenAI com conteúdo sintético:

```sh
npm run check:openai
node --import tsx scripts/check-capabilities.ts
node --import tsx scripts/evaluate-extraction.ts
node --import tsx scripts/evaluate-voice-decisions.ts
```

Na interface, uma rotina pronta permite registrar cuidados, corrigir registros, relatar sono/alimentação e pedir apoio. O menu de perfil troca entre paciente e cuidador do mesmo caso. Para duas sessões simultâneas, abra o link da outra visão em uma janela privada. Um novo plano permite importar PDF, JPEG, PNG ou texto, revisar o original e confirmar cada cuidado antes de ativá-lo.

## Limites desta versão

- Os perfis e vínculos são cenários locais de teste; não há autenticação para produção.
- Voz propõe um registro por vez e exige confirmação na tela antes de salvar.
- A leitura por IA é um rascunho que exige conferência humana; não substitui avaliação clínica.
- Banco compartilhado entre máquinas, implantação pública, notificações push e uso offline não fazem parte desta entrega local.
- O plano fica fixo após ser ativado.

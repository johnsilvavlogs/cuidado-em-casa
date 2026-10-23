# Cuidado em Casa na nuvem

A publicação usa o Site existente, com a página pública em `/`, o aplicativo em `/app` e os endpoints em `/api`. O Worker executa o servidor; D1 guarda contas e registros, R2 guarda documentos e a chave OpenAI fica nos segredos do Site. O Mac não precisa permanecer ligado.

O endereço permanente `/play-demo` cria uma demonstração pronta e abre o dia da Helena. Os botões da página inicial apontam para ele. Cada abertura começa um caso separado; o perfil da Marina dentro do aplicativo compartilha o mesmo caso.

O armazenamento cloud começa separado do armazenamento local. Esta preparação não transfere contas, sessões ou documentos já salvos no Mac.

## Preparar o código

Abra o repositório do Site com o helper oficial, preservando sua identidade e `.git`. Prepare um starter Vinext com o helper `project-setup.mjs` do plugin Sites. Então execute na raiz deste repositório:

```sh
node cloud/prepare-site.mjs --starter output/sites-cloud/starter --target output/sites-cloud/cuidado-em-casa
```

O script copia a interface e os endpoints atuais, mantém as versões das dependências do app e troca a fronteira de armazenamento pelo adaptador cloud. Ele preserva a identidade do Site, transforma os caminhos públicos da landing, aponta seus botões para `/app` e mantém o compartilhamento entre os dois perfis dentro do app. Não copia arquivos de ambiente, credenciais ou dados locais.

O adaptador em `cloud/runtime`, o schema em `cloud/schema.ts` e as migrações em `cloud/migrations` são copiados quando presentes. Execute a preparação novamente depois de atualizá-los. Não rode o script durante instalação ou build.

## Instalar, verificar e publicar

No checkout preparado, gere o lockfile após uma mudança das dependências e use os helpers oficiais do plugin Sites:

```sh
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
node /caminho/do/plugin-sites/scripts/install-dependencies.mjs
npm run typecheck
node /caminho/do/plugin-sites/scripts/build-site.mjs
```

Depois da instalação, `npm run db:generate` gera migrações de uma mudança de schema. Preserve o SQL e os metadados gerados em `cloud/migrations` na fonte principal. Para conferir a interface localmente, execute `npm run dev -- --port 5174` no checkout preparado; esse preview não é necessário para manter o site publicado funcionando.

Configure `OPENAI_API_KEY` pelos segredos do Site. Nunca grave a chave em código, arquivos de ambiente enviados ou parâmetros de comandos. O manifesto declara `DB` e `DOCUMENTS`; a plataforma cria e associa os recursos durante a publicação. Migrações devem conter somente schema.

Para publicar, o responsável pelo Site usa `site-workflow.mjs` para sincronizar e empacotar a fonte, salva a versão e a implanta com as ferramentas nativas. Preserve o público atual do Site. Verifique no endereço publicado a landing, abertura de `/app`, sessão de demonstração, compartilhamento entre perfis, gravação dos registros e leitura dos documentos. A leitura com IA e a voz exigem a chave configurada e devem ser verificadas no ambiente publicado.

# Prévia sem reconstruir o aplicativo em uso

O Next instalado suporta `distDir`. `CARE_DIST_DIR` é opcional: sem a variável continua usando `.next`; com `.next-preview` ou `.next-stable`, build e start usam aquela saída. Só são aceitos nomes locais `.next`/`.next-*`, sem caminho absoluto, subdiretório ou travessia.

Enquanto a porta 3000 serve a versão estável, executar em outro terminal:

```sh
node scripts/care-preview.mjs build
node scripts/care-preview.mjs start
```

O helper fixa `.next-preview` e `127.0.0.1:3002`, mesmo se o terminal tiver outro `CARE_DIST_DIR`. Não encerra processos nem usa a porta 3000. Abrir a prévia em contexto de navegador isolado e criar um caso sintético novo: portas diferentes no mesmo host compartilham cookies; o banco `.data` também é compartilhado. Nunca reconstruir `.next-preview` enquanto uma pessoa usa essa prévia.

Para uma próxima inicialização estável planejada:

```sh
CARE_DIST_DIR=.next-stable npm run build
CARE_DIST_DIR=.next-stable npm run start -- --port 3000
```

Esses comandos não migram o processo atual. O dono do servidor coordena a troca; não executá-los sobre uma `.next-stable` já em uso. Manter build e start com o mesmo `CARE_DIST_DIR`.

Adicionar `/.next-*/` ao `.gitignore` antes do primeiro build alternativo. Next pode regravar `next-env.d.ts` e entradas de tipos do `tsconfig.json`; são arquivos de desenvolvimento, não os artefatos servidos da saída estável. Revisar essas alterações geradas sem descartar mudanças alheias.

## Evidência e recuperação

O registro `output/e2e/voice-ui/dev-hmr-transition-report.json` documenta `/api/state` respondendo 500 durante a transição/HMR de 23/10 às 16:17 UTC. O relato posterior `Failed to fetch` é compatível com indisponibilidade/reinício, mas falta um evento de rede e log correlacionado que prove a causa desse episódio. Um 500 HTTP e uma falha de transporte são classes diferentes; não se deve declarar que um comprova o outro.

`/api/actions` já usa transação SQLite, chave única `(case_id, request_id)` e comparação de payload/papel. Repetir o mesmo request ID devolve o estado sem duplicar a operação; reutilizá-lo para outro conteúdo é rejeitado. O botão de tentativa novamente retém o corpo/request ID. Após resposta perdida, usar essa tentativa ou consultar o estado; uma ação nova com ID novo não é a mesma tentativa.

Verificação sem build ou servidor:

```sh
node --import tsx --test scripts/check-build-isolation.test.ts
node --import tsx --test --test-name-pattern="concurrent retries" tests/backend/care-repository.test.ts
```

O build alternativo e o teste vivo da porta 3002 cabem ao dono do servidor. Esta implementação não iniciou nem interrompeu processos.

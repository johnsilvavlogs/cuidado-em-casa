# Ambiente local

O MVP roda em um único processo Next.js, com SQLite e arquivos privados no disco local. Não exige provisionar banco ou armazenamento externo para desenvolver.

| Camada | Implementação |
| --- | --- |
| Web | Next.js App Router, React, TypeScript, CSS responsivo |
| Servidor | Route Handlers; chave OpenAI somente no servidor |
| Persistência | SQLite por `@libsql/client`, em `.data/` |
| Documentos | Original privado; PDF.js com páginas e zoom; JPEG, PNG ou texto |
| Extração | Responses, `gpt-6.1-sol`, Structured Outputs e Zod |
| Voz | GPT-Live `gpt-live-1`, WebRTC e Decisions `gpt-6-luna` |
| Verificação | Node Test Runner e Playwright, além de inspeção no navegador |

As versões exatas estão no lockfile. Os comandos usam Webpack porque o Turbopack falhou ao abrir a porta interna do compilador CSS neste ambiente.

## Execução

```sh
npm ci
npm run doctor
npm run dev
```

Abra `http://127.0.0.1:3000`. Uma rotina pronta permite alternar entre paciente e acompanhante. “Preparar novo plano” cria outro caso, sem apagar os anteriores.

`OPENAI_API_KEY` é lida do ambiente ou de `.env.local`. John autorizou a chave existente; não é necessário gerar outra. Nunca usar `NEXT_PUBLIC_` para credenciais. Nenhuma chamada à OpenAI ocorre durante o build ou ao simplesmente abrir a rotina.

## Contratos do produto

- A extração gera um rascunho. O acompanhante corrige e confirma cada cuidado, esclarece pendências e declara que leu todas as páginas antes da ativação.
- Horários operacionais são definidos explicitamente; a aplicação não inventa horários a partir de intervalos prescritos.
- O plano ativo é fixo. Registros, correções e ajuda têm autor, horário e histórico.
- A gravação é online. Tentativas repetidas usam a mesma identidade e não duplicam a ação. Falha de rede não é apresentada como sucesso.
- Ajuda urgente tem acesso próprio e ligação independente para o SAMU. Resolver ajuda não conclui a tarefa.

## Voz vinculada às ações

```mermaid
sequenceDiagram
    actor Pessoa
    participant Web as Aplicativo
    participant Live as GPT-Live
    participant Decisions
    participant API as Servidor e SQLite
    Pessoa->>Web: Liga o microfone
    Web->>API: Oferta WebRTC
    API->>Live: Cria sessão com catálogo da rotina
    Live->>Decisions: Classifica intenção e cuidado
    Decisions-->>Web: Proposta estruturada
    Web-->>Pessoa: Mostra ação e horário para conferir
    Pessoa->>Web: Confirma
    Web->>API: Mesma ação validada dos botões
    API-->>Web: Gravação confirmada
    Web-->>Pessoa: Registro salvo
    Note over API,Web: A outra visão consulta o mesmo estado
```

A voz pode registrar tarefa feita/não feita, pouco/suficiente/muito sono, alimentação completa/parcial/ausente e pedido de apoio. Uma pergunta, intenção futura ou referência ambígua não autoriza registro. A aplicação pausa o microfone enquanto a proposta aguarda confirmação. Cancelar não grava; repetir a mesma decisão não abre outra proposta. Relatos de alimentação preservam os dados de sono e humor do mesmo dia.

- [Instalação do Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Entrada de imagens](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-Live e Decisions](https://developers.openai.com/api/docs/guides/decisions-voice)

## Contas no MVP de avaliação

A entrada oferece o caso pronto de demonstração e uma conta nova com um plano vazio. A conta nova tem o papel fixo de cuidador; autenticação, sessão e vínculo com seu caso são validados no servidor. As sessões de demonstração continuam separadas das contas, e conhecer um identificador de caso não permite abrir um caso de conta pelo endpoint de demonstração.

Os dados são locais a esta instalação. Cadastro, login, saída e retorno à sessão fazem parte desse recorte; confirmação de e-mail, recuperação de senha e convites entre contas ficam para uma evolução. A publicação ainda exige persistência adequada ao ambiente de hospedagem.
## Limites desta versão

A demonstração usa identidades e casos sintéticos. Contas têm autenticação e isolamento do plano; o vínculo por convite entre duas contas ainda não está implementado.

Para publicar, é preciso definir banco compartilhado e armazenamento privado persistente. SQLite em disco efêmero de funções não atende a esse requisito. Não há fila offline, push, aplicativo nativo, HealthKit ou mudança de tratamento pela IA.

A extração não foi validada clinicamente. Não promete leitura confiável de manuscritos; campos incertos permanecem pendentes. Veja [validação](validation.md).

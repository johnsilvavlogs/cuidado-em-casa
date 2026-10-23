# Validação do MVP local

Evidências coletadas em 23 de outubro de 2026. Os casos e documentos usados são sintéticos. Relatos de testes não equivalem a validação clínica nem a aprovação para uso com pacientes reais.

## OpenAI

| Verificação | Resultado | Limite da conclusão |
| --- | --- | --- |
| Responses estruturado | Resposta real válida | Credencial e modelo acessíveis |
| Oito receitas do repositório | 8 processadas; 115/118 verificações lexicais | Três omissões de contexto em ORT01/ORT02; avaliação humana continua necessária |
| Decisions, política `2026-10-23.5` | 14/14 frases classificadas como esperado, incluindo cancelamento | Texto sintético, não medição de precisão de fala |
| GPT-Live por WebSocket | Sessão, decisão nativa, áudio e transcrição | Prova do serviço; não comprova percepção humana do áudio |
| Microfone e WebRTC no navegador | Conexão e transcrição observadas | Teste breve autorizado, sem ação clínica |
| Áudio → Decisions → confirmação → gravação, política `.5` | Live/WebRTC real com áudio sintético; confirmação e repetição pelo Computer Use; uma conclusão persistida e leitura pelo cuidador | Dois pedidos HTTP idênticos após perda controlada da primeira resposta; não representa variedade de vozes ou ruído |
| Contexto de tarefas concluídas | Live identificou medicamento/alimentação já feitos e somente caminhada pendente | Casos sintéticos controlados |
| Referência contextual | “Já concluí” após o assistente citar a caminhada gerou a intenção correta em Live | Teste real por WebSocket |

As três diferenças de extração foram contexto anatômico/lateralidade de cabeçalhos não repetido no texto da tarefa. Não chamar o resultado de 100% de acurácia. Um documento totalmente ilegível retornou zero cuidados; manuscritos exigem revisão. Essa avaliação de oito documentos corresponde ao prompt de extração `2026-10-23.2`.

A política de voz `.4` passou 11/13 frases na repetição: reconheceu duas ações de medicamento, mas não o ID da tarefa. A `.5` separa a identificação da tarefa das regras da ação; as 14 chamadas seguintes passaram, sem remover os bloqueios para ambiguidade, intenção futura, perguntas e cancelamento. Os resultados anteriores foram preservados em `output/ai/task-identity-repair/` e `output/ai/cancellation-verification/`.

## Fluxos e persistência

Os testes de domínio cobrem sessões, isolamento de casos, papéis, importação, confirmação, ativação, horários explícitos, correções, mudança de dia, ajuda normal/urgente, bem-estar opcional, originais privados e repetição de pedidos.

O gatilho de Decisions acompanha as transcrições do paciente. A interface correlaciona os eventos, ignora respostas antigas/duplicadas e também envia a fala acumulada à Decisions após uma pausa. Essa segunda via aceita pedidos explícitos como “pode concluir a caminhada leve”, sem depender de um fragmento isolado. O estado em tempo real é enviado em mensagens compactas para respeitar o limite do Live. O estado persistido da rotina é enviado ao conectar e atualizado quando sua revisão muda. A integração da voz verifica que nenhuma decisão grava automaticamente; o cancelamento preserva o estado; a confirmação usa a ocorrência correta; repetir a decisão não duplica a proposta. Sono e alimentação preservam os demais campos do relato. O acompanhante lê o mesmo registro após recarregar. Sem permissão de microfone, os botões continuam funcionando.

O foco final é mobile, conforme pedido: 320 px e 390×844. As inspeções de desktop anteriores são históricas e não fazem parte do aceite final. As referências visuais, a anatomia congelada, capturas e medições ficam em `output/iterate/`. Evidências são transitórias e não entram no Git; a documentação de produto e os assets finais entram.

A verificação integrada da política `.5` usou Chrome com viewport 390×844, áudio sintético em português, Live/WebRTC e Decisions reais. O cartão e a repetição após perda da resposta foram acionados por Computer Use. O servidor manteve uma única conclusão, e a sessão do cuidador mostrou quatro tarefas registradas. Cinco cenários mobile de regressão também passaram. Recibos desta rodada: `output/e2e/voice-policy-5/` e `output/e2e/voice-policy-5-live/`.

A revisão de documentos permite confirmar em lote os itens claros após a conferência de todas as páginas. O servidor valida o lote inteiro antes de alterar qualquer item; dúvidas, ausência de campos essenciais e itens desconhecidos bloqueiam o lote. A ação não ativa o plano. Root verificou o percurso de sete itens no navegador mobile; testes de domínio verificaram recusa atômica e repetição idempotente.

Outra execução pelo navegador importou texto novo pela API real, confirmou dois cuidados, ativou o plano e mostrou os mesmos cuidados para a pessoa cuidada. Os testes de revisão com PDFs e itens transcritos separadamente comprovam o formulário, a fonte, o bloqueio e a ativação; não contam como uma nova avaliação da qualidade da extração.

As faixas de sono — menos de 4 horas, cerca de 6 horas e 8 horas ou mais — são armazenadas como faixas, sem inventar minutos. Testes em 320 e 390 px verificaram seleção, gravação, leitura pelo cuidador, correção e recarga. O formulário atual usa somente essas três escolhas; editar alimentação ou humor preserva um relato preciso anterior. Pedidos de ajuda conservam o cuidado e a fonte após a virada do dia; resolver a ajuda não conclui a tarefa.

A revisão integrada pelo PR37 seleciona explicitamente a voz Bossa em português brasileiro e impede ofertas de lembretes futuros que o produto não entrega. Essa frente registrou uma conversa WebRTC real, a proposta de caminhada e a gravação confirmada, além da leitura no histórico da cuidadora.

## Reproduzir

Com o servidor local em execução:

```sh
npm run check
node --import tsx --test tests/backend/*.test.ts tests/ai/*.test.ts
npx playwright test -c tests/e2e/playwright.config.ts -g mobile
```

Chamadas cobradas à OpenAI, usando apenas casos sintéticos:

```sh
node --import tsx scripts/check-capabilities.ts
node --import tsx scripts/evaluate-extraction.ts
node --import tsx scripts/evaluate-voice-decisions.ts
node --import tsx scripts/evaluate-live-audio.ts
node --import tsx scripts/evaluate-live-audio.ts --contextual
node --import tsx scripts/evaluate-live-audio.ts --brevity
CARE_E2E_LIVE=1 npx playwright test -c tests/e2e/playwright.config.ts voice-ui.integration.spec.ts -g real-live
```

Os relatórios completos ficam em `output/ai/` e `output/e2e/`. O teste Playwright usa Chromium instalado e cria casos novos, sem apagar os anteriores.

## Ainda fora do produto

O cadastro e o login local de cuidador têm autenticação e isolamento de caso. O vínculo entre duas contas por convite, encerramento desse vínculo, recuperação de senha, contato telefônico pessoal e hospedagem persistente ainda não estão implementados. As duas visões conectadas da demo usam um caso sintético compartilhado; não equivalem a esse fluxo completo de contas.

Notificações push, funcionamento offline e validação clínica não fazem parte desta entrega local. Áudio em ruído, sotaques variados e reprodução física em dispositivos diferentes ainda precisam de avaliação com pessoas. Os recibos antigos de paridade visual permanecem incompletos e parte dos alvos foi superada pelas mudanças de UI pedidas depois; não há alegação de equivalência pixel a pixel.

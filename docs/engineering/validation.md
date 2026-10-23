# Validação do MVP local

Evidências coletadas em 23 de outubro de 2026. Os casos e documentos usados são sintéticos. Relatos de testes não equivalem a validação clínica nem a aprovação para uso com pacientes reais.

## OpenAI

| Verificação | Resultado | Limite da conclusão |
| --- | --- | --- |
| Responses estruturado | Resposta real válida | Credencial e modelo acessíveis |
| Oito receitas do repositório | 8 processadas; 115/118 verificações lexicais | Três omissões de contexto em ORT01/ORT02; avaliação humana continua necessária |
| Decisions, 13 frases em pt-BR | 13/13 classificações esperadas | Texto sintético, não medição de precisão de fala |
| GPT-Live por WebSocket | Sessão, decisão nativa, áudio e transcrição | Prova do serviço; não comprova percepção humana do áudio |
| Microfone e WebRTC no navegador | Conexão e transcrição observadas | Teste breve autorizado, sem ação clínica |
| Áudio → Decisions → confirmação → gravação | Live/WebRTC real com áudio sintético, cartão de caminhada, confirmação e leitura pelo cuidador | Entrada de áudio sintética; não representa variedade de vozes ou ruído |
| Contexto de tarefas concluídas | Live identificou medicamento/alimentação já feitos e somente caminhada pendente | Casos sintéticos controlados |
| Referência contextual | “Já concluí” após o assistente citar a caminhada gerou a intenção correta em Live | Teste real por WebSocket |

As três diferenças de extração foram contexto anatômico/lateralidade de cabeçalhos não repetido no texto da tarefa. Não chamar o resultado de 100% de acurácia. Um documento totalmente ilegível retornou zero cuidados; manuscritos exigem revisão.

## Fluxos e persistência

Os testes de domínio cobrem sessões, isolamento de casos, papéis, importação, confirmação, ativação, horários explícitos, correções, mudança de dia, ajuda normal/urgente, bem-estar opcional, originais privados e repetição de pedidos.

O gatilho de Decisions acompanha as transcrições do paciente. A interface correlaciona os eventos, ignora respostas antigas/duplicadas e também envia a fala acumulada à Decisions após uma pausa. Essa segunda via aceita pedidos explícitos como “pode concluir a caminhada leve”, sem depender de um fragmento isolado. O estado em tempo real é enviado em mensagens compactas para respeitar o limite do Live. O estado persistido da rotina é enviado ao conectar e atualizado quando sua revisão muda. A integração da voz verifica que nenhuma decisão grava automaticamente; o cancelamento preserva o estado; a confirmação usa a ocorrência correta; repetir a decisão não duplica a proposta. Sono e alimentação preservam os demais campos do relato. O acompanhante lê o mesmo registro após recarregar. Sem permissão de microfone, os botões continuam funcionando.

O foco final é mobile, conforme pedido: 320 px e 390×844. As inspeções de desktop anteriores são históricas e não fazem parte do aceite final. As referências visuais, a anatomia congelada, capturas e medições ficam em `output/iterate/`. Evidências são transitórias e não entram no Git; a documentação de produto e os assets finais entram.

A validação final de voz usou Chrome com viewport 390×844, áudio sintético em português, Live/WebRTC e Decisions reais. O cartão foi confirmado por Computer Use, e o servidor gravou uma única conclusão; a sessão do cuidador leu o mesmo estado. O contexto enviado depois da confirmação incluiu a caminhada como feita. Foram aprovados quatro cenários mobile de regressão e esse percurso real.

A revisão de documentos permite confirmar em lote os itens claros após a conferência de todas as páginas. O servidor valida o lote inteiro antes de alterar qualquer item; dúvidas, ausência de campos essenciais e itens desconhecidos bloqueiam o lote. A ação não ativa o plano. Root verificou o percurso de sete itens no navegador mobile; testes de domínio verificaram recusa atômica e repetição idempotente.

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
CARE_E2E_LIVE=1 npx playwright test -c tests/e2e/playwright.config.ts voice-ui.integration.spec.ts -g real-live
```

Os relatórios completos ficam em `output/ai/` e `output/e2e/`. O teste Playwright usa Chromium instalado e cria casos novos, sem apagar os anteriores.

## Ainda fora do produto

Autenticação real, convites seguros, hospedagem persistente, observabilidade de produção, notificações push, funcionamento offline e validação clínica dos fluxos. Áudio em ruído, sotaques variados, interrupções e reprodução física em dispositivos diferentes ainda precisam de avaliação com pessoas.

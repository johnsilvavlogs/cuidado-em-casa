<!-- Source: https://docs.google.com/document/d/1bYOPkNtU2AimgIiz0x1N1i_J7iWEkXc_lM0kLTs29Ok. Snapshot: 2026-10-23. -->

# Cuidado em Casa

Requisitos, jobs to be done e proposta de MVP · 23 de outubro de 2026

Rascunho de John e equipe. Nome provisório; escopo proposto, ainda não implementado.

### Protótipo visual

[Abrir jornada e telas no tldraw](https://www.tldraw.com/f/cx_sqUW3D1tTCo5FQg8VA)

Comece por 04 · Mapa de fluxos. A página 09 · Leitura e confirmação detalha a importação assistida por IA. As páginas 05 a 08 cobrem as demais jornadas e a alternativa manual; 01 a 03 guardam o conceito inicial.

## 1. Objetivo e escopo

Ajudar uma pessoa cuidada e seu cuidador a seguir um plano fiel às orientações recebidas, registrar o que aconteceu e acompanhar pedidos de ajuda. Ambos consultam a mesma informação, com origem, autor e horário.

### Escopo da demonstração

MVP: web app responsiva em Next.js, React e TypeScript, acessível por link no celular e desktop. Importar orientações impressas e legíveis em PDF ou foto, ou colar texto; conferir o rascunho com o original e confirmar antes de ativar. Compartilhar online registros, pedidos de apoio e ajuda urgente entre uma pessoa cuidada e seu único cuidador. Voz é alternativa aos botões. Sono, alimentação e bem-estar são relatos manuais opcionais. O plano fica fixo após a ativação nesta demo.

### Fora da implementação agora

Ficam para depois: alterar um plano ativo ou agendar versões; reconhecer manuscritos e documentos de baixa legibilidade; localizar trechos com precisão, usar OCR dedicado ou marcar regiões manualmente; salvar offline e sincronizar depois. Também ficam fora HealthKit, aplicativos nativos, push e integração hospitalar. O produto não diagnostica, completa prescrições por suposição nem altera tratamentos.

## 2. Jobs e jornada

Os jobs descrevem o progresso desejado. As histórias abaixo definem as capacidades do produto; os critérios de aceite dizem como verificar cada entrega.

- Preparar: quando recebo orientações para continuar o cuidado em casa, preciso transformá-las numa rotina confiável, sem perder instruções nem inventar o que falta.

- Seguir: quando chega a hora de um cuidado, preciso saber o que fazer e registrar o que aconteceu, com autonomia.

- Obter apoio: quando encontro uma dificuldade, preciso que meu cuidador entenda a situação e me ajude.

- Acompanhar: quando não estou com a pessoa cuidada, preciso ver o que foi registrado e onde ela precisa de apoio.

- Acionar ajuda urgente: quando preciso de apoio imediato, quero avisar meu cuidador e acessar uma ligação de emergência, sem depender da resposta no aplicativo.

### Jornada principal

Entrar no cuidado → importar e conferir orientações → ativar o plano → acompanhar a rotina → registrar ou pedir ajuda → cuidador acompanha e responde. Ajuda urgente tem acesso destacado na rotina.

## 3. User stories e critérios de aceite

As histórias definem o escopo do MVP; os critérios de aceite descrevem comportamentos verificáveis. As regras comuns ficam na seção 4. Os IDs foram mantidos: US04, US05 e US06 ficam para uma evolução.

### A. Preparar o plano

#### US01 · Entrar no cuidado

Como participante, quero acessar o cuidado com minha conta e aceitar o vínculo, para consultar o plano correto.

- o convite identifica pessoa e papel; abrir o link ou escolher um papel não concede acesso.

- O aceite válido vincula as duas contas: uma pessoa cuidada e um cuidador ativo. Convite expirado ou cancelado não libera acesso. Não há inclusão de cuidadores adicionais.

#### US02 · Enviar orientações

Como pessoa cuidada ou responsável autorizado, quero enviar as orientações recebidas, para usá-las como fonte do plano.

- receber PDF ou foto JPEG/PNG com texto impresso legível, ou texto colado. Preservar o original e mostrar processamento, falha de envio e arquivo não aceito.

- falha de leitura ou trecho ilegível mantém o rascunho sem ativação e oferece outra foto, outro arquivo, texto colado ou cadastro manual. Distinguir informação ausente de leitura ambígua; não completar o que falta por suposição.

#### US03 · Preparar e ativar o plano

Como cuidador com permissão para preparar o plano, quero revisar cada cuidado extraído junto ao trecho original, corrigir o que consigo ler e esclarecer lacunas, para compartilhar somente orientações conferidas.

- cada cuidado mostra categoria, transcrição original e descrição organizada. Para medicamentos, revisar separadamente nome, concentração, dose, via, frequência, duração e condições quando constarem na fonte; campos ausentes ficam explícitos. Caminhada, alimentação e outros cuidados preservam suas instruções, limites e condições.

- cada item começa não confirmado. O cuidador confere todas as páginas do original, corrige os campos e confirma cada cuidado. Editar um campo invalida a confirmação afetada. Ativar exige todos os cuidados incluídos confirmados e nenhuma dúvida pendente. Ambos recebem o mesmo plano aprovado, que fica fixo após a ativação.

### B. Acompanhar a rotina

#### US07 · Consultar a rotina

Como pessoa cuidada, quero ver o próximo cuidado e sua orientação, para saber o que fazer agora.

- mostrar tarefas do dia com horário e estado; abrir a fonte da tarefa sem perder o contexto.

- separar conclusão registrada, dificuldade relatada e ausência de registro; mostrar quando os dados foram atualizados.

#### US08 · Registrar e corrigir

Como participante autorizado, quero registrar uma tarefa e corrigir um engano, para manter o acompanhamento fiel ao que informei.

- vincular o registro à ocorrência certa, com autor, horário informado e horário de gravação.

- correção mantém o original no histórico. Repetir uma tentativa de envio não duplica a conclusão.

#### US11 · Acompanhar sono e bem-estar

Como pessoa cuidada, quero informar opcionalmente quantas horas dormi, minha alimentação e como me sinto, para dar contexto ao acompanhamento sem depender de dispositivos ou integrações.

- sono por relato manual opcional: informar horas e minutos, data de referência e salvar, editar ou pular. Identificar “Informado por você” ou o cuidador autor, com horário do registro. Não exigir horários de dormir/acordar, wearable, conta Apple ou conexão com HealthKit.

- sem relato, mostrar “Sono não informado” e a ação opcional “Informar sono”; nunca interpretar ausência como zero horas ou gerar alerta por não preencher. Alimentação e bem-estar também são opcionais e corrigíveis. A demo usa exemplos fictícios identificados como relatos, sem conclusão clínica.

### C. Pedir e acompanhar ajuda

#### US09 · Pedir ajuda

Como pessoa cuidada, quero relatar uma dificuldade e pedir apoio, para que meu cuidador entenda o que preciso.

- Mostrar tarefa e relato antes de enviar; o pedido fica disponível ao cuidador vinculado após confirmação da gravação.

- pedir ajuda não conclui a tarefa. Se o envio falhar, mostrar o erro e permitir tentar novamente.

#### US10 · Acompanhar pedidos de ajuda

Como cuidador, quero ver os pedidos de ajuda e registrar o atendimento, para saber o que ainda está pendente.

- Mostrar tarefa, fonte, última atualização e motivo do pedido; oferecer contato com a pessoa cuidada.

- O pedido permanece aberto até o cuidador marcar “Ajuda resolvida”. Ambos veem o desfecho. Ler o pedido ou resolver a ajuda não conclui a tarefa.

#### US14 · Pedir ajuda urgente

Como pessoa cuidada, quero pedir ajuda imediata ao meu cuidador e acessar uma ligação de emergência, para buscar apoio rapidamente.

- “Ajuda urgente” tem acesso destacado na rotina e um fluxo próprio. “Avisar meu cuidador agora” cria um pedido destacado, sem formulário ou IA. Reutilizar o envio e o desfecho de US09–US10.

- Oferecer ligação ao serviço local validado, sem depender do envio ou da resposta do cuidador. Mostrar salvando, falha ou confirmação do pedido. Pedido gravado e discador aberto não significam socorro a caminho.

### D. Voz e confirmação de gravação

#### US12 · Usar voz

Como pessoa que prefere falar, quero consultar e registrar cuidados por voz, para usar o app sem depender de digitação.

- identificar a tarefa e confirmar a ação antes de gravar; ambiguidade pede esclarecimento, e cancelar não modifica o plano.

- voz e botões usam os mesmos registros. Microfone indisponível oferece os botões; a voz só anuncia sucesso após confirmação do sistema.

#### US13 · Saber se o registro foi salvo

Como participante, quero saber se meu registro foi salvo e compartilhado, para confiar no que aparece nas duas visões.

- o MVP exige conexão para salvar. Distinguir salvando, confirmado e falhou; permitir nova tentativa manual sem duplicidade. Sem conexão, orientar a reconectar e tentar de novo, sem fila local ou reenvio automático.

- o cuidador vê a última atualização confirmada pelo servidor. Uma tentativa sem confirmação não aparece como recebida.

## 4. Regras comuns do produto

- Acesso: cada cuidado tem uma pessoa cuidada e um cuidador vinculado. Escolher papel não autentica nem autoriza. Consulta, registro e ativação do plano respeitam as permissões de cada conta.

- Fonte: cada campo extraído aponta para o documento, a página e o trecho transcrito na revisão. O original permanece acessível com zoom; destaque aproximado é opcional. Medicação, dose, via, frequência, duração e condições seguem a orientação recebida. O cuidador corrige o que consegue ler; dúvida clínica ou texto indecifrável exige esclarecimento com o profissional responsável.

- Registro: “sem confirmação” não significa “não tomou”. O sistema registra declarações; não comprova ingestão.

- Ocorrência: cada tarefa recorrente tem instâncias por data e horário. Corrigir um registro preserva seu histórico; o plano aprovado permanece fixo no MVP.

- Avisos: gerar uma pendência por ocorrência importante após horário e tolerância revisados. O cuidador define prioridade operacional; a IA só transcreve obrigatoriedade ou recomendação explícita na fonte e sinaliza quando ela não consta. “Opcional” não pode rebaixar uma prescrição. Leitura não resolve ajuda; ajuda resolvida não conclui tarefa.

- Privacidade: compartilhar os dados apenas entre a pessoa cuidada e seu cuidador vinculado. Encerrar o vínculo bloqueia o acesso e preserva o histórico.

- Limite: avisos do MVP ficam dentro do app. Não prometer push, leitura pelo cuidador, monitoramento contínuo ou resposta de emergência.

## 5. Plano de execução e entrega

Construir um ciclo completo entre pessoa cuidada e cuidador antes de polir as variações. Usar o mesmo caso fictício em todas as etapas.

- Base e vínculo — US01 e US13: contas separadas, acesso autorizado, caso compartilhado e gravação online com confirmação.

- Importação e confirmação — US02–03: ler um documento impresso legível, conferir o rascunho com a página original e zoom, resolver dúvidas e ativar o plano.

- Rotina e ajuda — US07–10 e US14: registrar, corrigir, mostrar ao cuidador e acompanhar pedidos. Manter Ajuda urgente como fluxo próprio, com pedido destacado e ligação independente.

- Voz e bem-estar — US11–12: reutilizar as ações dos botões e permitir os relatos opcionais definidos na US11.

- Validação e entrega: testar em duas sessões, corrigir falhas, publicar a aplicação e gravar o vídeo.

### Condições para fechar a demo

- Uma dúvida de leitura impede ativação; corrigir um campo não o confirma automaticamente. Cada item aprovado mantém sua origem.

- Um registro aparece nas duas visões e continua disponível após recarregar a página. Repetir um envio não duplica a conclusão.

- Pedido, leitura e desfecho da ajuda não concluem a tarefa. Avisos respeitam a regra prevista e não se repetem para a mesma ocorrência.

- A voz confirma a ação antes de gravar e anuncia sucesso só após a resposta do sistema. Falhas e falta de conexão permanecem visíveis.

- Dados fictícios estão identificados como demonstração. Abrir o discador não significa que houve chamada ou que o socorro está a caminho.

## 6. Protótipo e demo

No tldraw, comece pela página 04 · Mapa de fluxos. A página 09 · Leitura e confirmação detalha a importação; a página 06 mostra o cadastro manual. As demais cobrem acesso, rotina, voz e ajuda. São referências visuais: telas com vários cuidadores, atualização de plano ativo, recortes precisos ou fila offline excedem o MVP atual. Ajuda urgente permanece um fluxo próprio.

Os mockups mostram conteúdo e sequência. A implementação precisa demonstrar leitura de documento impresso legível, conferência do original, bloqueio diante de dúvida, acesso autorizado e gravação online entre duas sessões. Uma falha de leitura deve permitir trocar a entrada ou usar cadastro manual.

### Roteiro da apresentação

Demo: importar um documento sintético impresso e legível → conferir a página original com zoom → corrigir e confirmar os cuidados → mostrar que uma pendência bloqueia a ativação → ativar o plano → registrar uma tarefa por voz e vê-la na conta do cuidador → abrir Ajuda urgente e enviar o pedido destacado. Mostrar o acesso à ligação de emergência sem realizar uma chamada na apresentação.

A entrega do hackathon exige projeto acessível na web, repositório e vídeo de até três minutos. O desafio é organizar orientações e registrar o acompanhamento, sem recomendar tratamentos.

## 7. Decisões abertas e evolução

- Permissões: definir as ações de cada uma das duas contas. A ativação do plano exige permissão explícita; o vínculo inicial não permite adicionar outros cuidadores.

- Operação: definir tarefas com aviso, tolerância e validade do convite inicial. São configurações explícitas, não decisões clínicas da IA.

- Depois do MVP: atualizar planos ativos e agendar versões; ampliar a leitura para manuscritos e documentos difíceis; adicionar localização precisa de trechos ou OCR dedicado; salvar offline e sincronizar depois. Múltiplos cuidadores, resumo de passagem de cuidado, push e HealthKit também ficam para uma evolução.

- Ajuda urgente: validar o serviço local de ligação e conferir no protótipo o acesso destacado, o pedido ao cuidador e a ligação independente antes de gravar a demo.

## Apêndice técnico · integrações e dados

Referência para implementação. O escopo, as histórias e a ordem de construção estão nas seções 1 a 7.

### Stack do MVP web

Entrega: web app responsiva, acessível por link HTTPS em celular e desktop. O front-end deve permitir navegar, importar, revisar, corrigir e confirmar o plano. As imagens do protótipo orientam a implementação; não substituem uma demo interativa. Aplicativos nativos e publicação em lojas não são requisitos do MVP.

Interface: React + Next.js (App Router) + TypeScript; Tailwind CSS para o estilo. Reutilizar componentes, regras e estados entre a visão da pessoa cuidada e a do cuidador. A prioridade é encurtar o ciclo entre alterar o front-end, abrir o link e testar.

Servidor: Route Handlers do Next.js, no mesmo projeto, para chamadas à OpenAI e validações de autorização e confirmação. Credenciais ficam somente no servidor. Responses lê documentos; voz usa as mesmas ações dos botões.

Documentos: PDF.js para visualizar a página original com zoom; seletor de arquivos e câmera do navegador quando disponíveis. Guardar o original e relacionar cada cuidado à página e ao trecho transcrito. Destaque aproximado é opcional. O MVP dispensa recortes precisos, editor de regiões e provedor separado de OCR.

Persistência: contas, vínculo, rascunho, confirmações, plano aprovado e registros em banco no servidor; documentos em armazenamento privado. Usar a infraestrutura disponível ao projeto e definir o provedor no início. Dados fictícios locais devem ser identificados; não comprovam compartilhamento entre as duas contas.

Distribuição: começar pelo navegador. Adicionar instalação na tela inicial como PWA é opcional, sem bloquear a demo. iOS/Android podem vir depois por um contêiner nativo ou cliente próprio; isso exige trabalho adicional e não é uma simples importação automática. HealthKit depende de integração nativa Apple e não faz parte da web app do MVP.

Aceite: concluir o fluxo principal em celular e desktop, conferir e corrigir o rascunho com a página original, bloquear ativação diante de dúvida e salvar entre duas contas online. Incluir relatos opcionais e o fluxo próprio de Ajuda urgente.

Referências: [Next.js — Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers); [MDN — instalação de PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

### A. Voz e ações

GPT-Live conduz a interação por voz. Decisions reconhece ações entre opções válidas; não grava dados. O aplicativo valida permissão, tarefa e confirmação, salva o evento e devolve o resultado. Só então a voz anuncia sucesso. Resultados provisórios ou antigos não executam ações.

Exemplo: “Já tomei o remédio das duas” → identificar a ocorrência → confirmar com a pessoa → gravar → atualizar a visão do cuidador. “Preciso de ajuda com o almoço” cria um pedido e mantém o cuidado pendente.

### B. Importação assistida: stack proposta

Usar Responses API com GPT-6.1 Sol como candidato inicial, entrada visual e Structured Outputs (JSON com campos definidos). PDF entra como input_file; foto como input_image. Avaliar a leitura com documentos impressos legíveis em português. Formato JSON correto não garante conteúdo correto; a conferência humana continua obrigatória.

Para o hackathon, mostrar a página original com zoom ao lado da transcrição e dos campos. Se houver destaque, identificá-lo como “região aproximada”; sua ausência não bloqueia a revisão. Não exigir coordenadas precisas nem seleção manual de regiões.

O servidor valida arquivo, campos, referências e confirmações do rascunho. Resposta incompleta, recusa, erro ou timeout permite tentar novamente sem ativar o plano. O modelo não recebe função para ativá-lo. Conteúdo do documento é dado não confiável, nunca instrução para o sistema.

### C. Dados que alimentam a revisão

Documento: identificador, páginas e estado do processamento. Origem do cuidado: página e trecho transcrito, com destaque aproximado opcional. Se a origem não puder ser identificada, manter a dúvida explícita e pedir conferência do original.

Cuidado: categoria, campos extraídos com valor ou null, origem por campo e condições explícitas na fonte. Distinguir leitura ambígua de informação ausente. A revisão de todas as páginas permite acrescentar orientações que a extração omitiu.

Pendência: campo ou página afetada, motivo e pergunta concreta. A confirmação fica separada: quem revisou, quando, valor confirmado, correção e origem do esclarecimento. Editar o rascunho invalida a confirmação afetada; o modelo não confirma itens.

Não mostrar porcentagem de “certeza” sem calibração. Usar o motivo concreto da dúvida e manter a conferência humana, mesmo quando a leitura parecer correta.

### D. UI de conferência e critérios de aceite

N15 · Importar: enviar documento e acompanhar preparação/leitura. Mostrar original, quantidade de páginas e alternativa manual. Concluir o processamento apenas abre o rascunho.

N16 · Revisar: listar medicamentos, atividades e alimentação. Cada cartão mostra leitura, pendências e “Revisar com a fonte”. Separar “Conferência: pendente/confirmado” de “Prioridade no plano: obrigatória/recomendada/a definir”. Nada vem confirmado por padrão.

N17 · Esclarecer: abrir a página original com zoom, a transcrição e a dúvida. Permitir corrigir o campo, trocar o arquivo ou manter a pendência para esclarecimento com o profissional. Destaque aproximado é opcional; salvar uma correção não confirma o item.

N18 · Ativar: mostrar resumo, itens confirmados e pendências. O cuidador confere todas as páginas e pode acrescentar uma orientação omitida. Liberar ativação somente após confirmar os cuidados incluídos e resolver as dúvidas. Uma orientação não esclarecida não pode ser descartada para liberar o botão. O plano fica fixo após a ativação.

Se a fonte diz “três vezes ao dia”, não converter automaticamente em “a cada oito horas”. Não inventar dose, via, duração ou horário. Distinguir horário operacional acordado de instrução clínica. Instruções conflitantes permanecem pendentes até esclarecimento.

Aceite visual: a pendência abre a página correta com zoom, transcrição e campos editáveis. Aceite funcional: a correção do rascunho fica salva, uma dúvida bloqueia a ativação e nenhuma extração ativa o plano sozinha. Depois de ativado, o plano é somente leitura no MVP.

Privacidade: restringir acesso ao original, sem links públicos; limitar dados enviados aos provedores e definir retenção e exclusão antes do uso real. A demo usa documentos sintéticos; os mockups não comprovam integração nem precisão da leitura.

Referências técnicas: [Responses — arquivos](https://developers.openai.com/api/docs/guides/file-inputs); [imagens e limitações](https://developers.openai.com/api/docs/guides/images-vision); [Structured Outputs;](https://developers.openai.com/api/docs/guides/structured-outputs) [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Fontes

[Guia e critérios do hackathon](https://openaihackathon.com.br/)

[Desafio oficial:](https://docs.google.com/document/d/1ST4scZYa_JyocXzdOMpy5yfxvdpADDOJ-_On4IPvb_0/edit)[ Plano de cuidado em casa](https://docs.google.com/document/d/1ST4scZYa_JyocXzdOMpy5yfxvdpADDOJ-_On4IPvb_0/edit)

[OpenAI:](https://developers.openai.com/api/docs/guides/decisions-voice)[ integração GPT-Live + Decisions](https://developers.openai.com/api/docs/guides/decisions-voice)

[Apple:](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)[ autorização de dados de saúde](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)

[Apple:](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)[ privacidade no HealthKit](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)

[Apple:](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))[ limites da entrega em segundo plano](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))

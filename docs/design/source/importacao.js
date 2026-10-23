
const {createShapeId,toRichText}=helpers;
editor.createPage({id:'page:care-import-v4',name:'09 · Leitura e confirmação'});
editor.setCurrentPage('page:care-import-v4');
function text(id,x,y,w,t,size='s',color='black',parentId){editor.createShape({id:createShapeId(id),type:'text',x,y,...(parentId?{parentId}:{}),props:{w,autoSize:false,font:'sans',size,color,richText:toRichText(t)}});}
function box(id,x,y,w,h,t='',color='grey',fill='none',parentId,align='start'){editor.createShape({id:createShapeId(id),type:'geo',x,y,...(parentId?{parentId}:{}),props:{geo:'rectangle',w,h,dash:'solid',size:'s',font:'sans',color,fill,labelColor:color==='green'&&fill==='solid'?'white':'black',align,verticalAlign:'middle',richText:toRichText(t)}});}
function frame(id,x,y,name,title,sub){const fid=createShapeId(id);editor.createShape({id:fid,type:'frame',x,y,props:{w:520,h:900,name}});text(id+'brand',24,22,460,'♡  Cuidado em Casa','m','green',fid);text(id+'role',24,66,460,'CUIDADOR  ·  ANA','s','grey',fid);text(id+'title',24,110,472,title,'l','black',fid);text(id+'sub',24,157,472,sub,'s','grey',fid);return fid;}
text('import-title',0,0,1120,'Do documento ao cuidado confirmado','xl');
text('import-sub',0,66,1120,'US02 + US03 · PDF, foto ou texto → rascunho → conferência humana → plano ativo','m');
text('import-note',0,125,1120,'Protótipo de fluxo · documentos fictícios · nenhuma leitura representa confirmação clínica.','s','grey');

const a=frame('import-upload',0,230,'N15 · Importar','Importar orientações','1 de 4 · Envie a fonte do plano');
box('upload-types',24,228,472,60,'PDF       Foto       Texto','green','semi',a,'middle');
box('upload-drop',24,314,472,172,'+  Escolher arquivo ou tirar foto\n\nPDF ou JPEG/PNG · impresso ou manuscrito','grey','none',a,'middle');
box('upload-file',24,512,472,98,'orientacoes.pdf · 2 páginas\nRecebido  ✓     Abrir original ↗','blue','semi',a);
box('upload-progress',24,636,472,98,'Preparando a leitura\nSe houver dúvidas, vamos mostrar onde estão.','green','semi',a);
box('upload-button',24,765,472,52,'Ler documento','green','solid',a,'middle');
text('upload-manual',24,840,472,'Ou cadastrar orientações manualmente','s','green',a);

const b=frame('import-review',600,230,'N16 · Conferir cada item','Confira o que encontramos','2 de 4 · 0 de 3 cuidados confirmados');
box('review-alert',24,218,472,82,'2 trechos precisam de esclarecimento\nToque para ver a parte do documento.','orange','semi',b);
box('review-med',24,328,472,124,'Medicamento A     ·     REVISÃO PENDENTE\nFrequência: 2 vezes ao dia · dose ilegível\nVer trecho e esclarecer →','orange','none',b);
box('review-walk',24,472,472,114,'Caminhada     ·     REVISÃO PENDENTE\nA duração não ficou clara\nRevisar com a fonte →','orange','none',b);
box('review-food',24,606,472,104,'Alimentação     ·     A CONFERIR\nOrientação extraída, ainda não confirmada\nRevisar com a fonte →','grey','none',b);
box('review-button',24,746,472,52,'Começar a conferência','green','solid',b,'middle');
text('review-extra',24,825,472,'Faltou uma orientação? Adicionar manualmente','s','green',b);

const c=frame('import-clarify',0,1250,'N17 · Esclarecer com a fonte','Não consegui ler a dose','3 de 4 · Medicamento A · página 1');
box('clarify-page',24,212,472,174,'DOCUMENTO ORIGINAL · EXEMPLO FICTÍCIO\n\nMedicamento A · dose: ▒▒▒\nTomar 2 vezes ao dia.','grey','none',c);
box('clarify-highlight',43,267,433,48,'','red','none',c);
text('clarify-open',24,397,472,'Abrir página inteira ↗    Ampliar recorte +','s','green',c);
box('clarify-crop',24,441,472,76,'RECORTE AMPLIADO\nDose: [trecho ilegível]','red','semi',c);
text('clarify-question',24,535,472,'O que está escrito nesse trecho?','s','black',c);
box('clarify-input',24,573,472,57,'Digite somente o que consegue ler','grey','none',c);
box('clarify-context',24,643,472,55,'Contexto ou origem do esclarecimento','grey','none',c);
box('clarify-save',24,719,472,52,'Salvar correção e revisar item','green','solid',c,'middle');
text('clarify-retry',24,789,472,'Trocar foto  ·  Marcar região manualmente','s','green',c);
text('clarify-unresolved',24,828,472,'Ainda não está claro? Manter pendente.\nConsulte o profissional; não adivinhe.','s','grey',c);

const d=frame('import-activate',600,1250,'N18 · Confirmar e ativar','Seu plano está em revisão','4 de 4 · Exemplo: 1 pendência restante');
box('activate-med',24,220,472,102,'✓ Medicamento A · conferido com a fonte\nPrioridade: conforme prescrição\nVer original · Editar','green','semi',d);
box('activate-walk',24,342,472,112,'! Caminhada · duração a esclarecer\nRecomendação na fonte: não identificada\nPrioridade no plano: a definir','orange','semi',d);
box('activate-food',24,474,472,94,'✓ Alimentação · conferida com a fonte\nPrioridade no plano: recomendada','green','semi',d);
box('activate-check',24,590,472,82,'□ Revisei todas as páginas e orientações.\nAinda indisponível enquanto houver dúvida.','grey','none',d);
box('activate-disabled',24,698,472,52,'Ativar plano · 1 pendência','grey','semi',d,'middle');
text('activate-help',24,771,472,'Após resolver e confirmar tudo, o botão libera.\nSó a versão aprovada chega à pessoa cuidada.','s','grey',d);
text('activate-priority',24,843,472,'Prioridade não altera a prescrição.','s','green',d);

text('import-states-title',0,2230,1120,'Estados e regras que o front-end precisa mostrar','l');
box('import-states',0,2290,1120,150,'Arquivo incompleto, protegido ou não aceito → explicar e oferecer nova tentativa.\nPágina ilegível → manter trecho pendente; nunca preencher por suposição.\nRegião sem localização confiável → página completa + seleção manual.\nCorreção salva ≠ item confirmado. Documento novo ≠ nova versão ativa.','orange','semi');
box('import-architecture',0,2470,1120,130,'STACK PROPOSTA\nWeb responsiva · Next.js + TypeScript · renderização de PDF · OCR com coordenadas\nResponses API + GPT-6.1 Sol + saída estruturada → validação no servidor → revisão humana\nFallback do hackathon: regiões numeradas e marcação aproximada, sempre identificada.','blue','semi');
editor.selectNone();editor.zoomToBounds({x:0,y:0,w:1120,h:2160});
return {page:editor.getCurrentPageId(),shapes:editor.getCurrentPageShapes().length};

// Ajustes finais aplicados na mesma página:
editor.setCurrentPage('page:care-import-v4');
editor.updateShape({id:'shape:clarify-highlight',type:'geo',y:296,props:{h:29}});
editor.updateShapes(['upload-button','review-button','clarify-save'].map(id=>({id:'shape:'+id,type:'geo',props:{labelColor:'green'}})));
editor.updateShape({id:'shape:import-architecture',type:'geo',props:{h:170,richText:helpers.toRichText('MVP WEB · Next.js + React + TypeScript · Tailwind CSS\nServidor no mesmo projeto · SDK OpenAI · Responses + saída estruturada\nPDF.js + OCR com coordenadas → revisão humana → versão ativa\nNavegador no celular e desktop. PWA opcional; iOS/Android nativos depois.\nSono manual opcional. HealthKit não é dependência.')}});

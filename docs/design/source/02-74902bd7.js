
const {createShapeId,toRichText}=helpers;
const journey=editor.getCurrentPageId();
editor.updatePage({id:journey,name:'01 · Jornada'});
editor.createPage({name:'02 · Mockup v2'});
const page=editor.getPages().find(p=>p.name==='02 · Mockup v2');
editor.setCurrentPage(page.id);
function text(id,parent,x,y,w,value,size='s',color='black',scale=1){
 editor.createShape({id:createShapeId(id),type:'text',parentId:parent,x,y,props:{w:w/scale,autoSize:false,richText:toRichText(value),font:'sans',size,color,scale}});
}
function card(id,parent,x,y,w,h,value,color='grey',fill='semi',labelColor='black',align='start'){
 editor.createShape({id:createShapeId(id),type:'geo',parentId:parent,x,y,props:{geo:'rectangle',w,h,richText:toRichText(value),font:'sans',size:'s',color,fill,labelColor,align,verticalAlign:'middle',dash:'solid'}});
}
function frame(id,x,y,name,role,color='grey'){
 const sid=createShapeId(id);
 editor.createShape({id:sid,type:'frame',x,y,props:{w:480,h:800,name,color}});
 text(id+'-brand',sid,28,22,424,'CUIDADO EM CASA','s','grey',0.78);
 if(role)text(id+'-role',sid,28,57,424,role,'s',color,0.85);
 return sid;
}
const root=page.id;
text('mock-title',root,0,0,1040,'Duas visões. Um cuidado compartilhado.','l');
text('mock-subtitle',root,0,58,1040,'Mockup v2 · Conteúdo fictício · Fluxos para discussão, ainda sem implementação','s','grey');
text('row1-title',root,0,110,1040,'1 / Entrar no papel certo e preparar o plano','m');
const a=frame('screen-role',0,180,'01 · Escolher papel',null);
text('role-title',a,28,98,420,'Como você vai\nparticipar?','l', 'black',0.88);
text('role-subtitle',a,28,202,420,'Escolha o que você precisa\nfazer neste cuidado.','s','grey');
card('choose-patient',a,28,300,424,136,'Vou receber cuidado\nVer meu dia e registrar minha rotina','green');
card('choose-carer',a,28,464,424,136,'Vou cuidar de alguém\nPreparar o plano e acompanhar','blue');
text('role-hint',a,28,641,420,'Recebeu um convite?\nVamos conectar você ao plano certo.','s','grey',0.90);
text('role-foot',a,28,748,420,'Primeiro acesso · papel sempre visível','s','grey',0.74);

const b=frame('screen-plan',540,180,'02 · Revisar antes de ativar','CUIDADORA · LIA','blue');
text('plan-title',b,28,105,424,'Preparar o plano','l','black',0.84);
text('plan-subtitle',b,28,163,420,'Alta de Ana · rascunho para revisão','s','grey',0.9);
card('plan-source',b,28,224,424,136,'ORIENTAÇÃO ORIGINAL\nArquivo: alta-demo.txt\nTrecho associado à tarefa','grey');
card('plan-ambiguity',b,28,388,424,128,'MEDICAMENTO A\nHorário não informado na fonte\nPrecisa de esclarecimento','light-red');
text('plan-explanation',b,28,543,420,'A tarefa só entra na rotina quando\na informação for esclarecida.','s','grey',0.9);
card('plan-help-button',b,28,625,424,58,'Solicitar esclarecimento','blue','solid','white','middle');
card('plan-activate-disabled',b,28,697,424,58,'Ativar plano · há pendência','grey','semi','grey','middle');
text('row1-note',root,0,1008,1020,'Escolher papel orienta a entrada. Convite e permissões definem a qual plano cada pessoa tem acesso.','s','grey',0.87);

text('row2-title',root,0,1080,1040,'2 / A mesma rotina, vista por quem faz e por quem acompanha','m');
const c=frame('screen-patient',0,1150,'03 · Meu dia','PESSOA CUIDADA · ANA','green');
text('patient-title',c,28,108,424,'Bom dia, Ana.','l','black',0.86);
text('patient-summary',c,28,166,424,'Hoje, 23 out · 2 de 4 tarefas registradas','s','grey',0.9);
card('patient-med',c,28,226,424,146,'14H · AINDA SEM REGISTRO\nMedicamento A\nConsultar orientação do plano','green');
card('patient-done',c,28,397,424,60,'Registrar como feito','green','solid','white','middle');
card('patient-difficulty',c,28,475,424,60,'Não consegui · pedir ajuda','orange','semi','black','middle');
card('patient-checkin',c,28,566,424,130,'SEU CHECK-IN\nSono: 6h20 · informado por você\nAlimentação: pediu ajuda','grey');
text('patient-sync',c,28,716,424,'Atualizado às 14h18','s','grey',0.77);
text('patient-nav',c,28,757,424,'Meu dia       Histórico       Ajuda','s','green',0.88);

const d=frame('screen-caregiver',540,1150,'04 · Acompanhamento','CUIDADORA · LIA','blue');
text('caregiver-title',d,28,108,424,'Como está a Ana?','l','black',0.84);
text('caregiver-sync',d,28,167,424,'Hoje, 23 out · atualizado às 14h18','s','grey',0.88);
card('caregiver-attention',d,28,225,424,162,'PRECISA DE ATENÇÃO\n14h · Medicamento A\nAinda sem confirmação\nNão significa que não foi tomado','orange');
card('caregiver-open',d,28,412,424,60,'Ver pendência','blue','solid','white','middle');
card('caregiver-overview',d,28,507,424,152,'VISÃO DO DIA\n2 de 4 tarefas registradas\nSono: 6h20 · autorrelato\nAlimentação: pediu ajuda','blue');
text('caregiver-source',d,28,690,424,'Cada dado tem origem e horário.','s','grey',0.85);
text('caregiver-nav',d,28,757,424,'Hoje            Plano            Histórico','s','blue',0.88);
text('row2-note',root,0,1978,1020,'Os dados são compartilhados; a prioridade visual muda conforme o papel. A ausência de registro é tratada como incerteza.','s','grey',0.85);

text('row3-title',root,0,2070,1040,'3 / Pedir ajuda e fechar o acompanhamento','m');
const e=frame('screen-help',0,2140,'05 · Ana pede ajuda','PESSOA CUIDADA · ANA','green');
text('help-title',e,28,109,424,'O que dificultou?','l','black',0.84);
card('help-task',e,28,190,424,112,'TAREFA DO PLANO\n13h · Alimentação','green');
text('help-label',e,28,332,424,'Conte para a Lia','s','grey');
card('help-field',e,28,375,424,152,'Estou sem apetite e preciso\nde ajuda para preparar\na refeição.','grey');
card('help-send',e,28,561,424,60,'Enviar pedido de ajuda','green','solid','white','middle');
text('help-consequence',e,28,655,424,'Lia verá este relato.\nA tarefa continuará pendente.','s','grey',0.9);
text('help-back',e,28,752,424,'Voltar para Meu dia','s','green',0.88);

const f=frame('screen-followup',540,2140,'06 · Lia acompanha a dificuldade','CUIDADORA · LIA','blue');
text('follow-title',f,28,109,424,'Ajuda com a refeição','l','black',0.76);
text('follow-status',f,28,163,424,'13h · tarefa ainda pendente','s','orange',0.9);
card('follow-report',f,28,224,424,156,'RELATO DE ANA · 13H12\n“Estou sem apetite e preciso\nde ajuda para preparar\na refeição.”','grey');
card('follow-contact',f,28,411,424,60,'Entrar em contato com Ana','blue','solid','white','middle');
card('follow-ack',f,28,490,424,60,'Marcar que li este pedido','blue','semi','black','middle');
card('follow-history',f,28,580,424,112,'ACOMPANHAMENTO\nA leitura fica registrada.\nO cuidado ainda precisa ser concluído.','grey');
text('follow-note',f,28,728,424,'Quem registrou + horário em cada etapa.','s','grey',0.83);

text('rules-title',root,0,2990,1040,'Regras de consistência desta proposta','m');
card('rule-record',root,0,3050,480,136,'REGISTRO NÃO É SUPOSIÇÃO\nFeito, pendente e pedido de ajuda\nsão estados diferentes.','green');
card('rule-data',root,540,3050,480,136,'CONTEXTO COM ORIGEM\nSono é opcional; mostrar fonte, data\ne ausência de dados sem inferir saúde.','blue');
text('mock-footer',root,0,3220,1040,'Mockup de fluxo, não protótipo clicável. Voz e HealthKit podem ampliar a experiência sem bloquear o caminho principal.','s','grey',0.88);
editor.selectNone();
editor.zoomToBounds({x:-30,y:1035,w:1090,h:965},{inset:25});
return {pageId:page.id,journeyPageId:journey,frames:6,shapeCount:editor.getCurrentPageShapes().length,pages:editor.getPages().map(p=>({id:p.id,name:p.name}))};

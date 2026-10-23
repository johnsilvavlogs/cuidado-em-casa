
const pages=[
 ['page:care-map-v3','04 · Mapa de fluxos'],
 ['page:care-access-v3','05 · Acesso e rede'],
 ['page:care-plan-v3','06 · Orientações e plano'],
 ['page:care-routine-v3','07 · Rotina e registros'],
 ['page:care-voice-v3','08 · Voz e ajuda']
];
for(const [id,name] of pages) if(!editor.getPages().some(p=>p.id===id)) editor.createPage({id,name});
editor.setCurrentPage('page:care-map-v3');
const rt=helpers.toRichText;
function text(id,x,y,w,txt,size='m',color='black'){
 editor.createShape({id:helpers.createShapeId('v3-'+id),type:'text',x,y,props:{w,autoSize:false,richText:rt(txt),font:'sans',size,color}});
}
text('map-title',0,0,980,'Cuidado em Casa · mapa de fluxos','xl');
text('map-subtitle',0,70,980,'PRD refinado · 23 out 2026\n5 jobs → 13 histórias → telas e estados verificáveis.','m','grey');
const d=await helpers.createMermaidDiagram(`flowchart TD
 A["05 · Entrar e formar a rede<br/>Conta própria, convite e autorização"]
 B["06 · Preparar o plano<br/>Enviar fonte, revisar tarefas e ativar"]
 C["03 + 07 · Acompanhar o dia<br/>Mesma rotina para pessoa e cuidadores"]
 D["08 · Registrar por voz ou botões<br/>Confirmar, salvar ou pedir ajuda"]
 E["07 + 08 · Coordenar e continuar<br/>Responder, corrigir e atualizar o contexto"]
 A --> B --> C --> D --> E
 E --> C
`,{blueprintRender:{position:{x:0,y:210},centerOnPosition:false}});
for(const id of d.shapeIds){const s=editor.getShape(id);if(s?.type==='geo')editor.updateShape({id,type:'geo',props:{font:'sans'}});}
text('coverage-title',0,d.bounds.y+d.bounds.h+95,980,'Onde está cada história','l');
const rows=[
 ['US01','Entrar no cuidado','03 · entrada/aceite + 05 · N06'],
 ['US02','Enviar orientações','06 · N01 + estados de envio'],
 ['US03','Preparar e ativar','06 · N02 + revisão/ativação'],
 ['US04','Atualizar orientações','06 · N03 + versão substituída'],
 ['US05','Convidar cuidador','05 · N04 → N05 → aceite'],
 ['US06','Gerir acessos','05 · N04 + cancelar/remover'],
 ['US07','Consultar rotina','03 · visões + 07 · contexto'],
 ['US08','Registrar e corrigir','03 · registro + 07 · N07'],
 ['US09','Pedir ajuda','03 · dificuldade → 08 · N10'],
 ['US10','Coordenar resposta','07 · N11 + 08 · N10'],
 ['US11','Registrar bem-estar','07 · N08 → acompanhamento'],
 ['US12','Usar voz','08 · voz → confirmação + N12'],
 ['US13','Entender sincronização','07 · N09 + estados de envio']
];
let y=d.bounds.y+d.bounds.h+165;
for(let i=0;i<rows.length;i++){const r=rows[i]; editor.createShape({id:helpers.createShapeId('v3-coverage-'+i),type:'geo',x:0,y,w:undefined,props:{geo:'rectangle',w:980,h:80,richText:rt(r[0]+' · '+r[1]+'\n'+r[2]),font:'sans',size:'m',color:i%2?'blue':'green',fill:'semi',align:'start',verticalAlign:'middle'}});y+=92;}
text('map-legend',0,y+25,980,'N01–N12: telas novas geradas individualmente. Os painéis anteriores ficam em 03.\nAs notas de estado são parte do fluxo. Imagens não comprovam permissões, sincronização nem integrações.','m','grey');
editor.selectNone();editor.zoomToBounds({x:0,y:0,w:980,h:900},{inset:40});
return {pages:editor.getPages(),diagram:d.bounds,rows:rows.length};

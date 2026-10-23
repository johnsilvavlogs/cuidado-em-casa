
const pages=[
['page:care-access-v3','Acesso e rede','US01 · US05 · US06','Rede → convite individual → aceite → acompanhamento. Convite inválido interrompe o acesso.'],
['page:care-plan-v3','Orientações e plano','US02 · US03 · US04','Enviar fonte → cadastrar e revisar → ativar. Novas orientações passam por outra revisão.'],
['page:care-routine-v3','Rotina e registros','US07 · US08 · US11 · US13','Ver o dia → registrar ou corrigir → acompanhar a rede. Sono vem do Apple Health; preenchimento manual não faz parte do fluxo.'],
['page:care-voice-v3','Voz e ajuda','US09 · US10 · US12','Falar ou tocar → confirmar → gravar → atualizar a rede. Se houver ajuda, um cuidador assume e registra o desfecho.']
];
for(const [id,title,ids,desc] of pages){
 editor.setCurrentPage(id);
 for(const [suffix,y,txt,size,color] of [['title',0,title,'xl','black'],['stories',65,ids,'m','blue'],['intro',105,desc,'m','grey']]){
  const sid=helpers.createShapeId('v3-'+id+'-'+suffix);
  if(!editor.getShape(sid))editor.createShape({id:sid,type:'text',x:0,y,props:{w:1020,autoSize:false,richText:helpers.toRichText(txt),font:'sans',size,color}});
 }
}
return {prepared:pages.length};

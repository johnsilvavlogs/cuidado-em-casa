
const {createShapeId,toRichText}=helpers;
editor.updatePage({id:editor.getCurrentPageId(),name:'Jornada + mockups v2'});
function txt(id,x,y,w,text,size='m',color='black'){
 editor.createShape({id:createShapeId(id),type:'text',x,y,props:{w,autoSize:false,richText:toRichText(text),font:'sans',size,color}});
}
txt('board-title',0,0,1120,'Cuidado em Casa','xl');
txt('board-subtitle',0,68,1120,'Proposta 02 · Um plano compartilhado. Duas experiências claras.','m','grey');
txt('journey-title',0,145,1120,'01 / A jornada de Ana e Lia','l');
txt('journey-note',0,207,1120,'Ana recebe cuidado. Lia acompanha. Cenário fictício baseado no documento de requisitos.','s','grey');
const diagram=await helpers.createMermaidDiagram(`flowchart TD
 A["1. Como você participa?"] --> P["Pessoa cuidada · Ana<br/>Aceita convite e compartilhamento"]
 A --> C["Cuidador · Lia<br/>Carrega, revisa e ativa o plano"]
 P --> S["2. Um plano ativo para as duas pessoas"]
 C --> S
 S --> U["3. Ana abre Meu dia<br/>Registra uma tarefa ou pede ajuda"]
 U --> V["4. Lia acompanha<br/>Vê registro, autor, horário e contexto"]
 V --> E{"Tarefa sem confirmação<br/>após o horário revisado?"}
 E -->|Sim| T["5. Aviso com contexto<br/>Lia entra em contato"]
 E -->|Não| R["A rotina continua"]
 T --> U
`,{blueprintRender:{position:{x:60,y:285},centerOnPosition:false}});
editor.zoomToBounds({x:-40,y:-30,w:1180,h:950},{inset:30});
return {diagram:diagram.bounds,nextY:diagram.bounds.y+diagram.bounds.h+150,shapeCount:editor.getCurrentPageShapes().length};

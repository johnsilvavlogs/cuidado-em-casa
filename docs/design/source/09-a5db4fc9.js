
editor.setCurrentPage('page:care-map-v3');
if(editor.getShape('shape:2jClVABIG9wINRk4kUkvr'))editor.deleteShapes(['shape:2jClVABIG9wINRk4kUkvr']);
for(const p of editor.getPages().filter(p=>p.id.includes('care-'))){
 editor.setCurrentPage(p.id);
 editor.updateShapes(editor.getCurrentPageShapes().filter(s=>s.type==='text'&&s.id.startsWith('shape:v3-')&&s.props.color==='grey').map(s=>({id:s.id,type:'text',props:{color:'black'}})));
}
editor.setCurrentPage('page:care-map-v3');editor.selectNone();editor.zoomToBounds({x:0,y:0,w:1020,h:1160},{inset:35});
return editor.getPages().filter(p=>p.id.includes('care-')).map(p=>({name:p.name,images:editor.getSortedChildIdsForParent(p.id).map(id=>editor.getShape(id)).filter(s=>s.type==='image').length}));

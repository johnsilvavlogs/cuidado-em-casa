
editor.setCurrentPage('page:page');
editor.updateShape({id:'shape:kv9foaThudO09SWNwIIRG',type:'geo',props:{richText:helpers.toRichText('3. Ana abre Meu dia\nUsa voz ou botões; confirma a ação')}});
editor.updateShape({id:'shape:sabKzeOQUqunRhrtG33Os',type:'geo',props:{richText:helpers.toRichText('4. Lia acompanha\nRegistro real, autor, horário e ajuda')}});
editor.setCurrentPage('page:vqdiEPZE08-di38ZCG_wD');
editor.selectNone();
editor.zoomToBounds({x:-40,y:2250,w:1280,h:1070},{inset:30});
return {pages:editor.getPages().map(p=>({id:p.id,name:p.name})),imageCount:editor.getCurrentPageShapes().filter(s=>s.type==='image').length};

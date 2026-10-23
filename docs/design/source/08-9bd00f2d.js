
const rt=helpers.toRichText;
function note(id,x,y,w,h,title,body,color='blue'){
 const sid=helpers.createShapeId('v3-note-'+id);
 if(!editor.getShape(sid)) editor.createShape({id:sid,type:'geo',x,y,props:{geo:'rectangle',w,h,richText:rt(title+'\n'+body),font:'sans',size:'m',color,fill:'semi',align:'start',verticalAlign:'middle'}});
}
editor.setCurrentPage('page:care-map-v3');
const nodes=[
['shape:VLILyXaW3jfBnv5wrijk4','05 · Entrar e formar a rede\nConta própria, convite e autorização'],
['shape:WxlGFQsKmSJMktpEueAmp','06 · Preparar o plano\nEnviar fonte, revisar tarefas e ativar'],
['shape:FFLQF_bO21rdnNb8x3SaB','07 · Acompanhar o dia\nMesma rotina para pessoa e cuidadores'],
['shape:GaoYyNtqqP1mQzljbu24D','08 · Registrar por voz ou botões\nConfirmar, salvar ou pedir ajuda'],
['shape:RfRyms8TPwe1_62otbFGI','07 + 08 · Coordenar e continuar\nResponder, corrigir e atualizar o contexto']
];
for(let i=0;i<nodes.length;i++)editor.updateShape({id:nodes[i][0],type:'geo',x:100,y:i*170,props:{w:780,h:115,size:'m',font:'sans',richText:rt(nodes[i][1])}});
editor.updateShape({id:'shape:v3-coverage-title',type:'text',y:1140});
const rows=[
['US01 · Entrar no cuidado','05 · N13 (aceite) e N06 (bloqueio); 07 · escolha de papel'],
['US02 · Enviar orientações','06 · N01 + erro de envio / documento ilegível'],
['US03 · Preparar e ativar','06 · N02 → revisão → N14'],
['US04 · Atualizar orientações','06 · N03 + aviso de versão substituída'],
['US05 · Convidar cuidador','05 · N04 → N05 → N13'],
['US06 · Gerir acessos','05 · N04 + confirmação de cancelamento/remoção'],
['US07 · Consultar rotina','07 · visões da pessoa e do cuidador'],
['US08 · Registrar e corrigir','08 · confirmação/registro; 07 · N07'],
['US09 · Pedir ajuda','08 · dificuldade → envio → N10'],
['US10 · Coordenar resposta','07 · N11; 08 · assumir → N10 → desfecho'],
['US11 · Sono e bem-estar','07 · N08: Apple Health + relatos opcionais'],
['US12 · Usar voz','08 · ouvir → confirmar → resultado; N12 sem microfone'],
['US13 · Entender sincronização','07 · N09 + salvando/falhou/confirmado']
];
for(let i=0;i<rows.length;i++)editor.updateShape({id:'shape:v3-coverage-'+i,type:'geo',x:0,y:1220+i*100,props:{w:1020,h:88,richText:rt(rows[i].join('\n')),size:'m'}});
editor.updateShape({id:'shape:v3-map-legend',type:'text',y:2560,props:{w:1020,richText:rt('N01–N14 são as telas complementares. As páginas 05 a 08 são a referência atual.\nOs cartões de estado completam os caminhos de falha. Imagens não validam permissões nem integrações.')}});
editor.setCurrentPage('page:care-access-v3');
note('invite-ready',0,2120,490,240,'Depois de criar o convite','Convite individual pronto.\nCopiar link ou código para Marina.\nAceite na conta correta → N13.\nSem aceite, nenhum acesso ao cuidado.','green');
note('remove',530,2120,490,240,'Confirmar remoção','“Remover o acesso de Bruno?”\nEle perderá acesso a este cuidado.\nSeus registros anteriores serão mantidos.\nCancelar  |  Remover acesso','orange');
note('cancel',0,2400,1020,170,'Cancelar convite / acesso bloqueado','Confirmar o cancelamento do convite de Marina. Depois, mostrar “Cancelado” na rede. Convite expirado, cancelado ou vínculo removido leva a N06; não revela dados do cuidado.','grey');
editor.setCurrentPage('page:care-plan-v3');
note('upload-fail',0,2130,490,210,'Envio incompleto ou ilegível','“Não conseguimos abrir este arquivo.”\nTentar novamente  |  Escolher outro.\nO plano continua em preparação.','orange');
note('missing-info',530,2130,490,210,'Informação a esclarecer','“Horário não informado na orientação.”\nConsultar a fonte / pedir esclarecimento.\nAtivar plano fica indisponível.','orange');
note('active',0,2390,490,190,'Depois de N14','“Plano ativo · versão 1”.\nTodos os vinculados veem a mesma versão.\nAbrir Meu dia / Acompanhamento → 07.','green');
note('stale',530,2390,490,190,'Se o plano mudar durante o registro','“O plano foi atualizado. Revise esta tarefa.”\nReabrir a versão atual; confirmar de novo.\nNenhuma gravação automática na versão antiga.','orange');
editor.setCurrentPage('page:care-routine-v3');
note('sync',0,3120,490,230,'Estados de gravação · US13','Salvando: aguardar resposta.\nConfirmado: horário e autor visíveis.\nFalhou: tentar novamente.\nSem conexão: N09; a rede ainda não recebeu.','blue');
note('sleep',530,3120,490,230,'Sono sem dados recentes · US11','“Dados de sono indisponíveis” ou\n“Última atualização: ontem, 08:10”.\nSem campo manual, diagnóstico ou nota de saúde.\nDemo: conexão HealthKit presumida.','grey');
note('history',0,3390,1020,170,'Depois da correção · US08','Exibir o registro original e a correção, com autor e horários. O cuidador recebe o estado atualizado. Repetir a tentativa não gera outra conclusão para a mesma ocorrência.','green');
editor.setCurrentPage('page:care-voice-v3');
note('unclaimed',0,2790,490,240,'Antes de N10 · pedido aberto','“Ana pediu ajuda. Ninguém assumiu ainda.”\nMarcar como lido  |  Vou ajudar.\n“Vou ajudar” registra o responsável.\nOutro cuidador vê quem assumiu.','blue');
note('resolved',530,2790,490,240,'Depois de N10 · ajuda resolvida','Exibir desfecho, autor e horário.\nA tarefa conserva seu próprio estado.\nDevolver à rede reabre a atribuição.\nLer, ajudar e concluir são ações diferentes.','green');
note('ambiguous',0,3070,490,230,'Voz ambígua ou cancelada','“Qual tarefa você quer registrar?”\nMostrar apenas opções válidas do plano.\nTrocar a tarefa exige nova confirmação.\nCancelar não altera os registros.','orange');
note('speech-failure',530,3070,490,230,'Se a gravação falhar','Informar a falha, sem dizer “registrado”.\nTentar novamente ou usar os botões.\nSem conexão, mostrar N09.\nAvisos por horário usam regras do app.','orange');
editor.setCurrentPage('page:vqdiEPZE08-di38ZCG_wD');
editor.updateShape({id:'shape:polished-core',type:'image',props:{assetId:'asset:v3-core-v3'}});
editor.updateShape({id:'shape:polished-voice',type:'image',props:{assetId:'asset:v3-voice-v3'}});
editor.updateShape({id:'shape:polished-help',type:'image',props:{assetId:'asset:v3-help-v3'}});
for(const pid of ['page:page','page:mddSkR8gQACJ3luxqZCeO','page:vqdiEPZE08-di38ZCG_wD']){
 editor.setCurrentPage(pid);
 const id=helpers.createShapeId('v3-legacy-'+pid);
 if(!editor.getShape(id))editor.createShape({id,type:'text',x:0,y:-100,props:{w:1200,autoSize:false,richText:rt('CONCEITO INICIAL · Fluxos atuais: comece por 04 · Mapa de fluxos.'),font:'sans',size:'m',color:'grey'}});
}
editor.setCurrentPage('page:care-routine-v3');editor.selectNone();editor.zoomToBounds({x:0,y:1160,w:1020,h:850},{inset:40});
return {pages:editor.getPages().length,storyRows:rows.length,mainImages:editor.getCurrentPageShapes().filter(s=>s.type==='image').length};

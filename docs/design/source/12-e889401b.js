const rt=helpers.toRichText;
editor.setCurrentPage('page:care-routine-v3');
editor.updateShapes([
{id:'shape:v3-page:care-routine-v3-intro',type:'text',props:{richText:rt('Ver o dia → registrar ou corrigir → acompanhar a rede. Sono é um relato manual opcional; sem dependência de HealthKit.')}},
{id:'shape:v3-08-bem-estar-label',type:'text',props:{richText:rt('N08 · Sono manual e bem-estar')}},
{id:'shape:v3-08-bem-estar-caption',type:'text',props:{richText:rt('US11 · Informar horas e minutos ou pular. Relato manual identificado; alimentação e bem-estar também opcionais.')}},
{id:'shape:v3-note-sleep',type:'geo',props:{richText:rt('Sono opcional · US11\nSem relato: “Sono não informado”.\nInformar horas e minutos, editar ou pular.\nMostrar autor e horário do relato.\nAusência não significa zero horas.\nHealthKit: integração futura opcional.')}}]);
editor.setCurrentPage('page:care-map-v3');
editor.updateShapes([
{id:'shape:v3-map-subtitle',type:'text',props:{richText:rt('Web app responsiva · MVP atualizado · 23 out 2026\nDocumento → revisão humana → cuidado compartilhado.')}},
{id:'shape:v3-coverage-1',type:'geo',props:{richText:rt('US02 · Enviar e ler orientações\n09 · N15 → rascunho, dúvidas e erros de leitura')}},
{id:'shape:v3-coverage-2',type:'geo',props:{richText:rt('US03 · Preparar e ativar\n09 · N16 → N17 (recorte e correção) → N18; 06 · alternativa manual')}},
{id:'shape:v3-coverage-10',type:'geo',props:{richText:rt('US11 · Sono e bem-estar\n07 · N08: relato manual opcional; HealthKit não é requisito')}},
{id:'shape:v3-map-legend',type:'text',props:{richText:rt('Referência atual: páginas 05 a 09. A página 09 detalha leitura e confirmação; 06 mantém a alternativa manual.\nMockups não comprovam integrações, permissões ou precisão do reconhecimento.')}}]);
editor.setCurrentPage('page:care-plan-v3');
editor.updateShapes([
{id:'shape:v3-page:care-plan-v3-intro',type:'text',props:{richText:rt('Alternativa manual. Para leitura assistida, recortes e confirmação por item, seguir 09 · Leitura e confirmação.')}},
{id:'shape:v3-01-enviar-orientacoes-caption',type:'text',props:{richText:rt('US02 · Alternativa manual. Trechos ilegíveis ficam pendentes; não rejeitar todo o documento por uma dúvida.')}}
]);
return {updated:['07 Sono','04 Mapa','06 referência manual']};
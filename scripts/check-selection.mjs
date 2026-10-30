import assert from 'node:assert/strict';
import { SELECTION_ACTIONS, selectionRequest, selectionPlan, selectionPrompt, parseSelectionPrompt, selectionSummary } from '../plugin/src/selection-actions.ts';
import { checkRevision } from '../plugin/src/revision.ts';
import { authorPrompt } from '../plugin/src/conversation.ts';
import { withChanges } from '../plugin/src/workshop.ts';

export async function checkSelection() {
 const path='Manuscript/Chapitres/002.md', source='Avant 🖋. Louise parle doucement.\n\nAprès : Louise parle doucement.\n';
 const from=source.indexOf('parle'),to=from+'parle doucement'.length;
 for(const action of SELECTION_ACTIONS) {
  const request=selectionRequest(action.id,path,source,from,to,'Garde les faits.',action.id==='point-de-vue'?'Nadia, première personne':'');
  const parsed=parseSelectionPrompt(selectionPrompt(request));
  assert.deepEqual(Object.fromEntries(Object.keys(request).map(key=>[key,parsed[key]])),request);
  assert.equal(authorPrompt(selectionPrompt(request)),selectionSummary(request));
  assert.equal(authorPrompt(withChanges(selectionPrompt(request),{pending:[{path,kind:'modifié'}]})),selectionSummary(request));
  const plan=selectionPlan(request,source);
  assert.equal(plan.selection.method,action.method);assert.equal(plan.wholeChapter,false);
  const candidate=source.slice(0,from)+'murmure'+source.slice(to);
  if(action.id==='variantes') assert.throws(()=>checkRevision(plan,source,candidate),/variantes/);
  else {
   checkRevision(plan,source,candidate);
   checkRevision(plan,source,source.slice(0,from)+source.slice(to));
   assert.throws(()=>checkRevision(plan,source,candidate+' '),/hors de la sélection/);
   assert.throws(()=>checkRevision(plan,source,'X'+candidate.slice(1)),/hors de la sélection/);
   assert.throws(()=>checkRevision(plan,source,source.replaceAll('parle doucement','murmure')),/hors de la sélection/);
   assert.throws(()=>checkRevision(plan,source,source.slice(0,from)+'==murmure=='+source.slice(to)),/balise/);
  }
  assert.throws(()=>selectionPlan(request,source+' '),/changé/);
  assert.throws(()=>checkRevision(plan,source+' ',candidate),/changé/);
 }
 assert.throws(()=>selectionRequest('point-de-vue',path,source,from,to),/point de vue/);
 for(const [start,end] of [[from,from],[-1,2],[0,source.length+1],[1.5,3]]) assert.throws(()=>selectionRequest('condenser',path,source,start,end),/Sélectionnez/);
 const emoji=source.indexOf('🖋');assert.throws(()=>selectionRequest('condenser',path,source,emoji+1,emoji+2),/Sélectionnez/);
 const multiline=selectionRequest('developper',path,source,from,source.lastIndexOf('doucement')+9);
 const plan=selectionPlan(multiline,source);checkRevision(plan,source,source.slice(0,plan.selection.from)+'Passage développé.\nDeuxième paragraphe.'+source.slice(plan.selection.to));
 assert.equal(parseSelectionPrompt('Une demande ordinaire.'),null);
 assert.throws(()=>parseSelectionPrompt('Action Orelius sur sélection.\nIncomplet'),/incomplète/);
 const valid=selectionPrompt(selectionRequest('reformuler',path,source,from,to));
 assert.throws(()=>parseSelectionPrompt(valid.replace(/"hash":"[^"]+"/,'"hash":"invalide"')),/invalide/);
 assert.equal(authorPrompt('Action Orelius sur sélection.\nIncomplet'),'Action Orelius sur sélection.\nIncomplet');
}

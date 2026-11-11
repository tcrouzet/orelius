import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {modelOptions} from '../plugin/src/models.ts';
import {ChatSession} from '../plugin/src/session.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';

export async function checkModelSelection(){
 const raw=[
  {model:'model-a',displayName:'Modèle A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Équilibré'},{reasoningEffort:'high',description:'Approfondi'}]},
  {model:'model-b',displayName:'Modèle B',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Rapide'},{reasoningEffort:'ultra',description:'Niveau annoncé par une future version'}]},
 ];
 const models=modelOptions(raw);
 assert.deepEqual(models[0].supportedReasoningEfforts,raw[0].supportedReasoningEfforts);
 assert.equal(models[1].defaultReasoningEffort,'low');
 assert.equal(modelOptions([{model:'legacy',displayName:'Ancien catalogue'}])[0].supportedReasoningEfforts,undefined,'Un ancien catalogue ne doit pas recevoir des niveaux inventés.');
 for(const extra of [{supportedReasoningEfforts:{}},{supportedReasoningEfforts:[{reasoningEffort:'',description:''}]},{supportedReasoningEfforts:[{reasoningEffort:3}]},{defaultReasoningEffort:42}])assert.throws(()=>modelOptions([{model:'bad',displayName:'Invalide',...extra}]),/invalide/);
 const root=await mkdtemp(join(tmpdir(),'orelius-model-options-'));
 let stopped=0;const calls=[];
 const session=new ChatSession(()=>{},async()=>{},undefined,()=>folders);
 try{
  await prepareProject(root,folders);
  session.models=models;session.model='model-a';session.connected=true;session.threadId='conversation-conservee';
  const history=[{id:'ancien',role:'assistant',phase:'final_answer',text:'Réponse déjà écrite.',paths:[]}];session.items=[...history];
  session.client={request:async(method,args)=>{
   calls.push({method,args});
   if(method==='thread/turns/list')return {data:[],nextCursor:null};
   if(method==='turn/steer')return {turnId:args.expectedTurnId};
   assert.equal(method,'turn/start');return {turn:{id:`turn-${calls.length}`}};
  },stop:async()=>{stopped++;}};
  session.selectReasoningEffort('high');
  await session.send('Premier échange.','codex',root,session.threadId);
  const start=calls.find(call=>call.method==='turn/start');
  assert.equal(start.args.model,'model-a');assert.equal(start.args.effort,'high');
  session.selectModel('model-b');assert.equal(session.reasoningEffort,'low','Un changement de modèle choisit un niveau pris en charge.');
  session.selectReasoningEffort('ultra');
  assert.equal(session.modelChangePending,true);assert.equal(session.running,true);assert.equal(stopped,0);
  assert.deepEqual(session.items,history);assert.equal(session.threadId,'conversation-conservee');
  assert.throws(()=>session.selectReasoningEffort('high'),/niveau/i);
  assert.throws(()=>session.selectModel('absent'),/proposé/);
  assert.equal(session.model,'model-b');assert.equal(session.reasoningEffort,'ultra');
  await session.steer('Précision pour la tâche en cours.');
  assert.equal(calls.some(call=>call.method==='turn/steer'),false,'Une précision est mise en attente sans interrompre la génération.');
  assert.equal(session.queuedMessages.length,1);
  await session.notification('turn/completed',{threadId:session.threadId,turn:{status:'completed'}},root);
  const maintenance=calls.filter(call=>call.method==='turn/start').at(-1);
  assert.equal(maintenance.args.model,'model-a');assert.equal(maintenance.args.effort,'high','Le suivi de la tâche conserve son modèle et son niveau initiaux.');
  await session.notification('turn/completed',{threadId:session.threadId,turn:{status:'completed'}},root);
  assert.equal(session.busy,true,'Le message en attente démarre après le suivi du premier échange.');
  assert.equal(session.queuedMessages.length,0);
  assert.ok(calls.filter(call=>call.method==='turn/start').at(-1).args.input[0].text.includes('Précision pour la tâche en cours.'));
  session.busy=false;session.turnId='';
  await session.send('Deuxième échange.','codex',root,session.threadId);
  const next=calls.filter(call=>call.method==='turn/start').at(-1);
  assert.equal(next.args.model,'model-b');assert.equal(next.args.effort,'ultra');assert.equal(next.args.threadId,'conversation-conservee');
  assert.equal(session.modelChangePending,false);
  const other=new ChatSession(()=>{},async()=>{});other.models=models;other.selectModel('model-a');
  assert.equal(other.reasoningEffort,'medium');assert.equal(session.model,'model-b','Chaque projet conserve ses choix.');
 }finally{await session.disconnect();await rm(root,{recursive:true,force:true});}
}

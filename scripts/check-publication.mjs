import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PublicationReview, PublicationError, parsePublicationVerdict, REVIEW_AXES } from '../plugin/src/publication-review.ts';
import { CodexClient } from '../plugin/src/codex.ts';
import { evaluatePublication } from '../plugin/src/codex-review.ts';
import { DEFAULT_PROJECT_FOLDERS as folders } from '../plugin/src/settings.ts';

export function publicationVerdict(input, accepted = true) {
 return {controles:REVIEW_AXES.map(axe=>{
  const source=axe==='intention'?{path:input.contexte.preparationPath,content:input.preparation}:axe==='faits'?input.contexte.sources.find(s=>s.role==='current-manuscript')??input.contexte.sources.find(s=>s.role==='previous-manuscript')??input.contexte.sources.find(s=>s.role==='author-request'):input.contexte.sources.find(s=>s.role==='approved-voice')??input.contexte.sources.find(s=>s.role==='instructions');
  assert.ok(source,`Source de test pour ${axe}`);
  return {axe,conforme:accepted || axe!=='faits',constat:'Comparaison contrôlée dans le test.',passage:input.candidat.trim(),source:source.path,preuve:source.content,correction:accepted?'':'Retirer l’antécédent non établi.'};
 })};
}
export async function checkPublication() {
 const root=await mkdtemp(join(tmpdir(),'orelius-publication-'));
 const chapter='Manuscript/Chapitres/002.md', prep='Manuscript/Context/002/preparation.md';
 const original='Texte conservé.', preparation='Aucune plainte établie ; voix de Jonas.';
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 try {
  await put(chapter,original);await put(prep,preparation);
  const context={chapter,path:'Manuscript/Context/002/sources.md',preparationPath:prep,promptsPath:'Manuscript/Context/002/prompts.md',task:'reviser',sources:[{path:chapter,role:'current-manuscript',content:original},{path:'Bible/Style/Narration.md',role:'instructions',content:'Voix de Jonas.'}],snapshots:new Map([[chapter,original]]),document:'Dossier courant',pages:[]};
  const input={candidat:'Une plainte a déjà été déposée.',preparation,contexte:context};
  const gate=new PublicationReview();let calls=0;
  const evaluator=async value=>{calls++;return publicationVerdict(value,calls>1);};
  await assert.rejects(()=>gate.check(root,folders,input,evaluator),error=>error instanceof PublicationError&&!error.terminal);
  assert.equal(await readFile(join(root,chapter),'utf8'),original);
  assert.equal(calls,1);
  const repaired={...input,candidat:'Jonas écoute Louise.'};
  await gate.check(root,folders,repaired,async value=>{assert.equal(value.precedent.controles[1].conforme,false);return evaluator(value);});
  assert.equal(calls,2);assert.equal(gate.incomplete,true,'Une évaluation favorable ne prétend pas que le fichier est écrit.');
  gate.published(chapter);assert.equal(gate.incomplete,false);
  await gate.check(root,folders,repaired,evaluator);assert.equal(calls,2,'Même candidat validé : pas de nouvelle génération.');
  await assert.rejects(()=>gate.check(root,folders,{...input,candidat:'Troisième candidat.'},evaluator),error=>error.terminal);assert.equal(calls,2);
  assert.equal(await readFile(join(root,chapter),'utf8'),original);
  assert.ok((await readFile(join(root,'Manuscript/Context/002/Publication/controle-2.md'),'utf8')).includes('contrôle favorable'));
  const duplicate=new PublicationReview();let duplicateCalls=0;
  const refuseDuplicate=async value=>{duplicateCalls++;return publicationVerdict(value,false);};
  await assert.rejects(()=>duplicate.check(root,folders,input,refuseDuplicate),error=>!error.terminal);
  await assert.rejects(()=>duplicate.check(root,folders,input,refuseDuplicate),error=>error.terminal&&/sans correction/.test(error.message));
  await assert.rejects(()=>duplicate.check(root,folders,repaired,refuseDuplicate),error=>error.terminal);
  assert.equal(duplicateCalls,1,'Renvoyer le même candidat ne crée pas une boucle.');
  const rejected=new PublicationReview();let rejectedCalls=0;
  const no=async value=>{rejectedCalls++;return publicationVerdict(value,false);};
  await assert.rejects(()=>rejected.check(root,folders,{...input,candidat:"Autre brouillon avec plainte."},no),error=>!error.terminal);
  await assert.rejects(()=>rejected.check(root,folders,repaired,no),error=>error.terminal);
  await assert.rejects(()=>rejected.check(root,folders,{...repaired,candidat:'Autre.'},no),error=>error.terminal);assert.equal(rejectedCalls,2);
  const archives=await readdir(join(root,'Archives/Manuscript/Context/002/Publication'));assert.ok(archives.some(name=>name.startsWith('candidat-1.')));
  for(const mutate of [v=>v.controles.pop(),v=>v.controles[1].axe='intention',v=>v.controles[0].passage='Citation inventée',v=>v.controles[0].preuve='Preuve inventée',v=>v.controles[0].source='archive absente',v=>v.controles[0].conforme='oui']) {
   const verdict=publicationVerdict(input);mutate(verdict);assert.throws(()=>parsePublicationVerdict(verdict,input),/invalide/);
  }
  const falseFact=publicationVerdict(input);falseFact.controles[1].source=prep;falseFact.controles[1].preuve=preparation;
  assert.throws(()=>parsePublicationVerdict(falseFact,input),/invalide/,'La préparation ne prouve pas un fait.');
  const withVoice={...input,contexte:{...context,sources:[...context.sources,{path:'voix acceptee',role:'approved-voice',content:'Extrait accepté.'}]}};
  assert.throws(()=>parsePublicationVerdict(publicationVerdict(input),withVoice),/invalide/,'Une voix acceptée ne peut être ignorée au profit de consignes génériques.');
  const unavailable=new PublicationReview();
  await assert.rejects(()=>unavailable.check(root,folders,input,async()=>{throw new Error('Contrôleur indisponible');}),/Contrôleur indisponible/);
  await assert.rejects(()=>unavailable.check(root,folders,repaired,evaluator),error=>error.terminal);
  const stale=new PublicationReview();
  await assert.rejects(()=>stale.check(root,folders,input,async value=>{await put(chapter,'Correction humaine pendant le contrôle.');return publicationVerdict(value);}),/Source modifiée/);
  assert.equal(await readFile(join(root,chapter),'utf8'),'Correction humaine pendant le contrôle.');await put(chapter,original);
  const cancel=new PublicationReview();
  await assert.rejects(()=>cancel.check(root,folders,input,async value=>{cancel.cancel();return publicationVerdict(value);}),/interrompu/);
  assert.equal(await readFile(join(root,chapter),'utf8'),original);

  let stopped=0, invoked=0;
  const factory=mode=>handlers=>({
   async connect(){},rejectRequest(){},async stop(){stopped++;},
   async request(method,args){
    if(method==='thread/start'){assert.equal(args.ephemeral,true);assert.equal(args.sandbox,'read-only');assert.equal(args.approvalPolicy,'never');assert.equal(args.model,'chosen-model');return {thread:{id:'review'}};}
    assert.equal(method,'turn/start');assert.equal(args.sandboxPolicy.networkAccess,false);assert.ok(args.outputSchema.properties.controles);
    assert.ok(args.input[0].text.includes(input.candidat));invoked++;
    queueMicrotask(()=>{
     if(mode==='request'){handlers.request({id:1,method:'item/tool/requestUserInput',params:{}});return;}
     if(mode==='exit'){handlers.exit('arrêt inattendu');return;}
     if(mode==='wait') return;
     handlers.notification('item/completed',{threadId:'review',item:{type:'agentMessage',phase:'final_answer',text:mode==='invalid'?'pas du JSON':JSON.stringify(publicationVerdict(input))}});
     handlers.notification('turn/completed',{threadId:'review',turn:{status:mode==='failed'?'failed':'completed'}});
    });return {turn:{id:'review-turn'}};
   }
  });
  const signal=new AbortController();
  assert.equal((await evaluatePublication('codex',root,'chosen-model',input,signal.signal,factory('ok'))).controles.length,3);
  for(const mode of ['invalid','failed','request','exit']) await assert.rejects(()=>evaluatePublication('codex',root,'chosen-model',input,signal.signal,factory(mode)));
  const abort=new AbortController();
  const pending=evaluatePublication('codex',root,'chosen-model',input,abort.signal,factory('wait'));
  abort.abort();await assert.rejects(()=>pending,/interrompu/);
  assert.equal(stopped,6);assert.equal(invoked,5);
 } finally { await rm(root,{recursive:true,force:true}); }
}

export async function checkPublicationProtocol(executable,cwd,model) {
 const input={candidat:'Elle écoute.',preparation:'Écouter.',contexte:{sources:[{path:'source',role:'instructions',content:'Voix prescrite.'}],preparationPath:'preparation.md',prompts:{'controler-publication':'Contrôle seulement.'}}};
 let turns=0,closed=false;
 const factory=handlers=>{
  const client=new CodexClient(handlers),native=client.request.bind(client),stop=client.stop.bind(client);
  client.stop=async()=>{closed=true;await stop();};
  client.request=async(method,args)=>{
   if(method==='thread/start') {
    const result=await native(method,args);
    assert.equal(result.thread.ephemeral,true);
    const inventory=await native('mcpServerStatus/list',{threadId:result.thread.id,limit:100});
    // Codex lists disabled servers too; only exposed tools grant capabilities.
    assert.deepEqual(inventory.data.flatMap(server=>Object.keys(server.tools??{})),[], 'Aucun outil MCP exposé au contrôleur.');
    return result;
   }
   if(method!=='turn/start') return native(method,args);
   turns++;assert.ok(args.outputSchema.properties.controles);
   // Only inference is synthetic; startup, authentication and thread isolation are native.
   queueMicrotask(()=>{
    handlers.notification('item/completed',{threadId:args.threadId,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({controles:[]})}});
    handlers.notification('turn/completed',{threadId:args.threadId,turn:{status:'completed'}});
   });return {turn:{id:'synthetic-review'}};
  };
  return client;
 };
 assert.deepEqual(await evaluatePublication(executable,cwd,model,input,new AbortController().signal,factory),{controles:[]});
 assert.equal(turns,1);assert.equal(closed,true);
}

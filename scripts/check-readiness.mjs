import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ReadinessGate,ReadinessError,READINESS_AXES,parseReadiness} from '../plugin/src/readiness.ts';
import {evaluateReadiness} from '../plugin/src/codex-review.ts';
import {buildSceneContext} from '../plugin/src/scene-context.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {ChatSession} from '../plugin/src/session.ts';

export function readinessVerdict(input,blocked=false){
 const source=input.contexte.sources.find(source=>source.role==='author-request')??input.contexte.sources.find(source=>source.role==='instructions');
 assert.ok(source,'Une preuve de test doit être disponible.');
 return {criteres:READINESS_AXES.map(axe=>({axe,statut:blocked&&axe==='intention'?'manquant':'suffisant',constat:blocked&&axe==='intention'?'Le but concret de la lettre reste à décider.':'Éléments disponibles.',
  appuis:[{source:source.path,extrait:source.content}],question:blocked&&axe==='intention'?'Que veut obtenir la correspondante de son lecteur ?':'',action:blocked&&axe==='intention'?'Préciser cette intention dans la fiche de scène avant la rédaction.':''}))};
}

export async function checkReadiness(prompts){
 const root=await mkdtemp(join(tmpdir(),'orelius-prerequisites-'));
 const chapter='Manuscript/001.md';
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 try{
  await put(chapter,'Version conservée.');
  await put('Bible/Projet.md','Une correspondance. Les motifs restent à décider.');
  await put('Bible/Style/Narration.md','Première personne ; une voix précise.');
  const checks='## Motifs — ouvert\n\nDécider du but de la lettre.\n\n## Source indispensable — ouvert\n\nL’œuvre qui motive la lettre reste à lire.\n';
  await put('Bible/Checks/Questions.md',checks);
  let context=await buildSceneContext(root,folders,{},chapter,'Écris sa première lettre.',prompts);
  assert.equal(context.sources.find(source=>source.path==='Bible/Checks/Questions.md').content,checks,'Les points ouverts arrivent intégralement, sans dépendre des mots de la demande.');
  let input={contexte:context,preparation:'La rédactrice imagine une lettre sur un sujet de remplacement.'};
  const gate=new ReadinessGate();let calls=0;
  const blocked=async value=>{calls++;return readinessVerdict(value,true);};
  let result=await gate.check(root,folders,input,blocked,new AbortController().signal);
  assert.equal(result.autorise,false);assert.equal(result.questions.length,1);assert.match(result.message,/Que veut obtenir/);
  assert.ok((await readFile(join(root,result.fichier),'utf8')).includes('manquant'));
  assert.equal(await readFile(join(root,chapter),'utf8'),'Version conservée.');
  const messages=[];
  const resumed=new ChatSession(()=>{},async()=>{},undefined,()=>({...folders,activeChapter:chapter,taskPrompts:prompts}));
  resumed.connected=true;resumed.threadId='dialogue-repris';
  resumed.client={request:async(method,args)=>{assert.equal(method,'turn/start');messages.push(args.input[0].text);return {turn:{id:'reponse-dialogue'}};}};
  await resumed.send('Elle veut surtout être lue, mais elle le cache derrière une objection au livre.','codex',root,resumed.threadId);
  const continuation=JSON.parse(messages[0].split('<!-- orelius:material-search -->\n')[1]);
  assert.equal(continuation.preparationEnCours.chapitre,chapter);
  assert.equal(continuation.preparationEnCours.diagnosticPrecedent,await readFile(join(root,result.fichier),'utf8'));
  assert.match(continuation.preparationEnCours.consigne,/Bible\/Characters/);
  assert.match(continuation.preparationEnCours.consigne,/un seul point à la fois/);
  assert.ok(!continuation.preparationEnCours.consigne.includes('{bibleFolder}'));
  assert.equal(await readFile(join(root,chapter),'utf8'),'Version conservée.','Une réponse de préparation ne produit aucun chapitre.');
  for(const activeChapter of [undefined,'Manuscript/pas-encore-ecrit.md']) {
   const sent=[];
   const beforePopulate=new ChatSession(()=>{},async()=>{},undefined,()=>({...folders,activeChapter,taskPrompts:prompts}));
   beforePopulate.connected=true;beforePopulate.threadId='discussion-sans-preparation';
   beforePopulate.client={request:async(method,args)=>{assert.equal(method,'turn/start');sent.push(args.input[0].text);return {turn:{id:'discussion-personnage'}};}};
   await beforePopulate.send('Elle est attentive et perspicace ; elle ne lui fait pas subir un interrogatoire.','codex',root,beforePopulate.threadId);
   const payload=JSON.parse(sent[0].split('<!-- orelius:material-search -->\n')[1]);
   assert.equal(payload.preparationEnCours.chapitre,activeChapter??null);
   assert.equal(payload.preparationEnCours.diagnosticPrecedent,undefined);
   assert.match(payload.preparationEnCours.consigne,/même avant le peuplement/);
   assert.match(payload.preparationEnCours.consigne,/Bible\/Characters/);
   assert.match(payload.preparationEnCours.consigne,/ecrire_fichier/);
   assert.match(payload.preparationEnCours.consigne,/sans attendre/);
   assert.ok(!payload.preparationEnCours.consigne.includes('{bibleFolder}'));
  }
  result=await gate.check(root,folders,{...input,preparation:'Une autre invention du rédacteur.'},blocked,new AbortController().signal);
  assert.equal(result.autorise,false);assert.equal(calls,1,'Reformuler la préparation ne déclenche ni nouveau jugement ni autorisation.');
  const good=readinessVerdict(input);
  for(const mutate of [value=>value.criteres.pop(),value=>value.criteres[1].axe=value.criteres[0].axe,value=>value.criteres[0].appuis[0].extrait='preuve inventée',value=>value.criteres[0].appuis=[{source:'preparationProposee — Objectif de la scène',extrait:input.preparation}],value=>value.criteres[0].appuis=[],value=>{value.criteres[0].statut='manquant';value.criteres[0].question='';}]){
   const invalid=structuredClone(good);mutate(invalid);assert.throws(()=>parseReadiness(invalid,input),/prérequis/);
  }
  await put('Bible/Projet.md','La correspondante cherche à obtenir un rendez-vous pour lui montrer son manuscrit.');
  await assert.rejects(()=>gate.check(root,folders,input,blocked,new AbortController().signal),/Source modifiée/);
  context=await buildSceneContext(root,folders,{},chapter,'Elle demande un rendez-vous. Écris la lettre.',prompts);
  input={contexte:context,preparation:'Faire émerger la demande de rendez-vous.'};
  result=await gate.check(root,folders,input,async value=>{calls++;return readinessVerdict(value);},new AbortController().signal);
  assert.equal(result.autorise,true);assert.equal(calls,2,'Une réponse nouvelle modifie le dossier et permet un nouveau contrôle.');
  await gate.check(root,folders,input,async()=>{throw Error('Ne doit pas être rappelé');},new AbortController().signal);
  assert.equal(calls,2);
  const repair=new ReadinessGate();let repairCalls=0,deadline;
  const repaired=await repair.check(root,folders,input,async request=>{
   repairCalls++;
   if(repairCalls===1){
    deadline=request.deadline;
    const bad=readinessVerdict(request);bad.criteres[0].appuis[0].extrait='Une citation inventée.';return bad;
   }
   assert.equal(request.deadline,deadline,'La réparation partage le délai initial.');
   assert.match(request.correctionRapport.erreur,/intention/);
   assert.equal(request.correctionRapport.rapport.criteres[0].appuis[0].extrait,'Une citation inventée.');
   return readinessVerdict(request);
  },new AbortController().signal);
  assert.equal(repaired.autorise,true);assert.equal(repairCalls,2);
  assert.ok((await readFile(join(root,'Tracking/001/prerequis-invalide-1.md'),'utf8')).includes('Une citation inventée.'));
  const broken=new ReadinessGate();let failures=0;
  const fail=async()=>{failures++;return {criteres:[]};};
  await assert.rejects(()=>broken.check(root,folders,input,fail,new AbortController().signal),ReadinessError);
  await assert.rejects(()=>broken.check(root,folders,input,fail,new AbortController().signal),ReadinessError);
  assert.equal(failures,2,'Un échec technique terminal ne relance pas indéfiniment le contrôleur.');
  assert.equal(await readFile(join(root,chapter),'utf8'),'Version conservée.');
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(()=>new ReadinessGate().check(root,folders,input,async value=>readinessVerdict(value),cancelled.signal),/interrompu/);
  await assert.rejects(()=>new ReadinessGate().check(root,folders,input,async value=>{
   await put('Bible/Projet.md','L’auteur vient de changer son intention.');return readinessVerdict(value);
  },new AbortController().signal),/Source modifiée/);
  const poem={...input,contexte:{...context,sources:[{path:'demande actuelle',role:'author-request',content:'Un haïku libre sur la pluie ; invente les images. Aucun personnage ni recherche documentaire.'}]}};
  const free=readinessVerdict(poem);
  for(const row of free.criteres)if(['documentation','personnages-et-information'].includes(row.axe))row.statut='sans-objet';
  assert.doesNotThrow(()=>parseReadiness(free,poem),'Aucun questionnaire de personnage ou de documentation imposé à un texte qui n’en a pas besoin.');

  input={...input,correctionRapport:{erreur:'Extrait absent',rapport:{criteres:[]}},deadline:Date.now()+30000};
  let stopped=false,started=false;
  const factory=handlers=>({connect:async()=>{},stop:async()=>{stopped=true;},rejectRequest(){throw Error('Aucun outil attendu');},request:async(method,args)=>{
   if(method==='thread/start'){assert.equal(args.ephemeral,true);assert.equal(args.sandbox,'read-only');assert.equal(args.approvalPolicy,'never');assert.equal(args.config.model_reasoning_effort,'high');return {thread:{id:'prerequisites'}};}
   assert.equal(method,'turn/start');assert.ok(args.outputSchema.properties.criteres);assert.equal(args.sandboxPolicy.networkAccess,false);assert.equal(args.effort,'high');
   const data=JSON.parse(args.input[0].text);assert.equal(data.candidat,undefined);assert.equal(data.preparationProposee,input.preparation);assert.deepEqual(data.correctionRapport,input.correctionRapport);started=true;
   queueMicrotask(()=>{handlers.notification('item/completed',{threadId:'prerequisites',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify(readinessVerdict(input))}});
    handlers.notification('turn/completed',{threadId:'prerequisites',turn:{status:'completed'}});});return {turn:{id:'turn'}};
  }});
  const verdict=await evaluateReadiness('codex',root,'chosen-model',input,new AbortController().signal,factory,'high');
  assert.equal(verdict.criteres.length,4);assert.equal(started,true);assert.equal(stopped,true);
 }finally{await rm(root,{recursive:true,force:true});}
}

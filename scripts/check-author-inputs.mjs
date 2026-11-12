import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {INPUTS_PATH,recordInput,bindInput,importInputs,pendingInputs,analyseInputs} from '../plugin/src/author-inputs.ts';
import {ChatSession} from '../plugin/src/session.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {saveConversation,renderConversation,visibleMessages} from '../plugin/src/conversation.ts';
import {INPUT_REVIEW_PREFIX} from '../plugin/src/editorial-workflow.ts';

export async function checkAuthorInputs(prompts){
 const root=await mkdtemp(join(tmpdir(),'orelius-inputs-'));
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 try{
  const text='Elle observe sans interroger.\n\nElle garde ce doute pour elle. (((Important)))';
  const id=await recordInput(root,folders,text);
  await recordInput(root,folders,text,id);
  assert.equal((await pendingInputs(root)).length,1,'Une relance du même envoi ne duplique pas le message.');
  assert.equal((await pendingInputs(root))[0].text,text);
  assert.ok((await readFile(join(root,INPUTS_PATH),'utf8')).includes(text));
  await bindInput(root,folders,id,'session','tour');
  const history=[{source:'source-1',threadId:'session',turnId:'tour',date:new Date().toISOString(),text}];
  await importInputs(root,folders,history);await importInputs(root,folders,history);
  assert.equal((await pendingInputs(root)).length,1,'La reprise de l’historique rattache le message déjà enregistré.');
  const entry={id,statut:'integre',synthese:'Caractérisation précisée.',references:[{chemin:'Bible/Characters/Nora.md',extrait:'Elle observe sans interroger.'}]};
  await assert.rejects(()=>analyseInputs(root,folders,{analyses:[entry]},()=>{}),/Analyse des apports/);
  await put('Bible/Characters/Nora.md','# Nora\n\nElle observe sans interroger. Elle garde ce doute pour elle.');
  await put('Model/reference.md','Elle observe sans interroger.');
  for(const invalid of [{...entry,references:[]},{...entry,id:'inconnu'},{...entry,references:[{chemin:'Bible/../config.md',extrait:'secret'}]},{...entry,references:[{chemin:'Model/reference.md',extrait:'Elle observe sans interroger.'}]}]){
   await assert.rejects(()=>analyseInputs(root,folders,{analyses:[invalid]},()=>{}),/Analyse des apports/);
  }
  await analyseInputs(root,folders,{analyses:[entry]},()=>{});
  assert.deepEqual(await pendingInputs(root),[]);
  assert.ok((await readFile(join(root,INPUTS_PATH),'utf8')).includes(text),'L’analyse conserve le message intégral.');
  await put('Bible/Characters/Nora.md','# Nora\n\nUne autre proposition a remplacé la consigne.');
  assert.ok((await pendingInputs(root)).some(input=>input.id===id && input.status==='pending'),'Une consigne dont la preuve a disparu doit être réexaminée.');
  await put('Bible/Characters/Nora.md','# Nora\n\nElle observe sans interroger. Elle garde ce doute pour elle.');
  assert.deepEqual(await pendingInputs(root),[],'La référence rétablie suffit ; aucun statut périmé ne doit rester en cache.');
  const idea=await recordInput(root,folders,'Et si elle se trompait ?');
  const exploration={id:idea,statut:'exploration',synthese:'Piste ouverte, sans fait ajouté au personnage.',references:[]};
  await assert.rejects(()=>analyseInputs(root,folders,{analyses:[exploration]},()=>{}),/Analyse des apports/,'Une piste classée dans le journal ne suffit pas à enrichir la Bible.');
  await put('Bible/Variants/Doute.md','# Piste\n\nNora pourrait se tromper sur la confiance de sa sœur ; cette possibilité reste à explorer.');
  exploration.references=[{chemin:'Bible/Variants/Doute.md',extrait:'Nora pourrait se tromper sur la confiance de sa sœur'}];
  await analyseInputs(root,folders,{analyses:[exploration]},()=>{});
  assert.deepEqual(await pendingInputs(root),[]);
  assert.ok((await readFile(join(root,INPUTS_PATH),'utf8')).includes('Et si elle se trompait ?'));
  const concurrent=await Promise.all(['Première nuance.','Deuxième nuance.'].map(value=>recordInput(root,folders,value)));
  assert.equal((await pendingInputs(root)).length,2,'Deux envois concurrents sont conservés.');
  const turns=[{id:'ancien',date:new Date('2026-01-01T10:00:00Z'),completed:true,messages:[{id:'ancien-input',role:'user',text:'Un retour plus ancien.',paths:[]}]}];
  await saveConversation(root,folders,'historique',turns);await saveConversation(root,folders,'historique',turns);
  assert.equal((await pendingInputs(root)).filter(input=>input.text==='Un retour plus ancien.').length,1);

  const sent=[];
  const session=new ChatSession(()=>{},async()=>{},undefined,()=>({...folders,taskPrompts:prompts}));
  session.connected=true;session.threadId='simulation';
  session.client={request:async(method,args)=>{
   if(method==='thread/turns/list')return {data:[],nextCursor:null};
   if(method==='turn/start'){
    assert.ok((await pendingInputs(root)).some(input=>input.text==='Elle veut être lue.'));
    sent.push(args.input[0].text);return {turn:{id:`tour-${sent.length}`}};
   }
   throw Error(method);
  }};
  await session.send('Elle veut être lue.','codex',root,session.threadId);
  const payload=JSON.parse(sent[0].split('<!-- orelius:material-search -->\n')[1]);
  assert.ok(payload.inputsAuteur.enAttente.some(input=>input.text==='Elle veut être lue.'));
  assert.match(payload.inputsAuteur.consigne,/conséquences/);
  assert.match(payload.inputsAuteur.consigne,/Characters/);
  assert.match(payload.inputsAuteur.consigne,/Style/);
  await session.notification('turn/completed',{threadId:session.threadId,turn:{status:'completed'}},root);
  assert.equal(sent.length,2);assert.ok(sent[1].startsWith(INPUT_REVIEW_PREFIX),'Un oubli déclenche une passe d’intégration.');
  await session.notification('turn/completed',{threadId:session.threadId,turn:{status:'completed'}},root);
  assert.equal(sent.length,2,'Une intégration impossible ne boucle pas.');assert.match(session.status,/incomplète/);
  assert.ok((await pendingInputs(root)).length>0);
  const offline=new ChatSession(()=>{},async()=>{},undefined,()=>({...folders,taskPrompts:prompts}));
  offline.initialize=async()=>{throw Error('Connexion impossible');};
  await assert.rejects(()=>offline.send('Même sans connexion, garder cette nuance.','codex',root,''),/Connexion impossible/);
  assert.ok((await pendingInputs(root)).some(input=>input.text==='Même sans connexion, garder cette nuance.'));
  session.busy=true;session.turnId='en-cours';
  session.client.request=async()=>{throw Error('Envoi interrompu');};
  await session.steer('Une précision pendant le travail.');
  assert.ok(session.queuedMessages.some(item=>item.text.includes('Une précision pendant le travail.')));
  assert.ok(!(await pendingInputs(root)).some(input=>input.text==='Une précision pendant le travail.'),'Une demande en attente ne contamine pas les contrôles de la tâche active.');
  const beforeRetry=(await pendingInputs(root)).length;
  session.busy=false;
  session.client.request=async()=>({turn:{id:'relance'}});
  await session.send('Elle veut être lue.\n\nUne précision pendant le travail.','codex',root,session.threadId,undefined,[],session.lastRequest.inputId);
  assert.equal((await pendingInputs(root)).length,beforeRetry,'La relance après un ajout réutilise les apports déjà enregistrés.');
  const internal={id:'interne',date:new Date(),completed:true,messages:[{id:'interne-user',role:'user',text:INPUT_REVIEW_PREFIX+'travail',paths:[]},{id:'interne-fin',role:'assistant',text:'détail technique',phase:'final_answer',paths:[]}]};
  assert.equal(renderConversation([internal]),'');assert.deepEqual(visibleMessages(internal.messages,[internal]),[]);
  const answer={id:'réponse-visible',role:'assistant',text:'Discussion.',phase:'final_answer',paths:[]};
  const initial={id:'public',date:new Date(),completed:true,messages:[{id:'question',role:'user',text:'Parlons du personnage.',paths:[]},answer]};
  const amended={...internal,messages:[...internal.messages,{id:'fiche',role:'activity',text:'Enregistrée',paths:[],modifiedPaths:['Bible/Characters/Nora.md']}]};
  assert.deepEqual(visibleMessages([...initial.messages,...amended.messages],[initial,amended]).find(item=>item.id===answer.id).paths,['Bible/Characters/Nora.md']);

  const saved=await readFile(join(root,INPUTS_PATH),'utf8');
  const marker='\n<!-- orelius:inputs:data -->\n';
  const oldRows=JSON.parse(saved.slice(saved.lastIndexOf(marker)+marker.length));
  const oldExploration=oldRows.find(input=>input.id===idea);oldExploration.references=[];
  await put(INPUTS_PATH,saved.slice(0,saved.lastIndexOf(marker)+marker.length)+JSON.stringify(oldRows));
  assert.ok((await pendingInputs(root)).some(input=>input.id===idea),'Une ancienne exploration seulement classée dans Inputs doit être réanalysée.');

  await put(INPUTS_PATH,'Texte personnel sans structure.');
  await assert.rejects(()=>recordInput(root,folders,'À conserver malgré le problème.'),/préservé/);
  assert.equal(await readFile(join(root,INPUTS_PATH),'utf8'),'Texte personnel sans structure.');
 }finally{await rm(root,{recursive:true,force:true});}
}

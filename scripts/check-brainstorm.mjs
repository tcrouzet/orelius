import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {withContext} from '../plugin/src/request-context.ts';
import {readProjectFile} from '../plugin/src/project-files.ts';
import {t} from '../plugin/src/i18n.ts';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {brainstormFolder,brainstormRequest,withBrainstorm,checkBrainstormWrite,BRAINSTORM_INPUT} from '../plugin/src/brainstorm.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {chapterPath,revisionDocumentPath,revisionPrompt,revisionRequest,revisionProtections,archiveWithCorrections,captureCodexVersions} from '../plugin/src/corrections.ts';
import {planRevision} from '../plugin/src/revision.ts';
import {ChatSession} from '../plugin/src/session.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {pendingInputs,INPUTS_PATH,recordInput,bindInput} from '../plugin/src/author-inputs.ts';
import {BRAINSTORM_TOOL,brainstormContext} from '../plugin/src/brainstorm-exploration.ts';
import {authorPrompt} from '../plugin/src/conversation.ts';
import {INPUT_REVIEW_PREFIX} from '../plugin/src/editorial-workflow.ts';
import {FILE_TOOL,CONTEXT_TOOL,REVIEW_TOOL,WORKSHOP_TOOL,INPUTS_TOOL,LINK_TOOL,STATE_TOOL} from '../plugin/src/mcp.ts';

export async function checkBrainstorm(executable,taskPrompts) {
 await checkSelectedDocument();
 await checkMovedLinks();
 for(const folder of ['Brainstorm','Bible/Brainstorm','Manuscript/Brainstorm']) {
  assert.equal(brainstormFolder(folder,folders),folder);
  assert.equal(brainstormFolder(folder+'/Idées.md',folders),folder);
  assert.equal(chapterPath('/',folders,folder+'/Idées.md'),null);
  assert.equal(revisionDocumentPath('/',folders,folder+'/Idées.md'),folder+'/Idées.md');
  const request={folder,document:folder+'/Idées.md'};
  checkBrainstormWrite(request,request.document,folders);
  for(const path of [folder+'/Autre.md',folder+'/../Plan.md','Bible/Characters/Isa.md','Model/Source.md','Tracking/Connaissances.md','Manuscript/001.md'])assert.throws(()=>checkBrainstormWrite(request,path,folders),/brainstorm/i);
  assert.deepEqual(brainstormRequest(withBrainstorm('Une question ?',request)),request);
  assert.equal(authorPrompt(withBrainstorm('Une question ?',request)),BRAINSTORM_INPUT+'Une question ?');
 }
 for(const path of ['Brainstorming','Brainstorm/../Plan.md','../Brainstorm','Model/Brainstorm'])assert.equal(brainstormFolder(path,folders),null);
 const root=await mkdtemp(join(tmpdir(),'orelius-brainstorm-'));
 const versions={},sent=[],externalQueries=[];
 const path='Brainstorm/Construction.md';
 const generated='# Construction\n\nUne piste autour du moteur secret.\n';
 const session=new ChatSession(()=>{},async()=>{},(cwd,changes)=>archiveWithCorrections(cwd,folders,changes,versions,()=>{}),
  ()=>({...folders,taskPrompts,activeChapter:'Manuscript/001.md',codexVersions:{[root]:versions},externalSources:async(cwd,args)=>{externalQueries.push(args);return JSON.stringify(args.source===undefined?{sources:[{source:0,description:'Documentation'}]}:{source:args.source,resultats:[{chemin:'archive.md',extraits:['Un élément documentaire à vérifier.']}],page:0,pages:1});}}),
  async(cwd,changes)=>Object.assign(versions,await captureCodexVersions(cwd,folders,changes)));
 try {
  await prepareProject(root,folders);
  const untouched={'Bible/Plan/Projet.md':'Le plan conservé.','Manuscript/001.md':'Le chapitre conservé.','Model/Source.md':'Le moteur secret est une rivalité familiale.'};
  for(const [file,text] of Object.entries(untouched))await writeFile(join(root,file),text);
  await session.connect(executable,root,'');
  const native=session.client.request.bind(session.client);
  const {thread}=await native('thread/start',{cwd:root,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',approvalsReviewer:'user'});
  session.threadId=thread.id;
  const positive=await recordInput(root,folders,BRAINSTORM_INPUT+'Cet exemple fait surgir une contradiction qui me donne envie d’écrire.');
  await bindInput(root,folders,positive,thread.id,'precedent');
  const other=await recordInput(root,folders,BRAINSTORM_INPUT+'Autre conversation à ne pas mélanger.');
  await bindInput(root,folders,other,'autre-session','ailleurs');
  session.client.request=async(method,args)=>{
   if(method==='turn/start'){sent.push(args);return {turn:{id:'tour-'+sent.length}};}
   if(method==='turn/steer')return {turnId:args.expectedTurnId};
   if(method==='thread/turns/list')return {data:[],nextCursor:null};
   return native(method,args);
  };
  const call=(tool,args)=>native('mcpServer/tool/call',{threadId:thread.id,server:'orelius',tool,arguments:args});
  await session.send(withBrainstorm('Explorons le moteur secret.',{folder:'Brainstorm'}),executable,root,thread.id);
  const payload=JSON.parse(sent[0].input[0].text.split('<!-- orelius:material-search -->\n')[1]);
  assert.ok(session.client.threadConfig.mcp_servers.orelius.enabled_tools.includes(BRAINSTORM_TOOL),'Le nouvel outil est réellement autorisé par Codex.');
  assert.match(payload.methode,/deux ou trois angles/);
  assert.ok(payload.exploration.retours.some(input=>input.id===positive),'Un exemple positif reste disponible pour la nouvelle recherche.');
  assert.ok(!payload.exploration.retours.some(input=>input.id===other),'Les retours restent propres à la conversation.');
  const current=payload.exploration.retours.find(input=>input.texte.includes('Explorons le moteur secret.'));
  assert.ok(current,'Le message courant est fourni avant même son association au tour.');
  const prepare={document:path,objectif:'Faire découvrir une tension féconde.',retours:[{id:positive,lecture:'Retenir le mécanisme de contradiction, pas seulement le sujet.'},{id:current.id,lecture:'Explorer la motivation cachée.'}],pistes:[{angle:'Rivalité',recherche:'rivalité familiale',sources:[]},{angle:'Contradiction',recherche:'désir loyauté',sources:[0]}]};
  const prepared=await call(BRAINSTORM_TOOL,prepare);
  assert.equal(prepared.isError,false,prepared.content[0].text);
  const exploration=JSON.parse(prepared.content[0].text);
  assert.ok(exploration.pistes[0].projet.matches.some(match=>match.path==='Model/Source.md'));
  assert.ok(externalQueries.some(query=>query.source===0&&query.recherche==='désir loyauté'),'L’angle choisi recherche réellement dans la source externe.');
  assert.equal(exploration.pistes[1].documentsExternes[0].resultats[0].chemin,'archive.md');
  const synthesis=await readFile(join(root,exploration.fichier),'utf8');
  assert.match(synthesis,/mécanisme de contradiction/);
  assert.ok(!synthesis.includes('Un élément documentaire à vérifier.'),'La mémoire conserve les références sans réinjecter tous les extraits.');
  await assert.rejects(readFile(join(root,path)),{code:'ENOENT'},'Préparer ne rédige pas la note.');
  for(const args of [{...prepare,document:'Bible/Characters/Isa.md'},{...prepare,retours:[{id:other,lecture:'Ne pas importer.'}]},{...prepare,pistes:[prepare.pistes[0],prepare.pistes[0]]},{...prepare,page:0},{...prepare,retours:[]}]) {
   const rejected=await call(BRAINSTORM_TOOL,args);assert.equal(rejected.isError,true,JSON.stringify(args));
   assert.equal(await readFile(join(root,exploration.fichier),'utf8'),synthesis,'Un mauvais appel préserve la préparation.');
  }
  assert.ok(payload.matches.some(match=>match.path==='Model/Source.md'),'Le brainstorming recherche aussi les matériaux de Model.');
  assert.equal(payload.inputsAuteur,undefined);assert.equal(payload.preparationEnCours,undefined);
  assert.equal(session.editorialChapter,undefined,'Un chapitre encore ouvert ne devient pas la cible du brainstorm.');
  const reference=await call(CONTEXT_TOOL,{reference:'Bible/Plan/Projet.md'});
  assert.equal(reference.isError,false);assert.ok(reference.content[0].text.includes('Le plan conservé.'));
  for(const file of [...Object.keys(untouched),'Tracking/Connaissances.md']) {
   const refused=await call(FILE_TOOL,{chemin:file,contenu:'Modification interdite.'});
   assert.equal(refused.isError,true,refused.content[0].text);
  }
  for(const tool of [REVIEW_TOOL,WORKSHOP_TOOL,INPUTS_TOOL,LINK_TOOL,STATE_TOOL]) {
   const refused=await call(tool,{});assert.equal(refused.isError,true,tool);assert.match(refused.content[0].text,/brainstorm/i);
  }
  await writeFile(join(root,'Brainstorm/Existant.md'),'Exploration antérieure.');
  const existing=await call(FILE_TOOL,{chemin:'Brainstorm/Existant.md',contenu:'Ne pas remplacer.'});
  assert.equal(existing.isError,true);assert.match(existing.content[0].text,/Réviser/);
  assert.equal(await readFile(join(root,'Brainstorm/Existant.md'),'utf8'),'Exploration antérieure.');
  for(const suffix of ['\n(((Suggestion de Codex)))','\n(((Question non fermée']) {
   const rejected=await call(FILE_TOOL,{chemin:path,contenu:generated+suffix});
   assert.equal(rejected.isError,true);assert.match(rejected.content[0].text,/réservées à l’auteur/);
   await assert.rejects(()=>readFile(join(root,path)),{code:'ENOENT'});
  }
  const creation=await call(FILE_TOOL,{chemin:path,contenu:generated});
  assert.equal(creation.isError,false,creation.content[0].text);assert.ok(JSON.parse(creation.content[0].text).archives.length);
  const csvPath='Brainstorm/Construction.csv';
  const csv='Numero;Titre\r\n'+Array.from({length:140},(_,index)=>`${index+1};"Élément ${index+1}"\r\n`).join('');
  const exported=await call(FILE_TOOL,{chemin:csvPath,contenu:csv});
  assert.equal(exported.isError,false,exported.content[0].text);
  assert.equal(await readFile(join(root,csvPath),'utf8'),csv);
  assert.equal(await readFile(join(root,JSON.parse(exported.content[0].text).archives[0]),'utf8'),csv);
  assert.equal((await call(FILE_TOOL,{chemin:csvPath,contenu:'Écrasement interdit.'})).isError,true);
  assert.equal(await readFile(join(root,csvPath),'utf8'),csv,'Un export existant reste préservé.');
  assert.equal((await call(FILE_TOOL,{chemin:'Model/tableau.csv',contenu:csv})).isError,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Brainstorm/script.js',contenu:'code'})).isError,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Brainstorm/Autre.md',contenu:'Autre sujet.'})).isError,true,'Une tâche ne réécrit pas un autre brainstorm.');
  await session.steer('Garde cette piste ouverte.');
  assert.deepEqual(await pendingInputs(root),[],'Les échanges exploratoires ne déclenchent pas une intégration future à la Bible.');
  assert.ok(session.queuedMessages.some(item=>item.text.includes('Garde cette piste ouverte.')));
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(sent.length,2,'Seule la demande en attente démarre après le brainstorm.');
  assert.ok((await readFile(join(root,INPUTS_PATH),'utf8')).includes('Garde cette piste ouverte.'));
  assert.deepEqual(await pendingInputs(root),[]);
  assert.equal(session.brainstormActive,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Plan/Projet.md',contenu:'Interdit après la file.'})).isError,true);
  assert.deepEqual(brainstormRequest(sent.at(-1).input[0].text),{folder:'Brainstorm'},'Une demande en attente ne reste pas enfermée dans la note du tour précédent.');
  assert.equal((await call(FILE_TOOL,{chemin:path,contenu:'Ne pas écraser la note précédente.'})).isError,true);
  const next=await call(FILE_TOOL,{chemin:'Brainstorm/Suite.md',contenu:'Une réponse distincte au nouvel angle.'});assert.equal(next.isError,false,next.content[0].text);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(sent.length,2,'Aucune intégration cachée ne démarre après le brainstorm.');
  assert.equal(session.status,'');
  assert.equal(session.brainstormActive,true,'Le fil reste Brainstorm une fois la tâche terminée.');
  const human=generated+'\n(((Repars de cette rivalité, avec une autre piste.)))\n';
  await writeFile(join(root,path),human);
  const plan=planRevision(path,human,generated,'Sans reprendre le plan.',true);
  const prompt=await revisionPrompt(root,folders,path,versions,'Sans reprendre le plan.',plan);
  assert.equal(brainstormRequest(prompt).document,path);
  assert.deepEqual(revisionRequest(prompt),{path,details:'Sans reprendre le plan.',wholeChapterRequested:true});
  await session.send(prompt,executable,root,thread.id,plan);
  const revisedPayload=JSON.parse(sent.at(-1).input[0].text.split('<!-- orelius:material-search -->\n')[1]);
  assert.ok(revisedPayload.exploration.synthesePrecedente.includes('mécanisme de contradiction'),'La préparation revient au tour suivant.');
  assert.ok(revisedPayload.exploration.texteAExaminer.includes('(((Repars'),'Les annotations restent transmises comme critiques, séparément des sources.');
  for(let index=0;index<17;index++) {const id=await recordInput(root,folders,BRAINSTORM_INPUT+'Retour '+index);await bindInput(root,folders,id,thread.id,'ancien-'+index);}
  const firstPage=await brainstormContext(root,{folder:'Brainstorm',document:path},thread.id);
  assert.equal(firstPage.pages,2);
  const older=await call(BRAINSTORM_TOOL,{page:1});assert.equal(older.isError,false);
  assert.ok(JSON.parse(older.content[0].text).retours.some(input=>input.id===positive),'Les anciens exemples restent accessibles après pagination.');
  assert.equal((await call(BRAINSTORM_TOOL,{page:9})).isError,true);
  const revised='# Construction\n\nUne autre piste de rivalité, à discuter.\n';
  const result=await call(FILE_TOOL,{chemin:path,contenu:revised});
  assert.equal(result.isError,false,result.content[0].text,'La révision ne réclame pas une écriture dans Connaissances.');
  const archive=JSON.parse(result.content[0].text).archives.find(file=>file.endsWith('-h.md'));
  assert.equal(await readFile(join(root,archive),'utf8'),human);
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Plan/Projet.md',contenu:'Interdit même après lecture.'})).isError,true);
  for(const [file,text] of Object.entries(untouched))assert.equal(await readFile(join(root,file),'utf8'),text);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(sent.length,3);
  await mkdir(join(root,'Manuscript/Brainstorm'),{recursive:true});
  await session.send(withBrainstorm('Une nouvelle exploration.',{folder:'Manuscript/Brainstorm'}),executable,root,thread.id);
  const alternative=await call(FILE_TOOL,{chemin:'Manuscript/Brainstorm/Piste.md',contenu:'Piste exploratoire.'});
  assert.equal(alternative.isError,false,alternative.content[0].text);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  const beforeFollowup=sent.length;
  await session.send('Et sous un autre angle, pourquoi cette rivalité ?',executable,root,thread.id);
  const followup=JSON.parse(sent.at(-1).input[0].text.split('<!-- orelius:material-search -->\n')[1]);
  assert.deepEqual(followup.brainstorm,{folder:'Manuscript/Brainstorm'});
  assert.equal(followup.inputsAuteur,undefined);
  assert.match(followup.instruction,/Réponds à toutes les questions de l’auteur dans la note/);
  assert.match(followup.methode,/nouvelle note de réponse/);
  assert.deepEqual(await pendingInputs(root),[],'Un suivi ordinaire du fil reste un apport exploratoire.');
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Plan/Projet.md',contenu:'Toujours interdit.'})).isError,true);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(session.canRetry,true);assert.equal(session.failure.message,t('brainstormResponseMissing'),'Une réponse sans note ne passe pas pour une tâche terminée.');
  await session.retry(executable,root,thread.id);
  const retry=await call(FILE_TOOL,{chemin:'Manuscript/Brainstorm/Autre angle.md',contenu:'La réponse complète, avec ses raisons, est dans cette nouvelle note.'});
  assert.equal(retry.isError,false,retry.content[0].text);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(session.failure,null);assert.equal(session.brainstormActive,true);assert.equal(sent.length,beforeFollowup+2);

  const history=[{id:'origine',messages:[{role:'user',text:withBrainstorm('Pistes initiales.',{folder:'Brainstorm'})}]},
    {id:'suivi',messages:[{role:'user',text:'Un autre angle ?'}]},
    {id:'interne',messages:[{role:'user',text:INPUT_REVIEW_PREFIX+'Ancien suivi technique.'}]}];
  session.restoreBrainstorm(history);assert.equal(session.brainstormDirectory,'Brainstorm','La reprise du fil conserve son mode, même après un ancien suivi sans marqueur.');
  const initialize=session.initialize;
  session.connected=false;
  session.initialize=async()=>{session.restoreBrainstorm(history);session.connected=true;};
  session.brainstorm=null;
  await session.send('Une question après reconnexion.',executable,root,thread.id);
  assert.deepEqual(brainstormRequest(sent.at(-1).input[0].text),{folder:'Brainstorm'},'Le mode restauré est appliqué avant l’envoi et avant l’enregistrement dans Inputs.');
  assert.deepEqual(await pendingInputs(root),[]);
  const resumed=await call(FILE_TOOL,{chemin:'Brainstorm/Reconnexion.md',contenu:'Une réponse dans la note après reconnexion.'});assert.equal(resumed.isError,false,resumed.content[0].text);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  session.initialize=initialize;
  const chapter='Manuscript/001.md',chapterText=untouched[chapter];
  const chapterPlan=planRevision(chapter,chapterText,chapterText,'Reprendre le chapitre.',true);
  const chapterPrompt=await revisionPrompt(root,folders,chapter,versions,'Reprendre le chapitre.',chapterPlan);
  session.restoreBrainstorm([...history,{id:'revision-explicite',messages:[{role:'user',text:chapterPrompt}]}]);assert.equal(session.brainstormActive,false);
  session.restoreBrainstorm(history);
  await session.send(chapterPrompt,executable,root,thread.id,chapterPlan);assert.equal(session.brainstormActive,false,'Réviser explicitement un chapitre reste une action distincte.');
  const otherSession=new ChatSession(()=>{},async()=>{});assert.equal(otherSession.brainstormActive,false,'Un autre projet ne reprend pas ce mode.');
  session.restoreBrainstorm([]);assert.equal(session.brainstormActive,false);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'interrupted'}},root);
  session.restoreBrainstorm(history);await session.newConversation();assert.equal(session.brainstormActive,false,'Une remise à zéro ne conserve pas le mode de l’ancien fil.');
 } finally {await session.disconnect();await rm(root,{recursive:true,force:true});}
}

async function checkMovedLinks(){
 const source=await readFile('plugin/src/main.ts','utf8');
 const {code}=await transform('export default class Harness {'+source.slice(source.indexOf('  async openFile(path:')),{loader:'ts',format:'cjs'});
 class FileSystemAdapter {constructor(root){this.root=root;}getBasePath(){return this.root;}}
 class TFile {constructor(path){this.path=path;}}
 const module={exports:{}};
 new Function('FileSystemAdapter','TFile','realpath','resolve','relative','isAbsolute','brainstormFolder','object','t','module','exports',code)(FileSystemAdapter,TFile,realpath,resolve,relative,isAbsolute,brainstormFolder,value=>value??{},t,module,module.exports);
 const root=await mkdtemp(join(tmpdir(),'orelius-brainstorm-link-'));
 try{
  await mkdir(join(root,'Brainstorm'));await writeFile(join(root,'Brainstorm/Piste.md'),'Note déplacée.');
  const opened=[],plugin=new module.exports.default();
  Object.assign(plugin,{settings:folders,workingDirectory:async()=>root,app:{vault:{adapter:new FileSystemAdapter(root),getAbstractFileByPath:path=>new TFile(path)},workspace:{getLeaf:()=>({openFile:async file=>opened.push(file.path)})}}});
  await plugin.openFile('Bible/Brainstorm/Piste.md');assert.equal(opened.at(-1),'Brainstorm/Piste.md','Un bouton d’une ancienne réponse retrouve la note déplacée.');
  await plugin.openFile('Brainstorm/Piste.md');assert.equal(opened.at(-1),'Brainstorm/Piste.md');
  await mkdir(join(root,'Bible/Brainstorm'),{recursive:true});await writeFile(join(root,'Bible/Brainstorm/Piste.md'),'Ancien projet non migré.');
  await plugin.openFile('Bible/Brainstorm/Piste.md');assert.equal(opened.at(-1),'Bible/Brainstorm/Piste.md','Un ancien chemin encore présent reste prioritaire.');
  await assert.rejects(plugin.openFile('Bible/Brainstorm/Absente.md'),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
}

async function checkSelectedDocument(){
 const source=await readFile('plugin/src/main.ts','utf8');
 const methods=source.slice(source.indexOf('  get brainstormDirectory()'),source.indexOf('  reactionFor('))
  +source.slice(source.indexOf('  async send(text:'),source.indexOf('  async compareVersions('));
 const {code}=await transform(`export default class Harness {${methods}}`,{loader:'ts',format:'cjs'});
 class TFile{constructor(path){this.path=path;}};
 const module={exports:{}};
 new Function('TFile','brainstormFolder','chapterPath','revisionDocumentPath','planRevision','readProjectFile','revisionProtections','revisionPrompt','withBrainstorm','withContext','t','module','exports',code)(
  TFile,brainstormFolder,chapterPath,revisionDocumentPath,planRevision,readProjectFile,revisionProtections,revisionPrompt,withBrainstorm,withContext,t,module,module.exports);
 const root=await mkdtemp(join(tmpdir(),'orelius-selected-note-'));
 try {
  const selected='Brainstorm/Juillet.md',other='Manuscript/001.md';
  for(const path of [selected,other]){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'Texte conservé. (((Développe ce passage.)))');}
  const notes=new Map([selected,other].map(path=>['Roman/'+path,new TFile('Roman/'+path)]));
  const received=[];
  const plugin=new module.exports.default();
  Object.assign(plugin,{settings:{...folders,folder:'Roman',codexVersions:{},threadId:'session'},navigation:{path:'Roman/'+selected},settingsWrite:Promise.resolve(),views:[],
   session:{busy:false,items:[{modifiedPaths:[selected]}],send:async(...args)=>received.push(args)},
   app:{vault:{getAbstractFileByPath:path=>notes.get(path)},workspace:{getActiveFile:()=>notes.get('Roman/'+other)}},
   refreshCorrections:async()=>root,workingDirectory:async()=>root,checkSavedDirectory(){},lockNote(){},releaseNoteLocks(){},contextForRequest:()=>null});
  assert.equal(plugin.revisionDocument,selected,'La sélection dans l’explorateur prime sur l’ancien éditeur actif.');
  assert.equal(plugin.revisionChapter,null);
  await plugin.send('Ajoute les deux matériaux.',selected);
  const [prompt,,,,plan]=received[0];
  assert.equal(plan.path,selected);assert.equal(brainstormRequest(prompt).document,selected);
  assert.equal(revisionRequest(prompt).path,selected);
  for(const path of ['Roman/Brainstorm','Roman/Bible','Roman','Roman/config.md','Ailleurs/'+other,null]){
   plugin.navigation.path=path;assert.equal(plugin.revisionDocument,null,'Un dossier ou une autre sélection ne reprend pas la dernière note.');assert.equal(plugin.revisionChapter,null);
  }
  plugin.navigation.path='Roman/'+other;
  assert.equal(plugin.revisionDocument,other);assert.equal(plugin.revisionChapter,other);assert.equal(plugin.brainstormDirectory,null);
  plugin.session.brainstormDirectory='Brainstorm';
  await plugin.send('Un nouvel angle alors que je consulte un chapitre.');
  assert.deepEqual(brainstormRequest(received.at(-1)[0]),{folder:'Brainstorm'});assert.equal(received.at(-1)[4],undefined);
  plugin.navigation.path='Roman/'+selected;
  await plugin.send('Une autre question sur cette piste.');
  assert.deepEqual(brainstormRequest(received.at(-1)[0]),{folder:'Brainstorm'});assert.equal(received.at(-1)[4],undefined,'Le message ordinaire ouvre une nouvelle réponse ; seul Réviser cible la note.');
  plugin.navigation.path='Roman/Brainstorm';
  await plugin.send('Une nouvelle exploration.');
  assert.deepEqual(brainstormRequest(received.at(-1)[0]),{folder:'Brainstorm'});
 }finally{await rm(root,{recursive:true,force:true});}
}

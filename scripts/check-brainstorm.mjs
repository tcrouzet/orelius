import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {brainstormFolder,brainstormRequest,withBrainstorm,checkBrainstormWrite,BRAINSTORM_INPUT} from '../plugin/src/brainstorm.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {chapterPath,revisionDocumentPath,revisionPrompt,revisionRequest,archiveWithCorrections,captureCodexVersions} from '../plugin/src/corrections.ts';
import {planRevision} from '../plugin/src/revision.ts';
import {ChatSession} from '../plugin/src/session.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {pendingInputs,INPUTS_PATH} from '../plugin/src/author-inputs.ts';
import {authorPrompt} from '../plugin/src/conversation.ts';
import {FILE_TOOL,CONTEXT_TOOL,REVIEW_TOOL,WORKSHOP_TOOL,INPUTS_TOOL,LINK_TOOL,STATE_TOOL} from '../plugin/src/mcp.ts';

export async function checkBrainstorm(executable,taskPrompts) {
 for(const folder of ['Bible/Brainstorm','Manuscript/Brainstorm']) {
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
 for(const path of ['Bible/Brainstorming','Bible/Brainstorm/../Plan.md','../Bible/Brainstorm','Model/Brainstorm'])assert.equal(brainstormFolder(path,folders),null);
 const root=await mkdtemp(join(tmpdir(),'orelius-brainstorm-'));
 const versions={},sent=[];
 const path='Bible/Brainstorm/Construction.md';
 const generated='# Construction\n\nUne piste autour du moteur secret.\n';
 const session=new ChatSession(()=>{},async()=>{},(cwd,changes)=>archiveWithCorrections(cwd,folders,changes,versions,()=>{}),
  ()=>({...folders,taskPrompts,activeChapter:'Manuscript/001.md',codexVersions:{[root]:versions}}),
  async(cwd,changes)=>Object.assign(versions,await captureCodexVersions(cwd,folders,changes)));
 try {
  await prepareProject(root,folders);
  const untouched={'Bible/Plan/Projet.md':'Le plan conservé.','Manuscript/001.md':'Le chapitre conservé.','Model/Source.md':'Le moteur secret est une rivalité familiale.'};
  for(const [file,text] of Object.entries(untouched))await writeFile(join(root,file),text);
  await session.connect(executable,root,'');
  const native=session.client.request.bind(session.client);
  const {thread}=await native('thread/start',{cwd:root,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',approvalsReviewer:'user'});
  session.threadId=thread.id;
  session.client.request=async(method,args)=>{
   if(method==='turn/start'){sent.push(args);return {turn:{id:'tour-'+sent.length}};}
   if(method==='turn/steer')return {turnId:args.expectedTurnId};
   if(method==='thread/turns/list')return {data:[],nextCursor:null};
   return native(method,args);
  };
  const call=(tool,args)=>native('mcpServer/tool/call',{threadId:thread.id,server:'orelius',tool,arguments:args});
  await session.send(withBrainstorm('Explorons le moteur secret.',{folder:'Bible/Brainstorm'}),executable,root,thread.id);
  const payload=JSON.parse(sent[0].input[0].text.split('<!-- orelius:material-search -->\n')[1]);
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
  await writeFile(join(root,'Bible/Brainstorm/Existant.md'),'Exploration antérieure.');
  const existing=await call(FILE_TOOL,{chemin:'Bible/Brainstorm/Existant.md',contenu:'Ne pas remplacer.'});
  assert.equal(existing.isError,true);assert.match(existing.content[0].text,/Réviser/);
  assert.equal(await readFile(join(root,'Bible/Brainstorm/Existant.md'),'utf8'),'Exploration antérieure.');
  const creation=await call(FILE_TOOL,{chemin:path,contenu:generated});
  assert.equal(creation.isError,false,creation.content[0].text);assert.ok(JSON.parse(creation.content[0].text).archives.length);
  const csvPath='Bible/Brainstorm/Construction.csv';
  const csv='Numero;Titre\r\n'+Array.from({length:140},(_,index)=>`${index+1};"Élément ${index+1}"\r\n`).join('');
  const exported=await call(FILE_TOOL,{chemin:csvPath,contenu:csv});
  assert.equal(exported.isError,false,exported.content[0].text);
  assert.equal(await readFile(join(root,csvPath),'utf8'),csv);
  assert.equal(await readFile(join(root,JSON.parse(exported.content[0].text).archives[0]),'utf8'),csv);
  assert.equal((await call(FILE_TOOL,{chemin:csvPath,contenu:'Écrasement interdit.'})).isError,true);
  assert.equal(await readFile(join(root,csvPath),'utf8'),csv,'Un export existant reste préservé.');
  assert.equal((await call(FILE_TOOL,{chemin:'Model/tableau.csv',contenu:csv})).isError,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Brainstorm/script.js',contenu:'code'})).isError,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Brainstorm/Autre.md',contenu:'Autre sujet.'})).isError,true,'Une tâche ne réécrit pas un autre brainstorm.');
  await session.steer('Garde cette piste ouverte.');
  assert.deepEqual(await pendingInputs(root),[],'Les échanges exploratoires ne déclenchent pas une intégration future à la Bible.');
  assert.ok(session.queuedMessages.some(item=>item.text.includes('Garde cette piste ouverte.')));
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(sent.length,2,'Seule la demande en attente démarre après le brainstorm.');
  assert.ok((await readFile(join(root,INPUTS_PATH),'utf8')).includes('Garde cette piste ouverte.'));
  assert.deepEqual(await pendingInputs(root),[]);
  assert.equal(session.brainstormActive,true);
  assert.equal((await call(FILE_TOOL,{chemin:'Bible/Plan/Projet.md',contenu:'Interdit après la file.'})).isError,true);
  await session.notification('turn/completed',{threadId:thread.id,turn:{status:'completed'}},root);
  assert.equal(sent.length,2,'Aucune intégration cachée ne démarre après le brainstorm.');
  assert.equal(session.status,'');
  const human=generated+'\n(((Repars de cette rivalité, avec une autre piste.)))\n';
  await writeFile(join(root,path),human);
  const plan=planRevision(path,human,generated,'Sans reprendre le plan.',true);
  const prompt=await revisionPrompt(root,folders,path,versions,'Sans reprendre le plan.',plan);
  assert.equal(brainstormRequest(prompt).document,path);
  assert.deepEqual(revisionRequest(prompt),{path,details:'Sans reprendre le plan.',wholeChapterRequested:true});
  await session.send(prompt,executable,root,thread.id,plan);
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
 } finally {await session.disconnect();await rm(root,{recursive:true,force:true});}
}

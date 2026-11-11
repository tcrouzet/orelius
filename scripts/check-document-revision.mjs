import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DEFAULT_PROJECT_FOLDERS} from '../plugin/src/settings.ts';
import {archiveWithCorrections, captureCodexVersions, refreshCorrections, revisionPrompt, revisionRequest} from '../plugin/src/corrections.ts';
import {planRevision, checkRevision, revisionMarks} from '../plugin/src/revision.ts';
import {readProjectFile, writeProjectFile} from '../plugin/src/project-files.ts';
import {authorPrompt} from '../plugin/src/conversation.ts';
import {ChatSession} from '../plugin/src/session.ts';
import {FILE_TOOL, CONTEXT_TOOL} from '../plugin/src/mcp.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {searchMaterials} from '../plugin/src/material-search.ts';
import {readEditorialContext} from '../plugin/src/editorial-context.ts';

export async function checkDocumentRevision() {
 const root=await mkdtemp(join(tmpdir(),'orelius-document-revision-'));
 const folders={...DEFAULT_PROJECT_FOLDERS,bibleFolder:'Univers',modelFolder:'Sources',archiveFolder:'Versions'};
 const path='Univers/Brainstorm/Le désir.md';
 const generated='# Le désir\n\nElle veut partir.\n\nUne piste à discuter.\n';
 const human=generated.replace('Elle veut partir.','Elle veut partir. (((Pourquoi ? Développe sa contradiction.)))');
 const revised='# Le désir\n\nElle veut partir, mais refuse de laisser sa sœur seule.\n\nUne piste à discuter.\n';
 try {
  await mkdir(join(root,'Univers/Brainstorm'),{recursive:true});
  await writeFile(join(root,path),human);
  await mkdir(join(root,'Univers/Plan'),{recursive:true});
  await writeFile(join(root,'Univers/Plan/Projet.md'),'Le désir de partir détermine la construction.');
  const plan=planRevision(path,human,generated,'',true);
  const prompt=await revisionPrompt(root,folders,path,{[path]:generated},'',plan);
  assert.match(prompt,/Révise le document/);
  assert.ok(prompt.includes(path));assert.ok(prompt.includes('Pourquoi ? Développe sa contradiction.'));
  assert.equal(prompt.includes('preparer_chapitre'),false,'Une fiche ne doit pas passer par la préparation narrative.');
  assert.equal(prompt.includes('nouchi'),false,'La voix du récit ne doit pas être imposée à une fiche.');
  const request=revisionRequest(prompt);
  assert.deepEqual(request,{path,details:'',wholeChapterRequested:true});
  assert.ok(authorPrompt(prompt).includes(path));assert.equal(authorPrompt(prompt).includes('Zones autorisées'),false);
  assert.equal(authorPrompt(prompt).includes('chapitre'),false);
  const retryPlan=planRevision(path,human,generated,request.details,request.wholeChapterRequested);
  assert.equal(await revisionPrompt(root,folders,path,{[path]:generated},request.details,retryPlan),prompt,'La relance conserve la portée de la révision.');
  await mkdir(join(root,'Univers/Characters'),{recursive:true});
  await writeFile(join(root,'Univers/Characters/Lina.md'),'Lina veut partir. Elle refuse de laisser sa sœur.\n');
  const research=await searchMaterials(root,folders,prompt);
  assert.ok(research.matches.some(match=>match.path===path),'La note annotée est le point de départ de la recherche.');
  assert.equal(research.matches.find(match=>match.path===path).role,'workshop-intentions-not-canon','Une discussion n’établit pas les faits du récit.');
  assert.ok(research.matches.some(match=>match.path==='Univers/Characters/Lina.md'),'Les références liées au contenu restent recherchées sans précision dans le chat.');
  const context=(await readEditorialContext(root,folders,{[path]:generated},undefined,prompt)).flatMap(page=>JSON.parse(page).sources);
  assert.ok(context.some(source=>source.path===path&&source.content===human));
  assert.ok(context.some(source=>source.role==='correction-diff'&&source.content.includes('Pourquoi ?')));
  const versions=await captureCodexVersions(root,folders,[{path}]);
  assert.equal(versions[path],human,'La référence IA couvre aussi la Bible.');
  assert.deepEqual(await captureCodexVersions(root,folders,[{path:join(root,path)}]),versions,'Les chemins absolus internes sont normalisés comme pour les chapitres.');
  assert.deepEqual(await captureCodexVersions(root,folders,[{path:`./${path}`}]),versions);
  versions[path]=generated;
  await refreshCorrections(root,folders,versions);
  const reports=(await readdir(join(root,'Tracking'))).filter(name=>/^\d{4}-/.test(name));
  assert.equal(reports.length,1);assert.ok((await readFile(join(root,'Tracking',reports[0]),'utf8')).includes('Pourquoi ?'));
  assert.throws(()=>checkRevision(plan,human,revised),/intention/);
  plan.intentRecorded=true;
  const archive=(cwd,changes)=>archiveWithCorrections(cwd,folders,changes,versions,()=>{});
  const copies=await writeProjectFile(root,path,revised,await readProjectFile(root,path),folders.archiveFolder,archive,()=>{},true,plan);
  assert.equal(copies.length,2);assert.ok(copies[0].endsWith('-h.md'));
  assert.equal(await readFile(join(root,copies[0]),'utf8'),human);
  assert.equal(await readFile(join(root,copies[1]),'utf8'),revised);
  assert.ok(revisionMarks({before:human,after:revised},revised).length);
  const longSource=Array.from({length:2300},(_,index)=>`Ancien point ${index}.\n`).join('');
  const longRevised=Array.from({length:2300},(_,index)=>`Nouvelle proposition ${index}.\n`).join('');
  const whole=planRevision(path,longSource,longSource,'',true);
  whole.intentRecorded=true;
  assert.doesNotThrow(()=>checkRevision(whole,longSource,longRevised),'Une révision intégrale ne dépend pas de la précision d’un diff par paragraphes.');
  assert.ok(revisionMarks({before:longSource,after:longRevised},longRevised).length,'Le surlignage reste disponible après une grande réécriture.');
  assert.doesNotThrow(()=>planRevision(path,longRevised,longSource,'',true));
  assert.throws(()=>checkRevision({...whole,wholeChapter:false,ranges:[{from:0,to:20}]},longSource,longRevised),/diff|Diff/,'Une portée partielle ne bénéficie pas du remplacement intégral.');
  assert.throws(()=>checkRevision(whole,longSource+'Correction humaine.',longRevised),/changé/);
  assert.throws(()=>checkRevision(whole,longSource,longRevised+'==interdit=='),/balise/);
  const longPath='Univers/Brainstorm/Inventaire.md';
  await writeFile(join(root,longPath),longRevised);
  const compactPrompt=await revisionPrompt(root,folders,longPath,{[longPath]:longSource},'Conserve la double chronologie.',planRevision(longPath,longRevised,longSource,'',true));
  assert.ok(compactPrompt.length<16000,'La demande n’embarque pas l’inventaire et son diff intégral.');
  assert.ok(compactPrompt.includes('Tracking/suivi.md'),'Le relevé complet reste accessible.');
  assert.deepEqual(revisionRequest(compactPrompt),{path:longPath,details:'Conserve la double chronologie.',wholeChapterRequested:true});
  assert.equal((await captureCodexVersions(root,folders,[{path}]))[path],revised);
  for(const target of ['Univers/Characters/Quelqu’un.md','Univers/Style/Narration.md','Univers/Seeds/idée.md','Sources/notes.md','analyse.md','Tracking/Prompts/idees.md','Tracking/Connaissances.md']) {
   await mkdir(join(root,target,'..'),{recursive:true});await writeFile(join(root,target),human);
   assert.ok((await revisionPrompt(root,folders,target,{},'Clarifie les points annotés.')).includes(JSON.stringify(target)),target);
  }
  for(const target of ['../ailleurs.md','Univers/../ailleurs.md','Versions/ancien.md','_Archives/ancien.md','.obsidian/config.md','AGENTS.md','config.md','Tracking/Conversation.md','Tracking/Structure.md','Tracking/Inputs.md','Manuscript/Plan/ancien.md']) {
   await assert.rejects(revisionPrompt(root,folders,target,{},''),/note|document/i,target);
  }
 } finally {await rm(root,{recursive:true,force:true});}
}

export async function checkDocumentRevisionProtocol(executable,taskPrompts) {
 const root=await mkdtemp(join(tmpdir(),'orelius-document-mcp-'));
 const folders={...DEFAULT_PROJECT_FOLDERS,bibleFolder:'Univers'};
 const path='Univers/Plan/Le désir.md',versions={},locked=[];
 const generated='# Le désir\n\n## Partir\n\nElle veut partir.\n\n## Rester\n\nUne piste à discuter.\n';
 const human=generated.replace('Une piste à discuter.','(((Développe cette contradiction.)))');
 const revised=generated.replace('Une piste à discuter.','Elle refuse de laisser sa sœur seule. Cette obligation contrarie son désir de partir.');
 const session=new ChatSession(()=>{},async()=>{},
  (cwd,changes)=>archiveWithCorrections(cwd,folders,changes,versions,()=>{}),
  ()=>({...folders,activeChapter:'Manuscript/001.md',taskPrompts,codexVersions:{[root]:versions},lockNote:note=>locked.push(note)}),
  async(cwd,changes)=>Object.assign(versions,await captureCodexVersions(cwd,folders,changes)),undefined,
  async()=>{assert.fail('Une note de discussion ne demande aucun contrôle de publication narrative.');},
  async()=>{assert.fail('Une note de discussion ne demande aucun contrôle de prérequis narratifs.');});
 try {
  await prepareProject(root,folders);
  await session.connect(executable,root,'');
  const native=session.client.request.bind(session.client);
  const {thread}=await native('thread/start',{cwd:root,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',approvalsReviewer:'user'});
  session.threadId=thread.id;
  const requests=[];
  session.client.request=async(method,args)=>{
   if(method!=='turn/start')return native(method,args);
   requests.push(args);return {turn:{id:`turn-${requests.length}`}};
  };
  const call=(tool,args)=>native('mcpServer/tool/call',{threadId:thread.id,server:'orelius',tool,arguments:args});
  await session.send('Discutons de son désir de partir.','codex',root,thread.id);
  const policy=JSON.parse(requests[0].input[0].text.split('<!-- orelius:material-search -->\n')[1]).reponseDansUneNote;
  assert.equal(policy.dossier,'Univers');assert.ok(policy.consigne.includes('Univers/Brainstorm'));
  assert.ok(policy.consigne.includes('ecrire_fichier'));assert.ok(policy.consigne.includes('Réviser'));
  assert.equal(authorPrompt(requests[0].input[0].text),'Discutons de son désir de partir.');
  const creation=await call(FILE_TOOL,{chemin:path,contenu:generated});
  assert.equal(creation.isError,false,creation.content[0].text);assert.equal(versions[path],generated);
  session.busy=false;session.turnId='';
  await writeFile(join(root,path),human);
  await mkdir(join(root,'Univers/Plan'),{recursive:true});
  await writeFile(join(root,'Univers/Plan/Projet.md'),'Le désir de partir détermine la construction.');
  await refreshCorrections(root,folders,versions);
  const plan=planRevision(path,human,versions[path],'',true);
  const prompt=await revisionPrompt(root,folders,path,versions,'',plan);
  await session.send(prompt,'codex',root,thread.id,plan);
  assert.equal(session.editorialChapter,undefined,'La fiche ciblée n’hérite pas du chapitre actif.');
  const planWrite=await call(FILE_TOOL,{chemin:'Univers/Plan/Projet.md',contenu:'Le désir de partir rencontre l’obligation de rester auprès de sa sœur.'});
  assert.equal(planWrite.isError,false,planWrite.content[0].text);
  assert.ok(JSON.parse(planWrite.content[0].text).archives.length,'La référence déjà transmise dans la recherche peut être harmonisée avec archivage.');
  const referencePath='Univers/Characters/Secondaire.md';
  const reference=await call(CONTEXT_TOOL,{reference:referencePath});
  assert.equal(reference.isError,false,reference.content[0].text);
  const referenceWrite=await call(FILE_TOOL,{chemin:referencePath,contenu:'Une piste ouverte : la sœur pourrait avoir besoin de son aide.'});
  assert.equal(referenceWrite.isError,false,referenceWrite.content[0].text);
  for(const reference of ['../ailleurs.md','Manuscript/001.md','Tracking/Inputs.md','Univers/../config.md']) {
   const refused=await call(CONTEXT_TOOL,{reference});
   assert.equal(refused.isError,true,reference);
  }
  const refused=await call(FILE_TOOL,{chemin:path,contenu:revised});
  assert.equal(refused.isError,true);assert.match(refused.content[0].text,/intention/);
  assert.equal(await readFile(join(root,path),'utf8'),human);
  const context=await call(CONTEXT_TOOL,{page:0});
  assert.equal(context.isError,false,context.content[0].text);
  assert.equal(session.sceneContext,null,'La consultation générale ne fabrique pas de scène pour la fiche.');
  const intent=await call(FILE_TOOL,{chemin:'Tracking/Connaissances.md',contenu:'## Consignes actives\n\nDévelopper la contradiction du désir de partir, sans la présenter comme une décision de l’auteur.\n'});
  assert.equal(intent.isError,false,intent.content[0].text);
  const result=await call(FILE_TOOL,{chemin:path,contenu:revised});
  assert.equal(result.isError,false,result.content[0].text);
  assert.equal(versions[path],revised);assert.ok(locked.includes(path.toLowerCase()));
  const written=JSON.parse(result.content[0].text);
  const humanArchive=written.archives.find(name=>name.endsWith('-h.md'));
  assert.ok(humanArchive);assert.equal(await readFile(join(root,humanArchive),'utf8'),human);
  assert.equal(await readFile(join(root,path),'utf8'),revised);
  const event=session.items.find(item=>item.modifiedPaths?.includes(path)&&item.writtenVersions?.some(version=>version.content===revised));
  assert.ok(event,'La réponse peut proposer l’accès à la note effectivement modifiée.');
  const unrelated=await call(FILE_TOOL,{chemin:'Manuscript/001.md',contenu:'Hors demande.'});
  assert.equal(unrelated.isError,true);assert.match(unrelated.content[0].text,/révision/);
  session.busy=false;session.turnId='';
  const memory='Tracking/Connaissances.md',memorySource=await readProjectFile(root,memory);
  const memoryPlan=planRevision(memory,memorySource.text,versions[memory],'Clarifie cette consigne.',true);
  await session.send(await revisionPrompt(root,folders,memory,versions,'Clarifie cette consigne.',memoryPlan),'codex',root,thread.id,memoryPlan);
  const provenance=await call(FILE_TOOL,{chemin:'Tracking/Provenance.md',contenu:'# Provenance\n\nClarifier la consigne de connaissance à la demande de l’auteur.\n'});
  assert.equal(provenance.isError,false,provenance.content[0].text);
  const memoryWrite=await call(FILE_TOOL,{chemin:memory,contenu:memorySource.text+'\nUne proposition ne vaut pas décision.\n'});
  assert.equal(memoryWrite.isError,false,memoryWrite.content[0].text);
 } finally {await session.disconnect();await rm(root,{recursive:true,force:true});}
}

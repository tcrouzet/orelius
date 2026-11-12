import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rename,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {transform} from 'esbuild';
import {ChatSession} from '../plugin/src/session.ts';
import {errorText} from '../plugin/src/codex.ts';
import {loadSettings,applySettings,PROJECT_FOLDER_KEYS,visibleFolder} from '../plugin/src/settings.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {archiveWithCorrections,captureCodexVersions,chapterPath} from '../plugin/src/corrections.ts';
import {renderAgent} from '../plugin/src/generate-agent.ts';
import {saveConversation} from '../plugin/src/conversation.ts';
import {externalSources} from '../plugin/src/external-sources.ts';
import {moveProjects,movedPath} from '../plugin/src/project-move.ts';
import {TASK_PROMPT_NAMES} from '../plugin/src/task-prompts.ts';
import {ChatNavigation} from '../plugin/src/navigation.ts';
import {t} from '../plugin/src/i18n.ts';

export async function checkProjectSessions(){
 const source=await readFile('plugin/src/main.ts','utf8');
 const methods=[
  source.slice(source.indexOf('  private projects ='),source.indexOf('  private requestContext:')),
  source.slice(source.indexOf('  private projectState('),source.indexOf('  async onload(')),
  source.slice(source.indexOf('  private navigate('),source.indexOf('  private hideChat(')),
  source.slice(source.indexOf('  private moveProjectFolders('),source.indexOf('  async testCodex(')),
  source.slice(source.indexOf('  private lockNote('),source.indexOf('  async openFile(')),
  source.slice(source.indexOf('  onunload('),source.indexOf('  async openChat(')),
 ].join('\n');
 const {code}=await transform(`export default class Harness {${methods}}`,{loader:'ts',format:'cjs'});
 const taskPrompts=Object.fromEntries(await Promise.all(TASK_PROMPT_NAMES.map(async name=>[name,await readFile(`prompts/${name}.md`,'utf8')])));
 class MarkdownView{}
 class NovelView{}
 class FileSystemAdapter{constructor(root){this.root=root;}getBasePath(){return this.root;}}
 const module={exports:{}};
 new Function('chapterPath','ChatSession','applySettings','archiveWithCorrections','captureCodexVersions','renderAgent','agentTemplate','taskPrompts','externalSources','parseYaml','saveConversation','MarkdownView','NovelView','FileSystemAdapter','PROJECT_FOLDER_KEYS','visibleFolder','moveProjects','movedPath','realpath','t','Notice','errorText','module','exports',code)(
  chapterPath,ChatSession,applySettings,archiveWithCorrections,captureCodexVersions,renderAgent,'Projet {folder}',taskPrompts,externalSources,()=>({}),saveConversation,MarkdownView,NovelView,FileSystemAdapter,PROJECT_FOLDER_KEYS,visibleFolder,moveProjects,movedPath,realpath,t,class{},errorText,module,module.exports);
 const root=await mkdtemp(join(tmpdir(),'orelius-parallel-'));
 const a='Alpha',b='Beta',path='Manuscript/001.md',cwdA=join(root,a),cwdB=join(root,b);
 const closed={a:0,b:0},opened=[];
 const target=new module.exports.default();
 try{
  const settings=loadSettings({folder:a,sessions:{[a]:{threadId:'thread-a',cwd:cwdA},[b]:{threadId:'thread-b',cwd:cwdB}}});
  for(const folder of [a,b]){await mkdir(join(root,folder));await prepareProject(join(root,folder),settings);await writeFile(join(root,folder,path),`Texte ${folder}.`);}
  Object.assign(target,{settings,settingsWrite:Promise.resolve(),pendingProjectMoves:[],views:new Set(),highlights:{refresh(){}},navigation:new ChatNavigation(`${a}/${path}`),
   saveData:async data=>writeFile(join(root,'data.json'),JSON.stringify(data)),prepareProject:async()=>{},configurationDirectory:()=>join(root,'.obsidian'),correctionTask:action=>action(),hideChat(){},
   openChat:async()=>{opened.push(target.settings.folder);},app:{vault:{adapter:new FileSystemAdapter(root)},workspace:{iterateAllLeaves(){},containerEl:{removeClass(){}}}}});
  const first=target.session;
  target.draft='Brouillon Alpha';
  first.connected=true;first.threadId='thread-a';
  first.client={request:async method=>{assert.equal(method,'turn/start');return {turn:{id:'turn-a'}};},stop:async()=>{closed.a++;}};
  await first.send('Examiner le projet Alpha.','codex',cwdA,'thread-a');
  assert.equal(first.busy,true);
  target.navigate(`${b}/${path}`);await target.navigation.pending;
  assert.deepEqual(opened,[b]);
  assert.equal(first.busy,true,'La tâche Alpha doit continuer pendant la navigation vers Beta.');assert.equal(closed.a,0,'Changer de dossier ne déconnecte pas la tâche précédente.');
  assert.equal(target.draft,'');target.draft='Brouillon Beta';
  const second=target.session;assert.notEqual(first,second);
  second.connected=true;second.threadId='thread-b';
  second.client={request:async method=>{assert.equal(method,'turn/start');return {turn:{id:'turn-b'}};},stop:async()=>{closed.b++;}};
  await second.send('Examiner le projet Beta.','codex',cwdB,'thread-b');
  assert.equal(first.running,true);assert.equal(second.running,true);
  await Promise.all([first.remember('thread-a',cwdA),second.remember('thread-b',cwdB)]);
  assert.equal(target.settings.threadId,'thread-b');assert.equal(target.settings.sessions[a].threadId,'thread-a');
  assert.equal(first.context().folder,a);assert.equal(second.context().folder,b);
  const editor=new MarkdownView();editor.file={path:`${b}/${path}`};editor.getViewData=()=> 'Brouillon Beta non enregistré';
  target.app.workspace.iterateAllLeaves=callback=>callback({view:editor});
  first.context().checkEditor(path,'Texte Alpha.');
  assert.throws(()=>second.context().checkEditor(path,'Texte Beta.'),/modifications dans l’éditeur/);
  target.app.workspace.iterateAllLeaves=()=>{};
  const changes=[{path,kind:{type:'update'}}];
  const archivesB=await readdir(join(cwdB,'Archives'),{recursive:true});
  const archived=await first.archive(cwdA,changes);
  assert.equal(await readFile(join(cwdA,archived[0]),'utf8'),'Texte Alpha.');
  assert.deepEqual(await readdir(join(cwdB,'Archives'),{recursive:true}),archivesB,'Archiver Alpha ne modifie aucune archive de Beta.');
  await Promise.all([first.written(cwdA,changes,{before:'Avant Alpha',after:'Texte Alpha.'}),second.written(cwdB,changes,{before:'Avant Beta',after:'Texte Beta.'})]);
  assert.equal(target.settings.codexVersions[cwdA][path],'Texte Alpha.');assert.equal(target.settings.codexVersions[cwdB][path],'Texte Beta.');
  assert.equal(target.settings.revisionHighlights[`${a}/${path}`].after,'Texte Alpha.');assert.equal(target.settings.revisionHighlights[`${b}/${path}`].after,'Texte Beta.');
  const turns=(id,label)=>[{id,date:new Date('2026-11-10T12:00:00Z'),completed:true,messages:[{id:`u-${id}`,role:'user',text:`Question ${label}`,paths:[]},{id:`r-${id}`,role:'assistant',phase:'final_answer',text:`Réponse ${label}`,paths:[]}]}];
  await Promise.all([first.conversation(cwdA,'thread-a',turns('a',a)),second.conversation(cwdB,'thread-b',turns('b',b))]);
  const historyA=await readFile(join(cwdA,'Tracking/Conversation.md'),'utf8'),historyB=await readFile(join(cwdB,'Tracking/Conversation.md'),'utf8');
  assert.ok(historyA.includes('Réponse Alpha'));assert.ok(!historyA.includes('Réponse Beta'));
  assert.ok(historyB.includes('Réponse Beta'));assert.ok(!historyB.includes('Réponse Alpha'));
  first.context().lockNote(path);second.context().lockNote(path);
  first.context().lockNote('Bible/Characters/A.md');
  first.inputReview=true;
  target.releaseNoteLocks(a);
  assert.equal(first.backgroundWork,true);
  assert.equal(first.busy,true);
  assert.deepEqual([...target.projectState(a).lockedNotes],[`${a}/Bible/Characters/A.md`.toLowerCase()],'Le chapitre est éditable pendant le suivi, la fiche encore modifiable reste protégée.');
  assert.equal(target.projectState(b).lockedNotes.size,1,'Le projet parallèle reste protégé.');
  first.inputReview=false;
  first.busy=false;target.releaseNoteLocks(a);
  assert.equal(target.projectState(a).lockedNotes.size,0);assert.equal(target.projectState(b).lockedNotes.size,1,'Terminer Alpha ne déverrouille pas les notes de Beta.');
  first.busy=true;
  await target.saveSettings({folder:a});
  assert.equal(target.session,first);assert.equal(target.draft,'Brouillon Alpha');assert.equal(first.running,true);assert.equal(second.running,true);
  assert.equal(target.settings.threadId,'thread-a');assert.equal(closed.a,0);assert.equal(closed.b,0);
  await assert.rejects(()=>target.saveSettings({modelFolder:'Sources'}),/Arrêtez la tâche/,'Les réglages communs restent protégés pendant les tâches.');
  await target.saveSettings({folder:b});
  target.setDraft('Brouillon sans session',`${a}/Sans session`);await target.settingsWrite;
  await rename(cwdA,join(root,'Renomme'));
  target.moveProjectFolders(a,'Renomme');await target.settingsWrite;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(first.connected,false);assert.equal(second.running,true);assert.equal(closed.a,1);assert.equal(closed.b,0,'Renommer Alpha ne coupe pas Beta.');
  assert.equal(target.projectSession('Renomme'),first);assert.equal(first.context().folder,'Renomme');assert.equal(target.projectState('Renomme').draft,'Brouillon Alpha');
  assert.equal(target.projectState('Renomme/Sans session').session,undefined);
  assert.equal(target.getDraft('Renomme/Sans session'),'Brouillon sans session');
  const reloaded=new module.exports.default();
  Object.assign(reloaded,{app:target.app,settings:loadSettings(JSON.parse(await readFile(join(root,'data.json'),'utf8'))),settingsWrite:Promise.resolve(),saveData:target.saveData});
  assert.equal(reloaded.getDraft('Renomme'),'Brouillon Alpha','Le brouillon survit au rechargement et au déplacement.');
  assert.equal(reloaded.getDraft(b),'Brouillon Beta','Chaque projet retrouve son brouillon.');
  assert.equal(reloaded.getDraft(a),'','L’ancien emplacement ne conserve pas un brouillon fantôme.');
  reloaded.setDraft('',b);
  await reloaded.settingsWrite;
  const reopened=new module.exports.default();Object.assign(reopened,{app:target.app,settings:loadSettings(JSON.parse(await readFile(join(root,'data.json'),'utf8')))});
  assert.equal(reopened.getDraft(b),'','Un brouillon envoyé ne réapparaît pas au prochain lancement.');
  const otherVault=new module.exports.default();Object.assign(otherVault,{app:{vault:{adapter:new FileSystemAdapter(root+'-other')}},settings:loadSettings(undefined)});
  assert.equal(otherVault.getDraft('Renomme'),'','Deux coffres ne partagent pas leurs brouillons.');
  const save=reloaded.saveData;
  reloaded.saveData=async()=>{throw Error('Stockage indisponible');};
  try { reloaded.setDraft('Texte conservé malgré une erreur disque',b);await reloaded.settingsWrite;assert.equal(reloaded.getDraft(b),'Texte conservé malgré une erreur disque'); }
  finally {reloaded.saveData=save;}
  reloaded.setDraft('Texte récupéré après une erreur disque',b);await reloaded.settingsWrite;
  assert.equal(JSON.parse(await readFile(join(root,'data.json'),'utf8')).drafts[b],'Texte récupéré après une erreur disque');

  let release,started;
  const writing=new Promise(resolve=>{started=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  reloaded.saveData=async data=>{started();await blocked;await save(data);};
  const setting=reloaded.saveSettings({codexPath:reloaded.settings.codexPath});
  await writing;
  reloaded.setDraft('Saisie pendant l’enregistrement','Renomme');
  reloaded.setDraft('Dernière saisie','Renomme');
  reloaded.setDraft('Autre projet',b);
  release();await setting;await reloaded.settingsWrite;
  const persisted=loadSettings(JSON.parse(await readFile(join(root,'data.json'),'utf8')));
  assert.equal(persisted.drafts.Renomme,'Dernière saisie');assert.equal(persisted.drafts[b],'Autre projet');
  assert.equal(persisted.sessions.Renomme.threadId,'thread-a','La sauvegarde des brouillons conserve les sessions.');


  target.onunload();await Promise.all([first.closing,second.closing]);
  assert.equal(closed.b,1,'Le déchargement du plugin arrête aussi les tâches en arrière-plan.');
 }finally{for(const project of target.projects.values())await project.session?.disconnect();await rm(root,{recursive:true,force:true});}
}

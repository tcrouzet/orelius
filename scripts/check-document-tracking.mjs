import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rename,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transform} from 'esbuild';
import {ChatNavigation} from '../plugin/src/navigation.ts';
import {trackDocuments,waitForTracking} from '../plugin/src/document-tracking.ts';
import {readData} from '../plugin/src/narrative-context.ts';
import {DEFAULT_PROJECT_FOLDERS as folders,loadSettings,PROJECT_FOLDER_KEYS,projectPaths,associatedFolder,visibleFolder} from '../plugin/src/settings.ts';
import {prepareProject} from '../plugin/src/archives.ts';
import {resetProject} from '../plugin/src/reset-project.ts';
import {newModelSources} from '../plugin/src/populate-state.ts';
import {WorkshopContext} from '../plugin/src/workshop.ts';

export async function checkDocumentTracking(){
 const root=await mkdtemp(join(tmpdir(),'orelius-documents-'));
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 try{
  await prepareProject(root,folders);
  for(const path of ['Model/source.md','Bible/Characters/Nora.md','Manuscript/Part 1/001.md','Tracking/configuration.md','config.md'])await put(path,'Version initiale.');
  const binary=Buffer.from([0,255,128,0,32]);await put('Model/image.png',binary);
  let changes=await trackDocuments(root,folders);
  assert.equal(changes.length,6);
  const image=changes.find(change=>change.path==='Model/image.png');
  assert.deepEqual(await readFile(join(root,image.after.file)),binary,'Les documents binaires sont suivis sans décodage.');
  assert.deepEqual(await trackDocuments(root,folders),[],'Le suivi ne se suit pas lui-même.');
  const workshop=new WorkshopContext();
  for(let page=0,pages=1;page<pages;page++)pages=JSON.parse(await workshop.page(root,folders,page)).pages;
  await workshop.finish(root,folders,()=>{});
  assert.deepEqual(await newModelSources(root,folders),[]);
  await trackDocuments(root,folders);
  await put('Model/source.md','Version corrigée par l’auteur.');
  await put('Bible/Characters/Nora.md','Personnage actualisé.');
  await rename(join(root,'Manuscript/Part 1/001.md'),join(root,'Manuscript/Part 1/002.md'));
  const results=await Promise.all([trackDocuments(root,folders),trackDocuments(root,folders)]);
  assert.equal(results.flat().length,4,'Les collectes concurrentes ne doublonnent pas les changements.');
  const updated=(await newModelSources(root,folders))[0];
  assert.equal(updated.previousContent,'Version initiale.');assert.equal(updated.content,'Version corrigée par l’auteur.');
  const revision=new WorkshopContext();
  for(let page=0,pages=1;page<pages;page++)pages=JSON.parse(await revision.page(root,folders,page)).pages;
  await put('Model/source.md','Nouvelle correction pendant Peupler.');
  await assert.rejects(()=>revision.finish(root,folders,()=>{}),/source a changé/);
  assert.equal((await newModelSources(root,folders)).length,1,'Un échec ne valide pas la source.');
  const revised=new WorkshopContext();
  for(let page=0,pages=1;page<pages;page++)pages=JSON.parse(await revised.page(root,folders,page)).pages;
  await revised.finish(root,folders,()=>{});assert.deepEqual(await newModelSources(root,folders),[]);
  await rm(join(root,'Model/source.md'));
  const removed=(await newModelSources(root,folders))[0];assert.equal(removed.deleted,true);
  assert.equal(removed.previousContent,'Nouvelle correction pendant Peupler.');
  const deletion=new WorkshopContext();
  for(let page=0,pages=1;page<pages;page++)pages=JSON.parse(await deletion.page(root,folders,page)).pages;
  await deletion.finish(root,folders,()=>{});assert.deepEqual(await newModelSources(root,folders),[]);
  const journal=readData(await readFile(join(root,'Tracking/Changements.md'),'utf8'));
  const original=journal.changes.find(change=>change.path==='Model/source.md');
  assert.equal(await readFile(join(root,original.after.file),'utf8'),'Version initiale.','Les anciennes versions restent exactes.');
  await put('Tracking/Changements.md','Journal modifié manuellement sans structure.');
  await assert.rejects(()=>trackDocuments(root,folders),/bloc JSON/);
  assert.equal(await readFile(join(root,'Tracking/Changements.md'),'utf8'),'Journal modifié manuellement sans structure.');
 }finally{await rm(root,{recursive:true,force:true});}
 await checkVaultReset();
}

async function checkVaultReset(){
 const root=await mkdtemp(join(tmpdir(),'orelius-reset-vault-'));
 const source=await readFile('plugin/src/main.ts','utf8');
 const method=source.slice(source.indexOf('  async resetActiveProject()'),source.indexOf('  private async populateWorkshop('));
 const refresh=source.slice(source.indexOf('  async refreshCorrections('),source.indexOf('  async connect(model?'));
 const observe=source.slice(source.indexOf('  private trackDocument('),source.indexOf('  private correctionTask<'));
 const open=source.slice(source.indexOf('  async openChat('),source.indexOf('  attach(view:'));
 const {code}=await transform(`export default class Harness {${method}${refresh}${observe}${open}}`,{loader:'ts',format:'cjs'});
 class TFolder{constructor(path){this.path=path;}}
 class MarkdownView{}
 class ResetProjectModal{result=Promise.resolve(true);open(){}}
 const module={exports:{}};
 new Function('t','ResetProjectModal','PROJECT_FOLDER_KEYS','MarkdownView','TFolder','waitForTracking','resetProject','Notice','readdir','join','associatedFolder','visibleFolder','VIEW_TYPE','module','exports',code)(
  key=>key,ResetProjectModal,PROJECT_FOLDER_KEYS,MarkdownView,TFolder,waitForTracking,resetProject,class{},readdir,join,associatedFolder,visibleFolder,'orelius-chat',module,module.exports);
 const entries=new Map(),prefix='Project/';
 const mkdirVault=async path=>{
  const parts=path.split('/');for(let index=1;index<=parts.length;index++){const parent=parts.slice(0,index).join('/');if(!entries.has(parent))entries.set(parent,new TFolder(parent));}
  await mkdir(join(root,path.slice(prefix.length)),{recursive:true});
 };
 try{
  await prepareProject(root,folders);
  for(const directory of [...projectPaths(folders),'Manuscript/Chapters','Manuscript/Plan','Manuscript/Tracking','Bible/Ancien dossier','Tracking/Ancien dossier','Context/Tracking','_Archives'])await mkdirVault(prefix+directory);
  await writeFile(join(root,'Bible/Characters/ancien.md'),'Ancienne fiche.');
  await writeFile(join(root,'Bible/Ancien dossier/ancien.md'),'Ancien document.');
  await writeFile(join(root,'Tracking/Ancien dossier/ancien.md'),'Ancien contexte.');
  await writeFile(join(root,'Context/Tracking/ancien.md'),'Ancien historique.');
  await writeFile(join(root,'Archives/ancien.md'),'Ancienne archive.');
  await writeFile(join(root,'_Archives/ancien.md'),'Archive héritée.');
  await writeFile(join(root,'Tracking/Changements.md'),'Historique invalide à effacer.');
  await writeFile(join(root,'Model/source.md'),'Source conservée.');
  // This stale explorer entry deliberately has no corresponding file on disk.
  entries.set(prefix+'Manuscript/Plan/fantome.md',{path:prefix+'Manuscript/Plan/fantome.md'});
  const target=new module.exports.default();
  Object.assign(target,{settings:loadSettings({folder:'Project',debugMode:true}),views:new Set(),settingsWrite:Promise.resolve(),documentTracking:new Map(),
   session:{newConversation:async()=>{},pendingChanges:[]},workingDirectory:async()=>root,configurationDirectory:()=>join(root,'.config'),
   correctionTask:action=>action(),releaseNoteLocks(){},projectSession:()=>target.session,saveSettings:async changes=>Object.assign(target.settings,typeof changes==='function'?changes(target.settings):changes),
   app:{workspace:{iterateAllLeaves(){}},vault:{getAbstractFileByPath:path=>entries.get(path),createFolder:mkdirVault},fileManager:{
    trashFile:async file=>{await mkdir(join(root,'.trash'),{recursive:true});await rename(join(root,file.path.slice(prefix.length)),join(root,'.trash',file.path.slice(prefix.length)));
     for(const key of [...entries.keys()])if(key===file.path||key.startsWith(file.path+'/'))entries.delete(key);
    }}}});
  // Both folders must be represented in the vault, as in a loaded project.
  for(const name of ['Bible','Tracking'])await mkdirVault(prefix+name);
  await target.resetActiveProject();
  assert.deepEqual(await readdir(join(root,'Manuscript')),[],'Manuscript reste vide, sans aucun sous-dossier.');
  const bibleFolders=['Arcs','Brainstorm','Characters','Checks','Plan','Plots','Scenes','Seeds','Style','Summaries','Synopsis','Variants','World'];
  assert.deepEqual((await readdir(join(root,'Bible'))).sort(),bibleFolders,'Bible retrouve uniquement les sous-dossiers prévus.');
  for(const name of bibleFolders)assert.deepEqual(await readdir(join(root,'Bible',name)),[],'Chaque rubrique de Bible est vide.');
  await assert.rejects(access(join(root,'Context')),{code:'ENOENT'});
  await assert.rejects(access(join(root,'_Archives')),{code:'ENOENT'});
  assert.deepEqual(await readdir(join(root,'Archives')),[],'Archives est vide, sans sauvegarde de reset.');
  assert.deepEqual(await readdir(join(root,'Tracking')),[],'Tracking est réinitialisé.');
  assert.equal([...entries.keys()].some(path=>path.startsWith(prefix+'Manuscript/')),false,'Le reset retire les anciennes entrées de l’explorateur.');
  assert.equal(await readFile(join(root,'Model/source.md'),'utf8'),'Source conservée.');
  assert.equal(await readFile(join(root,'.trash/Bible/Characters/ancien.md'),'utf8'),'Ancienne fiche.','Les documents retirés passent par la corbeille.');
  await assert.rejects(access(join(root,'.trash/Model')),{code:'ENOENT'});
  assert.equal((await newModelSources(root,folders)).length,1,'Peupler est disponible sans écrire de suivi.');
  target.prepareProject=async()=>{throw new Error('Une ouverture automatique ne doit pas repeupler Tracking après reset.');};
  await target.refreshCorrections(undefined,false);
  target.navigation=new ChatNavigation('Project/Model/source.md');
  const leaf={setViewState:async()=>{}};
  Object.assign(target.app.workspace,{rightSplit:{collapsed:true},getLeavesOfType:()=>[leaf],revealLeaf:async()=>{}});
  let connections=0;target.connect=async()=>{connections++;};
  await target.openChat();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(connections,1,'Ouvrir le chat charge le catalogue et reprend la session.');
  assert.deepEqual(await readdir(join(root,'Tracking')),[],'Le chargement de Codex après Reset ne doit pas recréer le suivi.');

  target.trackDocument('Project/Tracking');
  target.trackDocument('Project/Manuscript/Plan/fantome.md');
  assert.equal(target.documentTracking.size,0,'Les notifications retardées du reset ne relancent pas le suivi.');
  assert.deepEqual(await readdir(join(root,'Archives')),[]);
  assert.deepEqual(await readdir(join(root,'Tracking')),[],'Le bouton Peupler et le chat laissent Tracking vide.');
  await mkdir(join(root,'Copies/config'),{recursive:true});
  await writeFile(join(root,'Copies/config/protected.md'),'Configuration à conserver.');
  await assert.rejects(()=>resetProject(root,{...folders,archiveFolder:'Copies'},'Copies/config'),/configuration Obsidian/);
  assert.equal(await readFile(join(root,'Copies/config/protected.md'),'utf8'),'Configuration à conserver.');

 }finally{await rm(root,{recursive:true,force:true});}
}

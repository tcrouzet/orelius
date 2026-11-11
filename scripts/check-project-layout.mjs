import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {transform} from 'esbuild';
import {tmpdir} from 'node:os';
import {prepareProject,checkPath} from '../plugin/src/archives.ts';
import {DEFAULT_PROJECT_FOLDERS,isChapterPath,loadSettings,applySettings,PROJECT_FOLDER_KEYS,validateFolderName,associatedFolder,visibleFolder,modelProject} from '../plugin/src/settings.ts';
import {ChatNavigation} from '../plugin/src/navigation.ts';
import {t} from '../plugin/src/i18n.ts';
import {errorText} from '../plugin/src/codex.ts';
import {chapterFiles} from '../plugin/src/editorial-workflow.ts';
import {chapterPath} from '../plugin/src/corrections.ts';
import {buildSceneContext} from '../plugin/src/scene-context.ts';
import {storyKind} from '../plugin/src/story-structure.ts';
import {populateDestination,WorkshopContext,collectChanges,rememberGenerated} from '../plugin/src/workshop.ts';
import {projectSources} from '../plugin/src/project-sources.ts';
import {resetProject} from '../plugin/src/reset-project.ts';
import {readData,parseConfig} from '../plugin/src/narrative-context.ts';

export async function checkProjectLayout(){
 await checkFirstInstall();
 await checkProjectCreation();
 for(const name of await readdir(new URL('../prompts/',import.meta.url))){
  if(name.endsWith('.md'))assert.doesNotMatch(await readFile(new URL(`../prompts/${name}`,import.meta.url),'utf8'),/\bdans Context\b/,'Les prompts doivent désigner Tracking.');
 }
 assert.doesNotMatch(await readFile(new URL('../plugin/src/mcp.ts',import.meta.url),'utf8'),/\bdans Context\b/,'Les outils MCP doivent désigner Tracking.');

 for(const folders of [DEFAULT_PROJECT_FOLDERS,{archiveFolder:'Versions',manuscriptFolder:'Roman',bibleFolder:'Univers',modelFolder:'Sources'}]){
  const root=await mkdtemp(join(tmpdir(),'orelius-layout-'));
  const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
  const {manuscriptFolder:ms,bibleFolder:bible,modelFolder:model}=folders;
  try{
   await prepareProject(root,folders);assert.deepEqual(await readdir(join(root,ms)),[]);
   assert.deepEqual((await readdir(join(root,bible))).sort(),['Arcs','Brainstorm','Characters','Checks','Plan','Plots','Scenes','Seeds','Style','Summaries','Synopsis','Variants','World']);
   await put(`${model}/original.md`,'Source à préserver.');
   const paths=[`${ms}/001.md`,`${ms}/Partie 1/002.md`,`${ms}/Partie 2/003.md`];
   for(const [index,path] of paths.entries())await put(path,`Scène ${index+1}.`);
   assert.deepEqual(await chapterFiles(root,folders),paths);
   for(const path of paths){assert.equal(chapterPath(root,folders,path),path);assert.equal(storyKind(path,folders),'chapitre');}
   for(const folder of ['Tracking','Plan','Characters','Seeds','Chapters']){
    const old=`${ms}/${folder}/fiche.md`;assert.equal(isChapterPath(old,folders),false);assert.equal(populateDestination(folders,old),false);
    assert.throws(()=>parseConfig({chapters:[{path:old}],references:[]},folders),/Chapitre hors/);
    await put(old,'Ancienne fiche à exclure du récit.');
   }
   assert.deepEqual(await chapterFiles(root,folders),paths,'Les anciennes fiches ne sont pas des chapitres.');
   for(const [directory,kind] of [['Characters','personnage'],['Seeds','graine'],['Plots','intrigue'],['Scenes','scene'],['Arcs','arc'],['Plan','plan']]){
    const path=`${bible}/${directory}/fiche.md`;await put(path,`Fiche ${directory}.`);assert.equal(storyKind(path,folders),kind);assert.equal(populateDestination(folders,path),true);
   }
   await put('Tracking/Conversation.md','Historique technique.');
   await put('Tracking/Provenance.md','Anciennes sources.');
   const inventory=await projectSources(root,folders);
   assert.equal(inventory.some(item=>item.content.includes('Historique technique')||item.content.includes('Anciennes sources')||item.content.includes('Ancienne fiche à exclure')),false);
   const context=await buildSceneContext(root,folders,{},paths[2],'Reprends cette scène.');
   assert.equal(context.path,'Tracking/Partie 2/003/sources.md');
   assert.equal(context.sources.find(source=>source.role==='previous-manuscript').path,paths[1],'Le raccord traverse les parties.');
   const structure=readData(await readFile(join(root,'Tracking/Structure.md'),'utf8'));
   assert.equal(structure.nodes.filter(node=>node.kind==='chapitre').length,3);
   const workshop=new WorkshopContext();for(let page=0,pages=1;page<pages;page++)pages=JSON.parse(await workshop.page(root,folders,page)).pages;
   assert.ok(workshop.sources.some(source=>source.path===`${bible}/Seeds/fiche.md`));
   assert.deepEqual(workshop.indexFolders(folders),['Seeds','Scenes','Arcs','Plots'],'Les dossiers sans matière ne doivent pas imposer de faux index.');
   for(const path of ['Tracking/Connaissances.md','Tracking/Prompts/reviser.md']){
    await put(path,'Consigne générée.');
    await rememberGenerated(root,folders,path,'Consigne générée.');
    assert.equal((await collectChanges(root,folders)).pending.some(change=>change.path===path),false,'Une consigne générée ne devient pas une modification humaine.');
    await put(path,'Correction humaine.');
    assert.equal((await collectChanges(root,folders)).pending.some(change=>change.path===path),true,'Une retouche humaine reste transmise.');
   }
   await resetProject(root,folders);
   assert.deepEqual(await readdir(join(root,ms)),[]);
   assert.equal(await readFile(join(root,model,'original.md'),'utf8'),'Source à préserver.');
   assert.deepEqual(await readdir(join(root,folders.archiveFolder)),[]);
   assert.deepEqual(await readdir(join(root,'Tracking')),[]);
   await prepareProject(root,folders);assert.deepEqual(await readdir(join(root,ms)),[]);
  }finally{await rm(root,{recursive:true,force:true});}
 }
}

async function checkProjectCreation(){
 const source=await readFile('plugin/src/main.ts','utf8');
 const method=source.slice(source.indexOf('  private newProject('),source.indexOf('  async prepareProject('));
 const save=source.slice(source.indexOf('  saveSettings('),source.indexOf('  async testCodex('));
 const {code}=await transform(`export default class Harness {${method}${save}}`,{loader:'ts',format:'cjs'});
 let choose;
 class TFolder{constructor(path){this.path=path;}}
 class NewProjectModal{constructor(_app,_folder,_model,callback){choose=callback;}open(){}}
 const module={exports:{}};
 new Function('NewProjectModal','TFolder','t','validateFolderName','checkPath','resolve','errorText','Notice','PROJECT_FOLDER_KEYS','applySettings','module','exports',code)(
  NewProjectModal,TFolder,t,validateFolderName,checkPath,resolve,errorText,class{},PROJECT_FOLDER_KEYS,applySettings,module,module.exports);
 const root=await mkdtemp(join(tmpdir(),'orelius-project-choice-'));
 const entries=new Map([['',new TFolder('/')],['Romans',new TFolder('Romans')],['Romans/Existant',new TFolder('Romans/Existant')]]);
 const created=[],prepared=[],opened=[];
 try{
  await mkdir(join(root,'Romans/Existant'),{recursive:true});
  await writeFile(join(root,'Romans/Existant/source.md'),'Texte personnel à préserver.');
  const target=new module.exports.default();
  Object.assign(target,{projects:new Map(),settings:loadSettings({folder:'Romans/Existant',sessions:{'Romans/Existant':{threadId:'session-conservee',cwd:join(root,'Romans/Existant')}}}),
   settingsWrite:Promise.resolve(),session:{busy:false,disconnect:async()=>{}},navigation:new ChatNavigation('Autre.md'),
   workingDirectory:async()=>root,configurationDirectory:()=>join(root,'.obsidian'),saveData:async()=>{},
   prepareProject:async(folder)=>{prepared.push(folder);await prepareProject(join(root,folder),target.settings);},
   openChat:async()=>{opened.push(target.settings.folder);assert.equal(target.navigation.path,target.settings.folder);},
   app:{vault:{getRoot:()=>entries.get(''),getName:()=> 'Coffre',getAbstractFileByPath:path=>entries.get(path),createFolder:async path=>{created.push(path);await mkdir(join(root,path));entries.set(path,new TFolder(path));}}}});
  target.newProject(entries.get('Romans/Existant'));
  await choose(null,'Romans/Existant');
  assert.deepEqual(created,[],'Utiliser le dossier ouvert ne crée pas de sous-dossier de projet.');
  assert.equal(target.settings.folder,'Romans/Existant');assert.equal(target.settings.threadId,'session-conservee');
  assert.equal(await readFile(join(root,'Romans/Existant/source.md'),'utf8'),'Texte personnel à préserver.');
  assert.ok((await readdir(join(root,'Romans/Existant'))).includes('Manuscript'));
  await choose('Nouveau','Romans');
  assert.deepEqual(created,['Romans/Nouveau']);assert.equal(target.settings.folder,'Romans/Nouveau');assert.equal(target.settings.threadId,'');
  assert.ok(Object.hasOwn(target.settings.sessions,'Romans/Nouveau'),'Un nouveau dossier est enregistré comme projet avant toute connexion Codex.');
  await choose(null,'Romans/Existant');
  assert.equal(target.settings.threadId,'session-conservee','Ouvrir un dossier existant conserve sa session.');
  await assert.rejects(()=>choose(null,''),/racine du coffre/);
  assert.deepEqual(await readdir(root),['Romans'],'Refuser la racine ne crée aucun dossier de travail.');
  await choose('Projet racine','');
  assert.equal(target.settings.folder,'Projet racine');
  assert.deepEqual((await readdir(root)).sort(),['Projet racine','Romans']);
  assert.deepEqual(prepared,['Romans/Existant','Romans/Nouveau','Romans/Existant','Projet racine']);
  assert.deepEqual(opened,['Romans/Existant','Romans/Nouveau','Romans/Existant','Projet racine']);
  await assert.rejects(()=>choose('Nouveau','Romans'),/existe déjà/);
  await assert.rejects(()=>choose('','Romans'),/nom de dossier/);
  await assert.rejects(()=>choose(null,'Absent'),/n’existe plus/);
  assert.deepEqual(created,['Romans/Nouveau','Projet racine'],'Un échec ne crée aucun autre dossier.');
 }finally{await rm(root,{recursive:true,force:true});}
}

async function checkFirstInstall(){
 const source=await readFile('plugin/src/main.ts','utf8');
 const methods=[['  async onload()', '  private navigate('],['  async workingDirectory(', '  private newProject('],['  async prepareProject(', '  private correctionTask<']]
  .map(([start,end])=>source.slice(source.indexOf(start),source.indexOf(end))).join('\n');
 const {code}=await transform(`export default class Harness {${methods}}`,{loader:'ts',format:'cjs'});
 const root=await mkdtemp(join(tmpdir(),'orelius-first-install-'));
 const events=new Map(),noop=()=>{};
 class TFolder{constructor(path){this.path=path;}}
 class FileSystemAdapter{getBasePath(){return root;}}
 const dependencies={t,loadSettings,associatedFolder,visibleFolder,ChatNavigation,TFolder,FileSystemAdapter,resolve,relative,isAbsolute,realpath,
  setLocale:noop,requireApiVersion:()=>true,getLanguage:()=> 'fr',loadTranslationFiles:async()=>[],addIcon:noop,oreliusIcon:'',editorLock:noop,
  NOVEL_VIEW:'novel',VIEW_TYPE:'orelius',NovelView:class{},OreliusView:class{},OreliusSettingTab:class{},SELECTION_ACTIONS:[],
  ExplorerActions:class{refresh(){}},prepareProject,prepareSourceConfig:noop,prepareBible:noop,generateAgent:noop,agentTemplate:''};
 const module={exports:{}};
 new Function(...Object.keys(dependencies),'module','exports',code)(...Object.values(dependencies),module,module.exports);
 try{
  await writeFile(join(root,'Note.md'),'Note personnelle.');
  const target=new module.exports.default();
  const on=(event,callback)=>{events.set(event,[...(events.get(event)??[]),callback]);};
  Object.assign(target,{manifest:{id:'orelius'},loadData:async()=>undefined,highlights:{extension:[],refresh:noop},projects:new Map(),documentTracking:new Map(),projectWrite:Promise.resolve(),
   registerEditorExtension:noop,registerView:noop,addCommand:noop,addSettingTab:noop,registerEvent:noop,addRibbonIcon:noop,register:noop,registerDomEvent:noop,
   configurationDirectory:()=>join(root,'.obsidian'),moveProjectFolders:()=>false,correctionTask:()=>{throw Error('Aucun suivi hors projet');},
   app:{vault:{adapter:new FileSystemAdapter(),configDir:'.obsidian',on,getRoot:()=>new TFolder('/'),getAbstractFileByPath:path=>['.','/'].includes(path)?new TFolder(path):null},
    workspace:{on,getActiveFile:()=>({path:'Note.md'}),onLayoutReady:callback=>callback(),containerEl:{}}}});
  await target.onload();
  for(const event of ['create','modify','delete','rename']) for(const callback of events.get(event)??[])callback({path:'Note renommee.md'},'Note.md');
  for(const folder of ['', '.','/'])await assert.rejects(()=>target.prepareProject(folder));
  await assert.rejects(()=>target.workingDirectory(),/racine du coffre/);
  assert.equal(await target.workingDirectory('',true),await realpath(root),'La lecture de la racine reste possible pour choisir le parent d’un nouveau dossier.');
  assert.deepEqual(await readdir(root),['Note.md'],'Installer, renommer, modifier et ouvrir sans projet ne créent aucun dossier à la racine.');
  assert.equal(await readFile(join(root,'Note.md'),'utf8'),'Note personnelle.');
  assert.equal(target.documentTracking.size,0);
  const legacy=loadSettings({sessions:{'':{threadId:'ancienne-racine',cwd:root}}});
  assert.equal(associatedFolder(legacy,'Note.md'),undefined);
  assert.equal(modelProject(legacy,'Model'),undefined);
  const modalSource=await readFile('plugin/src/new-project-modal.ts','utf8');
  const submit=modalSource.slice(modalSource.indexOf('  private async submit('),modalSource.indexOf('  onClose()'));
  const modalCode=await transform(`export default class Harness {${submit}}`,{loader:'ts',format:'cjs'});
  const modalModule={exports:{}};
  new Function('errorText','module','exports',modalCode.code)(errorText,modalModule,modalModule.exports);
  const modal=new modalModule.exports.default(),buttons=[{disabled:true},{disabled:false}];
  Object.assign(modal,{contentEl:{querySelectorAll:()=>buttons},error:{setText(){}},create:async()=>{throw Error('Dossier absent');}});
  await modal.submit(null,'Absent');
  assert.deepEqual(buttons.map(button=>button.disabled),[true,false],'Un échec de sélection ne réactive pas le bouton qui utiliserait la racine.');

 }finally{await rm(root,{recursive:true,force:true});}
}

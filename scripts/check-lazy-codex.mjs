import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {loadSettings,applySettings,visibleFolder} from '../plugin/src/settings.ts';
import {ChatNavigation} from '../plugin/src/navigation.ts';
import {POPULATE_PREFIX} from '../plugin/src/workshop.ts';
import {renderAgent} from '../plugin/src/generate-agent.ts';

export async function checkLazyCodex() {
 const probe={calls:0,settings:[]};globalThis.__oreliusDetection=probe;
 try {
  const bundle=await build({entryPoints:['plugin/src/settings-tab.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'settings-detection-probe',setup(builder){
   builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'probe'}));
   builder.onResolve({filter:/^\.\/codex(?:\.ts)?$/},()=>({path:'codex',namespace:'probe'}));
   builder.onLoad({filter:/.*/,namespace:'probe'},({path})=>({contents:path==='codex'?`
    export const object=value=>value&&typeof value==='object'?value:{};
    export const errorText=error=>String(error);
    export async function findCodex(){globalThis.__oreliusDetection.calls++;return '/test/codex';}
   `:`
    export class Element { empty(){} removeClass(){} setText(){} createDiv(){return new Element();} createEl(){return new Element();} }
    export class PluginSettingTab {containerEl=new Element();}
    export class Notice {}
    export class Setting {
     settingEl=new Element(); buttons=[];
     constructor(){globalThis.__oreliusDetection.settings.push(this);}
     setName(value){this.name=value;return this;} setDesc(){return this;} setHeading(){return this;}
     addText(callback){const text={inputEl:{},setPlaceholder(){return this;},setValue(){return this;},onChange(){return this;}};callback(text);return this;}
     addToggle(callback){callback({setValue(){return this;},onChange(){return this;}});return this;}
     addButton(callback){const button={setButtonText(value){this.text=value;return this;},setDisabled(value){this.disabled=value;return this;},onClick(action){this.click=action;return this;}};callback(button);this.buttons.push(button);return this;}
    }
   `}));
  }}]});
  const {OreliusSettingTab}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const plugin={app:{},settings:loadSettings(undefined),async saveSettings(change){Object.assign(this.settings,change);}};
  const tab=new OreliusSettingTab(plugin);
  for(const definition of tab.getSettingDefinitions())definition.render({settingEl:tab.containerEl});
  await Promise.resolve();assert.equal(probe.calls,0,'Indexer les réglages ne doit pas chercher Codex.');
  probe.settings=[];tab.display();await Promise.resolve();assert.equal(probe.calls,0,'Afficher les réglages ne lance aucune recherche.');
  const search=probe.settings.flatMap(setting=>setting.buttons).find(button=>button.text==='Rechercher Codex');
  assert.ok(search);await search.click();assert.equal(probe.calls,1);assert.equal(plugin.settings.codexPath,'/test/codex');
 } finally {delete globalThis.__oreliusDetection;}

 const source=await readFile('plugin/src/main.ts','utf8');
 const method=source.slice(source.indexOf('  async connect(model?'),source.indexOf('  async send(text:'));
 const {code}=await transform(`export default class Harness {${method}}`,{loader:'ts',format:'cjs'});
 const module={exports:{}};new Function('visibleFolder','t','module','exports',code)(visibleFolder,key=>key,module,module.exports);
 const Harness=module.exports.default;
 for(const [settings,path,expected] of [[loadSettings(undefined),'Note.md',0],[loadSettings({folder:'Roman'}),'Autre/note.md',0],[loadSettings({folder:'Roman'}),null,0],[loadSettings({folder:'Roman'}),'Roman/1.md',1]]){
  const target=new Harness();let read=0,connected=0;
  const project={folder:settings.folder,connecting:null},session={connected:false,busy:false,connect:async()=>{connected++;session.connected=true;}};
  Object.assign(target,{settings,navigation:new ChatNavigation(path),settingsWrite:Promise.resolve(),projectState:()=>project,projectSession:()=>session,projectSettings:()=>settings,
   workingDirectory:async()=>{read++;return '/vault/Roman';},prepareProject:async()=>{throw Error('Le chargement du catalogue ne doit pas créer les fichiers du projet.');},checkSavedDirectory(){}});
  await target.connect();await target.connect();assert.equal(read,expected);assert.equal(connected,expected,'Ouvrir le projet charge Codex une seule fois, hors projet il reste inactif.');
 }
 const target=new Harness(),connections=[];let release;
 const settings=loadSettings({folder:'Roman A',sessions:{'Roman A':{threadId:'a',cwd:'/vault/Roman A'},'Roman B':{threadId:'b',cwd:'/vault/Roman B'}}});
 const states=new Map(['Roman A','Roman B'].map(folder=>[folder,{folder,connecting:null,session:{connected:false,busy:false,connect:async(_executable,cwd,id)=>{connections.push([cwd,id]);states.get(folder).session.connected=true;}}}]));
 Object.assign(target,{settings,navigation:new ChatNavigation('Roman A/1.md'),settingsWrite:Promise.resolve(),projectState:folder=>states.get(folder),projectSession:folder=>states.get(folder).session,
  projectSettings:folder=>applySettings(target.settings,{folder}),workingDirectory:folder=>folder==='Roman A'?new Promise(resolve=>{release=()=>resolve('/vault/Roman A');}):Promise.resolve('/vault/Roman B'),checkSavedDirectory(){}});
 const pending=target.connect();await Promise.resolve();const duplicate=target.connect();
 target.settings=applySettings(target.settings,{folder:'Roman B'});await target.navigation.run('Roman B/1.md',async()=>{});
 await target.connect();assert.deepEqual(connections,[['/vault/Roman B','b']],'Le projet B se charge sans attendre A.');
 release();await Promise.all([pending,duplicate]);
 assert.deepEqual(connections,[['/vault/Roman B','b'],['/vault/Roman A','a']]);
 assert.equal(states.get('Roman A').connecting,null);assert.equal(states.get('Roman B').connecting,null);

 const populateMethod=source.slice(source.indexOf('  private async populateWorkshop('),source.indexOf('  async refreshNarrativeState('));
 const compiled=await transform(`export default class Harness {${populateMethod}}`,{loader:'ts',format:'cjs'});
 const populateModule={exports:{}};
 let hasSources=true,notices=0;
 new Function('newModelSources','PopulateNotice','renderAgent','populateTemplate','POPULATE_PREFIX','visibleFolder','t','module','exports',compiled.code)(
  async()=>hasSources?[{}]:[],class {open(){notices++;}},renderAgent,'Lire les documents de {modelFolder}.',POPULATE_PREFIX,visibleFolder,key=>key,populateModule,populateModule.exports);
 const PopulateHarness=populateModule.exports.default;
 const project=new PopulateHarness(),events=[];
 Object.assign(project,{projects:new Map(),settings:loadSettings({folder:'Roman',modelFolder:'Sources'}),navigation:new ChatNavigation('Autre/note.md'),
  session:{busy:false,send:async(text,_executable,cwd)=>{events.push('send');assert.ok(text.startsWith(POPULATE_PREFIX));assert.ok(text.includes('Sources'));assert.equal(cwd,'/vault/Roman');}},
  workingDirectory:async()=>'/vault/Roman',saveSettings:async()=>{},refreshCorrections:async()=>'/vault/Roman',checkSavedDirectory(){},
  openChat:async()=>{events.push('chat');assert.equal(project.navigation.path,'Roman/Sources','Le clic Peupler ouvre le chat du projet, même depuis une note extérieure.');}});
 await project.populateWorkshop('Roman');
 assert.deepEqual(events,['chat','send'],'Le chat s’ouvre avant la requête, sans description ni formulaire.');
 assert.equal(project.sending,false);assert.equal(project.populatePending,false);assert.equal(notices,0);
 hasSources=false;events.length=0;await project.populateWorkshop('Roman');
 assert.equal(notices,1);assert.deepEqual(events,[],'Sans document à traiter, aucun appel à Codex.');
}

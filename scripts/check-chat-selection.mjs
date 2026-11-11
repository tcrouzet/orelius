import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DEFAULT_PROJECT_FOLDERS} from '../plugin/src/settings.ts';

export async function checkChatSelection() {
 const result=await build({entryPoints:['plugin/src/chat-view.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'chat-elements',setup(builder){
  builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
  builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export class ItemView { constructor(leaf){this.contentEl=leaf.contentEl;} removeChild(){} registerDomEvent(target,name,handler){(this.handlers??=[]).push({target,name,handler});} } export class Component {} export const setIcon=()=>{}; export const setTooltip=()=>{}; export const MarkdownRenderer={};`}));
 }}]});
 const {OreliusView}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
 class Element {
  textContent='';writes=0;emptyWrites=0;created=0;value='';nodes=new Map();
  setText(text){this.textContent=text;this.writes++;} toggle(visible){this.visible=visible;} toggleClass(){} addClass(){} removeClass(){} createDiv(options){return this.createEl("div",options);}
  empty(){this.emptyWrites++;this.nodes.clear();}
  querySelector(selector){return this.nodes.get(selector)??null;}
  createEl(tag,options={}){this.created++;const element=new Element();if(options.text)element.setText(options.text);if(options.cls)this.nodes.set('.'+options.cls,element);return element;}
 }
 let selection=null;const callbacks=[];
 const content=new Element();content.contains=node=>node?.inChat===true;
 content.ownerDocument={getSelection:()=>selection,defaultView:{requestAnimationFrame:callback=>{callbacks.push(callback);return callbacks.length;}}};
 const failure='La publication a échoué.\n'+('Diagnostic exact et copiable. '.repeat(1200));
 const session={turns:[],items:[],requests:[],models:[],model:'',reasoningEffort:null,modelChangePending:false,status:'Statut',failure:{message:failure},busy:false,connected:false,contextRemaining:null};
 const plugin={settings:{...DEFAULT_PROJECT_FOLDERS,folder:'Roman',debugMode:false},session,draft:'',acceptanceChapter:null,revisionChapter:null,revisionDocument:null,highlightedDocument:null,activeStoryNode:null};
 const view=new OreliusView({contentEl:content},plugin);
 for(const field of ['projectTitleEl','resetButton','statusEl','failureEl','failureMessageEl','retryButton','modelSelect','effortSelect','modelPendingEl','contextEl','sendButton','reviseButton','rewriteButton','acceptButton','stopButton','decisionLabel','decisionSelect','input','hintEl','messagesEl','requestsEl','timelineEl'])view[field]=new Element();
 view.render();const fields=['projectTitleEl','statusEl','failureMessageEl','contextEl','sendButton','hintEl'];
 const writes=fields.map(field=>view[field].writes),emptyMessage=view.messagesEl.querySelector('.orelius-empty');
 for(let i=0;i<5;i++)view.render();
 assert.deepEqual(fields.map(field=>view[field].writes),writes,'Un rafraîchissement ne doit pas remplacer les nœuds de texte inchangés.');
 assert.equal(view.messagesEl.querySelector('.orelius-empty'),emptyMessage,'Le texte d’accueil conserve aussi ses nœuds.');
 plugin.settings.archiveFolder='Copies';view.render();assert.equal(view.messagesEl.querySelector('.orelius-empty'),emptyMessage);assert.ok(emptyMessage.textContent.includes('Copies'));
 assert.equal(view.failureMessageEl.textContent,failure,'Le diagnostic complet reste disponible.');
 session.failure.message='Nouveau diagnostic';view.render();assert.equal(view.failureMessageEl.textContent,'Nouveau diagnostic');
 assert.equal(view.failureMessageEl.writes,writes[2]+1);
 plugin.settings.folder='Autre projet';view.render();
 assert.notEqual(view.messagesEl.querySelector('.orelius-empty'),emptyMessage,'Changer de projet invalide le rendu des messages du précédent.');
 session.models=[{model:'model-a',name:'Modèle A',supportedReasoningEfforts:[{reasoningEffort:'high',description:'Approfondi'}]}];
 session.model='model-a';session.reasoningEffort='high';session.connected=true;session.busy=true;session.running=true;
 view.render();assert.equal(view.modelSelect.disabled,false);assert.equal(view.effortSelect.disabled,false,'Le niveau reste modifiable pendant le travail.');assert.equal(view.effortSelect.value,'high');
 session.contextRemaining=75;view.render();assert.ok(view.contextEl.textContent.includes('75'),'La mesure de contexte reçue apparaît dans la sidebar.');session.contextRemaining=null;
 session.models=[];session.model='';session.reasoningEffort=null;session.connected=false;session.busy=false;session.running=false;
 plugin.brainstormDirectory='Bible/Brainstorm';view.render();assert.equal(view.sendButton.textContent,'Brainstorm');
 plugin.brainstormDirectory=null;view.render();assert.equal(view.sendButton.textContent,'Envoyer');
 const revisionCalls=[];plugin.send=async(...args)=>revisionCalls.push(args);
 plugin.revisionDocument='Bible/Characters/Personnage.md';view.render();
 assert.equal(view.reviseButton.visible,true);assert.equal(view.reviseButton.disabled,false);
 assert.equal(view.rewriteButton.visible,false,'La reprise narrative reste propre aux chapitres.');
 view.input.value='';await view.send(true);
 assert.deepEqual(revisionCalls,[['',plugin.revisionDocument,false]],'Les annotations de la fiche suffisent pour lancer Réviser.');
 const cleared=[];plugin.clearRevisionHighlights=async path=>cleared.push(path);
 plugin.highlightedDocument=plugin.revisionDocument;await view.clearHighlights();
 assert.deepEqual(cleared,[plugin.revisionDocument],'La gomme fonctionne aussi pour une fiche révisée.');
 plugin.highlightedDocument=null;
 plugin.revisionDocument=null;view.render();assert.equal(view.reviseButton.visible,false);
 view.active=true;view.timelineEl.scrollTop=40;view.timelineEl.scrollHeight=500;
 selection={isCollapsed:false,anchorNode:{inChat:true},focusNode:{inChat:true}};
 view.scrollMessages();assert.equal(callbacks.length,0,'Sélectionner un texte du panneau suspend le défilement.');
 selection=null;view.scrollMessages();assert.equal(callbacks.length,1);
 selection={isCollapsed:false,anchorNode:{inChat:true},focusNode:{inChat:false}};
 callbacks.shift()();assert.equal(view.timelineEl.scrollTop,40,'Une sélection démarrée avant le prochain rendu suspend aussi le déplacement.');
 selection={isCollapsed:false,anchorNode:{inChat:false},focusNode:{inChat:false}};
 view.scrollMessages();callbacks.shift()();assert.equal(view.timelineEl.scrollTop,500,'Une sélection hors du panneau ne bloque pas le suivi des messages.');
 content.win={setTimeout:()=>1,clearTimeout(){}};
 view.followMessages=false;view.timelineEl.scrollHeight=700;
 view.followConversation();view.scrollMessages();callbacks.shift()();
 assert.equal(view.timelineEl.scrollTop,700,'Ouvrir explicitement le chat reprend le suivi après un défilement manuel.');
 const savedNode=globalThis.Node,savedResize=globalThis.ResizeObserver;
 globalThis.Node=class{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 try{
  let connections=0;const refreshes=[];
  content.win={setTimeout:()=>1,clearTimeout(){}};
  const idlePlugin={...plugin,attach(){},detach(){},connect:async()=>{connections++;session.connected=true;},refreshCorrections:async(...args)=>{refreshes.push(args);}};
  const lifecycle=new OreliusView({contentEl:content},idlePlugin);lifecycle.render=()=>{};
  await lifecycle.onOpen();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(connections,1,'La sidebar d’un projet charge automatiquement son catalogue et sa conversation.');
  lifecycle.handlers.find(item=>item.name==='focusin').handler({relatedTarget:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(refreshes,[[undefined,false]],'Le focus du chat utilise la consultation sans initialisation.');
  lifecycle.modelSelect.onfocus();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(connections,1,'Le focus ne relance pas une session déjà chargée.');
  const selections=[];idlePlugin.session.selectModel=value=>selections.push(['model',value]);idlePlugin.session.selectReasoningEffort=value=>selections.push(['effort',value]);
  lifecycle.modelSelect.value='model-a';lifecycle.modelSelect.onchange();
  lifecycle.effortSelect.value='high';lifecycle.effortSelect.onchange();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(selections,[['model','model-a'],['effort','high']]);assert.equal(connections,1,'Changer les choix ne relance pas la connexion.');
  await lifecycle.onClose();
 }finally{
  if(savedNode===undefined)delete globalThis.Node;else globalThis.Node=savedNode;
  if(savedResize===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=savedResize;
 }

}

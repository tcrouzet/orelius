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
 const drafts=new Map();
 plugin.getDraft=folder=>drafts.get(folder)??'';
 plugin.setDraft=(text,folder)=>drafts.set(folder,text);
 Object.defineProperty(plugin,'draft',{enumerable:true,get:()=>plugin.getDraft(plugin.settings.folder),set:text=>plugin.setDraft(text,plugin.settings.folder)});
 const view=new OreliusView({contentEl:content},plugin);
 for(const field of ['projectTitleEl','resetButton','statusEl','failureEl','failureMessageEl','retryButton','modelSelect','effortSelect','modelPendingEl','contextEl','sendButton','reviseButton','rewriteButton','validateButton','acceptButton','stopButton','decisionLabel','decisionSelect','input','hintEl','messagesEl','requestsEl','timelineEl'])view[field]=new Element();
 view.render();const fields=['projectTitleEl','statusEl','failureMessageEl','contextEl','sendButton','hintEl'];
 const writes=fields.map(field=>view[field].writes),emptyMessage=view.messagesEl.querySelector('.orelius-empty');
 for(let i=0;i<5;i++)view.render();
 assert.deepEqual(fields.map(field=>view[field].writes),writes,'Un rafraîchissement ne doit pas remplacer les nœuds de texte inchangés.');
 assert.equal(view.messagesEl.querySelector('.orelius-empty'),emptyMessage,'Le texte d’accueil conserve aussi ses nœuds.');
 plugin.settings.archiveFolder='Copies';view.render();assert.equal(view.messagesEl.querySelector('.orelius-empty'),emptyMessage);assert.ok(emptyMessage.textContent.includes('Copies'));
 assert.equal(view.failureMessageEl.textContent,failure,'Le diagnostic complet reste disponible.');
 view.input.value='Mon commentaire non envoyé — à conserver.';
 session.busy=true;view.render();session.busy=false;view.render();
 assert.equal(view.input.value,'Mon commentaire non envoyé — à conserver.','Un rafraîchissement pendant la saisie ne vide pas le champ.');
 assert.equal(plugin.draft,view.input.value);
 view.input.value+=' Encore en cours de saisie.';
 const firstDraft=view.input.value;
 plugin.settings.folder='Projet voisin';view.render();
 assert.equal(plugin.getDraft('Roman'),firstDraft,'La saisie encore visible reste rattachée à son projet.');
 assert.equal(view.input.value,'');
 view.input.value='Autre commentaire.';view.render();
 plugin.settings.folder='Roman';view.render();assert.equal(view.input.value,firstDraft);
 assert.equal(plugin.getDraft('Projet voisin'),'Autre commentaire.');
 plugin.draft='';view.render();assert.equal(view.input.value,'','Un envoi validé peut effacer le texte inchangé.');
 plugin.draft='Texte envoyé';view.render();
 view.input.value='Nouveau texte saisi pendant l’envoi';plugin.draft='';view.render();
 assert.equal(view.input.value,'Nouveau texte saisi pendant l’envoi','La fin d’un envoi ne détruit pas la saisie suivante.');
 plugin.draft='';view.render();

 session.failure.message='Nouveau diagnostic';view.render();assert.equal(view.failureMessageEl.textContent,'Nouveau diagnostic');
 assert.equal(view.failureMessageEl.writes,writes[2]+1);
 plugin.settings.folder='Autre projet';view.render();
 assert.notEqual(view.messagesEl.querySelector('.orelius-empty'),emptyMessage,'Changer de projet invalide le rendu des messages du précédent.');
 session.models=[{model:'model-a',name:'Modèle A',supportedReasoningEfforts:[{reasoningEffort:'high',description:'Approfondi'}]}];
 session.model='model-a';session.reasoningEffort='high';session.connected=true;session.busy=true;session.running=true;
 view.render();assert.equal(view.modelSelect.disabled,false);assert.equal(view.effortSelect.disabled,false,'Le niveau reste modifiable pendant le travail.');assert.equal(view.effortSelect.value,'high');
 session.contextRemaining=75;view.render();assert.ok(view.contextEl.textContent.includes('75'),'La mesure de contexte reçue apparaît dans la sidebar.');session.contextRemaining=null;
 session.models=[];session.model='';session.reasoningEffort=null;session.connected=false;session.busy=false;session.running=false;
 plugin.brainstormDirectory='Brainstorm';view.render();assert.equal(view.sendButton.textContent,'Brainstorm');
 plugin.brainstormDirectory=null;view.render();assert.equal(view.sendButton.textContent,'Envoyer');
 const revisionCalls=[];plugin.send=async(...args)=>revisionCalls.push(args);
 plugin.revisionDocument='Bible/Characters/Personnage.md';view.render();
 assert.equal(view.reviseButton.visible,true);assert.equal(view.reviseButton.disabled,false);
 assert.equal(view.sendButton.visible,false,'Envoyer disparaît lorsqu’une note est sélectionnée.');
 assert.match(view.hintEl.textContent,/réviser/);
 assert.equal(view.rewriteButton.visible,false,'La reprise narrative reste propre aux chapitres.');
 assert.equal(view.validateButton.visible,false,'Une fiche Bible ne se valide pas comme un chapitre.');
 view.input.value='';await view.send(true);
 assert.deepEqual(revisionCalls,[['',plugin.revisionDocument,false]],'Les annotations de la fiche suffisent pour lancer Réviser.');
 view.input.value='Ajoute les deux matériaux.';await view.send();
 assert.deepEqual(revisionCalls.at(-1),['Ajoute les deux matériaux.',plugin.revisionDocument,false],'Le raccourci par défaut révise la note sélectionnée.');
 view.input.value='';

 const validations=[];plugin.validateChapter=async(...args)=>validations.push(args);
 plugin.revisionChapter='Manuscript/001.md';plugin.revisionDocument=plugin.revisionChapter;view.render();
 assert.equal(view.validateButton.visible,true,'Valider existe sans surlignage ni modification récente.');
 assert.equal(view.acceptButton.visible,false);
 view.input.value='Garder cette retenue dans la suite.';await view.validate();
 assert.deepEqual(validations,[['Garder cette retenue dans la suite.','Manuscript/001.md']]);
 assert.equal(view.input.value,'Garder cette retenue dans la suite.','Le rendu seul ne consomme pas le commentaire.');
 session.busy=true;view.render();assert.equal(view.validateButton.disabled,true);await view.validate();assert.equal(validations.length,1);
 session.busy=false;plugin.revisionChapter=null;plugin.revisionDocument='Bible/Characters/Personnage.md';view.input.value='';view.render();

 session.brainstormActive=true;plugin.revisionDocument='Brainstorm/Origine.md';view.render();
 assert.equal(view.sendButton.visible,true);assert.equal(view.sendButton.textContent,'Brainstorm');
 view.input.value='Un nouvel angle.';await view.send();assert.deepEqual(revisionCalls.at(-1),['Un nouvel angle.',undefined,false]);
 await view.send(true);assert.deepEqual(revisionCalls.at(-1),['Un nouvel angle.','Brainstorm/Origine.md',false]);
 plugin.revisionDocument='Manuscript/001.md';view.render();
 assert.equal(view.sendButton.visible,true,'Consulter un chapitre laisse accès au fil Brainstorm.');
 view.input.value='Une question pendant cette lecture.';await view.send();assert.deepEqual(revisionCalls.at(-1),['Une question pendant cette lecture.',undefined,false]);
 session.brainstormActive=false;plugin.revisionDocument='Bible/Characters/Personnage.md';view.input.value='';view.render();

 const cleared=[];plugin.clearRevisionHighlights=async path=>cleared.push(path);
 plugin.highlightedDocument=plugin.revisionDocument;await view.clearHighlights();
 assert.deepEqual(cleared,[plugin.revisionDocument],'La gomme fonctionne aussi pour une fiche révisée.');
 session.busy=true;session.backgroundWork=true;
 const reactions=[];plugin.react=async(...args)=>reactions.push(args);plugin.reactionFor=()=>undefined;
 await view.clearHighlights();
 assert.equal(cleared.length,2,'La gomme reste utilisable pendant le suivi.');
 view.input.value='Garde cette voix.';
 for(const reaction of ['heart','up','down']) {
  await view.react('réponse',reaction);view.render();
  assert.deepEqual(reactions.at(-1),['réponse',reaction,''],'Le vote ne transmet pas le brouillon non envoyé.');
  assert.equal(view.input.value,'Garde cette voix.','Le vote conserve le texte dans le champ.');
  assert.equal(plugin.draft,'Garde cette voix.','Le brouillon sauvegardé reste intact.');
 }
 view.exchanges=new Map([['réponse',{}]]);
 const buttons=['heart','up','down'].map(reaction=>({dataset:{reaction},setAttribute(){}}));
 const clear={};const controls={querySelectorAll:()=>buttons,querySelector:()=>clear};
 view.renderReactions({id:'réponse',paths:[plugin.revisionDocument]},{querySelector:()=>controls});
 assert.ok(buttons.every(button=>button.disabled===false));assert.equal(clear.disabled,false);
 session.backgroundWork=false;
 view.renderReactions({id:'réponse',paths:[plugin.revisionDocument]},{querySelector:()=>controls});
 assert.ok(buttons.every(button=>button.disabled===true));assert.equal(clear.disabled,true);
 await view.react('réponse','down');await view.clearHighlights();
 assert.equal(reactions.length,3);assert.equal(cleared.length,2,'Le travail principal reste protégé.');
 session.busy=false;view.input.value='';

 plugin.highlightedDocument=null;
 plugin.revisionDocument=null;view.render();assert.equal(view.reviseButton.visible,false);assert.equal(view.sendButton.visible,true);
 view.input.value='Une question générale.';await view.send();assert.deepEqual(revisionCalls.at(-1),['Une question générale.',undefined,false]);view.input.value='';
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
  lifecycle.input.value='À conserver même en fermant le panneau.';
  await lifecycle.onClose();
  assert.equal(plugin.getDraft(plugin.settings.folder),'À conserver même en fermant le panneau.');
 }finally{
  if(savedNode===undefined)delete globalThis.Node;else globalThis.Node=savedNode;
  if(savedResize===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=savedResize;
 }

}

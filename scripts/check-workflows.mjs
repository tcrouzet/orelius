import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {fingerprint,parseState,selectReferences} from '../plugin/src/narrative-context.ts';
import {resolveTimeline} from '../plugin/src/timeline.ts';
import {reviewBatch} from '../plugin/src/review-queue.ts';
import {buildSceneContext} from '../plugin/src/scene-context.ts';
import {recordNarrativeState,consultMethod} from '../plugin/src/writing-methods.ts';
import {pendingStates,saveWorkflow,maintenancePrompt} from '../plugin/src/editorial-workflow.ts';
import {renderConditions,TASK_PROMPT_NAMES} from '../plugin/src/task-prompts.ts';
import {renderConversation,visibleMessages} from '../plugin/src/conversation.ts';

export async function checkWorkflows(){
 const root=await mkdtemp(join(tmpdir(),'orelius-workflows-'));
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 const templates=Object.fromEntries(await Promise.all(TASK_PROMPT_NAMES.map(async name=>[name,await readFile(new URL('../prompts/'+name+'.md',import.meta.url),'utf8')])));
 const chapter='Manuscript/Chapitres/001.md';
 try {
  assert.equal(renderConditions('{if:pov}A{if:tense}B{else}C{/if}{else}D{/if}',{pov:'Nora',tense:''}),'AC');
  assert.throws(()=>renderConditions('{if:absent}A{/if}',{}),/inconnue/);
  assert.throws(()=>renderConditions('{if:pov}A',{pov:'x'}),/fermée/);
  assert.throws(()=>renderConditions('{else}',{}),/ouverte/);
  const references=[{path:'Bible/A.md',name:'Nora',priority:1,secondary:['lettre'],secondaryMode:'all'},{path:'Bible/B.md',name:'Nora',priority:9}];
  assert.deepEqual(selectReferences(references,'Nora',[]).selected.map(r=>r.path),['Bible/B.md']);
  assert.deepEqual(selectReferences(references,'Nora lettre',[]).selected.map(r=>r.path),['Bible/B.md','Bible/A.md']);
  const first={chapter,hash:'',summary:'',facts:[],moments:[{id:'a',quote:'',description:'',at:10,unit:'hours',duration:2}]};
  const second={...first,chapter:'Manuscript/Chapitres/002.md',moments:[{id:'b',quote:'',description:'',after:chapter+'#a',offset:30,unit:'minutes'}]};
  const timeline=resolveTimeline([first,second]);
  assert.equal(timeline[0].end,43200);assert.equal(timeline[1].start,37800);
  assert.throws(()=>resolveTimeline([{...first,moments:[{...first.moments[0],after:second.chapter+'#b'}]},second]),/Cycle/);
  assert.throws(()=>resolveTimeline([first,{...second,moments:[{...second.moments[0],at:100}]}]),/contradictoires/);
  const text='Nora lit la lettre.\n\n'+ 'Texte '.repeat(450)+'\n\nNora ferme la porte.';
  await put(chapter,text);
  let context=await buildSceneContext(root,folders,{},chapter,'',templates);
  const opening=JSON.parse(await reviewBatch(root,folders,{action:'ouvrir'},context,()=>{}));
  assert.equal(opening.lot,0);assert.ok(opening.total>1);
  await assert.rejects(()=>reviewBatch(root,folders,{action:'terminer',lot:1,empreinte:opening.empreinte,remarques:[]},context,()=>{}),/ordre/);
  await assert.rejects(()=>reviewBatch(root,folders,{action:'terminer',lot:0,empreinte:opening.empreinte,remarques:[{quote:'Inventé',issue:'X',suggestion:'Y'}]},context,()=>{}),/citation/);
  let batch=JSON.parse(await reviewBatch(root,folders,{action:'terminer',lot:0,empreinte:opening.empreinte,remarques:[]},context,()=>{}));
  assert.equal(JSON.parse(await reviewBatch(root,folders,{action:'ouvrir'},context,()=>{})).lot,1);
  while(!batch.termine) batch=JSON.parse(await reviewBatch(root,folders,{action:'terminer',lot:batch.lot,empreinte:batch.empreinte,remarques:[]},context,()=>{}));
  assert.equal(batch.termines,batch.total);
  assert.equal(await readFile(join(root,chapter),'utf8'),text);
  await put(chapter,text+' Fin.');
  await assert.rejects(()=>reviewBatch(root,folders,{action:'suivant'},context,()=>{}),/changé/);
  assert.equal(JSON.parse(await reviewBatch(root,folders,{action:'ouvrir'},context,()=>{})).lot,0);
  assert.equal((await pendingStates(root,folders))[0].reason,'absent');
  const actual=text+' Fin.';
  const state={chapter,hash:fingerprint(actual),summary:'Lecture et fermeture.',facts:[{entity:'Bible/Nora.md',field:'Savoir',value:'Lettre lue',quote:'Nora lit la lettre.',mode:'append',knownBy:['Nora']}],moments:[]};
  await recordNarrativeState(root,folders,state,chapter,()=>{});
  assert.deepEqual(await pendingStates(root,folders),[]);
  context=await buildSceneContext(root,folders,{},chapter,'',templates);
  assert.equal(JSON.parse(await consultMethod(root,folders,{tache:'continuer',debut:0,fin:0,acteur:'Nora'},context,()=>{})).connaissancesAvantSelection.length,0);
  assert.equal(JSON.parse(await consultMethod(root,folders,{tache:'continuer',debut:actual.length,fin:actual.length,acteur:'Nora'},context,()=>{})).connaissancesAvantSelection.length,1);
  assert.equal(JSON.parse(await consultMethod(root,folders,{tache:'continuer',debut:actual.length,fin:actual.length,acteur:'Jonas'},context,()=>{})).connaissancesAvantSelection.length,0);
  await put('Bible/Nora.md','# Nora\n\nVisible.\n\n## Savoir\n\nSecret.');
  await put('Bible/Lettre.md','# Lettre\n\nNora.');
  const config={chapters:[],references:[{path:'Bible/Nora.md',name:'Nora',hiddenSections:['Savoir'],priority:1},{path:'Bible/Lettre.md',name:'lettre',priority:2}],referenceBudget:0};
  await put('Manuscript/Context/configuration.md','```json\n'+JSON.stringify(config)+'\n```\n');
  context=await buildSceneContext(root,folders,{},chapter,'',templates);
  assert.equal(context.sources.some(source=>source.path==='Bible/Lettre.md'),false);
  assert.equal(JSON.parse(await consultMethod(root,folders,{tache:'continuer',debut:actual.length,fin:actual.length,acteur:'Nora'},context,()=>{})).connaissancesAvantSelection.length,0);
  config.references[0].mode='always';
  await put('Manuscript/Context/configuration.md','```json\n'+JSON.stringify(config)+'\n```\n');
  await assert.rejects(()=>buildSceneContext(root,folders,{},chapter,'',templates),/hors budget/);
  delete config.referenceBudget;
  config.recursiveReferences=true;
  config.references.push({path:'Bible/Cache.md',name:'Visible'});
  await put('Bible/Cache.md','# Référence indirecte');
  await put('Manuscript/Context/configuration.md','```json\n'+JSON.stringify(config)+'\n```\n');
  context=await buildSceneContext(root,folders,{},chapter,'',templates);
  assert.ok(context.sources.some(source=>source.path==='Bible/Cache.md'));
  for(const name of await readdir(new URL('../wiki/',import.meta.url))){
    const file=new URL('../wiki/'+name,import.meta.url);
    for(const match of (await readFile(file,'utf8')).matchAll(/\]\(([^)]+)\)/g)){
      if(!/^(https?:|#)/.test(match[1])) await access(new URL(match[1].split('#')[0],file));
    }
  }
  await put(chapter,actual+' Autre.');
  const pending=await pendingStates(root,folders);
  assert.equal(pending[0].reason,'perime');
  await saveWorkflow(root,folders,pending);
  assert.ok((await readFile(join(root,'Manuscript/Context/suivi-etats.md'),'utf8')).includes(chapter));
  const messages=[{id:'u',role:'user',text:maintenancePrompt(pending),paths:[]},{id:'f',role:'assistant',phase:'final_answer',text:'Technique',paths:[]}];
  assert.equal(renderConversation([{id:'internal',date:null,completed:true,messages}]),'');
  assert.deepEqual(visibleMessages(messages,[]),[]);
  assert.throws(()=>parseState({...state,hash:fingerprint('Nora. Nora.'),facts:[{...state.facts[0],quote:'Nora.'}]},chapter,'Nora. Nora.'),/ambiguë/);
 } finally {await rm(root,{recursive:true,force:true});}
}

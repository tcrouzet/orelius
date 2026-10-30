import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncStructure, structurePath, structureView, parseStructure } from '../plugin/src/story-structure.ts';
import { outlineRelations } from '../plugin/src/novel-outline.ts';
import { DEFAULT_PROJECT_FOLDERS as folders } from '../plugin/src/settings.ts';
import { projectSources } from '../plugin/src/project-sources.ts';
import { changeImpacts } from '../plugin/src/change-impact.ts';
import { collectChanges, deliverChanges } from '../plugin/src/workshop.ts';

export async function checkOutline() {
 const root=await mkdtemp(join(tmpdir(),'orelius-outline-'));
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 const chapter='Manuscript/Chapitres/001.md', second='Manuscript/Chapitres/002.md', scene='Manuscript/Scenes/entree.md', next='Manuscript/Scenes/sortie.md', person='Bible/Personnages/Nadia.md', plot='Manuscript/Intrigues/enquete.md';
 try {
  for(const path of [chapter,second,scene,next,person,plot]) await put(path,path===chapter?'Nadia entre.':path);
  let data=await syncStructure(root,folders);
  const id=path=>data.nodes.find(node=>node.path===path).id;
  const sceneId=id(scene),chapterId=id(chapter),secondId=id(second),nextId=id(next);
  const edit=async action=>data=await syncStructure(root,folders,{outline:{expected:JSON.stringify(data),action}});
  await edit({type:'initialize'});
  assert.equal(data.outline.scenes.length,2);assert.equal(data.outline.chapters.length,2);
  assert.ok(data.outline.scenes.every(item=>item.chapter===null));
  const unlinked=await collectChanges(root,folders);
  assert.ok(unlinked.pending.some(item=>item.path===structurePath(folders)),'Le plan est transmis même sans lien ancien.');
  await deliverChanges(root,folders,unlinked);
  await edit({type:'act',title:'Premier acte'});await edit({type:'act',title:'Second acte'});
  const act=data.outline.acts[0].id;
  await edit({type:'chapter',id:chapterId,act});await edit({type:'chapter',id:secondId,act:data.outline.acts[1].id});
  const move=(id,chapter,before=null)=>({type:'scene',id,chapter,before,pov:'Nadia',status:'draft'});
  await edit(move(sceneId,chapterId));await edit(move(nextId,chapterId,sceneId));
  assert.deepEqual(data.outline.scenes.filter(item=>item.chapter===chapterId).map(item=>item.id),[nextId,sceneId]);
  assert.equal(outlineRelations(data).find(item=>item.from===nextId).order,0);
  for(const path of [person,plot]) {
   const from=data.nodes.find(node=>node.path===path),to=data.nodes.find(node=>node.id===sceneId);
   data=await syncStructure(root,folders,{link:{from:from.id,to:to.id,fromHash:from.hash,toHash:to.hash,relation:'implique'}});
  }
  const from=data.nodes.find(node=>node.id===sceneId),to=data.nodes.find(node=>node.id===chapterId);
  data=await syncStructure(root,folders,{link:{from:from.id,to:to.id,fromHash:from.hash,toHash:to.hash,relation:'realise',quote:'Nadia entre.',at:0}});
  const links=structuredClone(data.links),old=JSON.stringify(data);
  await edit(move(sceneId,secondId));
  assert.deepEqual(data.links,links,'Le déplacement conserve personnages, intrigue et citation écrite.');
  assert.ok(outlineRelations(data).some(item=>item.from===sceneId && item.to===secondId));
  assert.ok(!outlineRelations(data).some(item=>item.from===sceneId && item.to===chapterId));
  assert.equal(await readFile(join(root,chapter),'utf8'),'Nadia entre.');
  const impacts=changeImpacts(await projectSources(root,folders),folders,[scene],[],data).get(scene);
  assert.ok(impacts.some(item=>item.path===second));assert.ok(impacts.some(item=>item.path===chapter));
  await assert.rejects(syncStructure(root,folders,{outline:{expected:old,action:move(sceneId,chapterId)}}),/changé/);
  const snapshot=await readFile(join(root,structurePath(folders)),'utf8');
  for(const action of [move(sceneId,secondId,sceneId),move(sceneId,secondId,nextId),move(sceneId,id(person)),{type:'chapter',id:chapterId,act:'unknown'},{...move(sceneId,secondId),status:'__proto__'}]) await assert.rejects(edit(action));
  assert.equal(await readFile(join(root,structurePath(folders)),'utf8'),snapshot);
  const renamed='Manuscript/Scenes/arrivee.md';await rename(join(root,scene),join(root,renamed));
  data=await syncStructure(root,folders,{rename:{from:scene,to:renamed}});
  assert.equal(data.outline.scenes.find(item=>item.id===sceneId).chapter,secondId);
  assert.equal(data.nodes.find(item=>item.id===sceneId).path,renamed);
  const stale=JSON.stringify(data);await put(renamed,'Scène changée par l’auteur.');
  await assert.rejects(syncStructure(root,folders,{outline:{expected:stale,action:move(sceneId,chapterId)}}),/changé/);
  data=await syncStructure(root,folders);
  await rm(join(root,second));data=await syncStructure(root,folders);
  assert.equal(data.outline.scenes.find(item=>item.id===sceneId).chapter,secondId,'Parent absent conservé, jamais réaffecté silencieusement.');
  await edit(move(sceneId,null));
  assert.ok(!outlineRelations(data).some(item=>item.from===sceneId));
  assert.equal(structureView(data,await projectSources(root,folders)).outline.scenes.find(item=>item.id===sceneId).pov,'Nadia');
  const changed=await collectChanges(root,folders);assert.ok(changed.pending.some(item=>item.path===structurePath(folders)));
  const invalid=structuredClone(data);invalid.outline.scenes.push(invalid.outline.scenes[0]);
  assert.throws(()=>parseStructure(invalid,folders),/invalide/);
  assert.ok((await readdir(join(root,'Archives/Manuscript/Context'))).some(name=>name.startsWith('Structure.')));
  const legacy={version:1,nodes:data.nodes,links:data.links};assert.deepEqual(parseStructure(legacy,folders),legacy);
 } finally { await rm(root,{recursive:true,force:true}); }
}

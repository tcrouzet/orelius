import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {changeImpacts} from '../plugin/src/change-impact.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {fingerprint} from '../plugin/src/narrative-context.ts';
import {collectChanges,deliverChanges,withChanges,withoutChanges} from '../plugin/src/workshop.ts';

export async function checkImpact(){
 const arc='Manuscript/Arcs/Jonas.md',scene='Manuscript/Scenes/cuisine.md',chapter='Manuscript/Chapitres/002.md';
 const source=(path,content)=>({path,content,hash:fingerprint(content)});
 const sources=[source(arc,'Il veut provoquer la publication.'),source(scene,`Motivation : [[${arc}]]. Chapitre : [002](../Chapitres/002.md).`),source(chapter,'Jonas ouvre la vidéo.'),source('Manuscript/Chapitres/003.md','Jonas attend.'),source('Manuscript/Chapitres/004.md','Nadia parle.'),source('Manuscript/Scenes/index.md',`[[${scene}]]`),source('Manuscript/Scenes/autre.md','[[index]]\n[[Manuscript/Chapitres/004.md]]')];
 let impacts=changeImpacts(sources,folders,[arc]).get(arc);
 assert.equal(impacts.find(item=>item.path===scene).certainty,'lien explicite');
 const linked=impacts.find(item=>item.path===chapter);
 assert.equal(linked.certainty,'lien explicite','Un chemin explicite prime sur une mention directe.');
 assert.deepEqual(linked.chain.map(item=>item.from),[arc,scene]);
 assert.ok(linked.chain.every(item=>item.excerpt.includes('Motivation')));
 assert.equal(impacts.find(item=>item.path.endsWith('/003.md')).certainty,'à vérifier');
 assert.equal(impacts.some(item=>item.path.endsWith('/004.md')),false,'Un index ne diffuse pas le changement partout.');
 impacts=changeImpacts(sources.filter(item=>item.path!==arc),folders,[arc]).get(arc);
 assert.ok(impacts.some(item=>item.path===chapter),'Une source supprimée reste identifiable dans les liens.');
 const ambiguous=[...sources,source('Bible/Personnages/Jonas.md','Autre fiche'),source('Manuscript/Scenes/ambigu.md','[[Jonas]]'),source('Manuscript/Scenes/exemple.md','```md\n[[Manuscript/Arcs/Jonas.md]]\n```'),source('Manuscript/Scenes/faux.md','Manuscript/Arcs/Jonas.md.bak')];
 impacts=changeImpacts(ambiguous,folders,[arc]).get(arc);
 for(const name of ['ambigu','exemple','faux']) assert.equal(impacts.some(item=>item.path.endsWith('/'+name+'.md')),false,name);
 const continuity=changeImpacts(sources,folders,[chapter]).get(chapter);
 assert.ok(continuity.some(item=>item.path.endsWith('/003.md')&&item.chain[0].kind==='raccord'));
 assert.equal(continuity.some(item=>item.path.endsWith('/004.md')),false,'Un raccord potentiel ne se propage pas à tous les chapitres suivants.');
 const deletedContinuity=changeImpacts(sources.filter(item=>item.path!==chapter),folders,[chapter]).get(chapter);
 assert.ok(deletedContinuity.some(item=>item.path.endsWith('/003.md')));
 const narration='Bible/Style/Narration.md';
 const global=changeImpacts([...sources,source(narration,'Nouvelle voix')],folders,[narration]).get(narration);
 assert.deepEqual(global.map(item=>item.path),sources.filter(item=>item.path.includes('/Chapitres/')).map(item=>item.path));
 assert.ok(global.every(item=>item.certainty==='à vérifier'));
 const entity='Bible/Personnages/La sœur.md';
 const config={chapters:[{path:chapter,references:[entity]}],references:[{path:entity,name:'Louise',aliases:['Loulou']}]};
 const configured=[source(entity,'Fiche'),source(chapter,'Elle ouvre la vidéo.'),source('Manuscript/Chapitres/003.md','Loulou attend.'),source('Manuscript/Context/configuration.md','```json\n'+JSON.stringify(config)+'\n```')];
 const configuredImpacts=changeImpacts(configured,folders,[entity]).get(entity);
 assert.equal(configuredImpacts.find(item=>item.path===chapter).chain[0].kind,'configuration');
 assert.equal(configuredImpacts.find(item=>item.path.endsWith('/003.md')).chain[0].kind,'mention');
 const brokenConfig='Manuscript/Context/configuration.md';
 const invalid=changeImpacts([source(chapter,'Texte'),source(brokenConfig,'JSON cassé')],folders,[brokenConfig]).get(brokenConfig);
 assert.ok(invalid[0].chain[0].excerpt.includes('Configuration illisible'));
 const state={chapter,hash:fingerprint('Elle ouvre la vidéo.'),summary:'Une vidéo.',facts:[{entity,field:'Savoir',value:'Elle connaît la vidéo.',quote:'Elle ouvre la vidéo.',knownBy:['Louise'],mode:'append'}],moments:[]};
 const extracted=changeImpacts(configured.filter(item=>!item.path.includes('/Context/')),folders,[entity],[state]).get(entity);
 assert.equal(extracted[0].chain[0].kind,'etat');
 assert.ok(extracted[0].chain[0].excerpt.includes('connu de Louise'));
 const root=await mkdtemp(join(tmpdir(),'orelius-impact-'));
 try {
  for(const item of sources){await mkdir(join(root,item.path,'..'),{recursive:true});await writeFile(join(root,item.path),item.content);}
  await deliverChanges(root,folders,await collectChanges(root,folders));
  await writeFile(join(root,arc),'Il veut empêcher la publication.');
  const delivery=await collectChanges(root,folders);
  assert.equal(delivery.pending.length,1);
  assert.ok(delivery.pending[0].affected.some(item=>item.path===chapter));
  const prompt=withChanges('Révise 002.',delivery);
  assert.ok(prompt.includes('affected')&&prompt.includes('cuisine.md'));
  assert.equal(withoutChanges(prompt),'Révise 002.');
  const ledger=await readFile(join(root,'Manuscript/Context/Modifications.md'),'utf8');
  assert.ok(ledger.includes('lien explicite')&&ledger.includes(scene));
  assert.equal(await readFile(join(root,chapter),'utf8'),'Jonas ouvre la vidéo.');
  assert.equal((await collectChanges(root,folders)).pending.length,1,'Le relevé reste en attente sans acquittement.');
  await deliverChanges(root,folders,delivery);
  assert.equal((await collectChanges(root,folders)).pending.length,0);
 } finally {await rm(root,{recursive:true,force:true});}
}

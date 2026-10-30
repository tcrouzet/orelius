import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeComparison, saveVariants, comparisonVersions, applyComparison } from '../plugin/src/comparison.ts';
import { diffToGroups } from '../plugin/src/diff.ts';
import { readProjectFile } from '../plugin/src/project-files.ts';
import { selectionRequest, selectionPlan } from '../plugin/src/selection-actions.ts';
import { DEFAULT_PROJECT_FOLDERS as folders } from '../plugin/src/settings.ts';

export async function checkComparison() {
 const before='Louise parle.\n\nNadia attend.\n',after='Louise crie.\n\nNadia sort.\n';
 const groups=diffToGroups(before,after);
 assert.equal(groups.length,2);
 assert.equal(mergeComparison(before,after,new Set([0])),'Louise crie.\n\nNadia attend.\n');
 for(const [a,b] of [[before,after],['','🖋'],['Une phrase.',''],['a 🖋 b','a 😀 b'],['a\n\nb','a\nb\n'],['même même','autre même']]) {
  assert.equal(mergeComparison(a,b,new Set()),a);
  assert.equal(mergeComparison(a,b,new Set(diffToGroups(a,b).map((_,i)=>i))),b);
 }
 assert.throws(()=>mergeComparison(before,after,new Set([50])),/invalide/);
 const cwd=await mkdtemp(join(tmpdir(),'orelius-comparison-')),chapter='Manuscript/Chapitres/002.md';
 try {
  await mkdir(join(cwd,'Manuscript/Chapitres'),{recursive:true});await writeFile(join(cwd,chapter),before);
  const request=selectionRequest('variantes',chapter,before,7,12),plan=selectionPlan(request,before);
  const args={variantes:[{titre:'Brève',texte:'crie'},{titre:'Autre',texte:'murmure'}]};
  await assert.rejects(saveVariants(cwd,folders,null,args,()=>{}),/sélection/);
  for(const invalid of [{},{variantes:[]},{variantes:[null,null]},{...args,chemin:'../../x'},{variantes:[{titre:'a',texte:''},{titre:'b',texte:'b'}]}]) await assert.rejects(saveVariants(cwd,folders,plan,invalid,()=>{}));
  await saveVariants(cwd,folders,plan,args,()=>{});
  assert.equal(await readFile(join(cwd,chapter),'utf8'),before);
  let versions=await comparisonVersions(cwd,folders,chapter,before);
  assert.equal(versions.length,3);assert.equal(versions[1].text,'Louise crie.\n\nNadia attend.\n');
  let previous=await readProjectFile(cwd,chapter);
  await assert.rejects(applyComparison(cwd,folders,chapter,previous,after,()=>{throw Error('éditeur');}),/éditeur/);
  assert.equal(await readFile(join(cwd,chapter),'utf8'),before);
  const archives=await applyComparison(cwd,folders,chapter,previous,after,()=>{});
  assert.equal(await readFile(join(cwd,archives[0]),'utf8'),before);
  assert.equal(await readFile(join(cwd,archives[1]),'utf8'),after);
  await assert.rejects(applyComparison(cwd,folders,chapter,previous,'écrasement',()=>{}),/changé/);
  await assert.rejects(saveVariants(cwd,folders,plan,args,()=>{}),/changé/);
  versions=await comparisonVersions(cwd,folders,chapter,after);
  assert.ok(versions[1].label.includes('ancienne version'));
  const archive=versions.find(v=>v.archive && v.text===before);assert.ok(archive);
  previous=await readProjectFile(cwd,chapter);
  await applyComparison(cwd,folders,chapter,previous,archive.text,()=>{});
  assert.equal(await readFile(join(cwd,chapter),'utf8'),before);
  assert.equal(await readFile(join(cwd,archive.archive),'utf8'),before);
  await assert.rejects(comparisonVersions(cwd,folders,'../../outside.md',before),/chapitre/);
  previous=await readProjectFile(cwd,chapter);
  await assert.rejects(applyComparison(cwd,folders,chapter,previous,after,()=>{},async()=>{throw Error('archive impossible');}),/archive impossible/);
  assert.equal(await readFile(join(cwd,chapter),'utf8'),before);
 } finally { await rm(cwd,{recursive:true,force:true}); }
}

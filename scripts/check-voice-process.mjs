import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildSceneContext,checkSceneContext} from '../plugin/src/scene-context.ts';
import {withContext} from '../plugin/src/request-context.ts';
import {linkedStyleExamples} from '../plugin/src/style-examples.ts';
import {publicationFeedback,parsePublicationVerdict,PublicationReview} from '../plugin/src/publication-review.ts';
import {publicationVerdict} from './check-publication.mjs';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';

export async function checkVoiceProcess(){
 const root=await mkdtemp(join(tmpdir(),'orelius-voice-process-'));
 const chapter='Manuscript/001.md',profile='Model/profile.md',example='Model/Cadence/Exemple1.md',style='Bible/Style/Voix-Nora.md';
 const put=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
 const prose='Une voix sans étiquette.\n\n'+'Une longue matière qui ne contient pas les mots de la demande. '.repeat(90)+'\n\nFIN DE L’EXEMPLE.\nExemple inspiré de Model/profile.md';
 try{
  await put(chapter,'Nora écrit une lettre.');
  await put('Bible/Style/Narration.md','Narration à la première personne.');
  await put('Bible/Characters/Nora.md','Nora est musicienne. Sa voix est décrite dans Model/profile.md.');
  await put(profile,'Français maîtrisé et registre singulier. On peut s’inspirer de Model/Cadence/Exemple1 pour sa façon d’écrire.');
  await put(example,prose);
  await put(style,'- [essentiel] Le registre demandé doit être audible dès la première lettre.\n- [a-eviter] Réduire cette voix à un mot ajouté à une prose neutre.\n- [secondaire] Préférer des paragraphes courts.\n- [suspendu] Tout rédiger au passé.');
  for(let i=0;i<18;i++)await put(`Bible/World/lettre-${i}.md`,'Lettre de Nora. Nora écrit la lettre musicale, la première lettre.');
  const inventory=[{path:example,content:prose,hash:''}];
  for(const link of ['Voix : Model/Cadence/Exemple1','Writing example: [[Model/Cadence/Exemple1.md]]','Style : [référence](Model/Cadence/Exemple1.md)','Style : [[Exemple1]]','Voix à suivre :\n[[Model/Cadence/Exemple1.md]]'])assert.deepEqual(linkedStyleExamples(link,inventory),[example]);
  assert.deepEqual(linkedStyleExamples('Une information sur Model/Cadence/Exemple1',inventory),[]);
  const context=await buildSceneContext(root,folders,{},chapter,'Écris la première lettre de Nora.');
  const selected=context.sources.find(source=>source.path===example);
  assert.ok(selected,'Un exemple explicitement désigné traverse la chaîne profil → exemple, quel que soit le classement lexical.');
  assert.equal(selected.role,'style-example-not-canon');assert.equal(selected.content,prose,'Le texte entier, pas trois extraits, est transmis.');
  assert.equal(context.sources.filter(source=>source.path===example).length,1,'Les renvois cycliques ne dupliquent pas les sources.');
  const excluded=await buildSceneContext(root,folders,{},chapter,withContext('Écris la première lettre de Nora.',{chapter,include:[],exclude:[example]}));
  assert.equal(excluded.sources.some(source=>source.path===example),false,'Un choix explicite d’exclusion reste respecté.');
  const input={candidat:'Nora écrit une lettre neutre.',preparation:'Développer une voix singulière.',contexte:context};
  const obligations=publicationFeedback(input).filter(item=>item.source===style);
  assert.equal(obligations.length,2);assert.ok(obligations.some(item=>item.attente.includes('[essentiel]')));assert.ok(obligations.some(item=>item.attente.includes('[a-eviter]')));
  const globalOnly=publicationVerdict(input);globalOnly.retours=globalOnly.retours.filter(item=>!obligations.some(goal=>goal.id===item.id));
  assert.throws(()=>parsePublicationVerdict(globalOnly,input),/Chaque retour/,'Un verdict favorable global ne remplace pas le contrôle des exigences de voix.');
  await put(context.preparationPath,input.preparation);
  const gate=new PublicationReview();
  await assert.rejects(gate.check(root,folders,input,async value=>{
   const verdict=publicationVerdict(value);
   const item=verdict.retours.find(item=>item.id===obligations[0].id);item.conforme=false;item.constat='Le registre est absent de la prose.';item.correction='Reprendre le rythme et la syntaxe à partir de l’exemple fourni.';
   return verdict;
  }),error=>!error.terminal&&/registre est absent/.test(error.message));
  const evidence=publicationVerdict(input);Object.assign(evidence.controles.find(item=>item.axe==='voix'),{source:example,preuve:'Une voix sans étiquette.'});
  assert.doesNotThrow(()=>parsePublicationVerdict(evidence,input));
  await put('Tracking/configuration.md','```json\n'+JSON.stringify({chapters:[],references:[],referenceBudget:4000})+'\n```');
  await assert.rejects(buildSceneContext(root,folders,{},chapter,'Écris la première lettre de Nora.'),/Exemple1/,'Un exemple requis dépassant le budget est signalé, jamais omis silencieusement.');
  await put(example,prose+'\nModification humaine');
  await assert.rejects(checkSceneContext(root,context),/Source modifiée/);
 }finally{await rm(root,{recursive:true,force:true});}
}

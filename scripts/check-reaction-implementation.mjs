import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareProject} from '../plugin/src/archives.ts';
import {DEFAULT_PROJECT_FOLDERS as folders} from '../plugin/src/settings.ts';
import {toChatItem} from '../plugin/src/session.ts';
import {reactionExchanges,recordReaction,implementedReaction} from '../plugin/src/reactions.ts';
import {recordAcceptance} from '../plugin/src/acceptance.ts';
import {buildSceneContext} from '../plugin/src/scene-context.ts';
import {readEditorialContext} from '../plugin/src/editorial-context.ts';

export async function checkReactionImplementation(){
 const root=await mkdtemp(join(tmpdir(),'orelius-rated-versions-'));
 const chapter='Manuscript/001.md',next='Manuscript/002.md',character='Bible/Characters/YQ.md';
 const written=(path,content,extra={})=>toChatItem({id:path,type:'mcpToolCall',server:'orelius',tool:'ecrire_fichier',status:'completed',arguments:{chemin:path,contenu:content},result:{content:[{type:'text',text:JSON.stringify({fichier:path,modifie:true})}]},...extra});
 const turn={id:'turn',completed:true,date:null,messages:[
  {id:'u',role:'user',text:'Écris la lettre de YQ.',paths:[]},
  written(chapter,'Premier essai.'),written(character,'YQ développe son raisonnement.'),written(chapter,'Version réellement écrite.'),
  written(chapter,'Refusé.',{result:{isError:true}}),
  {id:'answer',role:'assistant',phase:'final_answer',text:'Lettre et fiche enregistrées.',paths:[]}
 ]};
 const exchange=reactionExchanges([turn]).get('answer');
 assert.deepEqual(exchange.versions,[{path:chapter,content:'Version réellement écrite.'},{path:character,content:'YQ développe son raisonnement.'}]);
 assert.deepEqual(written(chapter,'Sans changement',{result:{content:[{type:'text',text:JSON.stringify({fichier:chapter,modifie:false})}]}}).writtenVersions,[]);
 assert.equal(implementedReaction('Ancien avis sans versions.'),null);
 assert.equal(implementedReaction('Mise en œuvre : {"value":"up","versions":[{"path":"../secret.md","content":"x"}]}'),null);
 try {
  await prepareProject(root,folders);
  await writeFile(join(root,chapter),'Version réellement écrite.');
  await writeFile(join(root,next),'Lettre suivante de YQ.');
  await writeFile(join(root,character),'YQ développe son raisonnement.');
  const acceptance=await recordAcceptance(root,folders,chapter,{before:'Avant.',after:'Version réellement écrite.'},'Accepté.');
  await writeFile(join(root,chapter),'Retouches humaines ultérieures.');
  const heart=await recordReaction(root,folders,'session',exchange,'heart','Garde cette ampleur, sauf la dernière phrase.');
  const report=await readFile(join(root,heart.report),'utf8');
  assert.deepEqual(implementedReaction(report),{value:'heart',versions:exchange.versions});
  assert.equal(report.includes('Retouches humaines ultérieures.'),false,'La note actuelle ne remplace jamais la version évaluée.');
  let context=await buildSceneContext(root,folders,{},next,'Continue la lettre de YQ.');
  assert.ok(context.sources.some(s=>s.role==='approved-voice'&&s.content.includes('FORTEMENT VALIDÉ')&&s.content.includes('sauf la dernière phrase')));
  assert.ok(context.sources.some(s=>s.content.includes(character)&&s.content.includes('FORTEMENT VALIDÉ')));
  const ordinaryExchange={...exchange,turnId:'ordinary',answer:{...exchange.answer,id:'ordinary'},versions:[{path:next,content:'Une version ordinaire.'}]};
  const ordinary=await recordReaction(root,folders,'session',ordinaryExchange,'up','Correct.');
  context=await buildSceneContext(root,folders,{},next);
  assert.ok(context.sources.some(s=>s.role==='approved-voice'&&s.content.includes('FORTEMENT VALIDÉ')),'Le cœur prime sur une validation simple plus récente d’une autre version.');
  await recordReaction(root,folders,'session',ordinaryExchange,'down','Finalement non.',ordinary);
  const up=await recordReaction(root,folders,'session',exchange,'up','Bien, sans en faire le modèle prioritaire.',heart);
  context=await buildSceneContext(root,folders,{},next);
  assert.ok(context.sources.some(s=>s.role==='approved-voice'&&s.content.includes('VALIDÉ')));
  assert.equal(context.sources.some(s=>s.content.includes('FORTEMENT VALIDÉ')),false);
  const down=await recordReaction(root,folders,'session',exchange,'down','Trop abstrait.',up);
  context=await buildSceneContext(root,folders,{},next);
  assert.equal(context.sources.some(s=>s.role==='approved-voice'),false,'Le rejet retire aussi cette version des acceptations antérieures.');
  assert.ok(context.sources.some(s=>s.content.includes('INVALIDÉ')));
  assert.equal(context.sources.some(s=>s.path===acceptance),false);
  const general=(await readEditorialContext(root,folders,{})).flatMap(page=>JSON.parse(page).sources);
  assert.equal(general.some(s=>s.path===acceptance),false);
  assert.equal(general.some(s=>s.path===heart.report||s.path===up.report),false);
  assert.ok(general.some(s=>s.path===down.report));
  assert.equal(await readFile(join(root,chapter),'utf8'),'Retouches humaines ultérieures.');
  assert.equal(await readFile(join(root,character),'utf8'),'YQ développe son raisonnement.');
  assert.equal(await readFile(join(root,heart.report),'utf8'),report,'Les anciens verdicts restent archivés.');
  await writeFile(join(root,chapter),'Version réellement écrite.');
  await recordAcceptance(root,folders,chapter,{before:'Avant.',after:'Version réellement écrite.'},'Finalement je valide cette version.');
  context=await buildSceneContext(root,folders,{},next);
  assert.ok(context.sources.some(s=>s.role==='approved-voice'&&s.content.includes('Finalement je valide')),'Une acceptation plus récente prime sur le rejet.');
 } finally {await rm(root,{recursive:true,force:true});}
}

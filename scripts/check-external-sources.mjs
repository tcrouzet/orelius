import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {externalSources,prepareSourceConfig} from '../plugin/src/external-sources.ts';
import {ProjectMcp,SOURCES_TOOL} from '../plugin/src/mcp.ts';

export async function checkExternalSources() {
 const root=await mkdtemp(join(tmpdir(),'orelius-external-'));
 const project=join(root,'project'),first=join(root,'documents'),second=join(root,'other');
 const parse=text=>text.trim()==='sources: []'?{sources:[]}:JSON.parse(text);
 let server;
 try {
  for(const path of [project,first,second])await mkdir(path);
  await prepareSourceConfig(project,'Archives',parse);
  assert.deepEqual(JSON.parse(await externalSources(project,{},parse)).sources,[]);
  const config=sources=>'---\n'+JSON.stringify({sources})+'\n---\n\n# Notes personnelles\n';
  const definitions=[{path:first,description:'Événements personnels et chronologie.'},{path:second,description:'Textes techniques à consulter pour les métiers.'},{url:'https://example.org/articles',description:'Articles récents à consulter selon le sujet.'},{path:join(second,'source.txt'),description:'Un document précis.'}];
  const legacy='---\nsources:\n  - '+JSON.stringify(first)+'\n  - '+JSON.stringify(second)+'\nother: untouched\n---\n\n# Ma note\nÀ préserver.\n';
  await writeFile(join(project,'config.md'),legacy);
  const parseLegacy=text=>{assert.ok(text.includes('other: untouched'));const description=text.match(/description: ("[^\n]*")/);return {sources:description?[first,second].map(path=>({path,description:JSON.parse(description[1])})):[first,second],other:'untouched'};};
  await prepareSourceConfig(project,'Archives',parseLegacy);
  const migrated=await readFile(join(project,'config.md'),'utf8');
  assert.ok(migrated.includes('path: '+JSON.stringify(first)));assert.ok(migrated.includes('path: '+JSON.stringify(second)));
  assert.ok(migrated.includes('description:'));assert.ok(migrated.includes('\nother: untouched\n'));assert.ok(migrated.endsWith('# Ma note\nÀ préserver.\n'));
  assert.equal(migrated.includes('  - '+JSON.stringify(first)),false);
  await writeFile(join(project,'config.md'),legacy);
  let reads=0;
  await prepareSourceConfig(project,'Archives',text=>{if(reads++)throw Error('Invalid migration');return parseLegacy(text);});
  assert.equal(await readFile(join(project,'config.md'),'utf8'),legacy,'Une conversion YAML non vérifiable préserve le fichier original.');
  const original=config(definitions);await writeFile(join(project,'config.md'),original);
  await prepareSourceConfig(project,'Archives',parse);assert.equal(await readFile(join(project,'config.md'),'utf8'),original);
  await mkdir(join(first,'nested'));await writeFile(join(first,'nested','reference.md'),'Faits documentaires.\n'+'Texte '.repeat(1500));
  await writeFile(join(second,'source.txt'),'Autre dossier.');await writeFile(join(first,'.private.md'),'Privé');
  await symlink(join(second,'source.txt'),join(first,'link.md'));
  const before=await stat(join(first,'nested','reference.md'));
  const call=async args=>JSON.parse(await externalSources(project,args,parse));
  assert.deepEqual((await call({})).sources,definitions.map((source,index)=>({source:index,...source})));
  assert.equal((await call({source:0})).description,definitions[0].description);
  const web=await call({source:2});assert.equal(web.url,definitions[2].url);assert.equal(web.description,definitions[2].description);
  assert.equal(web.contenu,undefined,'Une URL annoncée ne constitue pas une page consultée.');
  assert.equal((await call({source:3})).contenu,'Autre dossier.');
  await assert.rejects(call({source:2,chemin:'autre-page'}));
  assert.deepEqual((await call({source:0})).documents,[{chemin:'nested',type:'dossier'}]);
  const page0=await call({source:0,chemin:'nested/reference.md'}),page1=await call({source:0,chemin:'nested/reference.md',page:1});
  assert.equal(page0.pages,2);assert.equal(page0.contenu+page1.contenu,await readFile(join(first,'nested','reference.md'),'utf8'));
  assert.equal((await call({source:1,chemin:'source.txt'})).contenu,'Autre dossier.');
  for(const args of [{source:4},{source:0,chemin:'../other/source.txt'},{source:0,chemin:join(second,'source.txt')},{source:0,chemin:'.private.md'},{source:0,page:-1},{source:0,page:1},{source:0,action:'write'},{chemin:'a.md'},{source:0,chemin:'nested/reference.md',page:4}])await assert.rejects(call(args));
  await assert.rejects(call({source:0,chemin:'link.md'}),/liens symboliques/);
  const after=await stat(join(first,'nested','reference.md'));assert.equal(after.mtimeMs,before.mtimeMs);
  server=new ProjectMcp(async()=>{throw Error('Aucune écriture autorisée dans ce test');},...Array(9).fill(undefined),args=>externalSources(project,args,parse));
  const url=await server.start();
  const rpc=async(method,params)=> (await (await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${server.token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json()).result;
  const tool=(await rpc('tools/list',{})).tools.find(item=>item.name===SOURCES_TOOL);
  assert.equal(tool.annotations.readOnlyHint,true);
  const response=await rpc('tools/call',{name:SOURCES_TOOL,arguments:{source:1,chemin:'source.txt'}});
  assert.equal(response.isError,false);assert.equal(JSON.parse(response.content[0].text).contenu,'Autre dossier.');
  const catalogue=await rpc('tools/call',{name:SOURCES_TOOL,arguments:{}});assert.equal(JSON.parse(catalogue.content[0].text).sources[2].description,definitions[2].description);
  await writeFile(join(project,'config.md'),config([]));
  await assert.rejects(call({source:0,chemin:'nested/reference.md'}),'La suppression d’un accès est prise en compte sans reconnexion.');
  for(const sources of [['relative'],[7],null,[{path:first}],[{path:first,description:' '}],[{path:first,url:'https://example.org',description:'Ambiguë'}],[{url:'file:///etc/passwd',description:'Refusé'}],[{url:'https://user:secret@example.org',description:'Refusé'}],[{url:'pas une url',description:'Refusé'}]]){await writeFile(join(project,'config.md'),config(sources));await assert.rejects(call({}));}
  await writeFile(join(project,'config.md'),'Pas de YAML');await assert.rejects(call({}));
 }finally{await server?.stop();await rm(root,{recursive:true,force:true});}
}

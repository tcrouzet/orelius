import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,writeFile,symlink,realpath,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexClient,findCodex} from '../plugin/src/codex.ts';
import {t} from '../plugin/src/i18n.ts';

export async function checkCodexLauncher(executable) {
 const folder=await realpath(await mkdtemp(join(tmpdir(),'orelius-native-codex-')));
 const clients=[];
 const make=()=>{const client=new CodexClient({notification(){},request(){},exit(){}});clients.push(client);return client;};
 const previousPath=process.env.PATH;
 try {
  process.env.PATH='/usr/bin:/bin:/usr/sbin:/sbin';
  const installed=make();
  const version=await installed.connect(executable,folder);
  const native=installed.child.spawnfile;
  const file=await open(native,'r'),header=Buffer.alloc(4);
  try {await file.read(header,0,4,0);} finally {await file.close();}
  assert.notEqual(header.subarray(0,2).toString(),'#!','La connexion utilise le programme compilé, sans interpréteur Node.');
  assert.match(version,/^\d+\.\d+\.\d+/);
  await installed.stop();
  const targets={'darwin:arm64':'aarch64-apple-darwin','darwin:x64':'x86_64-apple-darwin','linux:arm64':'aarch64-unknown-linux-musl','linux:x64':'x86_64-unknown-linux-musl','win32:arm64':'aarch64-pc-windows-msvc','win32:x64':'x86_64-pc-windows-msvc'};
  const target=targets[process.platform+':'+process.arch];
  const name=process.platform==='win32'?'codex.exe':'codex';
  for(const layout of ['dependency-bin','dependency-codex','bundled-codex']) {
   const root=join(folder,layout,'node_modules','@openai','codex');
   const launcher=join(root,'bin','codex.js'), link=join(folder,layout,'codex');
   await mkdir(dirname(launcher),{recursive:true});
   await writeFile(join(root,'package.json'),JSON.stringify({name:'@openai/codex'}));
   await writeFile(launcher,'#!/usr/bin/env node\nthrow new Error("Le lanceur JavaScript ne doit jamais être exécuté.");\n',{mode:0o755});
   await symlink(launcher,link);
   const dependency=layout.startsWith('dependency')?join(root,'node_modules','@openai',`codex-${process.platform}-${process.arch}`):root;
   if(dependency!==root){await mkdir(dependency,{recursive:true});await writeFile(join(dependency,'package.json'),'{}');}
   const binary=join(dependency,'vendor',target,layout.endsWith('-bin')?'bin':'codex',name);
   await mkdir(dirname(binary),{recursive:true});await symlink(native,binary);
   assert.equal(await findCodex(link),link,'Le chemin configuré reste stable entre les mises à jour npm.');
   const client=make();assert.equal(await client.connect(link,folder),version);
   assert.equal(client.child.spawnfile,binary,'Le binaire correspondant à cette installation est lancé directement.');
   await client.stop();
  }
  const broken=join(folder,'incomplete','bin','codex.js');
  await mkdir(dirname(broken),{recursive:true});await writeFile(join(folder,'incomplete','package.json'),'{"name":"@openai/codex"}');
  await writeFile(broken,'#!/usr/bin/env node\n',{mode:0o755});
  const missing=make();await assert.rejects(missing.connect(broken,folder),{message:t('codexNativeBinaryMissing')});assert.equal(missing.child,null);
  const cancelled=make(),pending=cancelled.connect(executable,folder);await cancelled.stop();
  await assert.rejects(pending,{message:t('codexConnectionClosed')});assert.equal(cancelled.child,null,'Arrêter pendant la résolution ne laisse pas de processus orphelin.');
 } finally {
  if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
  await Promise.all(clients.map(client=>client.stop()));await rm(folder,{recursive:true,force:true});
 }
}

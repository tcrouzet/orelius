import assert from 'node:assert/strict';
import {defaultMessages,resolveLocale,setLocale,setTranslations,t} from '../plugin/src/i18n.ts';
import {loadTranslationFiles} from '../plugin/src/locale-files.ts';
import {SELECTION_ACTIONS} from '../plugin/src/selection-actions.ts';
import {SCENE_STATUSES} from '../plugin/src/novel-outline.ts';
import {REACTIONS} from '../plugin/src/reactions.ts';
import {projectPaths,DEFAULT_PROJECT_FOLDERS} from '../plugin/src/settings.ts';

export async function checkI18n() {
 const parameters=text=>[...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]))].sort();
 try {
  assert.deepEqual(Object.keys(defaultMessages.en).sort(),Object.keys(defaultMessages.fr).sort());
  for(const key of Object.keys(defaultMessages.en)) {
   assert.deepEqual(parameters(defaultMessages.en[key]),parameters(defaultMessages.fr[key]),key);
   for(const language of ['en','fr']) {
    setLocale(language);
    const values=Object.fromEntries(parameters(defaultMessages[language][key]).map(name=>[name,'example']));
    assert.equal(t(key,values),defaultMessages[language][key].replace(/\{(\w+)\}/g,'example'),key);
   }
  }
  assert.equal(resolveLocale('fr_CA'),'fr');assert.equal(resolveLocale('en-GB'),'en');assert.equal(resolveLocale('de'),'en');
  setLocale('en');assert.equal(SELECTION_ACTIONS[0].label,'Expand');assert.equal(SCENE_STATUSES.draft,'Draft');assert.equal(REACTIONS[0].label,'Love it');
  setLocale('fr');assert.equal(SELECTION_ACTIONS[0].label,'Développer');assert.equal(SCENE_STATUSES.draft,'Brouillon');
  const files=new Map();const adapter={exists:async path=>files.has(path),mkdir:async path=>{files.set(path,null);},read:async path=>files.get(path),write:async(path,text)=>{files.set(path,text);}};
  assert.deepEqual(await loadTranslationFiles(adapter,'locales'),[]);
  assert.ok(files.get('locales/fr.json').includes('newOreliusProject'));
  const custom=JSON.stringify({...defaultMessages.fr,newOreliusProject:'Mon nouveau projet'});
  files.set('locales/fr.json',custom);
  assert.deepEqual(await loadTranslationFiles(adapter,'locales'),[]);
  assert.equal(t('newOreliusProject'),'Mon nouveau projet');assert.equal(files.get('locales/fr.json'),custom);
  assert.throws(()=>setTranslations('fr',{chapterNotFound:'Absent : {wrong}'}),/Paramètres/);
  files.set('locales/fr.json','{broken');
  assert.equal((await loadTranslationFiles(adapter,'locales')).length,1);
  assert.equal(t('newOreliusProject'),defaultMessages.fr.newOreliusProject);
  assert.equal(files.get('locales/fr.json'),'{broken');
  assert.throws(()=>t('chapterNotFound'),/Paramètre/);
  const paths=projectPaths(DEFAULT_PROJECT_FOLDERS);
  assert.ok(paths.includes('Manuscript/Chapters')&&paths.includes('Manuscript/Seeds')&&paths.includes('Manuscript/Characters')&&paths.includes('Manuscript/Summaries'));
  assert.ok(!paths.some(path=>/Chapitres|Personnages|Resume|Intrigues|Variantes|Verification/.test(path)));
  assert.deepEqual(paths.filter(path=>path.startsWith('Model/')),[]);
  setLocale('en');assert.deepEqual(projectPaths(DEFAULT_PROJECT_FOLDERS),paths);
 } finally {setTranslations('fr',{});setTranslations('en',{});setLocale('fr');}
}

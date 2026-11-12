import assert from 'node:assert/strict';
import { loadSettings, associatedFolder, modelProject } from '../plugin/src/settings.ts';
import { moveProjects, movedPath, relocateVault } from '../plugin/src/project-move.ts';
import { reactionKey } from '../plugin/src/reactions.ts';

export function checkProjectMove() {
  const original = loadSettings({folder:'Romans/Alpha',threadId:'thread-a',threadCwd:'/vault/Romans/Alpha',
    sessions:{'Romans/Alpha':{threadId:'thread-a',cwd:'/vault/Romans/Alpha'},'Romans/Beta':{threadId:'thread-b',cwd:'/vault/Romans/Beta'},'RomansBis':{threadId:'other',cwd:'/vault/RomansBis'}},
    codexVersions:{'/vault/Romans/Alpha':{'Manuscript/01.md':'Texte humain'},'/vault/Romans/Beta':{'a.md':'Beta'}},
    drafts:{'Romans/Alpha':'Brouillon Alpha','Romans/Beta':'Brouillon Beta'},
    revisionHighlights:{'Romans/Alpha/Manuscript/01.md':{before:'Avant',after:'Après'}},
    reactions:{[reactionKey('/vault/Romans/Alpha','thread-a','answer')]:{value:'heart',message:'À conserver',report:'Tracking/avis.md'}}});
  const before=JSON.stringify(original);
  for(const [from,to] of [['Romans/Alpha','Romans/Nouveau'],['Romans','Livres/Projets']]) {
    const moved=moveProjects(original,from,to,'/vault');
    const folder=movedPath(original.folder,from,to),cwd='/vault/'+folder;
    assert.equal(moved.folder,folder);assert.equal(moved.threadId,'thread-a');assert.equal(moved.threadCwd,cwd);
    assert.deepEqual(moved.sessions[folder],{threadId:'thread-a',cwd});
    assert.equal(moved.drafts[folder],'Brouillon Alpha');assert.equal(moved.drafts['Romans/Alpha'],undefined);
    assert.equal(moved.sessions['RomansBis'].cwd,'/vault/RomansBis');
    assert.deepEqual(moved.codexVersions[cwd],original.codexVersions['/vault/Romans/Alpha']);
    assert.deepEqual(moved.revisionHighlights[folder+'/Manuscript/01.md'],{before:'Avant',after:'Après'});
    assert.equal(moved.reactions[reactionKey(cwd,'thread-a','answer')].message,'À conserver');
    assert.equal(associatedFolder(moved,folder+'/Manuscript/01.md'),folder);
    assert.equal(modelProject(moved,folder+'/Model'),folder);
    assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(moved))),moved,'Le déplacement survit au redémarrage.');
  }
  const newRoot='/Users/nouveau/Documents/Coffre';
  const transferred=relocateVault(original,newRoot);
  assert.equal(transferred.threadId,original.threadId);
  assert.equal(transferred.threadCwd,newRoot+'/Romans/Alpha');
  for(const [folder,session] of Object.entries(original.sessions)) {
    assert.deepEqual(transferred.sessions[folder],{threadId:session.threadId,cwd:newRoot+'/'+folder});
    if(original.codexVersions[session.cwd])assert.deepEqual(transferred.codexVersions[newRoot+'/'+folder],original.codexVersions[session.cwd]);
  }
  assert.deepEqual(transferred.drafts,original.drafts);assert.deepEqual(transferred.revisionHighlights,original.revisionHighlights);
  assert.equal(transferred.reactions[reactionKey(newRoot+'/Romans/Alpha','thread-a','answer')].message,'À conserver');
  assert.equal(transferred.codexVersions['/vault/Romans/Alpha'],undefined);
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(transferred))),transferred);
  assert.equal(relocateVault(transferred,newRoot),null,'Le prochain chargement ne remigre pas les mêmes associations.');
  assert.equal(relocateVault(loadSettings(undefined),newRoot),null,'Une installation vide ne crée aucun projet.');
  assert.throws(()=>relocateVault({...original,codexVersions:{...original.codexVersions,[newRoot+'/Romans/Alpha']:{'autre.md':'À préserver'}}},newRoot),/déjà associé/,'Un conflit préserve les références au lieu de les écraser.');
  assert.equal(JSON.stringify(original),before,'Aucune mutation des associations sources.');
  assert.equal(moveProjects(original,'Romans/Al','Autre','/vault'),null);
  assert.equal(moveProjects(original,'Romans/Alpha/Model','Sources','/vault'),null);
  const inactive=moveProjects(original,'Romans/Beta','ArchivesTravail/Beta','/vault');
  assert.equal(inactive.folder,original.folder);assert.equal(inactive.threadCwd,original.threadCwd);
  const fresh=loadSettings({folder:'Nouveau'});
  assert.equal(moveProjects(fresh,'Nouveau','Livres/Premier','/vault').folder,'Livres/Premier');
  const first=moveProjects(original,'Romans/Alpha','Romans/Renommé','/vault');
  const second=moveProjects(first,'Romans/Renommé','Dossiers/Final','/vault');
  assert.equal(second.threadCwd,'/vault/Dossiers/Final');assert.equal(second.threadId,'thread-a');
  assert.throws(()=>moveProjects(original,'Romans/Alpha','Romans/Beta','/vault'),/déjà associé/);
  assert.equal(JSON.stringify(original),before);
  assert.deepEqual(loadSettings(undefined).drafts,{});
  assert.deepEqual(loadSettings({drafts:{Alpha:'À conserver',Beta:12}}).drafts,{Alpha:'À conserver'});
}

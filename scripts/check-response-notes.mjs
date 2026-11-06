import assert from 'node:assert/strict';
import {toChatItem,readConversation} from '../plugin/src/session.ts';
import {visibleMessages} from '../plugin/src/conversation.ts';
const write=(id,path,extra={})=>({id,type:'mcpToolCall',server:'orelius',tool:'ecrire_fichier',status:'completed',arguments:{chemin:path,contenu:'Texte'},result:{content:[{type:'text',text:JSON.stringify({fichier:path,archives:['Archives/copie.md']})}]},...extra});
const user=(id)=>({id,type:'userMessage',content:[{type:'text',text:'Une demande'}]});
const answer=(id)=>({id,type:'agentMessage',text:'Enregistré.',phase:'final_answer'});
export async function checkResponseNotes(){
 const a='Manuscript/Chapters/001.md',b='Bible/Characters/Nora.md';
 assert.deepEqual(toChatItem(write('w',a)).modifiedPaths,[a]);
 assert.deepEqual(toChatItem(write('same',a,{result:{content:[{type:'text',text:JSON.stringify({fichier:a,modifie:false})}]}})).modifiedPaths,[]);
 for(const extra of [{status:'failed'},{error:{message:'refus'}},{server:'other'},{result:{isError:true,content:[]}},{result:{content:[{type:'text',text:'aucune écriture'}]}},{arguments:{chemin:b}}]) assert.deepEqual(toChatItem(write('w',a,extra)).modifiedPaths,[]);
 for(const path of ['../secret.md','/secret.md','Bible/../secret.md','image.png']) assert.deepEqual(toChatItem(write('w',path)).modifiedPaths,[]);
 const history=[
  {id:'t1',status:'completed',items:[user('u1'),write('w1',a),write('w2',b),write('w3',a),answer('a1')]},
  {id:'t2',status:'completed',items:[user('u2'),{id:'read',type:'commandExecution',status:'completed',command:'read',commandActions:[{path:b}]},answer('a2')]},
  {id:'t3',status:'completed',items:[user('u3'),write('w4',b),answer('a3')]}
 ];
 const client={request:async()=>({data:history,nextCursor:null})};
 const turns=await readConversation(client,'thread',()=>{});
 const messages=visibleMessages(turns.flatMap(turn=>turn.messages),turns);
 assert.deepEqual(messages.find(item=>item.id==='a1').paths,[a,b],'Les notes sont dédupliquées par échange.');
 assert.deepEqual(messages.find(item=>item.id==='a2').paths,[],'Lire un fichier ne signifie pas le modifier.');
 assert.deepEqual(messages.find(item=>item.id==='a3').paths,[b]);
 const live=[toChatItem(user('live-u')),{id:'write-1',role:'activity',text:'Écrit',paths:[a,'Archives/copie.md'],modifiedPaths:[a]},toChatItem(answer('live-a'))];
 assert.deepEqual(visibleMessages(live,[]).at(-1).paths,[a]);
}

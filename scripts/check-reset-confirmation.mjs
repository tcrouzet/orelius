import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DEFAULT_PROJECT_FOLDERS} from '../plugin/src/settings.ts';

export async function checkResetConfirmation(){
 const result=await build({entryPoints:['plugin/src/reset-project-modal.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{
  name:'obsidian-modal-test',setup(build){
   build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
   build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`
    export class Modal {
     contentEl={buttons:[],paragraphs:[],createEl:(_tag,options)=>this.contentEl.paragraphs.push(options.text),empty:()=>{}};
     setTitle(title){this.title=title;} open(){this.onOpen();} close(){this.onClose();}
    }
    export class Setting {
     constructor(container){this.container=container;}
     addButton(configure){
      const button={buttonEl:{focus(){button.focused=true;}},setButtonText(text){this.text=text;return this;},setWarning(){this.warning=true;return this;},onClick(callback){this.click=callback;return this;}};
      this.container.buttons.push(button);configure(button);return this;
     }
    }
   `}));
  }
 }]});
 const {ResetProjectModal}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
 for(const action of ['close','cancel','confirm']){
  const modal=new ResetProjectModal({},'Mon roman',{...DEFAULT_PROJECT_FOLDERS,modelFolder:'Sources',bibleFolder:'Univers',manuscriptFolder:'Roman',archiveFolder:'Sauvegardes'});
  let settled=false;void modal.result.then(()=>{settled=true;});
  modal.open();await Promise.resolve();assert.equal(settled,false,'Ouvrir la fenêtre ne confirme rien.');
  assert.ok(modal.title.includes('Mon roman'));
  for(const name of ['Sources','Univers','Roman','Sauvegardes'])assert.ok(modal.contentEl.paragraphs[0].includes(name));
  const [cancel,confirm]=modal.contentEl.buttons;
  assert.equal(cancel.focused,true);assert.equal(confirm.warning,true);assert.equal(confirm.text,'Reset projet');
  if(action==='close')modal.close();else (action==='cancel'?cancel:confirm).click();
  assert.equal(await modal.result,action==='confirm');
 }
}

import {Extension,type Editor} from '@tiptap/core';
import {closeHistory} from '@tiptap/pm/history';
import {tagKey,tagName} from '../domain/tags';
import type {RichDocument} from '../domain/rich-document';

// Editor-only metadata participates in body undo, and is never stored in JSON.
export const TagEditorState=Extension.create({
  name:'tagEditorState',
  addGlobalAttributes(){return [{types:['doc'],attributes:{legacyTags:{default:[],rendered:false}}}];},
});

export function savedDocument(editor:Editor):RichDocument {
  const document=editor.getJSON() as RichDocument;
  if(document.attrs){document.attrs={...document.attrs};delete document.attrs.legacyTags;if(!Object.keys(document.attrs).length)delete document.attrs;}
  return document;
}

function commitTags(editor:Editor,tags:string[]){
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('legacyTags',tags));
  editor.view.dispatch(closeHistory(editor.state.tr));editor.view.focus();
}
export function selectionHasTag(editor:Editor){const name=tagName(editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,'\n'));return !!name&&((editor.state.doc.attrs.legacyTags??[]) as string[]).some(tag=>tagKey(tag)===tagKey(name));}
export function toggleLinkedTag(editor:Editor,value=editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,'\n')):string|null {
  const name=tagName(value);
  if(!name||name.length>40||/[\r\n]/.test(value))return '标签需要1–40字，且不能换行。';
  const tags=(editor.state.doc.attrs.legacyTags??[]) as string[],key=tagKey(name),exists=tags.some(tag=>tagKey(tag)===key);
  if(!exists&&tags.length>=20)return '每条记录最多关联20个标签。';
  commitTags(editor,exists?tags.filter(tag=>tagKey(tag)!==key):[...tags,name]);return null;
}
export function addLinkedTag(editor:Editor,value:string):string|null {
  const name=tagName(value),tags=(editor.state.doc.attrs.legacyTags??[]) as string[];
  if(name&&tags.some(tag=>tagKey(tag)===tagKey(name)))return null;
  return toggleLinkedTag(editor,value);
}
export function changeLinkedTag(editor:Editor,value:string,replacement:string|null):string|null {
  const key=tagKey(value),next=replacement===null?null:tagName(replacement);
  if(next!==null&&(!next||next.length>40||/[\r\n]/.test(replacement!)))return '标签需要1–40字，且不能换行。';
  const legacy=(editor.state.doc.attrs.legacyTags??[]) as string[];
  if(!legacy.some(tag=>tagKey(tag)===key))return null;
  const changed=legacy.flatMap(tag=>tagKey(tag)===key?(next===null?[]:[next]):[tag]);
  const tags=[...new Map(changed.map(tag=>[tagKey(tag),tag])).values()];
  commitTags(editor,tags);return null;
}

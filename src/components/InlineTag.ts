import {Mark,mergeAttributes} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {inlineTagName,inlineTagSpans} from '../domain/inline-tags';

export const InlineTag=Mark.create({
  name:'tag',inclusive:false,
  addAttributes(){return {id:{default:null,parseHTML:element=>element.getAttribute('data-inline-tag-id'),renderHTML:attributes=>({'data-inline-tag-id':attributes.id})}};},
  parseHTML(){return [{tag:'span[data-inline-tag-id]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{class:'inline-tag'}),0];},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){
    if(!transactions.some(transaction=>transaction.docChanged))return null;
    const invalid=inlineTagSpans(state.doc).filter(span=>!inlineTagName(span.text));if(!invalid.length)return null;
    const tr=state.tr;for(const span of invalid)tr.removeMark(span.from,span.to,state.schema.marks.tag);return tr;
  }})];}
});

export {toggleLinkedTag as toggleInlineTag} from './TagEditorState';

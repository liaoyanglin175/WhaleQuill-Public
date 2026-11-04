import {describe,it,expect} from 'vitest';
import {documentTags,inlineTagName,mergeTagNames} from '../../src/domain/inline-tags';
import {plainDocument,publicDocument,documentText} from '../../src/domain/rich-document';
import {createRecord,recordSchema,encodeCompleteArchive,decodeArchive} from '../../src/domain/models';

const id='46c6849c-270e-415f-9653-5e90d36d3e0b';
const tagged=()=>{const doc=plainDocument('#英语单词');doc.content[0].content![0].marks=[{type:'tag',attrs:{id}}];return doc;};
describe('正文关联标签',()=>{
  it('从明确标记提取标签，不将正文中普通的#当作关联',()=>{expect(documentTags(plainDocument('#英语单词'))).toEqual([]);expect(documentTags(tagged())).toEqual(['英语单词']);});
  it('连续不同样式仍属于同一标签，删除#或跨行后不再关联',()=>{
    const doc=tagged();doc.content[0].content=[{type:'text',text:'#英语',marks:[{type:'tag',attrs:{id}}]},{type:'text',text:'单词',marks:[{type:'tag',attrs:{id}},{type:'bold'}]}];expect(documentTags(doc)).toEqual(['英语单词']);
    doc.content[0].content[0].text='英语';expect(documentTags(doc)).toEqual([]);expect(inlineTagName('#跨\n行')).toBeNull();expect(inlineTagName('#'+'长'.repeat(41))).toBeNull();
  });
  it('兼容旧标签，同一记录同名标签不重复',()=>{expect(mergeTagNames(['旧标签','AI'],['ai','旅行','旅行'])).toEqual(['旧标签','ai','旅行']);});
  it('正文与索引不一致时拒绝保存，完整备份明确使用新版格式',()=>{
    const record={...createRecord(),body:'#英语单词',document:tagged(),tags:['英语单词']};expect(recordSchema.safeParse({...record,tags:[]}).success).toBe(false);
    const archive=decodeArchive(encodeCompleteArchive({records:[{...record,deletedAt:null}],tasks:[]}));expect(archive.version).toBe(5);
    if(archive.version!==1)expect(archive.snapshot.records[0].document).toEqual(record.document);
  });
  it('公开副本保留可见#和外观，剥离私人标签标识',()=>{const doc=publicDocument(tagged())!;expect(documentText(doc)).toBe('#英语单词');expect(JSON.stringify(doc)).not.toContain(id);expect(JSON.stringify(doc)).not.toContain('"type":"tag"');expect(doc.content[0].content![0].marks?.some(mark=>mark.type==='bold')).toBe(true);});
});

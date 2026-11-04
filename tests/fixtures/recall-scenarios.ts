import type {NoteRecord} from '../../src/domain/models';
export const recallNow=Date.parse('2026-10-28T12:00:00+08:00');
const data:[string,string,string,string[],string][]=[
 ['sea','海边散步','和小林去海边散步。晚风很舒服，最近难得这么放松。',[],'2026-10-20'],
 ['sea-new','又去海边','和阿宁去海边散步，放松了一下。',[],'2026-10-27'],
 ['study','英语计划','每天记十个英语单词，不用一下子记太多。',['学习'],'2026-10-22'],
 ['quote-lin','报价发送','给小林发送报价，费用约800元。',['项目'],'2026-10-21'],
 ['quote-an','报价沟通','给阿宁发送报价，费用约600元。',['项目'],'2026-10-23'],
 ['cloud-first','暂缓云同步','预算只有200元，因此暂缓云同步。',['项目'],'2026-10-10'],
 ['cloud-later','预算调整','云同步预算调为500元，先验证本地备份。',['项目'],'2026-10-24'],
 ['backup','备份完成','完整备份已经导出并验证能打开。',[],'2026-10-27'],
 ['sleep','夜间记录','昨晚睡不着，听了一会儿雨声。',[],'2026-10-18'],
 ['sad','周末心情','今天有点沮丧，想安静待一会儿。',[],'2026-10-25'],
 ['happy','开心的事','今天很开心，收到了朋友的小礼物。',[],'2026-10-26'],
 ['old-sea','夏天的海边','和小林去海边散步，很放松。',[],'2026-08-20'],
];
export const recallNotes:NoteRecord[]=data.map(([,title,body,tags,day],index)=>({id:`82600000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,title,body,tags,recordType:'note',document:null,highlights:[],createdAt:day+'T12:00:00+08:00',updatedAt:day+'T12:00:00+08:00'}));
export const recallKeys=new Map(recallNotes.map((record,index)=>[record.id,data[index][0]]));
export const recallScenarios:{question:string;expected:string[]}[]=[
 {question:'我之前为什么决定不做云同步？',expected:['cloud-first','cloud-later']},
 {question:'我为什么暂缓上云？',expected:['cloud-first','cloud-later']},
 {question:'上周出去散心的那次',expected:['sea']},
 {question:'海边',expected:['sea','sea-new','old-sea']},
 {question:'上周和小林放松的那次',expected:['sea']},
 {question:'这周散心',expected:['sea-new']},
 {question:'last week relaxing',expected:['sea']},
 {question:'上周给小林的估价',expected:['quote-lin']},
 {question:'上周给阿宁的报价',expected:['quote-an']},
 {question:'#学习',expected:['study']},
 {question:'上周 #项目',expected:['quote-lin','quote-an','cloud-later']},
 {question:'上周五 #项目',expected:['quote-an']},
 {question:'10月20日的记录',expected:['sea']},
 {question:'2026-10-20到2026-10-22 #项目',expected:['quote-lin']},
 {question:'最近7天备份',expected:['cloud-later','backup']},
 {question:'心情不好',expected:['sad']},
 {question:'失眠',expected:['sleep']},
 {question:'去年海边',expected:[]},
 {question:'上周和李雷散心',expected:[]},
 {question:'#不存在',expected:[]},
];

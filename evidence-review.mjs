import {createHash,randomUUID} from 'node:crypto';
import {evaluateDecision,recordDecision} from './decision.mjs';

// This workflow records a researcher's assessment. It does not certify evidence,
// run diagnostics, or add new methodological criteria to the reviewed registry.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v??null;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
const stages=['planned','obtained','reviewed'];
const origins=['user_material','synthetic','ai_draft','system_inference','unknown'];
const outcomes=['supports','limits','contradicts','unknown'];
const fields=['source','location','unit','time','materialVersion','observation','interpretation','reviewer','reason','counterevidence','unresolved','nextAction','burden'];
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const groups={conditions:['적용 조건','이 접근을 적용하는 데 필요한 조건을 실제 자료와 대조합니다.'],missing:['부족한 정보','이 정보에 따라 설계 선택과 주장 범위가 달라질 수 있습니다.'],competitors:['다른 설명','현재 설명 외의 가능성이 자료와 맞는지 검토합니다.'],counterEvidence:['맞지 않는 근거','처음 해석과 다른 자료를 보존하고 주장을 수정할 이유를 남깁니다.']};

function checkEntry(entry,{stored=false}={}){
 if(!object(entry)||!stages.includes(entry.stage)||!origins.includes(entry.provenance)||!outcomes.includes(entry.outcome)||typeof entry.criterionId!=='string'||entry.criterionId.length>100)throw error(400,'근거 항목·진행 상태·생성 유형·판단 형식을 확인해 주세요.');
 for(const field of fields)if(entry[field]!==undefined&&(typeof entry[field]!=='string'||entry[field].length>12000))throw error(400,'근거와 검토 내용은 항목마다 12,000자 이하의 글로 입력해 주세요.');
 const required=entry.stage==='planned'?['nextAction','burden']:['source','location','unit','time','materialVersion','observation'];
 if(entry.stage==='reviewed')required.push('reviewer','reason','interpretation');
 if(entry.stage==='reviewed'&&entry.outcome!=='supports')required.push('unresolved','nextAction','burden');
 if(required.some(k=>!entry[k]?.trim()))throw error(400,'자료 위치·판본 또는 검토 이유·다음 작업을 채워 주세요. 모르는 항목은 미정으로 남길 수 있습니다.');
 if(entry.stage!=='reviewed'&&entry.outcome!=='unknown')throw error(400,'계획·확보 단계에는 검토 결과를 확정하지 않습니다.');
 if(entry.provenance!=='user_material'&&entry.outcome==='supports')throw error(400,'AI 초안·합성 자료·추정·미확인 내용으로 실제 근거의 지지를 확인했다고 기록할 수 없습니다.');
 if(entry.link!==undefined&&(!object(entry.link)||!['qualitative','integration'].includes(entry.link.kind)||!Number.isInteger(entry.link.index)||entry.link.index<0))throw error(400,'연결할 기존 근거의 유형과 행 번호를 확인해 주세요.');
 if(stored&&(!entry.id||!entry.recordId||!digest(entry.inputFingerprint)||!digest(entry.knowledgeFingerprint)||!digest(entry.recordFingerprint)||!digest(entry.integrityFingerprint)))throw error(400,'보존된 근거 검토 이력의 식별자와 지문을 확인해 주세요.');
 if(stored){const {integrityFingerprint,...body}=entry;if(hash(body)!==integrityFingerprint)throw error(409,'보존된 근거 검토 기록이 바뀌었습니다. 원본을 유지하고 새 기록으로 이어가 주세요.');}
}

export function validateEvidenceHistory(entries){
 if(entries===undefined)return;
 if(!Array.isArray(entries)||entries.length>200)throw error(400,'근거 검토 이력은 200개 이하의 목록이어야 합니다.');
 const seen=new Map(),latest=new Map();
 for(const entry of entries){
  checkEntry(entry,{stored:true});
  const key=entry.recordId+':'+entry.criterionId;
  if(seen.has(entry.id)||entry.supersedes!==(latest.get(key)??null))throw error(400,'근거 검토 이력의 중복 또는 이어지는 순서를 확인해 주세요.');
  seen.set(entry.id,entry);latest.set(key,entry.id);
 }
}

export function validateEvidenceSnapshot(snapshot){
 if(snapshot===undefined)return;
 if(!object(snapshot)||!Array.isArray(snapshot.entries)||snapshot.entries.length>200)throw error(400,'판단에 연결한 근거 검토 사본의 형식을 확인해 주세요.');
 for(const entry of snapshot.entries)checkEntry(entry,{stored:true});
}

function context(project,registry,recordId){
 const w=project.decisionWorkspace??{};validateEvidenceHistory(w.evidenceReviews);
 const record=w.records?.find(r=>r.id===recordId);
 if(!record||!object(record.validityPlan))throw error(400,'근거 점검 계획이 있는 판단 기록을 선택해 주세요. 이전 판단은 보존하고 현재 조건으로 새 판단을 만들 수 있습니다.');
 let decision;try{decision=evaluateDecision(project,registry);}catch(cause){throw error(400,cause.message);}
 const plan=record.validityPlan;
 const criteria=Object.entries(groups).flatMap(([group,[title,reason]])=>Array.isArray(plan[group])?plan[group].filter(v=>typeof v==='string').map((label,index)=>({id:group+':'+index,group,title,label,reason})):[]);
 const recordFingerprint=hash(record);
 const current=record.inputFingerprint===decision.inputFingerprint&&record.knowledgeFingerprint===decision.knowledgeFingerprint&&(w.evidenceReviews??[]).filter(e=>e.recordId===recordId).every(e=>e.recordFingerprint===recordFingerprint);
 return {w,record,decision,criteria,recordFingerprint,current};
}
function entryCurrent(entry,c,project){
 return c.current&&entry.inputFingerprint===c.decision.inputFingerprint&&entry.knowledgeFingerprint===c.decision.knowledgeFingerprint&&entry.recordFingerprint===c.recordFingerprint&&(!entry.link||entry.link.fingerprint===hash(project[entry.link.kind]?.[entry.link.index]??null));
}
export function evidenceWorkspace(project,registry,{recordId}={}){
 const c=context(project,registry,recordId),history=(c.w.evidenceReviews??[]).filter(e=>e.recordId===recordId);
 const latest=new Map();for(const e of history)latest.set(e.criterionId,e);
 const alternative=c.decision.alternatives.find(a=>a.id===c.record.alternativeId);
 const allowed=c.w.answers?.dataMode==='none'?c.decision.claimReview.allowed:alternative?.claim??'이전 경로가 현재 조건의 대안에 없습니다. 현재 조건으로 경로를 다시 비교해 주세요.';
 const claimGuidance={...c.decision.claimReview,allowed,alternativeId:c.record.alternativeId};
 return {recordId,recordTitle:c.record.alternativeTitle,contextStatus:c.current?'current':'needs_review',criteria:c.criteria,sourceRefs:c.record.validityPlan.sourceRefs??[],sourceGaps:c.record.validityPlan.sourceGaps??[],paths:c.record.validityPlan.paths??[],entries:[...latest.values()].map(e=>({...structuredClone(e),contextStatus:entryCurrent(e,c,project)?'current':'needs_review'})),history:structuredClone(history),claimGuidance,originalClaim:c.record.claim,researchValidation:'not_run',notice:'기존 경로의 계획을 자료와 대조하는 기록 도구입니다. 연구 적합성 평가와 추가 계산은 실행하지 않습니다.'};
}

export function recordEvidence(project,registry,{recordId,entry}={}){
 const c=context(project,registry,recordId);
 if(!c.current)throw error(409,'연구 조건 또는 근거 판본이 바뀌었습니다. 현재 조건으로 새 판단을 기록한 뒤 점검을 이어가 주세요.');
 if((c.w.evidenceReviews?.length??0)>=200)throw error(400,'근거 검토 기록이 200개에 도달했습니다. 기존 판본을 보존해 주세요.');
 if(!object(entry))throw error(400,'근거 검토 내용을 입력해 주세요.');
 const clean=Object.fromEntries(fields.map(k=>[k,typeof entry[k]==='string'?entry[k].trim():entry[k]??'']));
 Object.assign(clean,{criterionId:entry.criterionId,stage:entry.stage,provenance:entry.provenance,outcome:entry.outcome});
 if(entry.link!==undefined)clean.link=structuredClone(entry.link);
 checkEntry(clean);
 const criterion=c.criteria.find(item=>item.id===clean.criterionId);
 if(!criterion)throw error(400,'선택한 판단의 점검 계획에 없는 항목입니다.');
 if(clean.link){
  const row=project[clean.link.kind]?.[clean.link.index];
  if(!object(row))throw error(400,'연결할 기존 질적·통합 근거 행이 없습니다.');
  clean.link={kind:clean.link.kind,index:clean.link.index,snapshot:structuredClone(row),fingerprint:hash(row)};
 }
 const previous=(c.w.evidenceReviews??[]).filter(e=>e.recordId===recordId&&e.criterionId===clean.criterionId).at(-1);
 const saved={...clean,id:randomUUID(),at:new Date().toISOString(),recordId,criterion:structuredClone(criterion),supersedes:previous?.id??null,inputFingerprint:c.decision.inputFingerprint,knowledgeFingerprint:c.decision.knowledgeFingerprint,recordFingerprint:c.recordFingerprint,provenanceVerification:'user_statement_not_independently_verified',sourceValidation:'not_run',researchValidation:'not_run',assessment:clean.stage==='reviewed'?'researcher_assessment_unverified':'not_run'};
 saved.integrityFingerprint=hash(saved);
 const copy=structuredClone(project);copy.decisionWorkspace.evidenceReviews=[...(copy.decisionWorkspace.evidenceReviews??[]),saved];
 return {project:copy,workspace:evidenceWorkspace(copy,registry,{recordId}),decision:evaluateDecision(copy,registry)};
}

export function reviseFromEvidence(project,registry,{recordId,claim,reason,nextAction,burden,confirmed}={}){
 if(confirmed!==true)throw error(400,'수정할 주장과 남은 쟁점을 확인해 주세요.');
 for(const [key,value]of Object.entries({claim,reason,nextAction,burden}))if(typeof value!=='string'||!value.trim()||value.length>(key==='reason'?10000:12000))throw error(400,key+': 수정할 주장·이유·다음 작업·부담의 내용과 길이를 확인해 주세요.');
 const c=context(project,registry,recordId),workspace=evidenceWorkspace(project,registry,{recordId});
 if(!c.current||workspace.entries.some(e=>e.contextStatus!=='current'))throw error(409,'연구 조건·자료·판본이 바뀌었습니다. 현재 조건에서 새 판단과 근거 검토를 이어가 주세요.');
 if(!workspace.entries.some(e=>e.stage==='reviewed'))throw error(400,'한 항목 이상에서 연구자의 검토 이유를 기록해 주세요. 미해결 사항은 남긴 채 진행할 수 있습니다.');
 const unaddressed=c.criteria.filter(item=>!workspace.entries.some(e=>e.criterionId===item.id&&e.stage==='reviewed')).map(item=>item.label);
 const openIssues=[...unaddressed,...workspace.entries.flatMap(e=>[e.unresolved,...(e.outcome==='contradicts'?[e.counterevidence||e.observation]:[])].filter(Boolean))];
 const copy=structuredClone(project);copy.decisionWorkspace.draftClaim=claim.trim();
 let result;try{result=recordDecision(copy,registry,{alternativeId:c.record.alternativeId,note:reason.trim()});}catch(cause){throw error(400,cause.message);}
 const record=result.project.decisionWorkspace.records.at(-1);
 const reviewedEntries=workspace.entries.map(({contextStatus,...entry})=>structuredClone(entry));
 record.evidenceReview={status:'researcher_review_recorded',basedOnRecordId:recordId,basedOnRecordFingerprint:c.recordFingerprint,entries:reviewedEntries,unaddressedCriteria:unaddressed,openIssues,originalClaim:c.record.claim,revisedClaim:claim.trim(),scopeGuidance:structuredClone(record.claimReview),reason:reason.trim(),nextAction:nextAction.trim(),burden:burden.trim(),sourceValidation:'not_run',researchValidation:'not_run'};
 record.claim=claim.trim();record.claimOrigin='researcher_revision_unverified';
 record.unresolved=[...new Set([...record.unresolved,...openIssues])];
 // Preserve the rule's bounded scope separately; the user's revised text is
 // never substituted for the system's allowed scope or marked approved.
 return {...result,record};
}

import {createHash,randomUUID} from 'node:crypto';
import {evaluateDecision,decisionAnswerCatalog} from './decision.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value??null;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const string=(value,max=2000)=>typeof value==='string'&&value.trim()&&value.length<=max;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const allowedProviders=new Set(['codex','claude','gemini']);

function sourceFor(project,decision,{draftIndex,draftRef}={}){
 const drafts=project.decisionWorkspace?.aiDrafts;
 if(!Array.isArray(drafts))throw fail(400,'보존한 AI 초안이 필요합니다.');
 let draft;
 if(draftRef!==undefined){
  if(typeof draftRef!=='string'||!/^[a-f0-9]{64}$/.test(draftRef))throw fail(400,'초안 원문 지문을 확인해 주세요.');
  draft=drafts.find(item=>object(item)&&digest(item)===draftRef);
 }else if(Number.isInteger(draftIndex)&&draftIndex>=0)draft=drafts[draftIndex];
 if(!object(draft)||!string(draft.text,60000)||!allowedProviders.has(draft.provider)||!['unverified_draft','unverified_external_draft'].includes(draft.status)||!['live_cli','live_api','manual_import','local_connector'].includes(draft.mode))throw fail(400,'검토할 초안 원문과 미검증 상태를 확인해 주세요.');
 if(draft.mode==='live_api'&&(draft.provider!=='gemini'||draft.status!=='unverified_draft'||!string(draft.model,90)||!/^gemini-[a-z0-9._-]+$/.test(draft.model)))throw fail(400,'Gemini API 초안의 모델과 미검증 상태를 확인해 주세요.');
 if(draft.mode==='local_connector'&&(draft.status!=='unverified_external_draft'||draft.executionVerification!=='not_server_verified'))throw fail(400,'개인 연결기 초안의 미검증 출처 상태를 확인해 주세요.');
 const contextStatus=!draft.inputFingerprint?'unknown':draft.inputFingerprint===decision.inputFingerprint?'current':'stale';
 const knowledgeStatus=!draft.knowledgeFingerprint?'unknown':draft.knowledgeFingerprint===decision.knowledgeFingerprint?'current':'stale';
 return {draftRef:digest(draft),contextStatus,knowledgeStatus,canApply:contextStatus==='current'&&knowledgeStatus!=='stale',source:{provider:draft.provider,mode:draft.mode,status:draft.status,...(draft.mode==='local_connector'?{executionVerification:'not_server_verified'}:{}),...(draft.mode==='live_api'?{transport:'api'}:['api','cli'].includes(draft.transport)?{transport:draft.transport}:{}),...(typeof draft.model==='string'?{model:draft.model}:{}),at:draft.at??null,inputFingerprint:draft.inputFingerprint??null,knowledgeFingerprint:draft.knowledgeFingerprint??null,text:draft.text}};
}

function normalizeSuggestion(raw,decision,catalog){
 if(!object(raw)||!['condition','alternative','claim'].includes(raw.kind))throw fail(400,'제안 유형을 확인해 주세요.');
 const allowed={condition:['kind','questionId','value','reason','sourceClaimIds'],alternative:['kind','alternativeId','reason','sourceClaimIds'],claim:['kind','text','reason','sourceClaimIds']}[raw.kind];
 if(Object.keys(raw).some(key=>!allowed.includes(key)))throw fail(400,'허용하지 않은 제안 필드가 있습니다.');
 if(raw.reason!==undefined&&!string(raw.reason,2000))throw fail(400,'제안 이유는 2,000자 이하로 적어 주세요.');
 const proposal={kind:raw.kind,reason:raw.reason?.trim()||'AI 제안을 현장 조건과 대조해 검토합니다.',sourceClaimIds:[]};
 if(raw.kind==='condition'){
  const question=catalog.find(q=>q.id===raw.questionId);
  if(!question||!question.options.some(option=>option.value===raw.value))throw fail(400,'등록된 질문과 답변 선택지를 사용해 주세요.');
  Object.assign(proposal,{questionId:raw.questionId,value:raw.value});
 }else if(raw.kind==='alternative'){
  if(!decision.alternatives.some(a=>a.id===raw.alternativeId))throw fail(400,'현재 비교하는 설계 대안 중에서 선택해 주세요.');
  proposal.alternativeId=raw.alternativeId;
 }else{
  if(!string(raw.text,12000))throw fail(400,'주장 초안은 1~12,000자여야 합니다.');
  proposal.text=raw.text.trim();
 }
 if(raw.sourceClaimIds!==undefined){
  if(!Array.isArray(raw.sourceClaimIds)||raw.sourceClaimIds.length>12||raw.sourceClaimIds.some(id=>!string(id,180)))throw fail(400,'출처 주장 ID 형식을 확인해 주세요.');
  const known=new Set(decision.alternatives.flatMap(a=>a.sourceRefs.map(ref=>ref.claimId)));
  if(raw.sourceClaimIds.some(id=>!known.has(id)))throw fail(400,'현재 확인한 근거에 없는 출처 주장 ID입니다. 새 출처를 생성하지 않았습니다.');
  proposal.sourceClaimIds=[...new Set(raw.sourceClaimIds)];
 }
 return proposal;
}

export function inspectProposals(project,registry,options={}){
 const decision=evaluateDecision(project,registry),info=sourceFor(project,decision,options),catalog=decisionAnswerCatalog();
 const warnings=[],proposals=[];
 if(info.contextStatus!=='current')warnings.push('전달 당시 연구 조건이 미확인이거나 달라졌습니다. 현재 맥락으로 응답을 다시 받거나 전달해 주세요. 원문은 그대로 보존합니다.');
 if(info.knowledgeStatus==='stale')warnings.push('근거·규칙 판본이 달라졌습니다. 현재 근거에서 새 초안을 검토해 주세요.');
 if(info.knowledgeStatus==='unknown')warnings.push('이 초안의 근거 판본은 미확인입니다. 현재 확인한 근거만 연결하며 AI의 근거 충실성을 검증하지 않습니다.');
 let parsed;
 try{parsed=JSON.parse(info.source.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'));}catch{}
 if(object(parsed)&&Array.isArray(parsed.suggestions)&&parsed.suggestions.length<=12){
  parsed.suggestions.forEach((item,index)=>{
   try{proposals.push({id:'p'+index,...normalizeSuggestion(item,decision,catalog)});}
   catch(error){warnings.push('제안 '+(index+1)+' 보류: '+error.message);}
  });
 }else warnings.push('자동으로 읽을 수 있는 구조화 제안이 없습니다. 원문 일부를 직접 골라 반영 대상을 정할 수 있습니다. 이것은 사용자 수동 정리입니다.');
 return {...info,proposals,warnings,questions:catalog,alternatives:decision.alternatives.map(({id,title})=>({id,title}))};
}

export function previewAdoption(project,registry,{draftRef,selections}={}){
 const beforeDecision=evaluateDecision(project,registry),info=inspectProposals(project,registry,{draftRef});
 if(info.contextStatus!=='current')throw fail(409,'초안 작성 이후 연구 조건이 달라졌거나 전달 맥락이 미확인입니다. 현재 조건으로 다시 검토해 주세요.');
 if(info.knowledgeStatus==='stale')throw fail(409,'초안 작성 이후 근거 판본이 변경됐습니다. 현재 근거에서 새 초안을 검토해 주세요.');
 if(!Array.isArray(selections)||selections.length<1||selections.length>12)throw fail(400,'반영할 제안을 1~12개 선택해 주세요.');
 const copy=structuredClone(project),workspace=copy.decisionWorkspace;
 workspace.answers??={};
 const changes=[],targets=new Set();
 for(const selection of selections){
  if(!object(selection)||Object.keys(selection).length!==1)throw fail(400,'제안 선택 형식을 확인해 주세요.');
  let proposal,quote,origin;
  if(Object.hasOwn(selection,'proposalId')){
   proposal=info.proposals.find(item=>item.id===selection.proposalId);
   if(!proposal)throw fail(400,'검토한 구조화 제안 ID를 선택해 주세요.');
   quote=JSON.stringify(Object.fromEntries(Object.entries(proposal).filter(([key])=>key!=='id')));origin='ai_structured_suggestion';
  }else if(Object.hasOwn(selection,'manual')){
   if(!object(selection.manual))throw fail(400,'원문 수동 정리 형식을 확인해 주세요.');
   const {quote:excerpt,...suggestion}=selection.manual;
   if(!string(excerpt,4000)||!info.source.text.includes(excerpt))throw fail(400,'원문에 실제로 있는 구절을 4,000자 이하로 골라 주세요.');
   proposal=normalizeSuggestion(suggestion,beforeDecision,info.questions);quote=excerpt;origin='user_arranged_excerpt';
  }else throw fail(400,'반영할 제안이나 원문 구절을 선택해 주세요.');
  const target=proposal.kind==='condition'?'answers.'+proposal.questionId:proposal.kind==='alternative'?'selectedAlternativeId':'draftClaim';
  if(targets.has(target))throw fail(400,'같은 반영 대상이 중복됩니다. 대안 값을 비교한 뒤 하나를 선택해 주세요.');
  targets.add(target);
  const question=info.questions.find(q=>q.id===proposal.questionId);
  const before=proposal.kind==='condition'?workspace.answers[proposal.questionId]??null:workspace[target]??null;
  const after=proposal.kind==='condition'?proposal.value:proposal.kind==='alternative'?proposal.alternativeId:proposal.text;
  if(proposal.kind==='condition')workspace.answers[proposal.questionId]=after;else workspace[target]=after;
  const valueLabel=value=>proposal.kind==='condition'?question?.options.find(option=>option.value===value)?.label??value:proposal.kind==='alternative'?info.alternatives.find(option=>option.id===value)?.title??value:value;
  changes.push({kind:proposal.kind,target,label:question?.prompt??(proposal.kind==='alternative'?'선택할 설계 대안':'이번 주장 초안'),before,after,beforeLabel:valueLabel(before),afterLabel:valueLabel(after),quote,origin,reason:proposal.reason,sourceClaimIds:proposal.sourceClaimIds,proposalId:proposal.id??null});
 }
 if(changes.every(change=>equal(change.before,change.after)))throw fail(400,'현재 값과 다른 반영 내용이 없습니다.');
 const decision=evaluateDecision(copy,registry);
 if(changes.some(change=>change.kind==='alternative')&&decision.selection.status!=='current')throw fail(409,'조건 반영 후에는 선택한 설계 대안이 현재 비교 경로에 없습니다. 조건을 먼저 반영하고 새 대안을 비교해 주세요.');
 const warnings=[...info.warnings,'확인은 사용자 진술·선택의 기록입니다. AI 설명·출처·계산·연구 타당성의 검증을 뜻하지 않습니다.'];
 if(changes.some(change=>change.before!==null&&!equal(change.before,change.after)))warnings.push('기존 답변이나 초안과 다른 제안이 포함돼 있습니다. 전후 값을 직접 확인해 주세요. 이전 값은 반영 이력에 보존합니다.');
 if(decision.claimReview.status==='revise')warnings.push('반영할 주장에 현재 자료의 범위를 넘는 표현이 있습니다. 아래 주장 점검과 수정 경로를 확인해 주세요.');
 const previewToken=digest({version:'ai-adoption-1',projectId:project.id??null,projectVersion:project.version??null,input:beforeDecision.inputFingerprint,knowledge:beforeDecision.knowledgeFingerprint,draftRef:info.draftRef,selections,adoptions:workspace.adoptions??[]});
 return {previewToken,source:{...info.source,draftRef:info.draftRef},changes,warnings,decision,changedFields:changes.filter(change=>!equal(change.before,change.after)).map(change=>change.target)};
}

export function applyAdoption(project,registry,options={}){
 if(options.confirmed!==true)throw fail(400,'반영 전후 값과 AI 초안의 미검증 상태를 확인해 주세요.');
 const preview=previewAdoption(project,registry,options);
 if(typeof options.previewToken!=='string'||options.previewToken!==preview.previewToken)throw fail(409,'미리보기 이후 내용이 달라졌습니다. 현재 조건으로 다시 비교해 주세요.');
 const copy=structuredClone(project),workspace=copy.decisionWorkspace;
 workspace.adoptions??=[];
 if(!Array.isArray(workspace.adoptions)||workspace.adoptions.length>=200)throw fail(400,'반영 이력은 200개까지 보존합니다. 기존 기록을 저장하고 작업을 나누어 주세요.');
 if(workspace.adoptions.some(item=>item.previewToken===preview.previewToken))throw fail(409,'이미 반영한 미리보기입니다.');
 for(const change of preview.changes){
  if(change.kind==='condition')workspace.answers[change.target.slice('answers.'.length)]=change.after;
  else workspace[change.target]=change.after;
 }
 const before=evaluateDecision(project,registry);
 // Preserve the immutable raw response once in aiDrafts; link it by digest from
 // adoption events and decision snapshots rather than duplicating the full text.
 const {text:rawText,...source}=preview.source;
 const adoption={id:randomUUID(),at:new Date().toISOString(),previewToken:preview.previewToken,source,changes:preview.changes,confirmedBy:'local_researcher',confirmation:'user_confirmed_ai_suggestion',beforeInputFingerprint:before.inputFingerprint,afterInputFingerprint:preview.decision.inputFingerprint,knowledgeFingerprint:before.knowledgeFingerprint,researchValidation:'not_run',sourceValidation:'not_validated'};
 workspace.adoptions.push(adoption);
 return {project:copy,decision:evaluateDecision(copy,registry),adoption};
}

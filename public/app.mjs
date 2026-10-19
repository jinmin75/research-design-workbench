import { ensureDecisionWorkspace, renderDecision } from '/decision-view.mjs';
import { PRACTICE_SCENARIOS, createPracticeProject, practiceScenario, currentPracticeAnswer, taskProgress } from '/practice.mjs';
import { createProjectBackup, readProjectBackup } from '/project-transfer.mjs';
import { createConnectorClient } from '/connector-client.mjs';
const root = document.getElementById('app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => Array.isArray(value) ? value.map(plain).join(' · ') : value && typeof value === 'object' ? Object.entries(value).map(([k,v]) => `${k}: ${plain(v)}`).join(' · ') : String(value ?? '미정');
function newProject(){return {id:'',schemaVersion:'1.0',version:0,title:'새 연구 프로젝트',interest:'',context:'',purpose:'',question:'',conclusion:'',dataDescription:'',resources:'',falsifier:'',predictionTime:'',unit:'',targetUnit:'',design:{identification:'',evaluationPlan:'',constructUse:'',measurementTarget:'',dependence:'',dependencePlan:'',normativeReason:'',conclusionBasis:''},selectedMethods:[],decisionReason:'',qualitative:[],integration:[],unregisteredMethods:[],nodes:[{id:'question',type:'question',label:'연구 질문',status:'draft',version:1},{id:'design',type:'design',label:'연구설계',status:'draft',version:1},{id:'data',type:'data',label:'자료',status:'draft',version:1}],edges:[{from:'question',to:'design',type:'produces'},{from:'design',to:'analysis',type:'produces'},{from:'data',to:'analysis',type:'produces'}],history:[],analysis:null,methodWorkspace:newMethodWorkspace(),methodAnalysis:null,calculationInput:{raw:'',unit:'',sourceLabel:'',sourceVersion:'',dataKind:'',label:''}};}
const state = {geminiSettingsOpen:false,connectorConnected:false,connectorMessage:'',connectorPendingDraft:null,session:{mode:'local',authenticated:true,accountId:'local'},sessionExpired:false,auth:{classCode:'',label:'',recoveryKey:''},newRecoveryKey:'',transferPreview:null,tab:'guidance',decision:null,decisionStale:false,decisionNote:'',aiStatus:null,aiStatusError:'',aiPreview:null,aiConsent:false,aiImport:'',manualProvider:'claude',aiImportTexts:{},aiHandoffFingerprints:{},step:0,registry:null,purposes:[],projects:[],project:newProject(),assessment:null,error:'',message:'',dirty:false,busy:false,search:'',group:'',layer:'',limit:60,allCandidates:false,detail:null,evidenceTab:'qualitative',versions:[],includeData:false,includeMethodData:false,figureUrl:null,methodFigureUrl:null};
async function api(path,body){
 const headers={'Content-Type':'application/json'};
 if(state.session?.csrfToken)headers['X-CSRF-Token']=state.session.csrfToken;
 const response=await fetch(path,body===undefined?{}:{method:'POST',headers,body:JSON.stringify(body,(key,value)=>key==='figureSvg'?undefined:value)});
 if(!response.ok){
  let message=`요청 실패 (${response.status})`,code='';try{const data=await response.json();message=data.error?.message||data.error||data.message||message;code=data.code||data.error?.code||'';}catch{}
  if((response.status===401||(response.status===403&&code==='SESSION_CHANGED'))&&state.session?.mode==='classroom'){
   state.sessionExpired=true;
   message='접속이 만료되었습니다. 현재 입력은 이 화면에 보존했습니다. 개인 작업키로 재접속하거나 JSON 백업을 받아 주세요.';
  }
  throw new Error(typeof message==='object'?JSON.stringify(message):message);
 }
 return response;
}
async function json(path,body){return (await api(path,body)).json();}
function announce(message){document.getElementById('announcer').textContent=message;}
function badge(text,kind='pending'){return `<span class="badge ${kind}">${esc(text)}</span>`;}
const statusLabels={registered:'명칭 등록',name_only:'명칭만 등록',pending:'검토 대기',source_reviewed:'원출처 확인',partial:'일부 원출처 확인',partially_reviewed:'일부 원출처 확인',limited_internal_calculation:'범위 한정 내부 계산',scoped_tests_available:'해당 범위 시험 제공',full_relevant_sections:'관련 절 원문 확인',full_text:'원문 확인',direct_support:'직접 지지',interpretation:'제품 적용 해석',not_systematically_checked:'정정·철회 전수 확인 미실시',internally_tested:'내부 실행 시험',unverified:'미검증',needs_review:'재검토 필요',changed:'변경됨',recompute_required:'재계산 필요',not_applicable_or_unimplemented:'해당 없음 또는 미구현',unreviewed:'미검토',not_reviewed:'미검토',not_validated:'미검증',not_supported:'미지원',unsupported:'미지원',human_review:'인간 검토',conditional:'조건부 가능',hold:'보류',pass:'충족',fail:'실패',not_run:'미실시',not_applicable:'해당 없음',stale:'재검토 필요',current:'현재 결과',draft:'작성 중',unknown:'미확인'};
function sl(value){if(value&&typeof value==='object')return Object.entries(value).map(([key,item])=>({source:'출처',rule:'규칙',numeric:'수치',endToEnd:'종단 흐름',user:'사용자',applicability:'적용 조건',expertReview:'전문가 검토',recommendation:'추천',methodExecution:'전체 방법 실행'}[key]||key)+': '+sl(item)).join(' · ');return statusLabels[value]||plain(value)||'미확인';}
function getPath(object,path){return path.split('.').reduce((obj,key)=>obj?.[key],object)??'';}
function guardNavigation(){return !state.dirty||window.confirm('저장하지 않은 변경이 있습니다. 변경을 버리고 이동하시겠습니까? 취소를 누르면 현재 작업으로 돌아가 저장할 수 있습니다.');}
function selectField(label,path,options){const id=`field-${path.replaceAll('.','-')}`;return `<label class="field" for="${id}"><span>${esc(label)}</span><select id="${id}" data-field="${path}">${options.map(([value,text])=>`<option value="${esc(value)}" ${getPath(state.project,path)===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;}
function setPath(object,path,value){const keys=path.split('.');const last=keys.pop();let target=object;for(const key of keys){target[key]??={};target=target[key];}target[last]=value;}
function field(label,path,placeholder='',opts={}){const rawValue=getPath(state.project,path),value=path==='unregisteredMethods'&&Array.isArray(rawValue)?rawValue.map(item=>typeof item==='string'?item:plain(item)).join('\n'):rawValue,id=`field-${path.replaceAll('.','-')}`;return `<label class="field" for="${id}"><span>${esc(label)}</span>${opts.area?`<textarea id="${id}" data-field="${path}" placeholder="${esc(placeholder)}" ${opts.rows?`rows="${opts.rows}"`:''}>${esc(value)}</textarea>`:`<input id="${id}" data-field="${path}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}${opts.help?`<small>${esc(opts.help)}</small>`:''}</label>`;}
const tabs=[['practice','▷','강의·연습 사례'],['guidance','◇','연구 안내'],['start','◎','연구 시작'],['registry','▦','방법 등록부'],['evidence','▤','근거와 통합'],['calculation','⌁','계산과 그림'],['modules','◫','검증 모듈'],['changes','↗','변경과 내보내기']];
function dirty(){state.dirty=true;state.message='';const s=document.getElementById('save-status');if(s)s.textContent='저장하지 않은 변경';const progress=root.querySelector('.task-progress');if(progress)progress.outerHTML=renderProgress();}
function localInvalidate(changedId,changeKind='content'){if(changeKind!=='style')markDecisionStale();const p=state.project,affected=new Set([changedId]);if(changeKind!=='style'){let advanced=true;while(advanced){advanced=false;for(const e of p.edges||[]){const source=e.from||e.source,target=e.to||e.target;const from=(e.type||e.relation)==='depends_on'?target:source,to=(e.type||e.relation)==='depends_on'?source:target;if(['depends_on','produces'].includes(e.type||e.relation)&&affected.has(from)&&!affected.has(to)){affected.add(to);advanced=true;}}}for(const node of p.nodes||[])if(affected.has(node.id)&&node.id!==changedId)node.status='stale';}p.history.push({at:new Date().toISOString(),changedId,changeKind,affectedIds:[...affected],message:`${{question:'연구 질문',design:'설계',data:'자료',figure:'그림'}[changedId]||changedId} ${changeKind==='style'?'글꼴 설정 변경':'변경'} · 연결된 후속 결과 재검토`});}
function refreshResultState(){
  for(const [kind,stale,analysis] of [['baseline',isStale(),state.project.analysis],['method',methodIsStale(),state.project.methodAnalysis]]){
    for(const panel of root.querySelectorAll(`[data-result-kind="${kind}"]`)){
      panel.dataset.stale=String(stale);
      const status=panel.querySelector('[data-result-status]');
      if(status)status.innerHTML=badge(stale?'재검토 필요':analysis?.synthetic?'합성 자료 결과':'계산 결과',stale?'stale':'green');
      const warning=panel.querySelector('[data-result-warning]');
      if(warning)warning.hidden=!stale;
      const preview=panel.querySelector('.figure');
      if(preview){preview.dataset.stale=String(stale);preview.setAttribute('aria-label',stale?'변경 전 그림 · 다시 계산하기 전까지 현재 결과로 사용할 수 없음':'현재 계산 그림');}
    }
    const actions=kind==='baseline'?['download-svg','export']:['method-svg','method-export'];
    for(const action of actions)for(const button of root.querySelectorAll(`[data-action="${action}"]`))button.disabled=state.busy||stale||!analysis;
  }
}
function updateField(path,value){
  if(path==='unregisteredMethods')value=value.split('\n').filter(line=>line.trim());
  ensureDecisionWorkspace(state.project);
  setPath(state.project,path,value);
  if(!['title','decisionReason'].includes(path))markDecisionStale();
  if(path==='methodWorkspace.methodId'&&value==='M050')state.project.methodWorkspace.unit='';
  if(['methodWorkspace.methodId','methodWorkspace.xUnit','methodWorkspace.yUnit'].includes(path))syncMethodUnit();
  if(path==='calculationInput.dataKind')state.project.dataKind=value;
  dirty();
  const changed=path.startsWith('methodWorkspace')?'method-data':path.startsWith('calculationInput')?'data':['interest','context','purpose','question','conclusion','falsifier'].includes(path)?'question':path.startsWith('decisionWorkspace.narrative')||path.startsWith('decisionWorkspace.answers.')||path==='decisionWorkspace.draftClaim'||path.startsWith('design')||path.startsWith('qualitative.')||path.startsWith('integration.')||['unit','targetUnit','dataDescription','resources','predictionTime'].includes(path)?'design':null;
  if(changed){
    if(changed==='method-data')ensureMethodGraph();
    localInvalidate(changed);
    const h=state.project.history.at(-1);const previous=state.project.history.slice(0,-1).find(x=>x.sessionField===path);
    if(previous)state.project.history.pop();else if(h)h.sessionField=path;
    state.assessment=null;for(const button of root.querySelectorAll('[data-draft]'))button.disabled=true;refreshResultState();
  }
}
function figure(analysis){if(state.figureUrl)URL.revokeObjectURL(state.figureUrl);state.figureUrl=analysis?.figureSvg?URL.createObjectURL(new Blob([analysis.figureSvg],{type:'image/svg+xml'})):null;}
async function busy(work){if(state.busy)return;state.busy=true;state.error='';state.message='';root.setAttribute('aria-busy','true');for(const control of root.querySelectorAll('button,input,textarea,select'))control.disabled=true;try{await work();}catch(error){state.error=error.message||String(error);announce(state.error);}finally{state.busy=false;root.removeAttribute('aria-busy');render();}}
async function assess(){state.assessment=await json('/api/assess',state.project);state.message='입력한 내용으로 탐색 후보와 확인할 정보를 업데이트했습니다.';announce(state.message);}
function renderPractice(){return `<section class="intro"><div><div class="eyebrow">LECTURE · SYNTHETIC PRACTICE</div><h1>연구를 진행하며 판단을 연습합니다.</h1><p>아래 여섯 사례는 강의를 위해 만든 합성 상황입니다. 사례를 불러온 뒤 현재 질문에 한 번씩 답하며 대안과 주장 범위가 어떻게 달라지는지 비교하세요.</p></div></section><div class="notice">사례를 새 프로젝트로 엽니다. 기존에 저장한 프로젝트는 바꾸지 않습니다. 저장하지 않은 변경이 있으면 이동 전에 확인합니다. AI 로그인 없이 규칙 안내·판단 기록·근거 검토를 연습할 수 있습니다.</div><div class="practice-grid">${PRACTICE_SCENARIOS.map((scenario,index)=>`<article class="panel"><div class="panel-head"><h2>${index+1}. ${esc(scenario.title)}</h2></div><div class="panel-body"><p>${esc(scenario.narrative)}</p><details><summary>합성 사례 조건 미리 보기</summary><ul>${scenario.conditions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details><button class="btn primary" data-action="practice-load" data-scenario-id="${esc(scenario.id)}">이 사례로 새 연습 시작</button></div></article>`).join('')}</div><section class="panel"><div class="panel-body"><h2>강의에서 살펴볼 흐름</h2><ol><li>설명을 읽고 연구 안내를 시작합니다.</li><li>질문이 필요한 이유를 읽고 현재 질문에 해당하는 합성 조건만 입력합니다.</li><li>대안의 차이와 주장 범위를 비교하고, 직접 선택한 경로의 판단 기록을 남깁니다.</li><li>근거 점검에서 미확인 사항과 다음 작업을 기록하고 프로젝트를 저장합니다.</li><li>저장한 프로젝트를 다시 열어 이전 판단과 수정한 판단을 비교합니다.</li></ol><p class="inline-note">작업 상태는 입력·기록·저장 여부입니다. 연구 타당성 점수나 검증 통과율을 표시하지 않습니다. 실제 AI 응답과 계산은 해당 화면에서 따로 실행합니다.</p></div></section>`;}
function renderPracticeContext(){
 const scenario=practiceScenario(state.project);if(!scenario)return '';
 const answer=currentPracticeAnswer(state.project,state.decision),current=Boolean(answer&&!state.decisionStale),hasMaterial=Boolean(scenario.qualitative||scenario.integration);
 return `<section class="panel practice-context"><div class="panel-head"><h2>합성 사례 조건 · ${esc(scenario.title)}</h2><button class="btn small" data-tab="practice">다른 연습 사례</button></div><div class="panel-body"><ul>${scenario.conditions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><p class="inline-note">이 조건은 강의용 설정입니다. 실제 연구에서 확인한 사실로 표시하지 않습니다. 답변은 아래 버튼을 눌렀을 때 현재 질문 한 개에만 입력됩니다.</p>${answer?`<div class="practice-answer"><strong>현재 질문의 합성 조건</strong><p>${esc(state.decision.questions[0].prompt)}<br>${esc(answer.label)}</p>${!answer.known?'<p class="inline-note">사례에 정해지지 않은 내용입니다. 미정으로 남겨 확인이 필요한 사항을 살펴보세요.</p>':''}<button class="btn" data-action="practice-answer" ${current?'':'disabled'}>${answer.known?'이 질문에만 사례 조건 입력':'이 질문은 미정으로 입력'} · 안내 업데이트</button></div>`:'<p>연구 안내를 시작하면 현재 질문에 맞는 사례 답변을 확인할 수 있습니다.</p>'}${hasMaterial?'<button class="btn small" data-action="practice-material">합성 자료 연결행 준비 · 근거 화면 열기</button><p class="inline-note">실제 참여자나 관측값이 없는 질적·혼합 연결행을 명시적으로 추가합니다. 근거 검토나 판단은 미리 작성하지 않습니다.</p>':''}</div></section>`;
}
function renderProgress(){
 const rows=taskProgress(state.project,state),labels={pending:'아직 시작 전',written:'작성함',current:'현재 조건과 일치',needs_review:'업데이트 필요',saved:'판본 저장됨',unsaved:'저장 전 변경 있음'},guidance=rows[1].status==='current',record=rows[2].status==='current';
 return `<section class="panel task-progress" aria-label="연구 작업 상태"><div class="panel-head"><h2>지금 할 작업</h2><span class="badge">작업 상태 · 연구 타당성 점수 아님</span></div><div class="panel-body"><ol class="task-checklist">${rows.map(row=>`<li data-task-status="${esc(row.id)}"><strong>${esc(row.label)}</strong><span>${esc(labels[row.status])}</span><small>${esc(row.detail)}</small></li>`).join('')}</ol><div class="actions">${!guidance?'<button class="btn primary" data-action="progress-evaluate">현재 내용으로 안내 검토</button>':!record?'<button class="btn primary" data-action="progress-record">대안 비교하고 직접 판단 기록</button>':state.dirty?'<button class="btn primary" data-action="save">현재 프로젝트 저장</button>':'<button class="btn" data-action="progress-records">저장한 판단 기록 살펴보기</button>'}<button class="btn small" data-action="progress-description">연구 설명으로</button>${state.decision?'<button class="btn small" data-action="progress-question">중요한 질문으로</button><button class="btn small" data-action="progress-record">설계 대안으로</button>':''}<button class="btn small" data-action="progress-records">판단 기록으로</button><button class="btn small" data-action="progress-evidence">근거와 통합</button></div><p class="inline-note">질문에 답하거나 대안을 선택했다고 연구 적합성이 검증되는 것은 아닙니다. 중요 조건이 미정이어도 미해결 사항을 남기며 진행할 수 있습니다.</p></div></section>`;
}
function hydratedProject(saved){const blank=newProject();return {...blank,...saved,design:{...blank.design,...saved.design},calculationInput:{...blank.calculationInput,...saved.calculationInput},methodWorkspace:{...blank.methodWorkspace,...saved.methodWorkspace}};}
function resetProjectView(){state.assessment=null;resetDecisionView();state.step=0;state.versions=[];state.detail=null;state.includeData=false;state.includeMethodData=false;figure(null);methodFigure(null);}
async function save(){
 const saved=await json('/api/projects',state.project);
 state.project=hydratedProject(saved);state.dirty=false;state.message=`프로젝트 판본 ${saved.version}을 저장했습니다.`;
 const results=await Promise.allSettled([json('/api/projects'),saved.id?json(`/api/projects/${encodeURIComponent(saved.id)}/versions`):Promise.resolve([])]);
 const warnings=[];if(results[0].status==='fulfilled')state.projects=results[0].value;else warnings.push('저장 목록 새로고침 실패');
 if(results[1].status==='fulfilled')state.versions=results[1].value;else warnings.push('판본 목록 새로고침 실패');
 if(warnings.length)state.message+=' '+warnings.join(' · ')+'. 저장은 완료되었습니다. 저장한 프로젝트를 다시 열거나 목록을 새로 확인해 주세요.';
 announce(state.message);
}
async function loadProject(id,version){
 // Keep the current project and consent untouched if the main read fails.
 const saved=await json(`/api/projects/${encodeURIComponent(id)}${version?`/versions/${encodeURIComponent(version)}`:''}`);
 let versions=[],warning='';try{versions=await json(`/api/projects/${encodeURIComponent(id)}/versions`);}catch{warning=' 판본 목록은 불러오지 못했습니다. 현재 자료는 보존했습니다.';}
 resetProjectView();state.project=hydratedProject(saved);if(state.tab==='practice')state.tab='guidance';state.dirty=false;state.versions=versions;figure(saved.analysis);methodFigure(saved.methodAnalysis);
 let message=version?`이전 판본 ${version}을 불러왔습니다. 최신 판본과 충돌하면 새 프로젝트로 보존해 주세요.`:'저장한 프로젝트를 불러왔습니다.';
 try{await evaluateDecisionView();}catch{state.decision=null;state.decisionStale=false;message+=' 연구 안내를 자동 업데이트하지 못했습니다. 연구 안내에서 현재 내용으로 다시 업데이트해 주세요.';}
 state.message=message+warning;announce(state.message);
}
function loadPractice(scenarioId){
 if(!guardNavigation())return false;
 const project=createPracticeProject(newProject,scenarioId);resetProjectView();state.project=project;state.tab='guidance';state.dirty=true;state.error='';state.message='새 합성 연습 프로젝트를 열었습니다. 답변·판단·저장·AI·계산은 자동으로 실행하지 않았습니다.';render();return true;
}
async function applyPracticeAnswer(){
 if(state.decisionStale||!state.decision)throw Error('현재 내용으로 연구 안내를 먼저 업데이트해 주세요.');
 const answer=currentPracticeAnswer(state.project,state.decision);if(!answer)throw Error('현재 질문에 연결된 연습 답변이 없습니다.');
 updateField('decisionWorkspace.answers.'+answer.questionId,answer.value);await evaluateDecisionView();
}
function preparePracticeMaterial(){
 const scenario=practiceScenario(state.project);if(!scenario)throw Error('합성 연습 프로젝트에서만 준비할 수 있습니다.');
 const kind=scenario.qualitative?'qualitative':scenario.integration?'integration':null;if(!kind)throw Error('이 사례에는 준비된 연결행이 없습니다.');
 if(state.project[kind].length){state.message='현재 연결행을 보존했습니다. 근거와 통합 화면에서 직접 검토해 주세요.';state.tab='evidence';render();return;}
 state.project[kind]=JSON.parse(JSON.stringify(scenario[kind]));localInvalidate('design');dirty();state.tab='evidence';state.message='실제 연구 자료가 없는 합성 연습 연결행을 추가했습니다. 실제 근거나 타당성 검증 결과로 사용하지 않습니다.';render();
}
function focusGuidance(selector){state.tab='guidance';render();const target=root.querySelector(selector);if(target){target.scrollIntoView?.({block:'start',behavior:'smooth'});target.setAttribute?.('tabindex','-1');target.focus?.();}}

function download(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
root.addEventListener('toggle',event=>{if(event.target?.matches?.('.gemini-key-settings'))state.geminiSettingsOpen=event.target.open;},true);
root.addEventListener('input',event=>{if(state.busy)return;const element=event.target;if(element.dataset.authField){state.auth[element.dataset.authField]=element.value;return;}if(element.dataset.decisionUi){state[element.dataset.decisionUi]=element.value;return;}if(element.dataset.field)updateField(element.dataset.field,element.value);if(element.id==='method-search'){state.search=element.value;state.limit=60;document.getElementById('registry-results').innerHTML=registryResults(filteredMethods());}});
root.addEventListener('change',event=>{if(state.busy)return;const e=event.target;if(e.id==='project-backup-file'){void busy(()=>previewProjectBackup(e.files?.[0]));return;}if(e.id==='decision-manual-provider'){const previous=manualProviderId();state.aiImportTexts[previous]=state.aiImport;state.manualProvider=['codex','gemini','claude'].includes(e.value)?e.value:'claude';state.aiImport=state.aiImportTexts[state.manualProvider]||'';render();return;}if(e.id==='decision-ai-consent'){state.aiConsent=e.checked;render();return;}if(e.name==='purpose'){updateField('purpose',e.value);render();}if(e.id==='group-filter'||e.id==='layer-filter'){state[e.id==='group-filter'?'group':'layer']=e.value;state.limit=60;document.getElementById('registry-results').innerHTML=registryResults(filteredMethods());}if(e.id==='include-data'){state.includeData=e.checked;render();}if(e.id==='include-method-data'){state.includeMethodData=e.checked;render();}if(e.tagName==='SELECT'&&e.dataset.field){updateField(e.dataset.field,e.value);if(e.dataset.field==='methodWorkspace.methodId')render();}});
root.addEventListener('click',async event=>{if(state.busy)return;const button=event.target.closest('button,[data-action="backdrop-close"]');if(!button||button.disabled)return;if(button.dataset.tab){state.tab=button.dataset.tab;state.error='';state.message='';render();document.getElementById('main').focus();return;}if(button.dataset.step!==undefined){state.step=Number(button.dataset.step);render();return;}if(button.dataset.load){if(!guardNavigation())return;await busy(()=>loadProject(button.dataset.load));return;}if(button.dataset.detail){state.detail=button.dataset.detail;render();document.querySelector('.close')?.focus();return;}if(button.dataset.select){localInvalidate('design');const id=button.dataset.select;if(state.project.selectedMethods.includes(id))state.project.selectedMethods=state.project.selectedMethods.filter(x=>x!==id);else state.project.selectedMethods.push(id);dirty();render();return;}if(button.dataset.draft!==undefined){const draft=state.assessment?.questionDrafts?.[Number(button.dataset.draft)];if(!draft){state.message='입력이 변경되었습니다. 탐색 안내를 업데이트한 뒤 새 질문 초안을 선택해 주세요.';render();return;}updateField('question',typeof draft==='string'?draft:draft.question||draft.text||plain(draft));render();return;}if(button.dataset.evidenceTab){state.evidenceTab=button.dataset.evidenceTab;render();return;}if(button.dataset.removeQual!==undefined){localInvalidate('design');state.project.qualitative.splice(Number(button.dataset.removeQual),1);dirty();render();return;}if(button.dataset.removeInt!==undefined){localInvalidate('design');state.project.integration.splice(Number(button.dataset.removeInt),1);dirty();render();return;}if(button.dataset.version){if(!guardNavigation())return;await busy(()=>loadProject(state.project.id,button.dataset.version));return;}const action=button.dataset.action;if(action==='backdrop-close'&&event.target!==button)return;switch(action){case'session-join':await busy(()=>connectSession('join'));break;case'session-login':await busy(()=>connectSession('login'));break;case'session-logout':await busy(logoutSession);break;case'recovery-download':downloadRecoveryKey();break;case'project-backup':await busy(async()=>{backupProject();});break;case'project-import-confirm':await busy(importProjectBackup);break;case'project-import-cancel':state.transferPreview=null;render();break;case'new':if(!guardNavigation())break;resetProjectView();state.project=newProject();state.tab='guidance';state.dirty=false;state.error='';state.message='';render();break;case'refresh-projects':await busy(async()=>{state.projects=await json('/api/projects');state.message='저장한 프로젝트 목록을 새로 확인했습니다. 현재 프로젝트는 변경하지 않았습니다.';});break;case'practice-load':loadPractice(button.dataset.scenarioId);break;case'practice-answer':await busy(applyPracticeAnswer);break;case'practice-material':preparePracticeMaterial();break;case'progress-evaluate':state.tab='guidance';await busy(evaluateDecisionView);break;case'progress-record':focusGuidance('#decision-alternatives');break;case'progress-description':focusGuidance('[data-field="decisionWorkspace.narrative"]');break;case'progress-question':focusGuidance('#decision-question');break;case'progress-records':focusGuidance('#decision-records');break;case'progress-evidence':state.tab='evidence';render();break;case'save':await busy(save);break;case'previous':state.step=Math.max(0,state.step-1);render();break;case'unknown':case'next':if(state.step<5){state.step++;render();}else await busy(assess);break;case'assess':await busy(assess);break;case'assess-design':state.tab='start';await busy(assess);break;case'all-candidates':state.allCandidates=!state.allCandidates;render();break;case'more-methods':state.limit+=60;document.getElementById('registry-results').innerHTML=registryResults(filteredMethods());break;case'close-detail':case'backdrop-close':state.detail=null;render();break;case'add-qualitative':localInvalidate('design');state.project.qualitative.push({id:`Q${Date.now()}`,tradition:'',source:'',excerpt:'',interpretation:'',counterevidence:'',decision:''});dirty();render();break;case'add-integration':localInvalidate('design');state.project.integration.push({concept:'',question:'',unit:'',quantitative:'',qualitative:'',agreement:'',alternative:'',decision:'',next:''});dirty();render();break;case'synthetic':state.project.dataKind='synthetic';state.project.calculationInput={raw:'2\n4\nNA\n6\n8',unit:'합성 단위',sourceLabel:'제품 기능 확인용 합성 예시',sourceVersion:'example-v1',dataKind:'synthetic',label:'합성 관측값'};localInvalidate('data');dirty();render();break;case'calculate':await busy(calculate);break;case'method-synthetic':loadMethodExample();render();break;case'method-calculate':await busy(calculateMethod);break;case'method-svg':if(state.project.methodAnalysis?.figureSvg&&!methodIsStale())download(new Blob([state.project.methodAnalysis.figureSvg],{type:'image/svg+xml'}),'method-figure.svg');break;case'method-export':await busy(exportMethod);break;case'download-svg':if(state.project.analysis?.figureSvg&&!isStale())download(new Blob([state.project.analysis.figureSvg],{type:'image/svg+xml'}),'research-figure.svg');break;case'versions':await busy(async()=>{if(!state.project.id)throw new Error('프로젝트를 먼저 저장해 주세요.');state.versions=await json(`/api/projects/${encodeURIComponent(state.project.id)}/versions`);});break;case'design-change':await busy(async()=>{const result=await json('/api/invalidate',{nodes:state.project.nodes,edges:state.project.edges,changedId:'design',changeKind:'content'});state.project.nodes=result.nodes;state.project.edges=result.edges;localInvalidate('design');dirty();state.message='설계 변경과 후속 결과의 재검토 상태를 기록했습니다.';});break;case'font-change':await busy(async()=>{const result=await json('/api/invalidate',{nodes:state.project.nodes,edges:state.project.edges,changedId:'figure',changeKind:'style'});state.project.nodes=result.nodes;state.project.edges=result.edges;state.project.history.push({at:new Date().toISOString(),message:'그림 글꼴 설정 변경 검토 기록 · 분석은 무효화하지 않음'});dirty();state.message='그림 스타일 변경 기록을 남겼습니다. 분석 계산은 무효화하지 않았습니다.';});break;case'export':await busy(async()=>{if(isStale())throw new Error('현재 결과로 내보내려면 먼저 다시 계산해 주세요.');const response=await api('/api/export',{project:state.project,analysis:state.project.analysis,includeData:state.includeData});download(await response.blob(),`research-${state.includeData?'reproducible':'public'}-v${state.project.version||0}.zip`);state.message=state.includeData?'원자료와 전체 프로젝트(다른 입력·근거 기록 포함)가 담긴 재현 ZIP을 저장했습니다.':'공개용 ZIP을 저장했습니다. 원자료가 없어 완전 재계산에는 제한이 있습니다.';});break;}});
async function calculate(){const input=state.project.calculationInput||{};if(!input.raw?.trim())throw new Error('관측값을 입력해 주세요. 빈 입력 전체는 계산할 수 없습니다.');const tokens=input.raw.replaceAll('\r','').split(/[\n,]/);if(tokens.at(-1)===''&&input.raw.endsWith('\n'))tokens.pop();const values=tokens.map((token,i)=>{const s=token.trim();if(!s||/^(na|null|nan)$/i.test(s))return null;const value=Number(s);if(!Number.isFinite(value))throw new Error(`${i+1}번째 값이 유한한 숫자가 아닙니다: ${s}`);return value;});const a=await json('/api/calculate',{...input,values,projectContext:state.project});state.project.analysis=a;figure(a);for(const id of ['analysis','figure','interpretation']){const n=state.project.nodes.find(x=>x.id===id);if(n){n.status=id==='interpretation'?'draft':'current';n.version=(n.version||0)+1;n.stale=false;n.needsReview=false;n.invalidated=false;delete n.invalidation;}else state.project.nodes.push({id,type:id,label:{analysis:'분석',figure:'그림',interpretation:'해석'}[id],version:1,status:id==='interpretation'?'draft':'current'});}for(const [from,to]of[['analysis','figure'],['analysis','interpretation']])if(!state.project.edges.some(e=>e.from===from&&e.to===to))state.project.edges.push({from,to,type:'produces'});dirty();state.message='기술 요약을 계산했습니다. 해석과 연구 타당성은 별도 검토가 필요합니다.';}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.detail){state.detail=null;render();}if(event.key==='Tab'&&state.detail){const items=[...document.querySelector('.dialog').querySelectorAll('button,input,textarea,select,[tabindex="0"]')];if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.connectorPendingDraft){event.preventDefault();event.returnValue='';}});
async function init(){
 try{
  state.session=await json('/api/session');
  if(state.session.mode==='classroom'&&!state.session.authenticated){render();return;}
  await loadWorkspace();render();
 }catch(error){root.innerHTML=`<main class="main"><h1>작업실을 연결하지 못했습니다.</h1><p role="alert">${esc(error.message)}</p><p>서버 주소와 접속 상태를 확인한 뒤 다시 연결해 주세요.</p><button class="btn primary" id="retry-connect">다시 연결</button></main>`;document.getElementById('retry-connect').addEventListener('click',init);}
}
async function loadWorkspace(){
 const results=await Promise.allSettled([json('/api/registry'),json('/api/purposes'),json('/api/projects')]);
 if(results[0].status==='rejected')throw results[0].reason;
 state.registry=results[0].value;state.purposes=results[1].status==='fulfilled'?results[1].value:[];
 state.projects=results[2].status==='fulfilled'?results[2].value:[];
 if(results.some(r=>r.status==='rejected'))state.error='일부 정보를 불러오지 못했습니다. 현재 입력을 보존했습니다. 접속 상태와 저장 목록을 다시 확인해 주세요.';
}
function renderAuth(reconnect=false){
 const field=(label,key,type='text',autocomplete='off')=>`<label class="field"><span>${esc(label)}</span><input type="${type}" data-auth-field="${key}" value="${esc(state.auth[key])}" autocomplete="${autocomplete}" ${key==='recoveryKey'?'spellcheck="false"':''}></label>`;
 return `<section class="panel session-panel" aria-label="학생 작업실 접속"><div class="panel-head"><h2>${reconnect?'현재 입력을 보존한 채 재접속':'내 연구 작업실에 접속'}</h2></div><div class="panel-body"><p>수업 참여 코드로 개인 공간을 만듭니다. 다시 접속할 때는 발급받은 개인 작업키를 사용하세요. 별명은 실명이 아니어도 됩니다.</p><div class="session-grid"><div><h3>처음 참여</h3>${field('수업 참여 코드','classCode','password')}${field('별명 (선택)','label')}<button class="btn primary" data-action="session-join">새 개인 공간 만들기</button></div><div><h3>기존 작업 이어가기</h3>${field('개인 작업키','recoveryKey','password')}<button class="btn primary" data-action="session-login">내 작업실 재접속</button><p class="inline-note">작업키를 브라우저 저장소나 주소에 저장하지 않습니다. 키를 잃으면 기존 공간을 찾지 못할 수 있으므로 별도로 보관하세요.</p></div></div>${reconnect?'<p class="notice warning">현재 편집 내용은 메모리에 남아 있습니다. 새로고침 전에 백업하거나 같은 작업키로 재접속하세요. 다른 공간으로 이동할 때는 미저장 내용을 먼저 백업합니다.</p><button class="btn" data-action="project-backup">현재 입력 JSON 백업</button>':''}</div></section>`;
}
function renderRecoveryKey(){return state.newRecoveryKey?`<section class="panel recovery-panel" role="status"><div class="panel-body"><h2>개인 작업키를 지금 보관하세요.</h2><p>새 공간을 만들 때 한 번만 보여 줍니다. 이 키를 아는 사람은 내 작업실에 접속할 수 있습니다.</p><code class="recovery-key">${esc(state.newRecoveryKey)}</code><button class="btn primary" data-action="recovery-download">개인 작업키 TXT 다운로드</button></div></section>`:'';}
function renderTransfer(){
 const preview=state.transferPreview;
 return `<details class="project-transfer"><summary>프로젝트 JSON 백업·가져오기</summary><p>계산 전에도 현재 입력 전체를 백업할 수 있습니다. 백업 파일은 1.9 MB 이하입니다. 원자료·면담 발췌·AI 초안이 평문으로 포함될 수 있습니다. 공유할 파일은 내용을 먼저 확인하세요.</p><div class="actions"><button class="btn" data-action="project-backup">현재 입력 JSON 백업</button><label class="btn" for="project-backup-file">JSON 백업 파일 선택</label><input id="project-backup-file" class="backup-file" type="file" accept=".json,application/json"></div>${preview?`<div class="notice transfer-preview"><div><strong>가져올 프로젝트: ${esc(preview.project.title)}</strong><p>백업 생성: ${esc(preview.exportedAt)} · 판단 기록 ${esc(preview.project.decisionWorkspace?.records?.length||0)}건<br>새 프로젝트의 첫 판본으로 저장합니다. 기존 프로젝트를 덮어쓰지 않습니다. 계산·근거의 실제 적합성은 이 파일 검사로 검증되지 않습니다.</p><button class="btn primary" data-action="project-import-confirm">이 백업을 새 프로젝트로 가져오기</button> <button class="btn" data-action="project-import-cancel">가져오기 취소</button></div></div>`:''}</details>`;
}
function backupProject(){
 if(!window.confirm('현재 입력의 원자료·면담 발췌·AI 초안을 포함한 평문 JSON 백업을 다운로드합니다. 보관할 위치를 확인하고 진행하시겠습니까?'))return false;
 const backup=createProjectBackup(state.project);
 download(new Blob([JSON.stringify(backup)],{type:'application/json'}),`research-project-v${state.project.version||0}-${new Date().toISOString().slice(0,10)}.json`);
 state.message='현재 입력 JSON 백업 다운로드를 요청했습니다. 파일 저장 여부를 확인해 주세요. 서버에 저장하지 않은 변경은 그대로 남아 있습니다.';return true;
}
function downloadRecoveryKey(){if(!state.newRecoveryKey)return;download(new Blob([`연구의 길 개인 작업키
서버: ${window.location?.origin||''}
작업키: ${state.newRecoveryKey}
이 키를 아는 사람은 내 작업실에 접속할 수 있습니다. 공개하지 마세요.
`],{type:'text/plain'}),'research-workbench-personal-key.txt');state.message='개인 작업키 TXT 다운로드를 요청했습니다. 파일을 안전하게 보관하세요.';render();}
function protectAccountTransition(){
 if(state.connectorPendingDraft){
  if(!window.confirm('프로젝트에 아직 기록하지 못한 연결기 응답이 있습니다. 원문을 TXT로 보관한 뒤 이동하시겠습니까? 취소하면 현재 작업으로 돌아갑니다.'))return false;
  downloadConnectorPending();
  if(!window.confirm('대기 응답 TXT 다운로드를 요청했습니다. 파일 보관을 확인하고 이동을 계속하시겠습니까?'))return false;
 }
 if(!state.dirty)return true;
 if(!backupProject())return false;
 return window.confirm('미저장 입력의 백업 다운로드를 요청했습니다. 파일을 확인한 뒤 이동하세요. 취소하면 현재 입력으로 돌아갑니다. 계속하시겠습니까?');
}
async function connectSession(kind){
 if(!protectAccountTransition())return;
 const previous=state.session?.accountId;
 const body=kind==='join'?{classCode:state.auth.classCode,label:state.auth.label}:{recoveryKey:state.auth.recoveryKey};
 const result=await json(`/api/session/${kind}`,body);
 const same=previous&&previous===result.session.accountId;
 state.session=result.session;state.sessionExpired=false;state.auth={classCode:'',label:'',recoveryKey:''};state.newRecoveryKey=result.recoveryKey||'';
 if(!same){disconnectStudentConnector({clearPending:true});resetProjectView();state.project=newProject();state.dirty=false;state.tab='guidance';state.projects=[];state.aiStatus=null;state.transferPreview=null;}
 await loadWorkspace();state.message=same?'같은 작업실에 재접속했습니다. 현재 입력을 보존했습니다.':'개인 작업실에 접속했습니다. 프로젝트를 저장하며 진행하세요.';
}
async function logoutSession(){
 if(!protectAccountTransition())return;
 await json('/api/session/logout',{});
 disconnectStudentConnector({clearPending:true});resetProjectView();state.project=newProject();state.projects=[];state.dirty=false;state.aiStatus=null;state.newRecoveryKey='';state.transferPreview=null;state.auth={classCode:'',label:'',recoveryKey:''};state.session={mode:'classroom',authenticated:false};state.sessionExpired=false;state.message='접속을 종료했습니다.';
}
async function previewProjectBackup(file){
 state.transferPreview=null;if(!file)return;if(file.size>1_900_000)throw Error('프로젝트 백업은 1.9 MB 이하여야 합니다.');
 const raw=await file.text(),project=readProjectBackup(raw),envelope=JSON.parse(raw);
 state.transferPreview={...envelope,project};state.message='백업 형식을 확인했습니다. 제목과 포함 내용을 확인하고 가져오기를 선택하세요.';
}
async function importProjectBackup(){
 if(!state.transferPreview)throw Error('JSON 백업 파일을 먼저 선택해 주세요.');
 if(!protectAccountTransition())return;
 const saved=await json('/api/projects/import',{backup:state.transferPreview});
 resetProjectView();state.project=hydratedProject(saved.project||saved);state.dirty=false;state.tab='guidance';state.transferPreview=null;
 try{state.projects=await json('/api/projects');}catch{state.message='가져오기는 완료되었습니다. 저장 목록은 다시 확인해 주세요.';return;}
 state.message='백업을 새 프로젝트의 첫 판본으로 저장했습니다. 기존 프로젝트는 보존했습니다.';
}
function render(){if(state.session?.mode==='classroom'&&!state.session.authenticated){root.innerHTML=`<main class="main student-entry">${state.error?`<p role="alert" class="notice error">${esc(state.error)}</p>`:''}${renderAuth()}${state.message?`<p role="status">${esc(state.message)}</p>`:''}</main>`;return;}const p=state.project;root.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">∴</div><div><strong>연구의 길</strong><small>RESEARCH WORKBENCH</small></div></div><button class="new-project" data-action="new">＋ 새 프로젝트</button><nav class="nav" aria-label="주 메뉴">${tabs.map(([id,icon,label])=>`<button data-tab="${id}" ${state.tab===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav><div><p class="sidebar-caption">저장한 프로젝트</p><button class="btn small project-refresh" data-action="refresh-projects">저장 목록 새로고침</button><div class="project-list">${state.projects.length?state.projects.map(item=>`<button class="project-item" data-load="${esc(item.id)}" title="${esc(item.title)}">${esc(item.title||'제목 없음')} <span class="edit-status">v${esc(item.version)}</span></button>`).join(''):'<p class="inline-note" style="padding:0 9px">아직 저장한 프로젝트가 없습니다.</p>'}</div></div><div class="side-bottom"><p><span class="local-dot"></span>${state.session?.mode==='classroom'?`개인 작업실 · ${esc(state.session.label||'학생')}`:'로컬 연구 작업실'}</p>명세 v4.0 · 초기 구현<br>${state.session?.mode==='classroom'?'자료는 수업 서버의 개인 공간에 저장됩니다.<br>이 공용 기기에서는 작업 후 접속을 종료하세요.<br><button class="btn small" data-action="session-logout">접속 종료</button>':'자료는 이 컴퓨터에 저장됩니다.'}</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">내 작업실 / <strong>${esc(tabs.find(t=>t[0]===state.tab)?.[2])}</strong></div><div class="top-actions"><button class="btn small" data-action="project-backup">JSON 백업</button><input class="title-input" aria-label="프로젝트 제목" data-field="title" value="${esc(p.title)}"><span class="saved-state" id="save-status">${state.dirty?'저장하지 않은 변경':p.version?`저장됨 · v${p.version}`:'새 프로젝트'}</span><button class="btn small primary" data-action="save" ${state.busy?'disabled':''}>저장</button></div></header><main id="main" class="main" tabindex="-1">${state.sessionExpired?renderAuth(true):''}${renderRecoveryKey()}${state.session?.mode==='classroom'?'<p class="notice">공유 작업실에서는 본인 PC 연결기로 GPT·Claude 구독을 연결합니다. Gemini는 개인 연결기 창에서 별도로 설정한 API 키를 사용합니다. API 이용은 Gemini 구독과 별도이며 사용량과 요금 조건을 확인하세요.</p>':''}${renderTransfer()}${state.error?`<div role="alert" class="notice error">${esc(state.error)}</div>`:''}${state.message?`<div role="status" class="notice">${esc(state.message)}</div>`:''}${state.project.practice?.synthetic===true?'<div class="notice practice-banner" role="note"><strong>합성 연습 프로젝트</strong> · 사례 조건과 자료는 강의를 위해 만든 내용입니다. 실제 관측·AI 응답·연구 타당성 검증 결과가 아닙니다.</div>':''}${({practice:renderPractice,guidance:()=>renderProgress()+renderPracticeContext()+renderDecision(state.project,state),start:renderStart,registry:renderRegistry,evidence:renderEvidence,calculation:renderCalculation,modules:renderModules,changes:renderChanges}[state.tab])()}<p class="footer-note">연구를 진행하며 판단을 기록합니다. 규칙·AI 초안·계산 검증·전문가 평가의 상태를 각각 구분합니다.</p></main></div></div>${state.detail?renderDetail():''}`;}
function intro(eyebrow,title,description,tag=''){return `<section class="intro"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${tag?`<span class="welcome-label">${tag}</span>`:''}</section>`;}
const steps=['관심사','대상·상황','연구목적','결론','자료·자원','반증 조건'];
function renderStart(){const p=state.project;const content=[field('무엇이 궁금하신가요?','interest','관심 있는 현상, 해결하고 싶은 문제, 읽은 논문에서 출발해 보세요.',{area:true,rows:5,help:'아직 가설이나 자료가 없어도 괜찮습니다. 알고 있는 내용만 적어 주세요.'}),field('누구의, 어떤 상황을 살펴보고 싶으신가요?','context','대상, 장소, 시기, 경험이나 맥락을 자유롭게 적어 주세요.',{area:true,rows:5,help:'특정 전공이나 연구 대상을 기본값으로 정하지 않습니다.'}),`<p class="form-caption">같은 관심사에서도 질문의 목적에 따라 검토할 방법이 달라집니다. 아직 모르시면 미정으로 남겨 두세요.</p><div class="purpose-grid"><label class="purpose-choice"><input type="radio" name="purpose" value="" ${!p.purpose?'checked':''}><span>아직 미정</span></label>${state.purposes.map(item=>`<label class="purpose-choice"><input type="radio" name="purpose" value="${esc(item.id)}" ${p.purpose===item.id?'checked':''}><span>${esc(item.label)}</span></label>`).join('')}</div>`,field('어떤 결론을 내리고 싶으신가요?','conclusion','알아낸 내용으로 무엇을 설명하거나 판단하고 싶은지 적어 주세요.',{area:true,rows:5,help:'원하는 결론과 현재 자료가 뒷받침하는 결론은 검토 과정에서 구별합니다.'}),field('접근할 수 있는 자료가 있나요?','dataDescription','자료가 없어도 진행할 수 있습니다. 있다면 자료의 종류와 출처를 적어 주세요.',{area:true})+field('시간, 접근 권한, 협력자 등 활용할 자원','resources','현재 가능한 범위를 적어 주세요.'),field('어떤 결과가 나오면 처음 생각을 수정하시겠어요?','falsifier','경쟁 설명, 반대 사례, 다른 해석을 적어 주세요.',{area:true,rows:5,help:'해석 중심 연구에서는 반례와 경쟁 해석을 기록할 수 있습니다. 미정으로 남겨도 됩니다.'})][state.step];return intro('FROM CURIOSITY TO A RESEARCH QUESTION','궁금한 것에서 시작해 보세요.','관심사를 연구 질문으로 다듬고, 가능한 방법과 아직 필요한 근거를 함께 살펴봅니다.','관심사만 있어도 시작할 수 있습니다')+`<div class="grid-main"><div><section class="panel"><div class="panel-head"><div><span class="overline">나의 연구 방향</span><h2 style="font-size:17px;margin-top:4px">여섯 질문으로 생각 정리하기</h2></div>${badge(`${state.step+1} / 6`,'green')}</div><div class="steps" aria-label="안내 단계">${steps.map((label,i)=>`<button class="step ${state.step===i?'active':i<state.step?'done':''}" data-step="${i}" ${state.step===i?'aria-current="step"':''}><span>${i+1}</span>${label}</button>`).join('')}</div><div class="panel-body"><p class="form-caption">STEP 0${state.step+1} · ${steps[state.step]} &nbsp; / &nbsp; 미정인 내용은 나중에 채울 수 있습니다.</p>${content}</div><div class="wizard-actions"><button class="btn link small" data-action="previous" ${state.step===0?'disabled':''}>← 이전</button><div class="actions"><button class="btn small" data-action="unknown">미정으로 계속</button><button class="btn primary" data-action="next">${state.step<5?'다음 질문 →':'방법 후보 살펴보기 →'}</button></div></div></section><section class="panel"><div class="panel-head"><h3>나의 연구 질문</h3>${badge('직접 수정 가능','green')}</div><div class="panel-body">${field('현재 질문 초안','question','정리한 관심사에서 질문을 만들어 보세요. 모든 내용은 직접 수정할 수 있습니다.',{area:true,rows:3})}<div class="actions"><button class="btn primary small" data-action="assess" ${state.busy?'disabled':''}>탐색 안내 업데이트</button><span class="inline-note">질문 미정 상태에서도 대안을 탐색할 수 있습니다.</span></div>${renderAssessment()}</div></section></div><aside class="aside-grid"><section class="aside-panel"><h3>내 연구의 현재 위치</h3><dl class="summary-list"><dt>관심사</dt><dd>${esc(p.interest||'아직 적지 않았습니다.')}</dd><dt>알고 싶은 것</dt><dd>${esc(state.purposes.find(x=>x.id===p.purpose)?.label||'미정 · 함께 탐색합니다.')}</dd><dt>자료와 자원</dt><dd>${p.dataDescription?'자료 설명 기록됨':'자료가 없어도 시작할 수 있습니다.'}</dd></dl><div class="rule-divider"></div><p style="margin:0">모든 답을 한 번에 정하지 않으셔도 됩니다. 미정인 내용도 프로젝트에 보존합니다.</p></section><section class="aside-panel"><div class="tiny-label">전체 방법 지도</div><div class="stat-row"><span>범위 초안 항목</span><strong>${state.registry.methods.length}</strong></div><div class="stat-row"><span>탐색 영역</span><strong>${state.registry.groups.length}</strong></div><div class="stat-row"><span>등록 상태</span>${badge('이름 목록 초안')}</div><p style="margin:12px 0">이름 등록, 상세 카드 검토, 추천 검증, 실행 검증을 각각 관리합니다.</p><button class="btn link small" data-tab="registry">전체 등록부 살펴보기 →</button></section><section class="aside-panel" style="background:#edf3e7"><h3>판단은 연구자의 몫입니다.</h3><p style="margin:0">탐색 안내는 가능한 방향과 부족한 정보를 보여줍니다. 실행 가능 여부가 방법의 적합성을 대신하지 않습니다.</p></section></aside></div>`;}
function renderAssessment(){const a=state.assessment;if(!a)return '<div class="notice">◇ 관심사를 적고 탐색 안내를 업데이트하면 질문 대안과 비교할 방법을 볼 수 있습니다.</div>';return `<div class="notice warning">${esc(a.notice||'명세의 규칙에 따른 탐색 후보입니다. 개별 카드와 추천 성능은 검증하지 않았습니다.')}</div>${a.questionDrafts?.length?`<h3 class="checks-title">다르게 물어볼 수 있는 질문</h3>${a.questionDrafts.map((draft,i)=>`<button class="draft-button" data-draft="${i}">${esc(typeof draft==='string'?draft:draft.question||plain(draft))}</button>`).join('')}`:''}<h3 class="checks-title">우선 비교할 경로 <span class="inline-note">최대 3개 · 적합성과 실행은 별도</span></h3><div class="candidate-grid">${(a.candidates||[]).map(renderCandidate).join('')}</div>${!a.candidates?.length?'<p class="inline-note">현재 정보로 단일 방법을 확정하지 않습니다. 목적과 맥락을 더 적거나 전체 등록부를 탐색해 주세요.</p>':''}<div class="actions section-space"><button class="btn small" data-action="all-candidates">${state.allCandidates?'전체 후보 접기':`전체 관련 후보 펼치기 (${a.allCandidates?.length||0})`}</button><button class="btn link small" data-tab="registry">393개 이름 검색 →</button></div>${state.allCandidates?`<div class="table-wrap section-space"><table class="registry-table"><thead><tr><th>방법</th><th>안내 상태</th><th>실행 상태</th><th>기록</th></tr></thead><tbody>${(a.allCandidates||[]).map(c=>{const m=state.registry.methods.find(x=>x.id===(c.methodId||c.id));return `<tr><td><button class="method-name" data-detail="${esc(c.methodId||c.id)}">${esc(m?.name||c.name||c.methodId)}</button><span class="method-id">${esc(c.methodId||c.id)}</span></td><td>${badge(sl(c.status||'conditional'))}</td><td>${esc(sl(c.executionStatus||m?.executionStatus))}</td><td><button class="btn small" data-select="${esc(c.methodId||c.id)}">${state.project.selectedMethods.includes(c.methodId||c.id)?'선택 해제':'후보 선택'}</button></td></tr>`;}).join('')}</tbody></table></div>`:''}<div class="section-space">${field('후보 선택·보류 이유','decisionReason','어떤 이유로 선택하거나 보류했는지, 무엇을 확인하면 판단이 바뀔지 기록하세요.',{area:true})}</div><h3 class="checks-title">확인할 내용</h3><div class="check-list">${(a.checks||[]).map(c=>`<div class="check-item"><code>${esc(c.id)}</code>${badge(sl(c.status),c.status==='pass'?'green':'pending')}<span>${esc(c.message||plain(c))}</span></div>`).join('')}</div>`;}
function renderCandidate(c){const m=state.registry.methods.find(x=>x.id===c.methodId);return `<article class="candidate ${state.project.selectedMethods.includes(c.methodId)?'selected':''}"><div class="candidate-head"><span class="method-id">${esc(c.methodId)} · ${esc(m?.groupName||'탐색 후보')}</span><h3>${esc(m?.name||c.name||c.methodId)}</h3>${badge(sl(c.status||'conditional'))}</div><div class="candidate-body"><p>${esc(c.reason||'명세의 영역 연결에 따른 탐색 후보. 개별 적용 조건 검토가 필요합니다.')}</p><dl>${[['질문',c.question],['자료·단위',c.unit],['필요한 근거',c.requiredEvidence],['예상 산출물',c.output],['허용되는 결론',c.allowedConclusion],['현재 부족한 정보',c.missingInformation],['실행 지원',sl(c.executionStatus)],['실행 범위',c.executionScope||m?.executionScope],['검증 상태',sl(c.verificationStatus)],['근거 위치',c.sourceRefs]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v?plain(v):'미확인 · 개별 카드 검토 필요')}</dd>`).join('')}</dl></div><div class="candidate-foot"><button class="btn link small" data-detail="${esc(c.methodId)}">등록 정보</button><button class="btn small" data-select="${esc(c.methodId)}" aria-pressed="${state.project.selectedMethods.includes(c.methodId)}">${state.project.selectedMethods.includes(c.methodId)?'선택됨 ✓':'후보로 선택'}</button></div></article>`;}
function num(v){return typeof v==='number'&&Number.isFinite(v)?String(Number(v.toPrecision(6))):'산출 안 됨';}
function isStale(){return (state.project.nodes||[]).some(n=>['analysis','figure','interpretation'].includes(n.id)&&(['stale','needs_review','recompute_required'].includes(n.status)||n.invalidated===true||n.stale===true||n.needsReview===true));}
function renderCalculation(){const p=state.project,a=p.analysis,stale=isStale();return intro('VERIFIABLE CALCULATION','자료의 숫자와 해석을 구별합니다.','초기 엔진은 원자료의 기술 요약과 점도표를 제공합니다. 계산 성공을 연구 타당성이나 모집단 추론의 검증으로 표시하지 않습니다.','실행 범위: 기술 요약 · SVG 점도표')+`<div class="grid-main"><div><section class="panel"><div class="panel-head"><h3>숫자 자료 입력</h3><button class="btn small" data-action="synthetic">합성 예시 불러오기</button></div><div class="panel-body"><div class="data-warning">한 줄에 하나의 값을 입력하세요. 빈 줄과 NA, null은 결측으로 보존합니다. 0은 실제 값입니다. 범주형·서열형 자료를 임의로 연속형으로 바꾸지 마세요.</div>${field('관측값 (한 줄에 하나)','calculationInput.raw','예시 값은 자동으로 채우지 않습니다.',{area:true,rows:7,help:'줄바꿈 또는 쉼표로 구분할 수 있습니다. 빈 입력 전체는 계산하지 않습니다.'})}<div class="field-row">${field('변수·축 이름','calculationInput.label','관측한 변수')}${field('값의 단위','calculationInput.unit','예: 시간, 원, 점')}</div><div class="field-row">${field('자료 출처','calculationInput.sourceLabel','확인 가능한 자료 이름·위치')}${field('자료 판본','calculationInput.sourceVersion','확인한 날짜·판본')}</div><label class="field"><span>자료 생성 유형 (필수)</span><select data-field="calculationInput.dataKind"><option value="">선택해 주세요</option>${[['human_observed','인간 직접 수집'],['administrative','행정·관찰 기록'],['synthetic','합성·모의 자료'],['llm_generated','LLM 생성 응답']].map(([id,label])=>`<option value="${id}" ${p.calculationInput?.dataKind===id?'selected':''}>${label}</option>`).join('')}</select></label><button class="btn primary" data-action="calculate" ${state.busy?'disabled':''}>기술 요약과 그림 생성</button></div></section>${a?`<section class="panel" data-result-kind="baseline" data-stale="${stale}"><div class="panel-head"><h3>기술 요약 결과</h3><span data-result-status>${badge(stale?'재검토 필요':a.synthetic?'합성 자료 결과':'계산 결과',stale?'stale':'green')}</span></div><div class="panel-body"><div class="notice warning" data-result-warning ${stale?'':'hidden'}>입력이나 설계가 변경되었습니다. 이전 결과와 그림을 보존합니다. 다시 계산하기 전에는 현재 결과로 내보낼 수 없습니다.</div><div class="result-stats">${[['유효 관측 수',a.summary?.n],['결측 수',a.summary?.missing],['평균',num(a.summary?.mean)],['표본 표준편차',num(a.summary?.sampleSD)]].map(([label,value])=>`<div class="result-stat"><strong>${esc(value??'산출 안 됨')}</strong><span>${label}</span></div>`).join('')}</div><div class="stat-row"><span>전체 분모</span><strong>${esc(a.summary?.denominator)}</strong></div><div class="stat-row"><span>중앙값 / 최소 / 최대</span><strong>${[a.summary?.median,a.summary?.min,a.summary?.max].map(num).map(esc).join(' / ')}</strong></div><div class="stat-row"><span>불확실성</span><span>추정하지 않음 · 오차막대 없음</span></div><div class="figure section-space">${state.figureUrl?`<img src="${state.figureUrl}" alt="입력한 관측값의 점도표. 단위, 유효 분모, 결측 수와 출처는 캡션에 표시합니다." style="max-width:100%">`:'<p>그림 미리 보기를 생성하지 못했습니다.</p>'}</div><p class="figure-caption">${esc(a.label)} · 단위 ${esc(a.unit)} · 유효 N=${esc(a.summary?.n)} / 전체 ${esc(a.summary?.denominator)}, 결측 ${esc(a.summary?.missing)} · 불확실성 미추정<br>출처: ${esc(a.sourceLabel)} · 판본: ${esc(a.sourceVersion)} · 엔진: ${esc(a.engineVersion)} · 자료 유형: ${esc(a.dataKind)}</p><div class="actions"><button class="btn small" data-action="download-svg" ${stale||!state.figureUrl?'disabled':''}>SVG 저장</button><button class="btn link small" data-tab="changes">재현 묶음으로 내보내기 →</button></div><div class="notice warning">${esc((a.limitations||[]).join(' ')||'모집단, 인과, 예측, 측정 타당성을 검증한 결과가 아닙니다.')}</div></div></section>`:''}</div><aside class="aside-grid"><section class="aside-panel"><h3>현재 실행하는 것</h3><p>유효 관측 수와 결측 수, 평균, 중앙값, 표본 표준편차, 범위, 관측값 점도표.</p><div class="rule-divider"></div><h3>별도 검토가 필요한 것</h3><p style="margin:0">표집·가중·의존 구조, 결측 가정, 점수의 의미, 인과 식별, 외부 예측 성능, 일반화는 계산으로 승인하지 않습니다.</p></section><section class="aside-panel"><h3>자료 생성 유형을 확인하세요.</h3><p style="margin:0">합성·LLM 응답은 인간의 관측값과 구별합니다. 공개 묶음은 원자료를 기본으로 포함하지 않습니다.</p></section></aside></div>`;}
function renderChanges(){const p=state.project;return intro('VERSIONS, DEPENDENCIES & REPRODUCIBILITY','바뀐 내용이 어디에 영향을 주는지 확인합니다.','등록된 생성 의존성을 따라 결과를 재검토 상태로 표시합니다. 생성 이력과 주장에 대한 지지·반박은 서로 다른 관계입니다.')+`<section class="panel"><div class="panel-head"><h3>프로젝트 의존성</h3>${badge(isStale()?'후속 결과 재검토 필요':'등록된 의존성 기준',isStale()?'stale':'green')}</div><div class="panel-body"><div class="graph">${(p.nodes||[]).map(n=>`<div class="graph-node"><code>${esc(n.id)} · v${esc(n.version||1)}</code><strong>${esc(n.label||({question:'연구 질문',design:'연구설계',data:'자료',analysis:'분석',figure:'그림',interpretation:'해석'}[n.id])||n.id)}</strong>${badge(sl(n.status),n.status==='stale'?'stale':n.status==='current'?'green':'pending')}</div>`).join('')}</div><div class="source-box">${(p.edges||[]).map(e=>`${esc(e.from||e.source)} → ${esc(e.to||e.target)} (${esc(e.type||e.relation)})`).join('<br>')}</div><p class="inline-note section-space">자동 영향 표시는 등록된 의존성에 한정됩니다. 의미 변화와 간접 영향은 연구자가 추가로 검토해야 합니다.</p><div class="actions"><button class="btn small" data-action="design-change">설계 변경 기록</button><button class="btn small" data-action="font-change">그림 글꼴 변경 기록</button></div></div></section><div class="review-grid"><section class="panel"><div class="panel-head"><h3>저장 판본</h3><button class="btn small" data-action="versions">목록 새로고침</button></div><div class="panel-body">${p.id?state.versions.length?state.versions.map(v=>`<div class="history-row"><div><strong>판본 ${esc(v.version)}</strong><small>${esc(v.savedAt||v.updatedAt||v.createdAt||'저장 시각 미표시')}</small></div><button class="btn small" data-version="${esc(v.version)}">이 판본 불러오기</button></div>`).join(''):'<p class="muted">목록을 새로고침해 저장 판본을 확인하세요.</p>':'<p class="muted">프로젝트를 먼저 저장하면 판본이 기록됩니다.</p>'}</div></section><section class="panel"><div class="panel-head"><h3>변경 이력</h3>${badge(`${p.history?.length||0}건`,'blue')}</div><div class="panel-body">${p.history?.length?p.history.slice(-8).reverse().map(h=>`<div class="history-row"><div>${esc(h.message||h.description||h.changeKind||h.kind||plain(h))}<small>${esc(h.at||h.timestamp||'')}</small></div></div>`).join(''):'<p class="muted">아직 기록된 변경이 없습니다.</p>'}</div></section></div><section class="panel"><div class="panel-head"><h3>연결된 재현 묶음 내보내기</h3>${badge('ZIP · SVG · JSON · 재계산 코드','blue')}</div><div class="panel-body"><p class="muted">그림과 캡션, 수치 요약, 분석 설정, 출처·판본, 재현 절차를 함께 저장합니다. 공개용 묶음에는 원자료가 포함되지 않아 완전 재계산에는 제한이 있습니다.</p><label class="checkbox-line"><input type="checkbox" id="include-data" ${state.includeData?'checked':''}><span>원자료와 전체 프로젝트(다른 입력·근거 기록 포함)를 ZIP에 포함합니다. 민감 정보·재식별 가능성·이용 권한을 확인했으며, 공유할 때 다른 모듈 입력과 질적·혼합 근거 기록도 함께 전달된다는 점을 이해합니다.</span></label>${state.includeData?'<div class="notice warning">원자료와 전체 프로젝트가 ZIP에 포함됩니다. 다른 입력·질적·혼합 근거 기록도 포함되므로 보관·공유 범위를 확인하세요.</div>':''}${isStale()?'<div class="notice error">변경 후 재검토가 필요한 결과가 있습니다. 먼저 다시 계산해 주세요.</div>':''}<button class="btn primary" data-action="export" ${!p.analysis||isStale()||state.busy?'disabled':''}>${state.includeData?'원자료·전체 프로젝트 ZIP 저장':'공개용 ZIP 저장'}</button>${!p.analysis?'<p class="inline-note" style="margin-top:10px">자료를 입력하고 기술 요약을 계산하면 내보내기가 열립니다.</p>':''}<p class="inline-note" style="margin-top:15px">현재 출력: SVG와 ZIP. PDF·PNG·TIFF 출력, 투고처별 검사, 외부 분석 결과 가져오기는 미구현입니다.</p></div></section>`;}
function filteredMethods(){return state.registry.methods.filter(m=>(!state.search||`${m.id} ${m.name} ${m.groupName} ${m.output||''}`.toLowerCase().includes(state.search.toLowerCase()))&&(!state.group||m.groupId===state.group)&&(!state.layer||m.layer===state.layer));}
function renderRegistry(){const methods=filteredMethods(),layers=[...new Set(state.registry.methods.map(m=>m.layer))];return intro('A MAP OF RESEARCH METHODS','전체 방법을 한곳에서 탐색합니다.','방법 이름을 찾고 영역을 비교하세요. 확인되지 않은 설명이나 적용 조건은 미확인 상태로 남겨 둡니다.',`${state.registry.methods.length}개 이름 · ${state.registry.groups.length}개 영역`)+`<div class="notice warning">현재 등록부는 범위 초안입니다. 이름 등록을 상세 카드 검토나 추천·실행 검증 완료로 해석하지 마세요.</div><section class="panel"><div class="panel-body"><div class="filters"><label class="field"><span>방법 이름·약어·영역 검색</span><input type="search" id="method-search" placeholder="예: 경험, 회귀, IPA, LDA" value="${esc(state.search)}"></label><label class="field"><span>영역</span><select id="group-filter"><option value="">모든 영역</option>${state.registry.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===state.group?'selected':''}>${esc(g.name||g.label||g.id)}</option>`).join('')}</select></label><label class="field"><span>층위</span><select id="layer-filter"><option value="">모든 층위</option>${layers.map(l=>`<option value="${esc(l)}" ${l===state.layer?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div><div id="registry-results">${registryResults(methods)}</div></div></section><section class="panel"><div class="panel-head"><h3>찾는 방법이 없나요?</h3>${badge('임시 후보 · 미검토')}</div><div class="panel-body">${field('미등록 방법과 확인할 원출처','unregisteredMethods','방법 이름, 동의어, 발견한 출처와 확인할 내용을 적어 주세요.',{area:true,help:'원출처 → 동의어·중복 → 유형·전제 → 카드 → 검토 → 버전 등록 순서로 확인해야 합니다. 이 기록은 새 방법을 검증 완료로 등록하지 않습니다.'})}</div></section>`;}
function registryResults(methods){return `<p class="count-line" role="status">검색 결과 ${methods.length}개 / 전체 ${state.registry.methods.length}개 · 첫 ${Math.min(state.limit,methods.length)}개 표시</p><div class="table-wrap"><table class="registry-table"><thead><tr><th>방법 이름</th><th>영역</th><th>상세 카드</th><th>추천 검증</th><th>실행</th></tr></thead><tbody>${methods.slice(0,state.limit).map(m=>`<tr><td><button class="method-name" data-detail="${esc(m.id)}">${esc(m.name)}</button><span class="method-id">${esc(m.id)}</span></td><td>${esc(m.groupName)}</td><td>${badge(sl(m.cardStatus))}</td><td>${badge(sl(m.recommendationStatus))}</td><td>${esc(sl(m.executionStatus))}</td></tr>`).join('')}</tbody></table></div>${!methods.length?'<div class="empty-state">해당하는 이름이 없습니다. 미등록 후보로 기록할 수 있습니다.</div>':''}${methods.length>state.limit?'<div class="registry-list-foot"><button class="btn small" data-action="more-methods">60개 더 보기</button></div>':''}`;}
function renderDetail(){
  const m=state.registry.methods.find(x=>x.id===state.detail);if(!m)return '';const c=m.card||{};
  const combine=(...values)=>values.filter(Boolean).map(plain).join(' / ')||'미확인 · 원출처와 개별 적용 조건 검토 필요';
  const items=[
    ['01 · 해결할 질문',c.question],['02 · 철학적·이론적 전제',c.premises],
    ['03 · 적용·제외 조건',combine(c.applicability,c.exclusions)],
    ['04 · 자료 종류·단위·수집 요구',c.dataRequirements],
    ['05 · 계산·해석 절차와 작업 환경',combine(c.procedure,c.environment)],
    ['06 · 결측·예외·반례',c.missingAndCounterevidence],
    ['07 · 산출물·단위·불확실성',combine(c.output,c.resultUnit,c.uncertainty)],
    ['08 · 허용 결론과 금지하는 확대 해석',combine(c.allowedConclusion,c.prohibitedConclusion)],
    ['09 · 대안·통합 관계',c.alternatives],['10 · 시각화와 필요한 입력',c.visualization],
    ['11 · 출처·판본·적용 범위',combine(c.sourceIds,c.sources,c.sourceScope)],
    ['12 · 검증 사례·판본·유지관리',combine(c.validationCases,c.cardVersion,c.version,c.maintainer,c.reviewer,c.reviewedAt)]
  ];
  return '<div class="dialog-backdrop" data-action="backdrop-close"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="method-title"><div class="panel-head"><div><span class="method-id">'+esc(m.id)+' · '+esc(m.groupName)+'</span><h2 id="method-title">'+esc(m.name)+'</h2></div><button class="close" data-action="close-detail" aria-label="방법 정보 닫기">×</button></div><div class="panel-body"><div class="notice warning" style="margin-top:0">'+(m.cardStatus==='source_reviewed'?'이 카드는 원출처와 대조한 범위를 표시합니다. 전문가 독립 검토와 추천 성능 검증은 미실시입니다.':['partial','partially_reviewed'].includes(m.cardStatus)?'일부 원출처를 대조했으며 상세 절차·적용 범위의 공백이 남습니다. 전문가·추천 검증 미실시':'명세의 이름·영역 등록 정보입니다. 원출처와 대조하지 않은 상세 항목은 미확인으로 유지합니다.')+'</div><div class="method-statuses">'+badge('이름: '+sl(m.nameStatus),'green')+badge('카드: '+sl(m.cardStatus))+badge('추천: '+sl(m.recommendationStatus))+badge('실행: '+sl(m.executionStatus),'blue')+badge('전문가 검토 미실시')+'</div><p class="inline-note section-space">실행 범위: '+esc(m.executionScope||'현재 내부 실행 미지원 · 적합성과 별도')+'</p><p class="inline-note">명세 표기 동의어: '+esc(m.aliases?.length?m.aliases.join(' · '):'미확인')+' · 층위: '+esc(m.layer)+'</p><div class="detail-grid">'+items.map(([key,value])=>'<div class="detail-item"><strong>'+esc(key)+'</strong>'+esc(value?plain(value):'미확인 · 개별 카드 검토 필요')+'</div>').join('')+'</div><details class="source-details section-space" open><summary>원출처·주장 연결과 확인 수준</summary>'+renderCardSources(m)+'<div class="source-box">남은 카드 검토 공백: '+esc(plain(c.reviewGaps||'미표시'))+'<br>검증 상태: '+esc(sl(m.verificationStatus))+'<br>원출처 대조는 해당 프로젝트의 적합성, 전문가 합의, 연구 타당성을 승인하지 않습니다.</div></details><div class="source-box">이름 등록 근거: '+esc(m.source?.file||'SPEC-v4.0.md')+' · '+esc(m.source?.section||'제21절')+' · '+esc(m.source?.line||'행 미확인')+'행<br>영역 수준 산출물 예시: '+esc(m.output||'미확인')+'<br>영역 수준 표현 예시: '+esc(m.visualization||'미확인')+'<br>영역 예시와 개별 방법의 검토된 조건을 구별합니다.</div><div class="actions section-space"><button class="btn primary" data-select="'+esc(m.id)+'">'+(state.project.selectedMethods.includes(m.id)?'후보 선택 해제':'프로젝트 후보로 선택')+'</button><button class="btn" data-action="close-detail">닫기</button></div></div></section></div>';
}
function renderClaimSources(claims){const entries=Array.isArray(claims)?claims:Object.values(claims);const labels={question:'질문',premises:'전제',applicability:'적용 조건',exclusions:'제외 조건',dataRequirements:'자료 요구',procedure:'절차',uncertainty:'불확실성',resultUnit:'산출 단위',allowedConclusion:'허용 결론',prohibitedConclusion:'금지하는 확대 해석',alternatives:'대안',visualization:'시각화',missingAndCounterevidence:'결측·반례','validationCases.normal':'정상 시험 계획','validationCases.risk':'위험 시험 계획','validationCases.boundary':'경계 시험 계획',reviewGaps:'근거 공백'};return '<h4 class="section-space">주장별 근거 연결</h4>'+entries.map(claim=>typeof claim==='string'?'<div class="source-box">'+esc(claim)+'</div>':'<details class="claim-item"><summary>'+esc(claim.claimId||'주장')+' · '+esc(labels[claim.field]||claim.field||'필드 미표시')+'</summary><p>'+esc(claim.text||'주장 문구 미표시')+'</p><div class="inline-note">'+esc(sl(claim.supportType||'unknown'))+' · '+esc(claim.sourceId||'출처 미표시')+' · '+esc(claim.location||'위치 확인 필요')+' · '+esc(sl(claim.accessLevel||'unknown'))+'</div>'+(claim.interpretationNote?'<p class="inline-note">'+esc(claim.interpretationNote)+'</p>':'')+sourceLink(claim)+'</details>').join('');}
function renderCardSources(method){
  const card=method.card||{},sourceList=Array.isArray(state.registry.sources)?state.registry.sources:Object.values(state.registry.sources||{}),ids=new Set();
  const collect=value=>{if(typeof value==='string'){if(sourceList.some(s=>(s.id||s.source_id||s.sourceId)===value))ids.add(value);}else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};
  collect(method.sourceIds);collect(card.sourceIds);collect(card.sources);collect(method.claimSources);collect(card.claimSources);
  const sources=sourceList.filter(s=>ids.has(s.id||s.source_id||s.sourceId));
  const claims=method.claimSources||card.claimSources;
  return (claims?renderClaimSources(claims):'')+(sources.length?sources.map(source=>'<article class="source-box"><strong>'+esc(source.id||source.source_id||source.sourceId)+' · '+esc(source.title||source.bibliography||'제목 미표시')+'</strong><br>'+esc(plain(source.authors||source.author||''))+' '+esc(source.year||'')+'<br>확인 절·위치: '+esc(plain(source.reviewedLocations||source.section||source.sections||source.location||source.evidenceLocation||'위치 확인 필요'))+'<br>판본: '+esc(plain(source.version||source.sourceVersion||'판본 미표시'))+' · 접근: '+esc(sl(source.accessLevel||source.access_level||'unknown'))+'<br>검토: '+esc(sl(source.reviewStatus||source.status||(source.source_reviewer_checked?'source_reviewed':'not_reviewed')))+' · 확인일: '+esc(source.accessedAt||source.reviewedAt||source.checkedAt||source.verifiedAt||'미표시')+'<br>검토 범위: '+esc(source.reviewScope||'미표시')+'<br>'+esc(sl(source.retractionCorrectionStatus||'unknown'))+sourceLink(source)+'</article>').join(''):'<p class="inline-note">연결된 원출처가 없습니다. 원출처·판본·위치 확인이 필요합니다.</p>');
}
function renderEvidence(){return intro('EVIDENCE, INTERPRETATION & INTEGRATION','근거와 판단을 함께 남깁니다.','질적 해석에는 원문과 반례를, 혼합연구에는 연결할 질문과 불일치를 기록합니다. 자동 타당성 점수를 부여하지 않습니다.')+`<div class="sub-tabs" aria-label="기록 유형"><button data-evidence-tab="qualitative" class="${state.evidenceTab==='qualitative'?'active':''}">질적 근거와 해석</button><button data-evidence-tab="integration" class="${state.evidenceTab==='integration'?'active':''}">혼합연구 공동표시</button><button data-evidence-tab="design" class="${state.evidenceTab==='design'?'active':''}">설계 검토</button></div>${state.evidenceTab==='qualitative'?`<section class="panel"><div class="panel-head"><h3>원문 → 해석 → 반례 → 판단</h3><button class="btn small primary" data-action="add-qualitative">＋ 근거 기록</button></div><div class="notice" style="margin:18px">사람이 해석하고 검토하는 작업입니다. 선택한 전통과 맥락을 기록하고 다른 질적 전통의 기준을 점수로 강제하지 않습니다.</div>${state.project.qualitative.length?state.project.qualitative.map((q,i)=>`<article class="note-card"><div class="actions" style="justify-content:space-between"><h3>근거 ${i+1} ${badge('인간 검토 필요')}</h3><button class="btn link small danger" data-remove-qual="${i}">기록 삭제</button></div><div class="field-row">${field('연구 전통·연구자 위치',`qualitative.${i}.tradition`,'선택한 전통과 해석 관점')}${field('출처·판본·쪽/절',`qualitative.${i}.source`,'자료 식별자, 쪽/절, 확인한 판본')}</div>${field('원문 발췌',`qualitative.${i}.excerpt`,'원문을 인용하고 맥락과 익명화·이용 권한을 확인하세요.',{area:true})}<div class="field-row">${field('연구자의 해석',`qualitative.${i}.interpretation`,'발췌와 구별해서 기록하세요.',{area:true})}${field('반례·경쟁 해석',`qualitative.${i}.counterevidence`,'이 해석을 약하게 하거나 다르게 설명할 근거',{area:true})}</div>${field('판단과 다음 검토',`qualitative.${i}.decision`,'판단자, 날짜, 아직 확인할 내용')}</article>`).join(''):'<div class="empty-state"><div class="empty-icon">▤</div><h3>첫 근거를 기록해 보세요.</h3><p>인용과 해석을 나누고, 다른 설명이 가능한지 남겨 둡니다.</p></div>'}</section>`:state.evidenceTab==='integration'?`<section class="panel"><div class="panel-head"><h3>수치와 질적 근거의 공동표시</h3><button class="btn small primary" data-action="add-integration">＋ 연결 행 추가</button></div><div class="panel-body"><div class="notice">같은 개념·질문·단위를 연결하는지 확인하세요. 일치, 보완, 불일치를 연구자가 판단하고 경쟁 설명을 보존합니다.</div><div class="integration-scroll"><table class="integration-table"><thead><tr>${['개념','통합 질문','단위','정량 근거','질적 근거','일치·불일치','경쟁 설명','판단','다음 작업'].map(t=>`<th>${t}</th>`).join('')}<th>삭제</th></tr></thead><tbody>${state.project.integration.map((r,i)=>`<tr>${['concept','question','unit','quantitative','qualitative','agreement','alternative','decision','next'].map((key,j)=>`<td><textarea aria-label="통합 ${i+1} ${['개념','통합 질문','단위','정량 근거','질적 근거','일치·불일치','경쟁 설명','판단','다음 작업'][j]}" data-field="integration.${i}.${key}">${esc(r[key])}</textarea></td>`).join('')}<td><button class="btn small" data-remove-int="${i}" aria-label="통합 ${i+1}행 삭제">×</button></td></tr>`).join('')}</tbody></table></div>${!state.project.integration.length?'<div class="empty-state">연결 행을 추가하면 통합 질문과 반대 근거를 기록할 수 있습니다.</div>':''}</div></section>`:`<section class="panel"><div class="panel-head"><h3>질문과 설계의 연결 검토</h3>${badge('명시한 내용만 판단 근거로 사용')}</div><div class="panel-body"><div class="field-row">${field('자료의 관측·분석 단위','unit','예: 개인, 조직, 문서, 사건')}${field('내리려는 결론의 단위','targetUnit','결론이 적용되는 단위')}</div>${field('인과 식별 근거','design.identification','인과 목적일 때 설계와 식별 가정을 기록하세요.',{area:true})}${field('예측 대상 시점','predictionTime','무엇을 어느 시점에 예측하나요?')+field('예측 평가 계획','design.evaluationPlan','예측 목적일 때 평가 시점·독립 자료·분할·누출 방지 계획',{area:true})}${field('측정 도구·점수의 사용 대상','design.measurementTarget','대상 모집단·언어·사용 맥락')+field('측정 점수의 의미와 사용','design.constructUse','측정 목적일 때 구성개념·대상·언어·용도',{area:true})}<div class="field-row">${selectField('반복·군집·의존 구조','design.dependence',[['','미정'],['independent','독립 관측'],['clustered','군집'],['repeated','반복측정'],['clustered_repeated','군집과 반복측정']])}${field('의존 구조를 다루는 계획','design.dependencePlan','표집·대응·다층 등 검토 계획')}</div>${field('가치 전제와 규범적 논거','design.normativeReason','어떤 가치와 논거로 판단하는지, 가능한 반론을 기록하세요.',{area:true})}${selectField('결론을 뒷받침하는 근거','design.conclusionBasis',[['','미정'],['argument','규범적 전제와 논증'],['mixed_evidence','경험적 근거와 논증을 구분해 연결'],['statistics_only','통계값만으로 판단하려 함 · 재검토 필요']])}<button class="btn primary" data-action="assess-design">현재 설계로 안내 다시 검토</button></div></section>`}`;}

function newMethodWorkspace(){return {methodId:'M050',raw:'',label:'',unit:'',analysisUnit:'',sourceLabel:'',sourceVersion:'',dataKind:'',level:'nominal',missingPolicy:'report_separately',dependence:'unknown',xLabel:'',yLabel:'',xUnit:'',yUnit:''};}
function ensureMethodGraph(){const p=state.project;for(const [id,type,label]of[['method-data','data','검증 모듈 자료'],['method-analysis','analysis','검증 모듈 분석'],['method-figure','figure','검증 모듈 그림']])if(!p.nodes.some(n=>n.id===id))p.nodes.push({id,type,label,version:1,status:'draft'});for(const [from,to]of[['method-data','method-analysis'],['design','method-analysis'],['method-analysis','method-figure']])if(!p.edges.some(e=>(e.from||e.source)===from&&(e.to||e.target)===to))p.edges.push({from,to,type:'produces'});}
function methodIsStale(){return state.project.nodes.some(n=>['method-analysis','method-figure'].includes(n.id)&&(['stale','needs_review','recompute_required'].includes(n.status)||n.invalidated||n.stale||n.needsReview));}
function methodFigure(run){if(state.methodFigureUrl)URL.revokeObjectURL(state.methodFigureUrl);state.methodFigureUrl=run?.figureSvg?URL.createObjectURL(new Blob([run.figureSvg],{type:'image/svg+xml'})):null;}
function moduleNumber(token,line){const value=token.trim();if(!value||/^(na|null|nan)$/i.test(value))return null;const numeric=Number(value);if(!Number.isFinite(numeric))throw Error(`${line}행에 유한한 숫자가 아닌 값이 있습니다: ${value}`);return numeric;}
function methodPayload(){const w=state.project.methodWorkspace;if(!w.raw.trim())throw Error('자료를 입력해 주세요. 빈 입력 전체는 계산하지 않습니다.');const lines=w.raw.replaceAll('\r','').split('\n');if(lines.at(-1)===''&&w.raw.endsWith('\n'))lines.pop();syncMethodUnit();const payload=Object.fromEntries(['methodId','label','unit','analysisUnit','sourceLabel','sourceVersion','dataKind','missingPolicy','dependence'].map(key=>[key,w[key]]));
  if(w.methodId==='M050'){payload.values=lines.map(line=>{const marker=line.trim();return !marker||/^(na|null)$/i.test(marker)?null:line;});payload.missingPolicy='report_separately';payload.level=w.level;}
  else{for(const key of ['xLabel','yLabel','xUnit','yUnit'])payload[key]=w[key];payload.pairs=lines.map((line,i)=>{if(!line.trim())return [null,null];const columns=line.split(',');if(columns.length!==2)throw Error(`${i+1}행은 x,y 두 열이어야 합니다. 누락된 셀은 빈칸 또는 NA로 남겨 주세요.`);return columns.map(token=>moduleNumber(token,i+1));});payload.missingPolicy=w.missingPolicy;}
  return payload;
}
async function calculateMethod(){ensureMethodGraph();const payload=methodPayload(),run=await json('/api/method/calculate',{...payload,projectContext:state.project});state.project.methodAnalysis=run;methodFigure(run);for(const id of ['method-analysis','method-figure']){const n=state.project.nodes.find(item=>item.id===id);n.status='current';n.version=(n.version||0)+1;n.invalidated=false;n.stale=false;n.needsReview=false;delete n.invalidation;}const data=state.project.nodes.find(n=>n.id==='method-data');data.status='current';dirty();state.message='모듈 계산과 그림을 생성했습니다. 추천 적합성·연구 타당성·전문가 검토는 별도 상태입니다.';}
async function exportMethod(){if(!state.project.methodAnalysis)throw Error('검증 모듈에서 먼저 계산해 주세요.');if(methodIsStale())throw Error('검증 모듈 자료나 설계가 변경되었습니다. 다시 계산한 뒤 내보내 주세요.');const response=await api('/api/method/export',{project:state.project,run:state.project.methodAnalysis,includeData:state.includeMethodData});download(await response.blob(),`${state.project.methodAnalysis.methodId}-${state.includeMethodData?'reproducible':'public'}-v${state.project.version||0}.zip`);state.message=state.includeMethodData?'모듈 원자료와 전체 프로젝트(다른 입력·근거 기록 포함)가 담긴 재현 ZIP을 저장했습니다.':'모듈 공개용 ZIP을 저장했습니다. 원자료를 제외해 완전 재계산에는 제한이 있습니다.';}
function loadMethodExample(){
  const methodId=state.project.methodWorkspace?.methodId||'M050',paired=['M081','M087'].includes(methodId),regression=methodId==='M087';
  state.project.methodWorkspace={...newMethodWorkspace(),methodId,raw:paired?'1,2\n2,3\n3,5\n4,4\n5,7\nNA,6':'범주 가\n범주 나\n범주 가\nNA\n범주 다\n범주 나',label:regression?'합성 두 변수의 기술적 직선 적합':paired?'합성 두 변수의 관측 연관':'합성 범주 빈도',unit:regression?'합성 Y 단위/합성 X 단위':paired?'무차원':'건',analysisUnit:'합성 관측 1건',sourceLabel:'제품 기능 확인용 합성 예시',sourceVersion:'method-example-v2',dataKind:'synthetic',dependence:paired?'independent':'unknown',missingPolicy:paired?'complete_pairs_explicit':'report_separately',xLabel:paired?'합성 X':'',yLabel:paired?'합성 Y':'',xUnit:paired?'합성 X 단위':'',yUnit:paired?'합성 Y 단위':''};
  ensureMethodGraph();localInvalidate('method-data');dirty();state.message='입력 자료와 모듈 설정을 합성 예시로 바꿨습니다. 이전 계산 결과는 재검토 상태로 보존합니다. 실제 인간 관측값이나 연구 결과가 아닙니다.';
}
function syncMethodUnit(){
  const w=state.project.methodWorkspace;
  if(w.methodId==='M081')w.unit='무차원';
  if(w.methodId==='M087')w.unit=w.xUnit?.trim()&&w.yUnit?.trim()?w.yUnit.trim()+'/'+w.xUnit.trim():'';
  const display=document.getElementById('field-methodWorkspace-unit');
  if(display&&['M081','M087'].includes(w.methodId))display.value=w.unit||(w.methodId==='M087'?'Y 단위/X 단위':'무차원');
}
function methodSourceEvidence(run){const evidence=run?.sourceEvidence;if(!evidence)return '<p class="inline-note">엔진에서 원출처 연결 정보를 반환하지 않았습니다.</p>';const entries=Array.isArray(evidence)?evidence:[evidence];return entries.map(item=>typeof item==='string'?'<p class="inline-note">'+esc(item)+'</p>':'<div class="source-box"><strong>'+esc(item.organization||'')+' · '+esc(item.title||item.sourceId||item.id||'엔진 근거')+'</strong><br>절: '+esc(item.section||item.location||item.evidenceLocation||'절 위치 미표시')+'<br>접근: '+esc(sl(item.access||item.accessLevel||'unknown'))+' · 확인일: '+esc(item.checkedDate||'미표시')+' · 출처 판본·날짜: '+esc(item.sourceDate||'미표시')+'<br>적용 범위: '+esc(item.scope||'범위 미표시')+sourceLink(item)+'</div>').join('');}
function sourceLink(source){const url=source?.url||source?.URL||source?.sourceURL||source?.doiUrl;if(typeof url!=='string'||!/^https?:\/\//i.test(url))return '';try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))return '';}catch{return '';}return `<br><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;}
function renderModules(){
  const w=state.project.methodWorkspace||newMethodWorkspace(),run=state.project.methodAnalysis,pearson=w.methodId==='M081',regression=w.methodId==='M087',paired=pearson||regression,stale=methodIsStale();
  const slopeUnit=w.xUnit?.trim()&&w.yUnit?.trim()?w.yUnit.trim()+'/'+w.xUnit.trim():'Y 단위/X 단위';
  return intro('METHOD MODULES · BOUNDED EXECUTION','검토된 계산 범위를 선택해 실행합니다.','전체 방법 탐색과 별도로, 현재 구현한 세 계산 모듈을 실행합니다. 엔진 지원 여부가 방법 추천의 우선순위를 바꾸지 않습니다.','M050 범주 빈도 · M081 Pearson · M087 단순회귀')+
  '<div class="notice warning">모듈의 내부 수치 시험, 원출처 확인, 추천 성능, 전문가 검토는 각각 다릅니다. 실행 성공으로 연구 질문의 적합성이나 연구 타당성을 승인하지 않습니다.</div>'+
  '<div class="grid-main"><div><section class="panel"><div class="panel-head"><h3>검증 모듈 자료와 설정</h3><button class="btn small" data-action="method-synthetic">합성 예시로 입력·설정 바꾸기</button></div><div class="panel-body">'+
  selectField('계산할 모듈','methodWorkspace.methodId',[['M050','M050 · 범주 빈도와 비율'],['M081','M081 · Pearson 선형상관'],['M087','M087 · 단순 OLS 직선 적합 · 기술 전용']])+
  '<div class="data-warning">'+(paired?'한 줄에 x,y 두 값을 입력하세요. 빈 셀과 NA, null은 결측입니다. 쌍이 모두 관측된 행만 계산하며, 처리 규칙을 명시적으로 선택해야 합니다.':'한 줄에 범주 하나를 입력하세요. 빈 줄과 NA, null은 결측으로 보존합니다. 범주를 숫자로 바꾸지 않으며 비율은 유효 응답 분모를 사용합니다.')+'</div>'+
  field(paired?'두 변수 관측값 (x,y)':'범주 관측값 (한 줄에 하나)','methodWorkspace.raw',paired?'x,y 두 열을 쉼표로 구분해 입력하세요.':'각 관측의 범주 이름을 입력하세요.',{area:true,rows:7,help:'합성 자료는 예시 버튼으로 명시적으로 불러올 수 있습니다. 자동으로 채우지 않습니다.'})+
  '<div class="field-row">'+field('그림·결과 제목','methodWorkspace.label','분석할 변수나 관계')+field('관측·분석 단위','methodWorkspace.analysisUnit','예: 개인 1명, 문서 1건')+'</div>'+
  (paired?'<label class="field"><span>'+(regression?'기울기 단위 (Y 단위/X 단위)':'상관계수 단위')+'</span><input id="field-methodWorkspace-unit" value="'+esc(regression?slopeUnit:'무차원')+'" readonly><small>'+(regression?'X와 Y의 단위에서 자동 구성합니다. 절편·잔차·RMSE의 단위는 Y 단위이며 R²와 레버리지는 무차원입니다.':'Pearson r의 단위입니다. X와 Y의 관측 단위는 각각 기록합니다.')+'</small></label><div class="field-row">'+
    field('X 변수 이름','methodWorkspace.xLabel','실제 관측한 X')+field('Y 변수 이름','methodWorkspace.yLabel','실제 관측한 Y')+'</div><div class="field-row">'+
    field('X 값의 단위','methodWorkspace.xUnit','X 단위')+field('Y 값의 단위','methodWorkspace.yUnit','Y 단위')+'</div>'+
    selectField('관측의 의존 구조','methodWorkspace.dependence',[['unknown','미정 · 실행 조건 확인 필요'],['independent','독립 관측으로 기록'],['clustered','군집 자료 · 현재 엔진 범위 확인 필요'],['repeated','반복측정 · 현재 엔진 범위 확인 필요']])+
    selectField('결측 처리의 명시적 선택','methodWorkspace.missingPolicy',[['report_separately','미선택 · 결측 현황만 확인'],['complete_pairs_explicit','완전한 관측 쌍만 계산 · 제외 행을 보고']]):
    '<div class="field-row">'+selectField('범주의 측정 수준','methodWorkspace.level',[['nominal','명목 범주'],['ordinal','서열 범주 · 순서 검토는 별도']])+field('빈도 단위','methodWorkspace.unit','예: 명, 건')+'</div><p class="inline-note">범주별 유효 빈도와 비율을 보고합니다. 전체·유효·결측 분모를 각각 보존합니다. 결측 원인과 편향을 자동 검증하지 않습니다.</p>')+
  '<div class="field-row">'+field('자료 출처 (필수)','methodWorkspace.sourceLabel','확인할 수 있는 자료 이름·위치')+field('자료 판본 (필수)','methodWorkspace.sourceVersion','확인 날짜·판본')+'</div>'+
  selectField('자료 생성 유형 (필수)','methodWorkspace.dataKind',[['','선택해 주세요'],['human_observed','인간 직접 수집'],['administrative','행정·관찰 기록'],['synthetic','합성·모의 자료'],['llm_generated','LLM 생성 응답']])+
  '<button class="btn primary" data-action="method-calculate">'+(regression?'기술적 직선 적합과 잔차 그림 생성':pearson?'Pearson r 계산과 산점도 생성':'범주 빈도 계산과 막대그림 생성')+'</button></div></section>'+
  (run?renderMethodResult(run,stale):'')+'</div><aside class="aside-grid"><section class="aside-panel"><h3>탐색 범위는 유지합니다.</h3><p>393개 등록항목의 이름과 영역을 계속 탐색할 수 있습니다. 이 화면의 세 실행 모듈만으로 전체 방법 안내 범위를 제한하지 않습니다.</p><button class="btn link small" data-tab="registry">전체 등록부 탐색 →</button></section><section class="aside-panel"><h3>'+
  (regression?'단순회귀 실행의 경계':pearson?'Pearson 실행의 경계':'범주 빈도 실행의 경계')+'</h3><p>'+
  (regression?'절편을 포함한 한 개 X와 Y의 OLS 직선을 관측 자료에 적합합니다. 기울기·절편·R²·잔차는 기술 요약입니다. 인과효과·외부 예측 성능·모집단 추론을 승인하지 않으며 p값·신뢰구간을 제공하지 않습니다.':pearson?'r은 관측된 두 변수의 선형 연관을 요약합니다. 인과효과·비선형 관계·모집단 추론을 승인하지 않습니다. p값과 신뢰구간은 제공하지 않습니다.':'입력한 범주의 빈도와 유효 응답 비율을 요약합니다. 표본틀·표집·가중치를 반영한 모집단 추정과 범주 순서·측정 타당성 검증은 제공하지 않습니다.')+
  '</p><div class="rule-divider"></div><p style="margin:0">기존 기술 요약 결과는 별도로 보존합니다. 자료나 설계가 바뀌면 이 모듈의 결과와 그림을 해당 의존성에 따라 재검토합니다.</p></section><section class="aside-panel"><h3>표본틀·표집·가중치 확인</h3><p>누가 표본틀에 포함되었는지, 어떤 방식으로 선택했는지, 제외·비응답·가중치가 있는지 기록하세요. 현재 모듈은 가중치를 적용하지 않으며 군집·반복 관측을 보정하지 않습니다. 의존 구조를 선택하거나 계획을 적어도 설계 검증 통과로 표시하지 않습니다.</p>'+
  field('표본틀·표집·가중치·의존 구조 검토 기록','design.dependencePlan','확인한 사항, 미확인 사항, 필요한 외부 분석을 기록하세요.',{area:true,rows:5})+
  '<p class="inline-note">이 기록을 바꾸면 연결된 분석과 그림이 재검토 상태가 됩니다.</p></section></aside></div>';
}
function renderMethodResult(run,stale){
  const s=run.summary||{},input=run.input||{},isPearson=run.methodId==='M081',isRegression=run.methodId==='M087',paired=isPearson||isRegression;
  const entries=isRegression?[['완전한 관측 쌍',s.complete],['제외·결측 행',s.missingPairs],['기울기 (Y/X)',num(s.slope)],['절편 (Y)',num(s.intercept)],['R² · 관측 자료 내',s.rSquared===null?'정의되지 않음':num(s.rSquared)],['기술 RMSE · √(SSE/n)',num(s.rmse)]]:isPearson?[['완전한 관측 쌍',s.complete],['제외·결측 행',s.missingPairs],['Pearson r',num(s.r)],['전체 입력 행',s.total]]:[['유효 관측 수',s.n??s.validN??s.valid],['결측 수',s.missing??s.missingN],['전체 분모',s.denominator??s.total],['범주 수',s.categoryCount??s.categories?.length??s.frequencies?.length]];
  const categories=s.frequencies||s.categories||s.counts,title=isRegression?'단순 OLS 직선 적합 결과 · 기술 전용':isPearson?'Pearson 선형상관 결과':'범주 빈도 결과';
  const diagnostics=isRegression?'<div class="stat-row"><span>기술적 적합식</span><strong>ŷ = '+esc(num(s.intercept))+' + ('+esc(num(s.slope))+') × x</strong></div><p class="inline-note">기울기: '+esc(input.unit)+' · 절편·잔차·RMSE: '+esc(input.yUnit)+' · SSE: ('+esc(input.yUnit)+')² · R²·레버리지: 무차원</p><div class="stat-row"><span>전체 입력 / 완전한 관측 쌍 / 제외·결측</span><strong>'+esc(s.total)+' / '+esc(s.complete)+' / '+esc(s.missingPairs)+'</strong></div><div class="stat-row"><span>SSE / 최대 절대 잔차 / 최대 레버리지</span><strong>'+[s.sse,s.maxAbsResidual,s.maxLeverage].map(num).map(esc).join(' / ')+'</strong></div>'+(s.constantY?'<div class="notice warning">Y가 상수여서 R²는 정의되지 않습니다. 기울기·절편과 잔차를 함께 확인하세요.</div>':'')+'<div class="notice warning">절편을 포함한 관측 자료 내 직선 적합입니다. RMSE는 √(SSE/n)인 기술 요약이며 잔차 표준오차 √(SSE/(n−2))가 아닙니다. 인과효과·모집단 추론·외부 예측 성능을 검증하지 않았고 p값·신뢰구간을 산출하지 않았습니다.</div><h4 class="section-space">관측값·적합값·잔차·레버리지</h4><p class="inline-note">입력 행 번호를 보존하며 완전한 관측 쌍만 표시합니다. 화면 수치는 유효숫자 6자리로 표시하고 저장 자료는 계산 정밀도를 보존합니다. 잔차는 중심화하여 계산하므로 큰 값에서는 표시한 Y−ŷ와 반올림 차이가 생길 수 있습니다. 잔차·레버리지에 임계값이나 이상치 판정을 부여하지 않습니다.</p>'+renderRegressionObservations(run.observations||[]):'';
  return '<section class="panel" data-result-kind="method" data-stale="'+stale+'"><div class="panel-head"><h3>'+title+'</h3><span data-result-status>'+badge(stale?'재검토 필요':run.synthetic?'합성 자료 결과':'계산 결과',stale?'stale':'green')+'</span></div><div class="panel-body"><div class="notice warning" data-result-warning '+(stale?'':'hidden')+'>모듈 자료나 설계가 변경되었습니다. 기존 결과와 그림을 보존하며 다시 계산하기 전에는 현재 결과로 내보낼 수 없습니다.</div><div class="result-stats">'+
    entries.map(([label,value])=>'<div class="result-stat"><strong>'+esc(value??'산출 안 됨')+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
    (paired?'<div class="stat-row"><span>X 결측 / Y 결측</span><strong>'+esc(s.missingX)+' / '+esc(s.missingY)+'</strong></div>':'')+
    (isRegression?diagnostics:isPearson?'<div class="notice warning">Pearson r은 관측된 선형 연관입니다. 인과효과가 아니며 p값·신뢰구간·오차막대를 추정하지 않았습니다.</div>':Array.isArray(categories)?'<div class="table-wrap"><table class="registry-table"><thead><tr><th>범주</th><th>빈도</th><th>유효 응답 비율</th><th>전체 입력 비율</th></tr></thead><tbody>'+categories.map(c=>'<tr><td>'+esc(c.category??c.label??c.value)+'</td><td>'+esc(c.count??c.n)+'</td><td>'+(typeof c.proportionValid==='number'?esc(num(c.proportionValid*100))+'%':esc(c.percentage??'정의 미표시'))+'</td><td>'+(typeof c.proportionTotal==='number'?esc(num(c.proportionTotal*100))+'%':'정의 미표시')+'</td></tr>').join('')+'</tbody></table></div>':'')+
    '<div class="figure section-space">'+(state.methodFigureUrl?'<img src="'+state.methodFigureUrl+'" alt="'+(isRegression?'완전한 관측 쌍의 산점도와 OLS 적합 직선, 적합값에 대한 잔차 그림. 불확실성과 연구 타당성을 검증한 그림이 아닙니다.':isPearson?'유효 관측 쌍의 산점도. Pearson r은 관측 연관이며 인과효과가 아닙니다.':'입력 범주의 빈도 막대그림. 유효·결측·전체 분모는 캡션에서 구분합니다.')+'" style="max-width:100%">':'<p>현재 그림 미리 보기가 없습니다. 다시 계산해 주세요.</p>')+'</div><p class="figure-caption">'+
    esc(input.label||run.label||'검증 모듈 결과')+' · 관측·분석 단위 '+esc(input.analysisUnit||'미표시')+' · '+(paired?'X: '+esc(input.xLabel)+' ('+esc(input.xUnit)+'), Y: '+esc(input.yLabel)+' ('+esc(input.yUnit)+')':'빈도 단위: '+esc(input.unit||'미표시'))+
    '<br>자료 유형: '+esc(input.dataKind||run.dataKind||'미표시')+' · 출처: '+esc(input.sourceLabel||run.sourceLabel)+' · 판본: '+esc(input.sourceVersion||run.sourceVersion)+' · 엔진: '+esc(run.engineVersion)+
    '<br>불확실성 미추정 · 모집단·인과·연구 타당성 미검증 · 자세한 분모와 결측은 위 결과 및 그림에 연결됩니다.</p><div class="actions"><button class="btn small" data-action="method-svg" '+(stale||!state.methodFigureUrl?'disabled':'')+'>모듈 SVG 저장</button></div><div class="notice warning">'+esc((run.limitations||[]).join(' '))+'</div><details class="source-details"><summary>계산 근거와 검토 범위</summary>'+methodSourceEvidence(run)+'<p class="inline-note">원출처 연결과 수치 시험은 추천 성능·전문가 검토·연구 타당성의 검증과 구별합니다.</p></details><div class="rule-divider"></div><h3>모듈 재현 묶음</h3><label class="checkbox-line"><input id="include-method-data" type="checkbox" '+(state.includeMethodData?'checked':'')+'><span>이 모듈의 원자료와 전체 프로젝트(다른 입력·근거 기록 포함)를 ZIP에 포함합니다. 다른 모듈 입력과 기존 기술 요약·질적·혼합 근거 기록도 함께 저장됩니다. 민감 정보·재식별 가능성·이용 권한을 확인했으며 공유할 때 전체가 전달된다는 점을 이해합니다.</span></label>'+
    (state.includeMethodData?'<div class="notice warning">원자료와 전체 프로젝트(다른 입력·근거 기록 포함)가 저장됩니다. 다른 모듈 입력과 질적·혼합 근거 기록의 공유 범위도 확인해 주세요.</div>':'<p class="inline-note">기본 공개용 묶음에서는 원자료와 관측별 적합값·잔차·레버리지를 제외합니다. 완전한 재계산에는 접근이 허용된 원자료가 별도로 필요합니다.</p>')+
    '<button class="btn primary" data-action="method-export" '+(stale?'disabled':'')+'>'+(state.includeMethodData?'모듈 원자료·전체 프로젝트 ZIP 저장':'모듈 공개용 ZIP 저장')+'</button></div></section>';
}
function renderRegressionObservations(observations){
  if(!observations.length)return '<p class="inline-note">관측별 결과를 불러오지 못했습니다. 다시 계산해 주세요.</p>';
  const visible=observations.slice(0,200);
  return (observations.length>200?'<p class="inline-note">전체 '+esc(observations.length)+'행 중 첫 200행을 표시합니다. 전체 관측별 결과는 원자료를 포함하는 재현 묶음에 저장됩니다.</p>':'')+
    '<div class="table-wrap"><table class="registry-table" data-regression-observations><thead><tr><th>입력 행</th><th>X</th><th>Y</th><th>적합값 ŷ</th><th>잔차 (Y−ŷ)</th><th>레버리지</th></tr></thead><tbody>'+
    visible.map(o=>'<tr><td>'+esc(o.rowIndex)+'</td><td>'+esc(num(o.x))+'</td><td>'+esc(num(o.y))+'</td><td>'+esc(num(o.fitted))+'</td><td>'+esc(num(o.residual))+'</td><td>'+esc(num(o.leverage))+'</td></tr>').join('')+'</tbody></table></div>';
}
function resetAdoptionReview(){state.adoptionReview=null;state.adoptionSelected=[];state.adoptionManual={};state.adoptionManualEnabled=false;invalidateAdoptionPreview();}
function invalidateAdoptionPreview(){state.adoptionPreview=null;state.adoptionConfirmed=false;state.adoptionSelections=null;const panel=root.querySelector('.adoption-preview');if(panel)panel.hidden=true;}
function adoptionSelections(){
  const selections=(state.adoptionSelected||[]).map(proposalId=>({proposalId}));
  if(state.adoptionManualEnabled){
    const m=state.adoptionManual,manual={quote:m.quote||'',kind:m.kind||'condition'};
    if(manual.kind==='condition'){manual.questionId=m.questionId;manual.value=m.value||'unknown';}
    if(manual.kind==='alternative')manual.alternativeId=m.alternativeId;
    if(manual.kind==='claim')manual.text=m.text||'';
    if(m.reason?.trim())manual.reason=m.reason;
    selections.push({manual});
  }
  return selections;
}
root.addEventListener('input',event=>{
  if(state.busy||!event.target.dataset.adoptionField)return;
  state.adoptionManual??={};state.adoptionManual[event.target.dataset.adoptionField]=event.target.value;invalidateAdoptionPreview();
});
root.addEventListener('change',event=>{
  if(state.busy)return;const e=event.target;
  if(e.dataset.adoptionProposal){
    const selected=new Set(state.adoptionSelected||[]);if(e.checked)selected.add(e.dataset.adoptionProposal);else selected.delete(e.dataset.adoptionProposal);
    state.adoptionSelected=[...selected];invalidateAdoptionPreview();render();
  }else if(e.id==='adoption-manual-enabled'){state.adoptionManualEnabled=e.checked;invalidateAdoptionPreview();render();}
  else if(e.id==='adoption-confirmed'){state.adoptionConfirmed=e.checked;render();}
  else if(e.dataset.adoptionField){
    state.adoptionManual??={};state.adoptionManual[e.dataset.adoptionField]=e.value;
    if(e.dataset.adoptionField==='questionId')state.adoptionManual.value='unknown';
    invalidateAdoptionPreview();render();
  }
});
root.addEventListener('input',event=>{
  if(state.busy)return;const e=event.target;
  if(e.dataset.evidenceField){state.evidenceEntry??=newEvidenceEntry();state.evidenceEntry[e.dataset.evidenceField]=e.value;clearEvidenceRevisionConfirmation();}
  if(e.dataset.evidenceRevision){state.evidenceRevision??={};state.evidenceRevision[e.dataset.evidenceRevision]=e.value;clearEvidenceRevisionConfirmation();}
});
function clearEvidenceRevisionConfirmation(){state.evidenceRevisionConfirmed=false;const confirmation=root.querySelector('#evidence-revision-confirmed');if(confirmation)confirmation.checked=false;const submit=root.querySelector('[data-action="decision-evidence-revise"]');if(submit)submit.disabled=true;}
root.addEventListener('change',event=>{
  if(state.busy)return;const e=event.target;
  if(e.id==='evidence-revision-confirmed'){state.evidenceRevisionConfirmed=e.checked;render();return;}
  if(e.dataset.evidenceField){
    const key=e.dataset.evidenceField;
    if(key==='criterionId')state.evidenceEntry=newEvidenceEntry(e.value);
    else{state.evidenceEntry??=newEvidenceEntry();state.evidenceEntry[key]=e.value;}
    if(key==='provenance'&&e.value!=='user_material'&&state.evidenceEntry.outcome==='supports')state.evidenceEntry.outcome='unknown';
    if(key==='stage'&&e.value!=='reviewed')state.evidenceEntry.outcome='unknown';
    clearEvidenceRevisionConfirmation();if(['criterionId','stage','provenance','outcome','linkSelection'].includes(key))render();
  }
});
function resetEvidenceReview(){state.evidenceReview=null;state.evidenceEntry={};state.evidenceRevision={};state.evidenceRevisionConfirmed=false;}
function newEvidenceEntry(criterionId=''){return {criterionId,stage:'planned',provenance:'unknown',outcome:'unknown',source:'',location:'',unit:'',time:'',materialVersion:'',observation:'',interpretation:'',reviewer:'',reason:'',counterevidence:'',unresolved:'',nextAction:'',burden:''};}
function resetDecisionView(){resetAdoptionReview();resetEvidenceReview();state.decision=null;state.decisionStale=false;state.decisionNote='';state.aiPreview=null;state.aiConsent=false;state.aiImport='';state.manualProvider='claude';state.aiImportTexts={};state.aiHandoffFingerprints={};}
function markDecisionStale(){
  resetEvidenceReview();const evidencePanel=root.querySelector('#decision-evidence-review');if(evidencePanel)evidencePanel.hidden=true;
  resetAdoptionReview();const review=root.querySelector('#ai-adoption-review');if(review)review.hidden=true;
  if(state.decision)state.decisionStale=true;
  state.aiPreview=null;state.aiConsent=false;
  for(const element of root.querySelectorAll('[data-decision-stale]'))element.hidden=false;
  for(const element of root.querySelectorAll('[data-decision-current]'))element.innerHTML=badge('변경 전 안내','stale');
  for(const button of root.querySelectorAll('[data-decision-record],[data-action="decision-ai-assist"],[data-action="decision-ai-handoff"]'))button.disabled=true;
  const consent=root.querySelector('#decision-ai-consent');if(consent)consent.checked=false;
  const progress=root.querySelector('.task-progress');if(progress)progress.outerHTML=renderProgress();
}
async function evaluateDecisionView(){
  ensureDecisionWorkspace(state.project);
  state.decision=await json('/api/decision',{project:state.project});
  state.decisionStale=false;state.message='현재 설명과 답변으로 질문·대안·주장 범위를 업데이트했습니다.';announce(state.message);
}
function manualProviderId(){return ['codex','gemini','claude'].includes(state.manualProvider)?state.manualProvider:'claude';}
let studentConnector=null;
function personalConnector(){return studentConnector??=createConnectorClient({windowObject:window});}
function connectorNotice(message){state.connectorMessage=message;const output=document.getElementById('connector-message');if(output)output.textContent=message;announce(message);}
function disconnectStudentConnector({clearPending=false}={}){
 studentConnector?.disconnect();studentConnector=null;state.connectorConnected=false;state.connectorMessage='내 PC 구독 연결을 해제했습니다.';state.aiStatus=null;state.aiStatusError='';state.aiConsent=false;if(clearPending)state.connectorPendingDraft=null;
}
async function decisionAIStatus({quiet=false}={}){
 try{
  state.connectorConnected=Boolean(studentConnector?.isConnected());
  state.aiStatus=state.session?.mode==='classroom'&&state.connectorConnected?await studentConnector.request('status'):await json('/api/ai/status');
  state.aiStatusError='';
 }catch(error){state.connectorConnected=Boolean(studentConnector?.isConnected());state.aiStatusError=error.message;if(!quiet)state.message='AI 연결 상태를 확인하지 못했습니다. 연구 안내는 계속 사용할 수 있습니다.';}
}
function downloadConnectorPending(){
 const pending=state.connectorPendingDraft,draft=pending?.draft;if(!draft?.text)throw Error('보관할 대기 응답이 없습니다.');
 pending.backupRequested=true;
 download(new Blob([`개인 PC 연결기의 외부 미검증 응답\n입력 지문: ${draft.inputFingerprint||'미확인'}\n근거 지문: ${draft.knowledgeFingerprint||'미확인'}\n\n${draft.text}`],{type:'text/plain;charset=utf-8'}),'research-connector-unverified-response.txt');
}
async function configureLocalGemini(remove=false){
 if(state.session?.mode==='classroom')throw Error('공유 작업실에서는 API 키를 입력하지 않습니다. 개인 연결기 창에서 Gemini API 키를 설정해 주세요.');
 state.geminiSettingsOpen=true;
 const keyInput=document.getElementById('gemini-api-key'),apiKey=remove?'':String(keyInput?.value||'').trim();
 if(keyInput)keyInput.value='';
 const model=document.getElementById('gemini-api-model')?.value||'gemini-3.8-flash';
 if(!['gemini-3.8-flash','gemini-3.5-flash-lite'].includes(model))throw Error('지원하는 Gemini API 모델을 선택해 주세요.');
 if(!remove&&!apiKey)throw Error('Gemini API 키를 입력해 주세요. 입력값은 화면에 보관하지 않습니다.');
 if(!remove&&!document.getElementById('gemini-api-ack')?.checked)throw Error('18세 이상 및 API 이용 조건·사용량/요금·데이터 처리 안내 확인에 동의해 주세요. 키 입력값은 지웠습니다.');
 let result;try{result=await json('/api/ai/gemini-key',{apiKey,model,acknowledged:true});}
 catch{throw Error('Gemini API 키 설정을 완료하지 못했습니다. 입력값은 지웠습니다. 로컬 연결 상태와 키를 확인해 다시 입력해 주세요.');}
 const provider=result?.provider;if(provider?.id!=='gemini')throw Error('Gemini 설정 상태를 확인하지 못했습니다. 키 입력값은 지웠습니다.');
 const previous=state.aiStatus?.providers?.length?state.aiStatus.providers:[{id:'codex',label:'GPT / Codex',status:'unknown'},{id:'claude',label:'Claude',status:'unknown'}];
 const metadata={id:'gemini',label:'Gemini API',mode:'api_key',status:remove?'key_required':'configured_unverified',available:!remove&&provider.available===true,model:typeof provider.model==='string'?provider.model:model,detail:typeof provider.detail==='string'?provider.detail:'',lastAttempt:null};
 state.aiStatus={...state.aiStatus,providers:[...previous.filter(item=>item.id!=='gemini'),metadata]};state.aiStatusError='';
 state.message=remove?'이 프로세스의 Gemini API 키를 삭제했습니다. 이미 처리된 API 사용량과 요금은 취소되지 않습니다.':'Gemini API 키 형식을 등록했습니다. 이 프로세스의 메모리에만 보관하며 종료하면 삭제됩니다. 실제 API 응답이나 연구 타당성을 검증한 상태는 아닙니다.';
}
async function storeConnectorDraft(){
 const pending=state.connectorPendingDraft;
 if(!pending?.draft?.text)throw Error('개인 PC 연결기에서 받은 대기 응답이 없습니다.');
 if(pending.project!==state.project&&(!pending.project.id||pending.project.id!==state.project.id))throw Error('응답을 요청한 프로젝트와 현재 프로젝트가 다릅니다. 대기 응답은 TXT로 보관한 뒤 현재 프로젝트에서 다시 요청해 주세요.');
 const result=await json('/api/ai/connector-result',{project:state.project,provider:pending.provider,text:pending.draft.text,sourceInputFingerprint:pending.draft.inputFingerprint,sourceKnowledgeFingerprint:pending.draft.knowledgeFingerprint,sourceModel:pending.draft.model,sourceTransport:pending.draft.mode==='live_api'?'api':'cli',consent:true});
 if(!result.draft?.text||result.draft.mode!=='local_connector'||result.draft.status!=='unverified_external_draft'||result.draft.executionVerification!=='not_server_verified')throw Error('연결기 응답의 외부 미검증 표시를 확인하지 못했습니다. 대기 응답은 보존했습니다.');
 const current=await json('/api/decision',{project:state.project});
 if(result.draft.inputFingerprint!==current.inputFingerprint||result.draft.knowledgeFingerprint&&current.knowledgeFingerprint&&result.draft.knowledgeFingerprint!==current.knowledgeFingerprint)throw Error('응답을 요청한 뒤 연구 조건 또는 근거 판본이 바뀌었습니다. 대기 응답을 보관한 뒤 현재 조건에서 다시 요청해 주세요.');
 state.project.decisionWorkspace.aiDrafts.push(result.draft);state.connectorPendingDraft=null;dirty();state.decision=current;state.decisionStale=false;
 state.message='내 PC 연결기에서 받은 응답을 외부 미검증 초안으로 보존했습니다. 공유 서버는 계정·모델·실행 사실을 검증하지 않았습니다. 초안에서 반영할 내용을 직접 검토하세요.';
 connectorNotice('구독 응답을 미검증 초안으로 보존했습니다. 반영할 내용을 검토하고 프로젝트를 저장하세요.');
}
root.addEventListener('click',async event=>{
  if(state.busy)return;
  const button=event.target.closest('button');if(!button||button.disabled)return;
  const answer=button.dataset.decisionAnswer,action=button.dataset.action;
  if(answer===undefined&&!action?.startsWith('decision-'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(action==='decision-connector-connect'){
   // Open the popup while the user's click is still active, before busy/await.
   let pairing;try{pairing=personalConnector().connect();}catch(error){await busy(async()=>{throw error;});return;}
   connectorNotice('개인 PC 연결기 창에서 이 사이트의 연결을 승인해 주세요.');
   await busy(async()=>{await pairing;state.connectorConnected=true;state.aiStatus=null;state.aiStatusError='';connectorNotice('내 PC 연결이 열렸습니다. 사용할 구독 도구에 로그인하고 상태를 확인하세요.');});return;
  }
  await busy(async()=>{
    ensureDecisionWorkspace(state.project);
    if(answer!==undefined){updateField('decisionWorkspace.answers.'+button.dataset.decisionQuestion,answer);await evaluateDecisionView();return;}
    if(action==='decision-evaluate'){await evaluateDecisionView();return;}
    if(action==='decision-answer-reset'){
      delete state.project.decisionWorkspace.answers[button.dataset.questionReset];markDecisionStale();localInvalidate('design');dirty();await evaluateDecisionView();return;
    }
    if(action==='decision-record'){
      if(state.project.decisionWorkspace.records.length>=200)throw Error('판단 기록이 200건에 도달했습니다. 기존 프로젝트와 기록은 계속 저장할 수 있습니다. 새 판단은 새 프로젝트에서 이어가 주세요.');
      if(state.decisionStale||!state.decision)throw Error('입력이 바뀌었습니다. 현재 내용으로 연구 안내를 업데이트해 주세요.');
      const result=await json('/api/decision/record',{project:state.project,alternativeId:button.dataset.decisionRecord,note:state.decisionNote});
      state.project={...state.project,...result.project};ensureDecisionWorkspace(state.project);dirty();state.decisionNote='';await evaluateDecisionView();state.message='현재 조건과 선택 경로의 판단 기록을 남겼습니다. 프로젝트 저장을 누르면 판본으로 보존됩니다.';return;
    }
    if(action==='decision-evidence-close'){resetEvidenceReview();return;}
    if(action==='decision-evidence-open'){
      resetEvidenceReview();state.evidenceReview=await json('/api/evidence/workspace',{project:state.project,recordId:button.dataset.recordId});
      state.evidenceEntry=newEvidenceEntry(state.evidenceReview.criteria[0]?.id);
      state.evidenceRevision={claim:state.evidenceReview.originalClaim||'',reason:'',nextAction:'',burden:''};
      state.message='선택한 접근에서 확인할 내용과 실제 근거를 연결합니다. 기록은 사용자 진술이며 연구 타당성 검증 결과로 표시하지 않습니다.';return;
    }
    if(action==='decision-evidence-latest'){
      const entry=state.evidenceReview?.entries?.find(item=>item.criterionId===state.evidenceEntry?.criterionId);
      if(!entry)throw Error('이 항목에 남긴 기록이 없습니다.');
      const next=newEvidenceEntry(entry.criterionId);for(const key of Object.keys(next))if(typeof entry[key]==='string')next[key]=entry[key];
      if(entry.link&&['qualitative','integration'].includes(entry.link.kind)&&Number.isInteger(entry.link.index))next.linkSelection=`${entry.link.kind}:${entry.link.index}`;
      state.evidenceEntry=next;state.evidenceRevisionConfirmed=false;state.message='이전 내용으로 새 기록을 작성합니다. 저장된 이전 기록은 수정하지 않습니다.';return;
    }
    if(action==='decision-evidence-record'){
      if(!state.evidenceReview)throw Error('판단 기록에서 실제 근거 점검을 먼저 열어 주세요.');
      const {linkSelection,...entry}=state.evidenceEntry;
      if(linkSelection){const [kind,index]=linkSelection.split(':');entry.link={kind,index:Number(index)};}
      const result=await json('/api/evidence/record',{project:state.project,recordId:state.evidenceReview.recordId,entry});
      state.project={...state.project,...result.project};ensureDecisionWorkspace(state.project);state.evidenceReview=result.workspace;
      state.evidenceEntry=newEvidenceEntry(entry.criterionId);state.evidenceRevisionConfirmed=false;state.decision=result.decision;state.decisionStale=false;dirty();
      state.message='근거 기록을 새 이력으로 추가했습니다. 계산 결과는 변경하지 않았습니다. 프로젝트 저장을 누르면 판본으로 보존됩니다.';return;
    }
    if(action==='decision-evidence-revise'){
      if(!state.evidenceReview||!state.evidenceRevisionConfirmed)throw Error('검토한 근거와 수정할 주장을 먼저 확인해 주세요.');
      const result=await json('/api/evidence/revise',{project:state.project,recordId:state.evidenceReview.recordId,...state.evidenceRevision,confirmed:true});
      state.project={...state.project,...result.project};ensureDecisionWorkspace(state.project);localInvalidate('design');state.assessment=null;dirty();
      state.decision=result.decision;state.decisionStale=false;refreshResultState();
      state.message='검토 이력과 미해결 사항을 연결해 수정한 주장과 새 판단을 기록했습니다. 연구 타당성 검증은 미실시입니다. 프로젝트를 저장해 주세요.';return;
    }
    if(action==='decision-ai-status'){await decisionAIStatus();return;}
    if(action==='decision-connector-disconnect'){disconnectStudentConnector();state.message='내 PC 연결을 해제했습니다. 현재 프로젝트와 기록은 보존했습니다.';return;}
    if(action==='decision-connector-retry'){await storeConnectorDraft();return;}
    if(action==='decision-connector-draft-download'){
      downloadConnectorPending();state.message='대기 응답 TXT 다운로드를 요청했습니다. 프로젝트의 판단이나 근거에 반영한 상태는 아닙니다.';return;
    }
    if(action==='decision-connector-clear-pending'){
      if(!state.connectorPendingDraft?.backupRequested)throw Error('대기 응답을 먼저 TXT로 보관해 주세요.');
      if(!window.confirm('대기 응답 TXT 다운로드를 요청했습니다. 파일 보관을 확인한 뒤 대기 응답을 닫으시겠습니까? 현재 프로젝트와 저장한 초안은 보존합니다.'))return;
      state.connectorPendingDraft=null;state.message='보관한 대기 응답을 닫았습니다. 현재 조건으로 새 응답을 요청할 수 있습니다.';return;
    }
    if(action==='decision-gemini-key-save'){await configureLocalGemini();return;}
    if(action==='decision-gemini-key-delete'){await configureLocalGemini(true);return;}
    if(action==='decision-ai-login'){
      const provider=button.dataset.aiProvider;if(!['codex','claude'].includes(provider))throw Error('Gemini는 구독 로그인 대신 개인 연결기 또는 이 컴퓨터의 API 키 설정을 사용합니다.');
      if(state.session?.mode==='classroom'){
       if(!studentConnector?.isConnected())throw Error('먼저 개인 PC에서 연결기를 실행하고 내 구독 계정을 연결해 주세요.');
       await studentConnector.request('login',{provider});
      }else await json('/api/ai/login',{provider});
      state.message='구독 도구의 로그인 절차를 시작했습니다. 개인 PC에 열린 로그인 안내를 완료한 뒤 연결 상태를 다시 확인하세요. 아직 AI 응답을 요청하지 않았습니다.';return;
    }
    if(action==='decision-adoption-close'){resetAdoptionReview();return;}
    if(action==='decision-adoption-review'){
      resetAdoptionReview();
      state.adoptionReview=await json('/api/ai/proposals',{project:state.project,draftIndex:Number(button.dataset.draftIndex)});
      state.adoptionManual={kind:'condition',questionId:state.adoptionReview.questions[0]?.id,value:'unknown',alternativeId:state.adoptionReview.alternatives[0]?.id};
      state.message='반영할 제안을 고른 뒤 변경 전후 값을 확인하세요. 원문과 기존 답변은 보존합니다.';return;
    }
    if(action==='decision-adoption-preview'){
      if(!state.adoptionReview)throw Error('보존한 초안에서 반영 검토를 먼저 열어 주세요.');
      const selections=adoptionSelections();
      state.adoptionPreview=await json('/api/ai/adoption/preview',{project:state.project,draftRef:state.adoptionReview.draftRef,selections});
      state.adoptionSelections=selections;state.adoptionConfirmed=false;
      state.message='반영 전후 값과 이후 질문·주장 범위를 비교했습니다. 아직 프로젝트를 변경하지 않았습니다.';return;
    }
    if(action==='decision-adoption-apply'){
      if(!state.adoptionConfirmed||!state.adoptionPreview||!state.adoptionReview)throw Error('변경 전후 값을 먼저 확인해 주세요.');
      const result=await json('/api/ai/adoption/apply',{project:state.project,draftRef:state.adoptionReview.draftRef,selections:state.adoptionSelections,previewToken:state.adoptionPreview.previewToken,confirmed:true});
      state.project={...state.project,...result.project};ensureDecisionWorkspace(state.project);
      localInvalidate('design');state.assessment=null;dirty();state.decision=result.decision;state.decisionStale=false;refreshResultState();
      state.message='확인한 제안을 반영하고 연구 안내를 업데이트했습니다. 변경 전후 값·원문 연결을 남겼습니다. 프로젝트 저장을 누르면 판본으로 보존됩니다.';return;
    }
    if(action==='decision-ai-preview'){
      const result=await json('/api/ai/preview',{project:state.project});
      state.aiPreview=result.context;state.aiConsent=false;state.message='외부 도구에 보낼 선택 맥락을 표시했습니다. 내용을 확인한 뒤 동의해 주세요.';return;
    }
    if(action==='decision-ai-assist'){
      if(state.project.decisionWorkspace.aiDrafts.length>=200)throw Error('AI 초안이 200건에 도달했습니다. 추가 요청을 실행하지 않았습니다. 기존 초안을 저장하고 새 프로젝트에서 이어가 주세요.');
      if(!state.aiConsent||!state.aiPreview)throw Error('보낼 맥락을 먼저 확인하고 전송에 동의해 주세요.');
      const provider=button.dataset.aiProvider;
      if(!['codex','gemini','claude'].includes(provider))throw Error('지원하는 구독 도구를 선택해 주세요.');
      if(state.session?.mode==='classroom'){
       if(!studentConnector?.isConnected())throw Error('개인 PC 연결기를 실행한 뒤 내 구독 계정을 연결해 주세요. 직접 전달·응답 가져오기도 사용할 수 있습니다.');
       if(state.connectorPendingDraft)throw Error('이전에 받은 대기 응답을 먼저 기록하거나 TXT로 보관해 주세요.');
       connectorNotice('개인 PC 연결기 창에서 전송할 실제 맥락을 확인하고 승인해 주세요. 승인 뒤 구독 도구의 응답을 기다립니다.');
       try{
        const result=await studentConnector.request('assist',{provider,context:state.aiPreview,consent:true});
        if(!result.draft?.text)throw Error('개인 PC 연결기에서 응답 본문을 받지 못했습니다.');
        state.connectorPendingDraft={provider,draft:result.draft,project:state.project};
        await storeConnectorDraft();
       }catch(error){connectorNotice(error.message);throw error;}finally{await decisionAIStatus({quiet:true});}
       return;
      }
      let result;
      try{result=await json('/api/ai/assist',{provider,project:state.project,consent:true});}
      finally{await decisionAIStatus({quiet:true});}
      const current=await json('/api/decision',{project:state.project});
      if(result.draft?.inputFingerprint!==current.inputFingerprint)throw Error('AI 응답을 요청한 뒤 연구 조건이 바뀌었습니다. 현재 입력으로 다시 요청해 주세요.');
      if(!result.draft?.text)throw Error('AI 응답 본문을 받지 못했습니다.');
      state.project.decisionWorkspace.aiDrafts.push(result.draft);dirty();state.decision=current;state.decisionStale=false;state.message=result.draft.mode==='live_api'?'Gemini API 응답을 검증하지 않은 초안으로 보존했습니다. API 사용량·요금은 계정 조건에 따르며 계산·출처·연구 타당성 검증 결과가 아닙니다.':'공식 구독 도구의 실제 응답을 검증하지 않은 초안으로 보존했습니다. 계산·출처·연구 타당성 검증 결과가 아닙니다.';return;
    }
    if(action==='decision-ai-handoff'){
      if(!state.aiConsent||!state.aiPreview)throw Error('전달할 맥락을 먼저 확인하고 동의해 주세요.');
      const provider=manualProviderId();
      const result=await json('/api/ai/handoff',{provider,project:state.project});
      if(typeof result.brief!=='string')throw Error('전달할 맥락을 만들지 못했습니다.');
      state.aiHandoffFingerprints[provider]=result.context?.inputFingerprint||null;
      download(new Blob([result.brief],{type:'text/plain;charset=utf-8'}),provider+'-research-context.txt');
      state.message='선택한 제공자의 공식 화면에 직접 전달할 맥락을 저장했습니다. 제품에서 AI를 실행한 상태는 아닙니다.';return;
    }
    if(action==='decision-ai-import'){
      if(state.project.decisionWorkspace.aiDrafts.length>=200)throw Error('AI 초안이 200건에 도달했습니다. 기존 초안을 저장하고 새 프로젝트에서 이어가 주세요.');
      if(!state.aiImport.trim())throw Error('직접 받은 응답을 먼저 붙여 넣어 주세요.');
      const provider=manualProviderId();
      const result=await json('/api/ai/import',{project:state.project,provider,text:state.aiImport,sourceInputFingerprint:state.aiHandoffFingerprints[provider]||null});
      if(!result.draft?.text)throw Error('가져올 초안 본문이 없습니다.');
      if(result.draft.provider!==provider||result.draft.mode!=='manual_import'||result.draft.status!=='unverified_external_draft')throw Error('선택한 제공자의 외부 미검증 초안 상태를 확인하지 못했습니다.');
      state.project.decisionWorkspace.aiDrafts.push(result.draft);state.aiImport='';state.aiImportTexts[provider]='';dirty();state.message='직접 가져온 외부 초안을 보존했습니다. 전달 당시 맥락의 연결 여부를 초안에서 확인해 주세요. 계정·모델·실행 사실과 연구 타당성은 검증하지 않았습니다.';return;
    }
  });
},true);
await init();



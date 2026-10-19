import { createHash, randomUUID } from 'node:crypto';

// These are reviewable product rules, not a validated research recommendation model.
export const DECISION_VERSION = 'decision-guidance-1.0.0';
const goals = [
 ['description', '지금 어떤 모습인지 알고 싶어요'], ['association', '무엇과 무엇이 함께 달라지는지 궁금해요'],
 ['causation', '어떤 변화가 다른 변화를 일으키는지 알고 싶어요'], ['prediction', '앞으로 일어날 일을 예상하고 싶어요'],
 ['measurement', '질문이나 점수로 무엇을 알 수 있는지 검토하고 싶어요'], ['experience', '사람들이 겪은 경험을 이해하고 싶어요'],
 ['meaning', '사람들이 경험이나 말에 붙이는 의미가 궁금해요'], ['process', '어떤 일이 어떻게 진행되는지 설명하고 싶어요'],
 ['theory', '사례에서 설명이나 이론을 발전시키고 싶어요'], ['normative', '무엇이 바람직하거나 공정한지 따지고 싶어요'],
 ['evaluation', '프로그램이 어떻게 운영되고 어떤 결과가 나는지 검토하고 싶어요'], ['synthesis', '기존 연구에서 무엇을 알고 있는지 정리하고 싶어요'],
 ['mixed', '숫자와 면담·관찰을 함께 이해하고 싶어요']
];
const yesNo = [['yes', '네'], ['no', '아니요']];
const definitions = {
 goal: ['이번 연구에서 가장 알고 싶은 것은 무엇인가요?', '알고 싶은 내용에 따라 필요한 자료와 말할 수 있는 결론이 달라집니다.', goals],
 dataMode: ['지금 손에 있거나 실제로 모을 수 있는 자료는 어떤 것인가요?', '자료가 아직 없어도 진행할 수 있습니다. 자료가 정해졌는지에 따라 지금 할 수 있는 작업이 달라집니다.', [['none', '아직 자료를 정하지 않았어요'], ['survey', '숫자로 답한 설문·측정 자료'], ['interview', '면담·관찰·글·녹음 자료'], ['mixed', '숫자 자료와 면담·관찰 자료 모두'], ['records', '기관 기록·사건·문서 자료']]],
 timing: ['같은 대상에게서 자료를 언제 모았나요?', '한 번의 조사인지 앞뒤 시점이 있는지에 따라 변화의 순서를 확인할 수 있는 범위가 달라집니다.', [['cross_sectional', '한 시점에 한 번 모았어요'], ['longitudinal', '같은 대상을 여러 시점에 확인했어요'], ['before_after', '어떤 일이 있기 전과 후를 확인했어요']]],
 assignment: ['프로그램을 받거나 조건이 달라진 사람은 어떻게 정해졌나요?', '원래의 차이 때문에 결과가 달라졌을 가능성과 프로그램의 영향을 구별하려는 질문입니다.', [['randomized', '추첨 등 무작위로 정했어요'], ['observed', '본인 선택·기관 판단·기존 상황에 따라 달랐어요']]],
 repeated: ['한 사람이나 같은 대상의 기록이 여러 번 들어 있나요?', '같은 대상의 여러 기록을 서로 다른 사람처럼 다루면 비교의 의미와 오차가 달라질 수 있습니다.', yesNo],
 clustered: ['사람들이 같은 학급·기관·지역·팀 등에 속해 있나요?', '같은 환경에 속한 사람들의 공통점을 자료 구조에 반영할 필요가 있는지 확인합니다.', yesNo],
 targetMatch: ['자료 한 건이 가리키는 대상과 결론을 말하려는 대상이 같나요?', '기관 평균을 개인의 차이로 해석하는 등 자료와 주장의 대상이 어긋나는 일을 줄입니다.', [['same', '예: 개인 기록으로 그 개인들에 관해 말해요'], ['different', '예: 기관 평균으로 개인에 관해 말하려 해요']]],
 missingness: ['응답하지 않거나 추적에서 빠진 경우와 처리 방법을 확인했나요?', '빠진 사람·문항의 이유가 결과를 바꿀 수 있어, 임의로 0점이나 평균을 채우지 않습니다.', [['documented', '범위·이유와 처리 방침을 기록했어요'], ['unreviewed', '아직 살펴보지 않았어요']]],
 qualApproach: ['면담·관찰에서 특히 무엇을 이해하고 싶으신가요?', '발화의 의미, 개인의 경험, 과정 설명은 서로 다른 읽기와 사례 비교가 필요할 수 있습니다.', [['meanings', '여러 사람이 붙이는 의미와 해석'], ['experiences', '각 사람이 겪은 경험의 맥락'], ['processes', '일이 변하는 과정과 사례 사이의 차이']]],
 qualCounter: ['처음 해석과 맞지 않는 말이나 사례도 따로 살펴보셨나요?', '반대 사례와 연구자의 관점을 남기면 어떤 해석이 가능한지, 어디에서 달라지는지 검토할 수 있습니다.', [['sought', '그런 사례와 다른 해석을 기록했어요'], ['not_yet', '아직 따로 살펴보지 않았어요']]],
 mixedAlignment: ['숫자 자료와 면담·관찰 자료가 같은 대상·내용·시점을 다루나요?', '같은 단어를 썼어도 서로 다른 경험·행동·시점을 다룬다면 곧바로 합쳐 결론을 내리기 어렵습니다.', [['same', '어떤 점에서 연결되는지 확인했어요'], ['different', '대상·내용·시점 중 다른 부분이 있어요']]],
 mixedDiscordance: ['두 자료에서 서로 맞지 않는 결과나 설명이 있나요?', '불일치는 지울 오류로 단정하지 않습니다. 무엇이 다르고 어떤 추가 설명이 필요한지 비교합니다.', yesNo],
 resources: ['앞으로 자료를 더 확인하거나 새로 모을 여지가 있나요?', '현재 자료로 질문을 좁힐지, 자료나 설계를 보강할지의 시간과 접근 부담을 비교합니다.', [['existing', '현재 자료 안에서 진행해야 해요'], ['new_possible', '추가 수집이나 재접촉을 검토할 수 있어요']]],
 predictionValidation: ['예상 결과를 만드는 데 쓰지 않은 자료로도 결과를 확인할 수 있나요?', '이미 본 자료에 잘 맞는 정도와 새로운 사람·시점에서 맞는 정도를 구별합니다.', [['independent', '따로 남긴 사람·시점·자료가 있어요'], ['training_only', '모형을 만든 자료의 결과만 있어요']]]
};
const fieldLabels = { interest: '관심사', context: '대상과 상황', purpose: '기존에 입력한 연구 목적', question: '기존 연구 질문', conclusion: '기존 결론 초안', dataDescription: '사용자가 설명한 자료', unit: '자료 단위', targetUnit: '주장 대상 단위', falsifier: '생각을 바꿀 증거', resources: '사용 가능한 자원' };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
 if (Array.isArray(value)) return value.map(canonical);
 if (!isObject(value)) return value ?? null;
 return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');

export function decisionAnswerCatalog(){
 return Object.entries(definitions).map(([id,[prompt,reason,options]])=>({id,prompt,reason,options:[...options.map(([value,label])=>({value,label})),{value:'unknown',label:'아직 모름·미정'}]}));
}

export function validateAdoptionHistory(events){
 if(events===undefined)return;
 if(!Array.isArray(events)||events.length>200||events.some(event=>!isObject(event)||!Array.isArray(event.changes)||event.changes.length<1||event.changes.length>12||event.changes.some(change=>!isObject(change)||typeof change.target!=='string'||change.target.length>100||!Array.isArray(change.sourceClaimIds)||change.sourceClaimIds.length>12||change.sourceClaimIds.some(id=>typeof id!=='string'||id.length>180))))throw Error('AI 제안 반영 이력의 변경 항목·출처 목록 형식을 확인해 주세요.');
}
export function decisionAdoptionSnapshot(project){
 const workspace=project.decisionWorkspace??{},events=Array.isArray(workspace.adoptions)?workspace.adoptions:[];
 const latest=new Map();
 for(const event of events)for(const change of event.changes??[])latest.set(change.target,event.id);
 return events.map(event=>({...structuredClone(event),changes:(event.changes??[]).map(change=>{
  const current=change.target?.startsWith('answers.')?workspace.answers?.[change.target.slice(8)]:workspace[change.target];
  return {...structuredClone(change),active:latest.get(change.target)===event.id&&current===change.after};
 })}));
}

function input(project) {
 if (!isObject(project)) throw Error('프로젝트 객체가 필요합니다.');
 const workspace = project.decisionWorkspace ?? {};
 if (!isObject(workspace)) throw Error('연구 안내 입력 형식을 확인해 주세요.');
 if (workspace.records !== undefined && (!Array.isArray(workspace.records) || workspace.records.some(record => !isObject(record)))) throw Error('이전 판단 기록의 형식을 확인해 주세요.');
 for (const key of ['narrative', 'draftClaim']) if (workspace[key] !== undefined && typeof workspace[key] !== 'string') throw Error('연구 설명과 주장 초안은 글로 입력해 주세요.');
 if (workspace.answers !== undefined && !isObject(workspace.answers)) throw Error('추가 질문의 답변 형식을 확인해 주세요.');
 validateAdoptionHistory(workspace.adoptions);
 if(workspace.selectedAlternativeId!==undefined&&typeof workspace.selectedAlternativeId!=='string')throw Error('선택한 설계 대안 ID를 확인해 주세요.');
 const answers = {};
 for (const [key, value] of Object.entries(workspace.answers ?? {})) {
  if (!Object.hasOwn(definitions, key)) throw Error('등록되지 않은 추가 질문입니다: ' + key);
  if (!['unknown', ...definitions[key][2].map(option => option[0])].includes(value)) throw Error('질문에 없는 답변입니다: ' + key);
  answers[key] = value;
 }
 const previous = Object.fromEntries(Object.keys(fieldLabels).map(key => [key, text(project[key])]));
 return { narrative: text(workspace.narrative), draftClaim: text(workspace.draftClaim), answers, previous, design: isObject(project.design) ? structuredClone(project.design) : {}, dataKind: text(project.dataKind), selectedMethods: Array.isArray(project.selectedMethods) ? [...project.selectedMethods] : [], ...(text(workspace.selectedAlternativeId)?{selectedAlternativeId:text(workspace.selectedAlternativeId)}:{}), evidenceFingerprints: Object.fromEntries(['qualitative', 'integration', 'calculationInput', 'methodWorkspace'].map(key => [key, hash(project[key] ?? null)])) };
}

function infer(narrative) {
 const found = {};
 // Keywords produce questions and visibly unconfirmed hints only. Negation is
 // deliberately not interpreted as a confirmed condition by this small parser.
 if (/설문.{0,24}(면담|인터뷰)|(면담|인터뷰).{0,24}설문|혼합연구/.test(narrative)) found.dataMode = 'mixed';
 else if (/면담|인터뷰|녹취|참여관찰/.test(narrative)) found.dataMode = 'interview';
 else if (/설문|측정값|점수 자료/.test(narrative)) found.dataMode = 'survey';
 if (/인과|효과|영향을|원인/.test(narrative)) found.goal = 'causation';
 else if (/의미|경험/.test(narrative)) found.goal = /의미/.test(narrative) ? 'meaning' : 'experience';
 if (/혼합연구|양적.{0,20}질적/.test(narrative)) found.goal = 'mixed';
 if (/횡단|한 시점|한 번만|한번만/.test(narrative)) found.timing = 'cross_sectional';
 if (/반복측정|반복 측정|여러 시점|사전.{0,8}사후|전후/.test(narrative)) found.repeated = 'yes';
 if (/군집|학급|기관별|팀별/.test(narrative)) found.clustered = 'yes';
 if (/불일치|엇갈|상반|맞지 않/.test(narrative)) found.mixedDiscordance = 'yes';
 return found;
}

function makeFacts(state, inferred) {
 const facts = [];
 const add = (id, label, value, provenance, confirmed, extra = {}) => facts.push({ id, label, value, provenance, confirmed, ...extra });
 if (state.narrative) add('narrative', '사용자가 적은 연구 설명', state.narrative, 'user_statement', true);
 for (const [key, value] of Object.entries(state.previous)) if (value) add('project.' + key, fieldLabels[key], value, 'user_statement', true);
 if (text(state.design.dependence)) add('project.design.dependence', '기존 화면에서 입력한 자료의 반복·소속 구조', text(state.design.dependence), 'user_statement', true);
 if (state.draftClaim) add('draftClaim', '이번 주장 초안', state.draftClaim, 'user_statement', true);
 for (const [key, value] of Object.entries(state.answers)) {
  const label = definitions[key][0];
  add(key, label, value === 'unknown' ? '아직 모름·미정' : definitions[key][2].find(option => option[0] === value)[1], value === 'unknown' ? 'unknown' : 'user_statement', value !== 'unknown', { answer: value });
 }
 for (const [key, value] of Object.entries(inferred)) if (!state.answers[key] || state.answers[key] === 'unknown') {
  add('inferred.' + key, '설명에서 확인이 필요한 내용: ' + definitions[key][0], definitions[key][2].find(option => option[0] === value)[1], 'system_inference', false, { suggestedValue: value, confirmationQuestionId: key });
 }
 return facts;
}

function sourceRefs(registry, methodIds) {
 const methods = Array.isArray(registry?.methods) ? registry.methods : [];
 const sources = Array.isArray(registry?.sources) ? registry.sources : [];
 return methodIds.flatMap(methodId => {
  const method = methods.find(item => item.id === methodId);
  if (!['partial', 'source_reviewed'].includes(method?.cardStatus) || method.card?.source_reviewer_checked !== true) return [];
  return (method.card.claimSources ?? []).filter(claim => ['question', 'applicability', 'premises', 'allowedConclusion', 'prohibitedConclusion', 'missingAndCounterevidence'].includes(claim.field)).flatMap(claim => {
   const source = sources.find(item => item.id === claim.sourceId);
   if (!source || source.source_reviewer_checked !== true || !claim.claimId || !claim.location || !claim.text) return [];
   return [{ methodId, claimId: claim.claimId, sourceId: source.id, statement: claim.text, location: claim.location, supportType: claim.supportType, accessLevel: claim.accessLevel, url: source.url, title: source.title, version: source.version, cardVersion: method.card.cardVersion }];
  }).slice(0, 4);
 });
}

function attachEvidence(alternative, registry) {
 const methodIds = alternative.methodIds.filter(id => registry?.methods?.some(method => method.id === id));
 const refs = sourceRefs(registry, methodIds);
 const gaps = methodIds.filter(id => !refs.some(ref => ref.methodId === id));
 return { ...alternative, methodIds, sourceRefs: refs, sourceGaps: gaps.map(id => id + ': 이 경로에 연결할 검토된 상세 근거가 부족합니다.'), evidenceBasis: '경로 비교 문구는 제품 적용 규칙입니다. 연결된 원출처 문장은 해당 문장의 범위만 지지하며 이 추천의 적합성을 검증한 결과가 아닙니다.', execution: {
  status: 'guidance_only', description: '설계 비교와 판단 기록을 지원합니다. 이 경로 전체를 자동 실행하거나 연구 적합성을 검증하지 않습니다.',
  methods: methodIds.map(id => { const method = registry.methods.find(item => item.id === id); return { methodId: id, status: method.executionStatus, scope: method.executionScope ?? '내부 실행 범위는 검증되지 않았습니다.' }; })
 } };
}

const path = (id, title, burden, action) => ({ id, title, burden, action });
const reviseQuestion = path('narrow-question', '현재 자료에 맞게 질문을 좁히기', '낮음: 글과 비교 대상을 다시 정리하는 작업', '어떤 사람·상황·시점의 기술 또는 연관인지 명시하고 효과를 단정하는 표현을 고칩니다.');
const inspectData = path('inspect-data', '자료 구조부터 작게 확인하기', '낮음~중간: 자료 목록·수집 기록 확인', '대상 ID, 시점, 소속, 빠진 기록을 목록으로 만들고 모르는 항목은 미정으로 남깁니다.');
const moreData = path('more-data', '추가 자료를 확보하기', '중간~높음: 접근 허가·시간·참여자 부담 검토', '결론을 바꿀 만한 비교 대상, 앞뒤 시점, 반대 사례를 정하고 필요한 동의와 자원을 확인합니다.');

function alternativesFor(state, goal, registry) {
 const a = state.answers;
 const independentUnknown = a.repeated !== 'no' || a.clustered !== 'no';
 const structure = [a.repeated === 'yes' ? '같은 대상의 반복 기록' : null, a.clustered === 'yes' ? '같은 기관·팀·지역에 속한 군집 구조' : null].filter(Boolean);
 const structureText = structure.join('과 ');
 const dependencyConditions = structure.length ? [structureText + '를 함께 보존하고 대상·소속·시점 식별자를 연결합니다.', '목표 비교와 자료 유형에 맞는 모형·불확실성을 별도로 검토합니다.'] : [];
 let alternatives;
 if (goal === 'mixed' || a.dataMode === 'mixed') {
  alternatives = [
   { id: 'integrate-discordance', title: '두 자료를 연결하고 불일치를 보존하기', reason: '두 종류의 자료가 무엇을 다르게 보여 주는지 연구 질문 안에서 비교합니다.', difference: '두 결과를 평균 내거나 한쪽으로 덮지 않고 연결 가능한 부분과 차이를 남깁니다.', conditions: ['같은 말이 같은 개념·행동인지 확인합니다.', '대상·자료 단위·시점과 통합 질문을 연결합니다.'], missing: [a.mixedAlignment !== 'same' ? '대상·개념·시점의 연결 근거' : null, !a.mixedDiscordance || a.mixedDiscordance === 'unknown' ? '일치·불일치가 나타나는 부분' : null].filter(Boolean), claim: '각 자료가 보여 준 결과와 서로 엇갈리는 지점을 함께 설명하고, 통합 해석은 확인한 연결 범위로 제한합니다.', competitors: ['응답 집단이나 조사 시점이 달라 생긴 차이', '자기보고와 실제 경험이 서로 다른 면을 다룰 가능성'], counterEvidence: ['현재 통합 해석과 맞지 않는 면담 발화·수치·사례를 따로 보존합니다.'], paths: [inspectData, path('align-display', '같은 질문에 관한 근거를 나란히 정리하기', '중간: 개념·대상·시점을 대조하는 작업', '근거 화면의 통합표에 수치, 원문 위치, 불일치, 대안 설명과 다음 검토를 연결합니다.'), moreData], methodIds: ['M297', 'M287'] },
   { id: 'explain-followup', title: '엇갈린 부분을 후속 질문으로 확인하기', reason: '숫자 결과와 다른 경험이 나타나는 조건을 새 질문으로 좁힙니다.', difference: '현재 불일치를 그대로 보존한 채 재접촉·다른 사례·수집 시점으로 설명을 보강합니다.', conditions: ['추가 접촉의 접근 가능성과 참여자 동의를 검토합니다.', '후속 질문이 어느 불일치를 확인하는지 기록합니다.'], missing: a.resources === 'new_possible' ? [] : ['추가 접촉·자료 접근 가능성'], claim: '후속 자료가 확인되기 전에는 경쟁 설명을 구분할 질문과 조건을 제안할 수 있습니다.', competitors: ['처음 설명에 맞는 사례만 다시 고를 가능성'], counterEvidence: ['예상 설명과 반대되는 사례도 후속 대상에 포함할 근거를 검토합니다.'], paths: [moreData, reviseQuestion], methodIds: ['M288', 'M297'] },
   { id: 'separate-results', title: '각 자료의 결과를 독립적으로 보고하기', reason: '자료의 대상·내용·시점이 다르면 연결을 억지로 확정하지 않고 각 결과의 의미를 보존합니다.', difference: '통합 결론을 보류해도 두 자료의 개별 결과와 다음 연구 질문을 남깁니다.', conditions: ['두 결과의 범위와 서로 직접 비교하기 어려운 부분을 명시합니다.'], missing: ['통합을 지지할 연결 근거'], claim: '각 자료 안에서 확인한 내용은 설명하되 두 자료가 같은 결론을 입증했다고 말하지 않습니다.', competitors: ['단순한 병렬 배치를 통합으로 오해할 가능성'], counterEvidence: ['두 자료가 실제로 연결되는 사례와 연결되지 않는 사례를 함께 확인합니다.'], paths: [reviseQuestion, inspectData], methodIds: ['M297'] }
  ];
 } else if (['experience', 'meaning', 'theory'].includes(goal) || a.dataMode === 'interview') {
  alternatives = [
   { id: 'interpret-meaning', title: '말과 경험의 의미를 맥락 속에서 해석하기', reason: '사람들이 무엇을 어떻게 이해하는지 묻는 질문에 원문과 해석을 연결합니다.', difference: '빈도나 가설 검정을 먼저 요구하지 않고 연구자의 해석 과정과 다른 해석을 검토합니다.', conditions: ['연구자가 채택할 탐구 관점과 해석 과정을 설명합니다.', '사례 선정·대화 상황·연구자 위치와 원문 위치를 기록합니다.', '참여자 수는 질문·사례의 특수성·대화의 질·분석 범위를 근거로 검토합니다.'], missing: [!a.qualApproach || a.qualApproach === 'unknown' ? '무엇을 이해하려는지와 읽기 관점' : null, a.qualCounter !== 'sought' ? '다른 해석과 반대 사례 검토' : null].filter(Boolean), claim: '검토한 사례와 맥락에서 나타난 의미와 해석을 설명할 수 있습니다. 모집단 비율이나 보편적인 원인으로 확대하지 않습니다.', competitors: ['질문 방식이나 연구자와의 관계가 발화에 미친 영향', '서로 다른 경험을 한 주제로 묶으며 생긴 손실'], counterEvidence: ['주제와 어긋나는 발화, 침묵, 사례 차이와 대안 해석을 원문 위치와 함께 남깁니다.'], paths: [path('trace-reading', '원문에서 해석까지 연결하기', '중간: 발췌·메모·해석의 왕복 검토', '근거 화면에 원문 위치, 해석, 다른 해석, 사례 차이를 연결합니다.'), path('choose-tradition', '읽기 관점을 비교해 정하기', '중간: 방법 원전과 사례 검토', '개인 경험·공유 의미·과정 설명 중 질문을 다듬고 반성적·코드북·코딩 신뢰도형 접근의 전제를 구별합니다.'), moreData], methodIds: ['M260', 'M273'] },
   { id: 'interpret-cases', title: '개별 사례의 경험과 변화를 먼저 따라가기', reason: '개인·사례의 맥락을 유지한 채 공통점과 차이를 비교할 수 있습니다.', difference: '여러 사람의 말을 곧바로 합치기보다 사례 안의 맥락과 시간 순서를 먼저 살핍니다.', conditions: ['사례의 경계와 경험을 묻는 이유를 정리합니다.', '방법 원전이 다루는 경험·전제와 현재 질문의 범위를 대조합니다.'], missing: ['사례 선정과 충분성을 판단할 근거'], claim: '검토한 사례의 경험과 맥락을 설명하고 적용 가능한 범위와 다른 사례에서 달라질 조건을 남깁니다.', competitors: ['기억과 사후 설명의 차이', '특정 사례만 선택한 영향'], counterEvidence: ['주된 경험과 다른 서사와 사건 기록을 함께 검토합니다.'], paths: [inspectData, moreData], methodIds: ['M273', 'M274'] },
   { id: 'refine-questions', title: '작은 탐색으로 질문과 접근을 다듬기', reason: '탐구 관점이나 자료 접근이 미정이어도 탐색을 이어갈 수 있습니다.', difference: '지금 방법을 확정하기보다 초기 사례·문헌·질문 메모로 다음 판단에 필요한 정보를 모읍니다.', conditions: ['탐색 단계임을 표시하고 변경 이유를 기록합니다.'], missing: ['최종 탐구 질문과 사례 접근 범위'], claim: '탐색에서 발견한 후보 의미와 다음 질문을 제안하며 최종 주제로 검증됐다고 표현하지 않습니다.', competitors: ['처음 생각을 지지하는 발화만 주목할 가능성'], counterEvidence: ['처음 예상과 맞지 않은 내용도 다음 질문에 포함합니다.'], paths: [reviseQuestion, moreData], methodIds: ['M034', 'M307'] }
  ];
 } else if (goal === 'causation' || goal === 'evaluation') {
  const randomized = a.assignment === 'randomized';
  alternatives = [
   { id: 'observed-association', title: '현재 자료에서 관찰한 차이·연관으로 질문을 좁히기', reason: a.timing === 'cross_sectional' ? '한 시점 자료에서는 변화의 선후와 다른 원인을 구분하는 근거를 더 확인해야 합니다.' : '현재 확인된 조건만으로 효과를 확정하지 않고 관찰한 비교부터 보존합니다.', difference: '누가 무엇 때문에 변했는지의 결론과 관찰된 차이를 분리합니다.', conditions: ['비교할 사람·조건·결과와 실제 관찰 시점을 명시합니다.', ...dependencyConditions], missing: ['기존 차이와 시간 순서를 구별할 근거', ...(independentUnknown && !structure.length ? ['반복·군집 자료 구조 확인'] : [])], claim: '관찰된 사람과 시점에서 나타난 차이 또는 연관을 설명할 수 있습니다. 그 차이가 프로그램 때문에 생겼다고 확정하지 않습니다.', competitors: ['원래의 상태나 참여 동기의 차이', '결과가 먼저 생겨 선택이 달라진 가능성', '같은 시기의 다른 사건·제도 변화'], counterEvidence: ['예상 효과와 반대인 결과나 영향을 받기 전부터 있던 차이를 검토합니다.'], paths: [reviseQuestion, inspectData, moreData], methodIds: ['M001', 'M081', 'M087'] },
   { id: 'time-comparison', title: '앞뒤 시점과 비교 대상을 보강하기', reason: '어떤 일이 먼저 일어났는지와 함께 달라진 다른 조건을 살펴볼 자료를 확보합니다.', difference: '시간 정보를 더하지만 앞뒤 차이만으로 인과효과가 성립하지는 않습니다.', conditions: ['같은 시기의 적절한 비교 대상과 변경 전 기록을 검토합니다.', '추가 자료가 어떤 경쟁 설명을 줄이는지 기록합니다.', ...dependencyConditions], missing: ['추가 시점과 비교 대상에 접근할 수 있는지', '변화 전의 차이·동시 변화·탈락 기록'], claim: '시간·비교 조건을 보강한 설명 후보를 만들 수 있습니다. 구체 설계의 가정을 검토하기 전 효과를 확정하지 않습니다.', competitors: ['자연 변화와 같은 시기의 다른 사건', '시간에 따라 달라지는 집단 구성'], counterEvidence: ['변화 전 추세와 비교 집단에서 나타난 예상 밖 변화를 확인합니다.'], paths: [moreData, path('design-review', '검토 쟁점을 좁혀 설계를 비교하기', '중간~높음: 자료 접근과 방법 검토', '비교 집단의 선정, 변화 시점, 동시 사건 중 어떤 부분이 해결되지 않았는지 표로 정리해 검토합니다.')], methodIds: ['M002', 'M012', 'M127'] },
   { id: 'designed-comparison', title: randomized ? '무작위 배정 연구의 실제 수행 조건을 검토하기' : '앞으로 조건을 배정하는 설계 검토하기', reason: randomized ? '무작위로 정했다는 답변을 보존하고 실제 배정·실행·탈락을 확인합니다.' : '효과 질문을 유지하려면 기존 차이를 줄일 수 있는 실행 가능한 비교 설계를 검토할 수 있습니다.', difference: '지금의 연관 분석 대신 자료 생성 단계의 비교 조건을 설계합니다.', conditions: ['대상·비교·결과·관찰 시점을 정합니다.', '배정 실행·배정 후 이탈·조건 간 영향·윤리와 자원을 검토합니다.', ...dependencyConditions], missing: ['배정과 실제 참여 기록', '빠진 자료와 대상 효과에 관한 구체 검토'], claim: '설계가 지지할 효과의 대상과 가정을 검토할 수 있습니다. 무작위 배정이라는 입력만으로 효과가 검증됐다고 승인하지 않습니다.', competitors: ['배정 후 이탈이나 조건 간 영향', '측정 방식과 실제 수행의 차이'], counterEvidence: ['배정 위반, 이탈의 차이, 의도와 다른 수행을 확인합니다.'], paths: [moreData, inspectData], methodIds: a.clustered === 'yes' ? ['M007', 'M006'] : ['M006'] }
  ];
  if (randomized) alternatives = [alternatives[2], alternatives[0], alternatives[1]];
 } else if (goal === 'prediction') {
  alternatives = [
   { id: 'prediction-plan', title: '새로운 사람·시점에서 확인할 예측 계획 만들기', reason: '앞으로 어느 상황의 무엇을 예상할지와 평가 자료를 함께 정합니다.', difference: '지금 자료에 잘 맞는 모형과 실제 사용 상황에서 맞는 모형을 구분합니다.', conditions: ['예측할 시점에 실제로 알 수 있는 변수만 사용합니다.', '전처리·선택·조정과 최종 평가를 분리합니다.', ...dependencyConditions], missing: a.predictionValidation === 'independent' ? ['자료 분리의 실제 구현과 누출 점검'] : ['새 사람·시점의 평가 자료'], claim: '확인된 평가 설계의 범위 안에서만 예측 성능을 평가할 수 있으며 현재 입력만으로 성능을 보장하지 않습니다.', competitors: ['사람·시점이 겹치거나 미래 정보가 섞여 생긴 과대평가'], counterEvidence: ['기준 모형과 새로운 시점·집단에서의 실패를 확인합니다.'], paths: [inspectData, moreData], methodIds: ['M208', 'M209'] },
   { id: 'describe-now', title: '현재 자료의 분포와 관계를 먼저 살펴보기', reason: '평가 자료가 없어도 자료의 한계와 오류를 탐색할 수 있습니다.', difference: '탐색 결과를 표본 밖 예측 성능으로 보고하지 않습니다.', conditions: ['탐색임을 표시합니다.'], missing: ['독립적인 성능 확인'], claim: '현재 자료의 특징을 기술할 수 있습니다.', competitors: ['탐색 선택의 영향'], counterEvidence: ['잘 맞지 않는 사례를 보존합니다.'], paths: [inspectData, reviseQuestion], methodIds: ['M053', 'M087'] }
  ];
 } else if (goal === 'normative') {
  alternatives = [
   { id: 'normative-reasoning', title: '바람직함을 판단할 이유와 반론 비교하기', reason: '공정성·책임·가치에 관한 판단의 기준과 적용 맥락을 검토합니다.', difference: '설문 선호도와 규범적 정당화가 맡는 역할을 구분합니다.', conditions: ['채택한 기준과 다른 기준을 비교합니다.'], missing: ['판단 기준과 반론에 답할 근거'], claim: '명시한 기준과 전제에서 어떤 판단을 지지하는지 논증할 수 있으며 통계값만으로 정당성을 확정하지 않습니다.', competitors: ['다른 가치 기준이나 이해관계에 따른 반론'], counterEvidence: ['기준을 적용했을 때 불리해지는 사례와 반론을 검토합니다.'], paths: [reviseQuestion, inspectData], methodIds: ['M371', 'M373'] },
   { id: 'empirical-preferences', title: '사람들의 견해를 별도 경험 자료로 확인하기', reason: '실제로 어떤 견해가 있는지와 무엇이 옳은지의 질문을 나누어 조사합니다.', difference: '경험 자료는 논증의 맥락을 도울 수 있으나 옳고 그름을 자동 결정하지 않습니다.', conditions: ['견해의 자료와 규범적 이유를 구분합니다.'], missing: ['견해를 확인할 대상·자료'], claim: '조사한 사람들의 견해를 설명할 수 있습니다.', competitors: ['응답 선호와 실제 판단 이유의 차이'], counterEvidence: ['소수 견해와 비응답의 한계를 검토합니다.'], paths: [moreData, reviseQuestion], methodIds: ['M032', 'M050'] }
  ];
 } else if (goal === 'synthesis') {
  alternatives = [
   { id: 'scope-literature', title: '기존 연구의 질문·개념·공백을 지도처럼 정리하기', reason: '어떤 연구가 있는지부터 파악하는 질문에 검색·선별 범위를 연결합니다.', difference: '효과값을 합치는 연구와 문헌의 지형을 파악하는 연구를 구분합니다.', conditions: ['검색 범위·검색일·선별 이유와 미검토 자료를 기록합니다.'], missing: ['검색·선별 범위와 실제 결과'], claim: '실제로 확인한 범위에서 연구의 분포와 공백 후보를 설명하며 문헌 부재나 완전성을 단정하지 않습니다.', competitors: ['검색어·언어·접근 가능성 때문에 빠진 연구'], counterEvidence: ['배제 문헌과 반대 결과의 포함 가능성을 점검합니다.'], paths: [inspectData, moreData], methodIds: ['M307', 'M306'] },
   { id: 'refine-review', title: '문헌 질문을 좁혀 합성 가능성 검토하기', reason: '대상·비교·자료의 유사성을 본 뒤 알맞은 합성 경로를 고릅니다.', difference: '문헌이 있다는 이유만으로 효과값이나 해석을 합치지 않습니다.', conditions: ['합칠 근거와 서로 다른 연구 조건을 기록합니다.'], missing: ['질문에 맞는 합성 자료와 질 검토'], claim: '적합한 합성 경로를 검토할 수 있으며 아직 통합 결론은 미정입니다.', competitors: ['이질적인 질문과 자료가 섞인 영향'], counterEvidence: ['포함 판단에 불리한 연구도 보존합니다.'], paths: [reviseQuestion, moreData], methodIds: ['M325', 'M317'] }
  ];
 } else if (goal === 'measurement') {
  alternatives = [
   { id: 'measurement-use', title: '점수로 하려는 판단과 실제 이해를 먼저 검토하기', reason: '누구의 어떤 내용에 어떤 결정을 내릴 점수인지에서 필요한 근거를 찾습니다.', difference: '전문가 합의나 지표 하나를 모든 용도의 타당성으로 확대하지 않습니다.', conditions: ['개념·문항·응답 과정·점수 사용을 연결합니다.', '기존 도구의 대상·언어·용도와 다른 부분을 확인합니다.'], missing: ['사용 대상·결정과 필요한 해석 근거'], claim: '특정 점수 해석과 사용을 지지할 근거를 모을 수 있으며 도구 전체의 타당성을 지표 하나로 확정하지 않습니다.', competitors: ['사람마다 문항을 다르게 이해할 가능성'], counterEvidence: ['높은 수치와 다른 사용자 이해·행동 사례를 함께 검토합니다.'], paths: [inspectData, moreData], methodIds: ['M039', 'M134', 'M135'] },
   { id: 'existing-measure', title: '기존 도구의 근거와 현재 용도를 비교하기', reason: '새 지표를 추가하기 전에 이미 있는 근거가 현재 사용을 얼마나 다루는지 살핍니다.', difference: '출판 여부와 현재 대상에서의 근거 범위를 구분합니다.', conditions: ['원문 판본과 적용 범위를 확인합니다.'], missing: ['기존 도구의 실제 검토 근거'], claim: '현재 사용과 기존 근거의 일치·차이를 설명할 수 있습니다.', competitors: ['번역·시점·대상 변화의 영향'], counterEvidence: ['기존 해석에 맞지 않은 응답이나 구조를 확인합니다.'], paths: [reviseQuestion, moreData], methodIds: ['M142', 'M307'] }
  ];
 } else if (goal === 'process') {
  alternatives = [
   { id: 'trace-process', title: '사건의 순서와 경쟁 설명을 연결하기', reason: '어떤 일이 어떻게 진행됐는지 사건 기록·면담·문서가 각각 어떤 설명을 지지하는지 살핍니다.', difference: '증거의 개수를 합산하지 않고 출처와 시점·진단적 역할을 대조합니다.', conditions: ['사례 경계와 시간 순서를 확인합니다.', '증거와 설명을 연결한 이유·반대 설명을 기록합니다.'], missing: ['기록의 시점·출처 독립성·반대 증거'], claim: '검토한 사례의 과정 설명을 조건과 경쟁 설명과 함께 제안할 수 있으며 사례 밖의 보편 인과효과로 확대하지 않습니다.', competitors: ['같은 사건을 다른 기제가 설명할 가능성', '사후 기록과 실제 사건 순서의 차이'], counterEvidence: ['예상 기제가 없는데 결과가 나타난 사례와 반대 기록을 검토합니다.'], paths: [inspectData, moreData, reviseQuestion], methodIds: ['M393', 'M015'] },
   { id: 'compare-process-cases', title: '과정이 다른 사례를 비교하기', reason: '비슷해 보이는 사례에서 달라진 조건과 설명을 찾아볼 수 있습니다.', difference: '한 사례의 이야기와 사례 간 비교가 맡는 역할을 구분합니다.', conditions: ['비교 사례를 선택한 이유와 다른 조건을 남깁니다.'], missing: ['비교 사례 접근 가능성'], claim: '비교한 사례 사이의 차이와 후속 검토 질문을 설명할 수 있습니다.', competitors: ['선정 기준에 따른 차이'], counterEvidence: ['설명에 맞지 않은 사례도 검토합니다.'], paths: [moreData, reviseQuestion], methodIds: ['M015', 'M268'] }
  ];
 } else if (['description', 'association'].includes(goal)) {
  const dependent = structure.length > 0;
  alternatives = [
   { id: dependent ? 'dependence-aware' : 'describe-now', title: dependent ? '반복·소속 구조를 보존한 비교 계획 만들기' : '관찰한 대상의 현황과 분포 기술하기', reason: dependent ? structureText + '가 비교의 단위와 불확실성에 영향을 줄 수 있습니다.' : '무엇을 관찰했는지와 그 범위를 먼저 보존합니다.', difference: dependent ? '반복 기록과 같은 소속을 없애지 않고 질문에 맞는 비교 수준을 정합니다.' : '관찰한 표본의 요약과 더 넓은 모집단의 결론을 구분합니다.', conditions: dependent ? dependencyConditions : ['대상·시점·변수·분모·빠진 기록을 명시합니다.'], missing: dependent ? ['사람·군집 수와 시점·자료 유형', '구조를 반영할 구체 모형·불확실성 검토'] : ['표집·대상 모집단·자료 구조의 근거'], claim: dependent ? '반복과 소속 구조를 보존해 기술하거나 비교 계획을 만들 수 있습니다. 현재 단순 엔진으로 의존성을 반영한 추론이 완료됐다고 표시하지 않습니다.' : '실제로 관찰한 대상과 시점의 분포를 설명할 수 있습니다. 모집단·인과효과로 확대하려면 별도 근거가 필요합니다.', competitors: ['누가 자료에 포함됐는지에 따른 차이', '소속 환경과 시점이 함께 달라진 영향'], counterEvidence: ['대표적인 평균과 다른 사례·군집·시간의 차이를 확인합니다.'], paths: [inspectData, reviseQuestion, moreData], methodIds: dependent ? ['M114', 'M116', 'M119'] : ['M050', 'M053', 'M056'] },
   { id: 'compare-association', title: '함께 달라지는 정도와 다른 설명 비교하기', reason: '변수 사이의 관계를 어떤 대상·조건에서 볼지 정리합니다.', difference: '관련성이 나타나는 것과 한 변수가 다른 변수를 바꾼다는 주장을 구분합니다.', conditions: ['관계의 정의·자료 유형과 비교 대상을 정합니다.', ...dependencyConditions], missing: ['측정·표집·다른 설명을 검토할 자료'], claim: '현재 조건에서 관찰된 연관을 설명하며 원인이나 미래 성능을 단정하지 않습니다.', competitors: ['함께 영향을 주는 제3의 상황', '역방향 관계·선택 차이'], counterEvidence: ['관계가 다르게 나타나는 집단·시점과 비선형 패턴을 확인합니다.'], paths: [reviseQuestion, inspectData, moreData], methodIds: dependent ? ['M114', 'M115'] : ['M081', 'M087', 'M099'] },
   { id: 'new-collection', title: '다음 자료 수집을 질문에 맞게 설계하기', reason: '현재 자료의 한계를 남기고 필요한 대상·시점을 보강하는 계획을 만듭니다.', difference: '현재 결과의 의미를 바꾸지 않고 더 답할 수 있는 다음 연구를 설계합니다.', conditions: ['추가 질문이 필요한 이유와 접근 부담을 기록합니다.'], missing: ['자원과 접근 가능성'], claim: '추가 자료가 해결할 질문과 남을 한계를 계획으로 제시할 수 있습니다.', competitors: ['새 수집에서도 같은 선택 한계가 반복될 가능성'], counterEvidence: ['현재 예상과 다른 결과를 확인할 수 있도록 수집 범위를 검토합니다.'], paths: [moreData, inspectData], methodIds: ['M032', 'M002'] }
  ];
 } else {
  alternatives = [
   { id: 'explore-question', title: '작은 탐색으로 궁금한 점 구체화하기', reason: '관심사만 있어도 문헌·현장 메모·접근 가능한 자료에서 구체 질문을 만들 수 있습니다.', difference: '자료와 목적을 미리 고정하지 않고 다음 판단을 바꿀 정보를 찾습니다.', conditions: ['아직 미정인 항목을 그대로 기록합니다.'], missing: ['가장 알고 싶은 내용', '접근 가능한 대상·상황·자료'], claim: '탐색 질문과 필요한 근거를 제안할 수 있으며 연구 결과나 단일 분석법은 아직 확정하지 않습니다.', competitors: ['처음 떠오른 설명만 선택할 가능성'], counterEvidence: ['예상과 다른 현장 사례와 문헌도 탐색합니다.'], paths: [inspectData, reviseQuestion, moreData], methodIds: ['M307', 'M034'] },
   { id: 'describe-possibility', title: '현황을 묻는 질문으로 시작하기', reason: '무엇이 어느 상황에서 나타나는지 묻는 질문 후보를 만들 수 있습니다.', difference: '효과·원인을 묻는 질문과 현황·분포를 묻는 질문을 비교합니다.', conditions: ['대상과 관찰 시점을 정하는 작은 작업을 합니다.'], missing: ['관찰할 대상·내용·자료'], claim: '기술 연구의 질문 후보를 만들 수 있습니다.', competitors: ['쉽게 접근한 대상만 남는 영향'], counterEvidence: ['자료에 포함되지 않을 사람과 상황을 적습니다.'], paths: [inspectData, moreData], methodIds: ['M050', 'M053'] },
   { id: 'interpret-possibility', title: '경험과 의미를 묻는 질문으로 시작하기', reason: '사람들이 겪거나 이해하는 방식을 알아보는 질문도 가능합니다.', difference: '숫자 자료나 가설을 선행 조건으로 요구하지 않습니다.', conditions: ['경험·의미를 묻는 이유와 접근 가능성을 확인합니다.'], missing: ['듣고 싶은 경험과 대화할 대상'], claim: '해석적 탐구의 질문 후보를 만들 수 있습니다.', competitors: ['연구자의 예상에 맞춘 질문의 영향'], counterEvidence: ['다른 경험이 나올 가능성을 질문에 열어 둡니다.'], paths: [reviseQuestion, moreData], methodIds: ['M273', 'M260'] }
  ];
 }
 if (goal === 'association' && !structure.length && alternatives[1]?.id === 'compare-association') alternatives = [alternatives[1], alternatives[0], alternatives[2]];
 return alternatives.map(alternative => attachEvidence(alternative, registry));
}

function questionSet(state, goal, inferred) {
 const a = state.answers;
 const dataMode = a.dataMode;
 const active = new Map();
 const add = (id, priority) => { if (!Object.hasOwn(a, id)) active.set(id, Math.max(priority, active.get(id) ?? 0)); };
 if (!goal || goal === 'unknown') add('goal', 100);
 if (!dataMode) add('dataMode', 95);
 if (goal === 'causation' || goal === 'evaluation') { add('timing', 110); add('assignment', 105); }
 if (['meaning', 'experience', 'theory'].includes(goal) || dataMode === 'interview') { add('qualApproach', 100); add('qualCounter', 85); }
 if (goal === 'mixed' || dataMode === 'mixed') { add('mixedAlignment', 115); add('mixedDiscordance', 110); }
 const quantitative = ['description', 'association', 'causation', 'prediction', 'measurement', 'evaluation'].includes(goal) || ['survey', 'records'].includes(dataMode);
 if (quantitative && dataMode !== 'none') { add('repeated', 89); add('clustered', 88); add('targetMatch', 80); add('missingness', 65); }
 if (goal === 'prediction') { add('predictionValidation', 112); add('timing', 90); }
 if (goal === 'process') { add('timing', 90); add('qualCounter', 82); }
 for (const key of Object.keys(inferred)) add(key, ['timing', 'repeated', 'clustered', 'mixedDiscordance'].includes(key) ? 103 : 98);
 add('resources', Object.values(a).includes('unknown') ? 90 : 55);
 return [...active].sort((left, right) => right[1] - left[1]).map(([id, priority]) => ({ id, prompt: definitions[id][0], reason: definitions[id][1], priority, options: [...definitions[id][2].map(([value, label]) => ({ value, label })), { value: 'unknown', label: '아직 모르겠어요·미정으로 둘게요' }], ...(inferred[id] ? { suggestedValue: inferred[id], inferenceNotice: '설명에서 짐작한 후보입니다. 직접 확인하거나 미정으로 남겨 주세요.' } : {}) }));
}

function reviewClaim(state, goal, alternatives) {
 const a = state.answers;
 const draft = state.draftClaim || state.previous.conclusion;
 const avoid = [];
 let reason = '현재 확인한 사실과 남은 조건에 맞게 주장의 대상·상황·시점을 제한합니다.';
 if (a.targetMatch === 'different' || (state.previous.unit && state.previous.targetUnit && state.previous.unit !== state.previous.targetUnit)) { avoid.push('집단 평균만으로 개인의 효과·행동을 단정하기'); reason = '자료와 주장의 대상 단위가 다릅니다. 단위에 맞게 질문을 바꾸거나 연결할 자료를 확보해야 합니다.'; }
 if (goal === 'causation' || goal === 'evaluation' || /인과|효과|영향을|원인|때문에/.test(draft)) {
  avoid.push(a.assignment === 'randomized' ? '배정·수행·탈락 검토 없이 효과가 검증됐다고 확정하기' : '관찰한 연관·시점 차이를 원인이나 효과로 확정하기');
  if (a.timing === 'cross_sectional') reason = '한 시점이라는 사용자 답변만으로 변화의 선후와 경쟁 원인을 구분할 수 없습니다. 연관으로 범위를 조정하거나 비교·시간·배정 근거를 보강합니다.';
 }
 if (['meaning', 'experience', 'theory'].includes(goal) || a.dataMode === 'interview') avoid.push('면담의 주제나 경험을 모집단 비율·보편 원인으로 확대하기', '선택한 전통과 무관한 일치도 점수·고정 참여자 수를 필수 기준으로 쓰기');
 if (goal === 'mixed' || a.dataMode === 'mixed') avoid.push('불일치하는 결과나 질적 반례를 삭제하거나 평균으로 덮기', '대상·내용·시점 연결 없이 같은 현상을 입증했다고 말하기');
 if (goal === 'prediction') avoid.push('모형을 만든 자료의 적합도를 새로운 대상의 예측 성능으로 보고하기');
 if (goal === 'measurement') avoid.push('한 지표·전문가 합의로 도구 전체의 모든 사용을 타당하다고 확정하기');
 if (goal === 'normative') avoid.push('통계값이나 선호도만으로 공정성·정당성을 확정하기');
 if (state.dataKind === 'synthetic' || /합성|모의 응답|LLM 응답/.test(state.previous.dataDescription)) avoid.push('합성·모의 자료를 실제 인간의 관측 결과로 보고하기');
 if (/독립 검증|검증 완료|모두 동의|세 모델/.test(draft)) avoid.push('AI 동의·계산 성공·재현 가능성만으로 연구 타당성을 승인하기');
 const risky = draft && (/입증|검증[됐되완]|확정|인과|원인|때문에|효과가|효과를|전체|모든|삭제|평균으로/.test(draft) || a.targetMatch === 'different');
 const allowed = a.dataMode === 'none' ? '자료가 아직 정해지지 않았으므로 연구 질문과 수집 계획을 제안할 수 있습니다. 실제 결과나 효과를 보고할 수 있는 단계는 아닙니다.' : alternatives[0].claim;
 return { status: !goal || goal === 'unknown' ? 'hold' : risky && avoid.length ? 'revise' : 'bounded', allowed, avoid, reason, checkedDraft: draft, validationStatus: 'not_validated', checkerScope: '제품 규칙의 문구·조건 점검이며 문장 의미 전체나 연구 타당성을 자동 검증하지 않습니다.' };
}

function evaluateDecisionBase(project, registry) {
 const state = input(project);
 const inferred = infer(state.narrative);
 const goal = state.answers.goal ?? (goals.some(([value]) => value === state.previous.purpose) ? state.previous.purpose : '');
 const facts = makeFacts(state, inferred);
 const questions = questionSet(state, goal, inferred);
 const alternatives = alternativesFor(state, goal, registry);
 const unresolved = Object.entries(state.answers).filter(([, value]) => value === 'unknown').map(([key]) => definitions[key][0] + ' — 미정으로 보존');
 unresolved.push(...questions.map(question => question.prompt));
 if (!goal || goal === 'unknown') unresolved.push('목적과 자료를 탐색하는 단계이므로 단일 분석법은 확정하지 않습니다.');
 if (['causation', 'evaluation'].includes(goal)) unresolved.push('배정·비교·시간 순서·측정·탈락이 지지할 효과의 범위는 별도 연구 검토가 필요합니다.');
 if (state.answers.repeated === 'yes' || state.answers.clustered === 'yes') unresolved.push('반복과 군집을 함께 반영하는 모형·불확실성은 내부 단순 계산 엔진의 지원 범위 밖입니다.');
 const legacyDependence = state.design.dependence;
 if ((legacyDependence === 'repeated' && state.answers.repeated !== 'yes') || (legacyDependence === 'clustered' && state.answers.clustered !== 'yes') || (legacyDependence === 'independent' && [state.answers.repeated, state.answers.clustered].includes('yes'))) unresolved.push('기존 화면의 반복·소속 구조와 이번 답변을 함께 확인해 주세요. 기존 조건을 자동으로 덮어쓰지 않았습니다.');
 const inputFingerprint = hash({ version: DECISION_VERSION, ...state });
 const knowledgeFingerprint = hash({ version: DECISION_VERSION, catalog: registry?.cardCatalog ?? null, sourceRefs: alternatives.flatMap(alternative => alternative.sourceRefs) });
 const claimReview = reviewClaim(state, goal, alternatives);
 const latest = Array.isArray(project.decisionWorkspace?.records) ? project.decisionWorkspace.records.at(-1) : null;
 const topic = state.previous.interest || state.narrative.slice(0, 100) || '관심 있는 현상';
 const ending = ['meaning', 'experience', 'theory'].includes(goal) ? '사람들은 어떤 경험과 의미를 이야기하며 사례와 맥락에 따라 어떻게 다른가?' : goal === 'mixed' || state.answers.dataMode === 'mixed' ? '두 자료가 무엇을 함께 보여 주고 어느 조건에서 다르게 설명하는가?' : goal === 'causation' || goal === 'evaluation' ? '현재 관찰한 대상과 시점에서 어떤 차이·연관이 있으며 다른 설명은 무엇인가?' : goal === 'process' ? '어떤 순서와 조건에서 전개되며 경쟁 설명을 가를 증거는 무엇인가?' : goal === 'normative' ? '어떤 기준과 이유로 판단하며 어떤 반론이 남는가?' : goal === 'prediction' ? '어느 새 대상·시점의 무엇을 예상하며 어떻게 확인할 것인가?' : goal === 'measurement' ? '어떤 대상과 용도의 점수 해석을 어떤 근거로 지지할 수 있는가?' : goal === 'synthesis' ? '확인한 문헌 범위에서 어떤 질문과 근거가 있으며 어떤 공백이 남는가?' : '어떤 사람과 상황에서 무엇을 먼저 확인하면 질문을 구체화할 수 있는가?';
 const recordCurrent = latest?.inputFingerprint === inputFingerprint && latest?.knowledgeFingerprint === knowledgeFingerprint;
 return { version: DECISION_VERSION, inputFingerprint, knowledgeFingerprint, facts, questions, alternatives, recommendation: { alternativeId: alternatives[0].id, status: !goal || goal === 'unknown' ? 'hold' : 'provisional', reason: (!goal || goal === 'unknown' ? '관심사와 자료를 탐색할 경로입니다. 답변으로 목적을 정하면 비교 경로가 달라집니다.' : alternatives[0].reason) + ' 조건에 따른 잠정 경로이며 전문가 적합성 평가를 통과한 추천이 아닙니다.' }, claimReview, unresolved: [...new Set(unresolved)], questionDraft: topic + ' — ' + ending, limitations: ['자유 설명의 해석은 제한된 키워드 규칙입니다. 추정은 사용자 확인 전 사실로 사용하지 않습니다.', '사용자 답변은 진술 기록이며 독립적인 파일 검사나 현장 사실 검증 결과가 아닙니다.', '파일에서 직접 확인한 정보는 이 모듈이 생성하지 않습니다. 파일 확인 기능은 별도 검사 기록이 필요합니다.', 'AI 초안은 이 평가의 사실·답변을 자동 변경하지 않습니다.', '대안과 질문 우선순위는 제품 적용 해석이며 추천 정확도·연구자 학습 부담 감소는 아직 검증하지 않았습니다.', '393개 방법의 전체 탐색은 기존 등록부에서 유지하며 여기의 대표 설계 경로가 전체 방법을 대체하지 않습니다.'], priorRecord: latest ? { id: latest.id, at: latest.at, inputFingerprint: latest.inputFingerprint, knowledgeFingerprint: latest.knowledgeFingerprint, status: recordCurrent ? 'current' : 'needs_review', reason: recordCurrent ? '현재 조건·규칙·출처 판본과 같은 기록입니다.' : '기록 이후 설명·답변·주장·자료 조건 또는 규칙·출처 판본이 달라졌습니다. 이전 판단을 재검토하세요.' } : null };
}

export function evaluateDecision(project,registry){
 const result=evaluateDecisionBase(project,registry),selected=project.decisionWorkspace?.selectedAlternativeId||null;
 result.selection={alternativeId:selected,status:selected?(result.alternatives.some(a=>a.id===selected)?'current':'needs_review'):'none'};
 for(const event of decisionAdoptionSnapshot(project))for(const change of event.changes){
  if(!change.active||!change.target.startsWith('answers.'))continue;
  const fact=result.facts.find(item=>item.id===change.target.slice(8));
  if(fact)Object.assign(fact,{confirmationOrigin:'ai_suggestion',adoptionId:event.id,sourceDraftRef:event.source?.draftRef??null,verification:'user_statement_not_independently_verified'});
 }
 return result;
}

export function recordDecision(project, registry, { alternativeId, note = '' } = {}) {
 if (typeof alternativeId !== 'string' || typeof note !== 'string' || note.length > 10000) throw Error('선택 경로와 판단 메모를 확인해 주세요.');
 const evaluation = evaluateDecision(project, registry);
 const alternative = evaluation.alternatives.find(item => item.id === alternativeId);
 if (!alternative) throw Error('현재 조건에서 비교한 설계 경로를 선택해 주세요.');
 const copy = structuredClone(project);
 copy.decisionWorkspace ??= {};
 copy.decisionWorkspace.records ??= [];
 if (!Array.isArray(copy.decisionWorkspace.records)) throw Error('이전 판단 기록의 형식을 확인해 주세요.');
 if (copy.decisionWorkspace.records.length >= 200) throw Error('판단 기록은 프로젝트당 200개까지 보존합니다. 기존 기록을 유지한 채 새 프로젝트 판본으로 작업을 나누어 주세요.');
 const previous = copy.decisionWorkspace.records.at(-1);
 const recordedClaim = project.decisionWorkspace?.answers?.dataMode === 'none' ? evaluation.claimReview.allowed : alternative.claim;
 copy.decisionWorkspace.records.push({ id: randomUUID(), at: new Date().toISOString(), version: DECISION_VERSION, projectVersion: Number.isInteger(project.version) ? project.version : null, inputFingerprint: evaluation.inputFingerprint, knowledgeFingerprint: evaluation.knowledgeFingerprint, alternativeId, alternativeTitle: alternative.title, conditionSnapshot: input(project), facts: evaluation.facts, claim: recordedClaim, claimReview: { ...evaluation.claimReview, allowed: recordedClaim }, sourceRefs: alternative.sourceRefs, sourceGaps: alternative.sourceGaps, unresolved: evaluation.unresolved, note: note.trim(), previousRecordId: previous?.id ?? null, previousInputFingerprint: previous?.inputFingerprint ?? null, changedSincePrevious: previous ? previous.inputFingerprint !== evaluation.inputFingerprint || previous.knowledgeFingerprint !== evaluation.knowledgeFingerprint : false, researchValidation: 'not_run' });
 copy.decisionWorkspace.records.at(-1).aiAdoptions=decisionAdoptionSnapshot(project);
 // A plan states what still needs evidence. It is not an assessment that the
 // recorded conditions hold, nor a new source-backed validity claim.
 copy.decisionWorkspace.records.at(-1).validityPlan={status:'planned',evidenceCollection:'not_run',evidenceAssessment:'not_run',alternativeId,conditions:structuredClone(alternative.conditions),missing:structuredClone(alternative.missing),competitors:structuredClone(alternative.competitors),counterEvidence:structuredClone(alternative.counterEvidence),paths:structuredClone(alternative.paths),sourceRefs:structuredClone(alternative.sourceRefs),sourceGaps:structuredClone(alternative.sourceGaps),inputFingerprint:evaluation.inputFingerprint,knowledgeFingerprint:evaluation.knowledgeFingerprint};
 return { project: copy, decision: evaluateDecision(copy, registry) };
}

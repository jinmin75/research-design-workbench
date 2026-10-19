// These are transparent, provisional group routes from SPEC v4.0, not validated
// method-level recommendation rules. Execution support never enters their order.
export const purposes = [
  { id: 'description', label: '현황·분포 기술', groups: ['G04', 'G44', 'G02'], preferred: ['M050', 'M056', 'M020'], description: '무엇이 얼마나, 어떻게 분포하는지 살펴봅니다.' },
  { id: 'association', label: '관계·연관', groups: ['G08', 'G09', 'G10', 'G11', 'G12', 'G24'], preferred: ['M081', 'M087', 'M099'], description: '관측된 관계와 조건을 구체화합니다.' },
  { id: 'causation', label: '인과·효과', groups: ['G13', 'G01', 'G47', 'G12'], preferred: ['M006', 'M122', 'M393'], description: '대조·시점·식별 근거와 경쟁 설명을 검토합니다.' },
  { id: 'prediction', label: '미래 예측', groups: ['G22', 'G09', 'G10', 'G26', 'G27'], preferred: ['M208', 'M087', 'M209'], description: '예측 대상·시점·평가 자료를 구분합니다.' },
  { id: 'measurement', label: '측정·점수 해석', groups: ['G14', 'G15', 'G16', 'G03'], preferred: [], description: '구성개념, 점수의 의미와 사용 맥락을 검토합니다.' },
  { id: 'experience', label: '경험 탐구', groups: ['G29', 'G28', 'G03'], preferred: ['M271', 'M273', 'M274'], description: '경험을 드러내는 자료와 해석 전통을 비교합니다.' },
  { id: 'meaning', label: '의미·해석', groups: ['G29', 'G28', 'G30', 'G34', 'G43'], preferred: ['M272', 'M260', 'M274'], description: '맥락 속 의미·해석·주관적 관점을 탐색합니다.' },
  { id: 'process', label: '과정·기제', groups: ['G47', 'G29', 'G41', 'G27', 'G01'], preferred: ['M393', 'M268', 'M363'], description: '시간 순서, 변화 과정과 경쟁 설명을 검토합니다.' },
  { id: 'theory', label: '이론 형성·개념', groups: ['G29', 'G28', 'G43', 'G45'], preferred: ['M268', 'M270', 'M369'], description: '반복적 비교, 개념 구분과 이론적 설명을 탐색합니다.' },
  { id: 'normative', label: '규범·윤리·논증', groups: ['G43', 'G40', 'G41'], preferred: ['M373', 'M371', 'M369'], description: '가치 전제와 논거를 경험적 결과와 구별합니다.' },
  { id: 'evaluation', label: '평가·의사결정', groups: ['G41', 'G42', 'G40', 'G13', 'G47'], preferred: ['M357', 'M359', 'M363'], description: '평가 질문·맥락·성과·가치 기준을 구체화합니다.' },
  { id: 'synthesis', label: '문헌·근거 합성', groups: ['G35', 'G37', 'G36', 'G38', 'G46'], preferred: ['M307', 'M306', 'M325'], description: '문헌 지형, 검토 질문과 근거 유형을 구분합니다.' },
  { id: 'mixed', label: '혼합·통합', groups: ['G31', 'G32', 'G33', 'G34'], preferred: ['M287', 'M288', 'M297'], description: '두 접근을 이어야 하는 이유·통합 지점·불일치를 기록합니다.' }
];

const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value.trim() : '';
const filled = value => text(value).length > 0;
const purposeMap = new Map(purposes.map(p => [p.id, p]));
const specialMethods = new Set(['M377', 'M378', 'M379', 'M380']);
const specRef = section => ({ file: 'SPEC-v4.0.md', section, accessLevel: 'specification_only', originalSourceReview: 'not_reviewed' });

export function createProject(input = {}) {
  const now = new Date().toISOString();
  const initial = {
    id: globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    schemaVersion: '1.0', version: 0, title: '', interest: '', context: '', purpose: '',
    question: '', conclusion: '', dataDescription: '', resources: '', falsifier: '', unit: '', targetUnit: '',
    dataKind: '', selectedMethods: [], decisionReason: '', qualitative: [], integration: [],
    design: { identification: '', evaluationPlan: '', constructUse: '', measurementTarget: '', dependence: '', dependencePlan: '', normativeReason: '', conclusionBasis: '' },
    nodes: [], edges: [], history: [], analysis: null, methodAnalysis: null, createdAt: now, updatedAt: now
  };
  const result = { ...initial, ...clone(input), design: { ...initial.design, ...clone(input.design ?? {}) } };
  // Explicit empty strings remain unresolved; no profile or method is inferred.
  return result;
}

const questions = [
  { id: 'interest', label: '관심 현상', prompt: '무엇이 궁금하신가요?', required: false },
  { id: 'context', label: '대상·상황', prompt: '누구와 어떤 상황을 살펴보고 싶으신가요?', required: false },
  { id: 'purpose', label: '탐구 목적', prompt: '현황·관계·효과·예측·측정·경험·의미·과정·이론·규범·평가·합성 중 무엇을 알고 싶으신가요?', required: false },
  { id: 'conclusion', label: '원하는 결론', prompt: '현재 어떤 결론을 생각하고 계신가요?', required: false },
  { id: 'dataDescription', label: '자료·자원', prompt: '접근 가능한 자료와 사용할 수 있는 자원은 무엇인가요?', required: false, relatedFields: ['resources'] },
  { id: 'falsifier', label: '생각을 수정할 조건', prompt: '어떤 결과나 반례를 만나면 처음 생각을 바꾸시겠어요?', required: false }
];

const purposeNeeds = {
  description: ['대상 모집단·시점', '표집 방식·관측 변수', '표본 요약과 모집단 추정의 구분'],
  association: ['변수와 관계의 정의', '조건화 변수·자료 구조', '관찰된 관계와 인과 주장의 구분'],
  causation: ['처치·비교·결과·시점·대상 효과', '식별 가정과 이를 지지하는 설계 근거', '경쟁 설명·반대 증거·민감도'],
  prediction: ['예측 대상·시점·사용 상황', '평가 자료·시간/개체 분할·누출 방지', '평가 지표·기준모형'],
  measurement: ['구성개념·점수 해석·사용 맥락', '사용 대상·자료 생성 과정', '해당 해석을 지지할 타당화 근거'],
  experience: ['탐구 전통·연구자 위치', '사례 선정·자료 생성 관계', '경험 자료·맥락·반례·인용 권한'],
  meaning: ['관점·전통·연구자 위치', '자료 생성 맥락·사례 선정', '해석 논리·대안 해석·반례'],
  process: ['사건 시간선·자료의 출처', '반복 수집·비교 또는 사례 내 증거의 분석 논리', '경쟁 설명·증거의 독립성・반대 증거'],
  theory: ['이론 형성 또는 개념 명료화의 목적', '자료·개념·반복 비교의 연결', '선택한 전통·반례·경쟁 설명'],
  normative: ['가치 전제·규범적 논거', '경험적 주장과 규범적 판단의 연결 이유', '반론·대안 가치·적용 맥락'],
  evaluation: ['평가 대상·질문·사용자·맥락', '성과·과정·기제·가치 기준', '경쟁 설명과 자료 출처'],
  synthesis: ['검토 질문·범위·문헌 유형', '검색·선별·종료 근거', '미검토 문헌·비뚤림·사람의 판단'],
  mixed: ['통합해야 하는 이유와 통합 질문', '자료·개념·단계의 연결 지점', '전제 충돌·불일치 처리·통합 판단']
};

const conclusions = {
  description: '확보한 표본의 현황을 기술합니다. 모집단 일반화에는 표집·설계 검토가 추가로 필요합니다.',
  association: '관측된 연관을 탐색합니다. 인과효과의 확인으로 표현할 수 없습니다.',
  causation: '식별 근거와 경쟁 설명 검토가 갖춰지기 전에는 인과 결론을 확정할 수 없습니다.',
  prediction: '독립적인 평가 설계를 확인하기 전에는 표본 밖 성능을 주장할 수 없습니다.',
  measurement: '특정 점수 해석·사용을 지지할 근거를 검토합니다. 도구 전체의 타당성이 승인된 것은 아닙니다.',
  experience: '맥락과 사례 근거를 연결한 경험 해석을 검토합니다. 수치 가설은 필수 조건이 아닙니다.',
  meaning: '해석과 반례·대안 해석을 함께 보존합니다. 모든 해석에 수치 출력을 요구하지 않습니다.',
  process: '시간 순서·경쟁 설명·증거의 진단성을 검토합니다. 증거 개수만으로 인과를 확정할 수 없습니다.',
  theory: '개념·이론의 형성과 반례를 기록합니다. 고정 가설을 사전에 강제하지 않습니다.',
  normative: '논거와 가치 전제를 명시한 판단을 검토합니다. 통계값만으로 당위를 확정할 수 없습니다.',
  evaluation: '맥락·기준·과정·성과의 연결을 검토합니다. 평가틀 이름만으로 효과가 입증되지 않습니다.',
  synthesis: '검토 범위에서 확인한 근거를 정리합니다. 문헌 지형 탐색에 효과값을 일괄 요구하지 않습니다.',
  mixed: '일치·불일치와 통합의 이유를 남깁니다. 방법을 나열한 것만으로 통합을 완료하지 않습니다.'
};

function draftQuestion(p, purposeId) {
  const phenomenon = text(p.interest) || '관심 현상';
  const context = filled(p.context) ? `${text(p.context)}에서 ` : '대상·상황을 정한 뒤 ';
  const endings = {
    description: `${phenomenon}의 현황과 분포는 어떠한가?`,
    association: `${phenomenon}와 관련된 변수는 어떤 관계를 보이는가?`,
    causation: `${phenomenon}에 관한 처치와 비교의 차이는 어떤 설계 근거로 설명할 수 있는가?`,
    prediction: `${phenomenon}의 미래 결과를 어느 시점에 어떤 자료로 평가할 수 있는가?`,
    measurement: `${phenomenon}를 나타내는 점수는 누구에게 어떤 의미와 용도로 사용되는가?`,
    experience: `사람들은 ${phenomenon}를 어떻게 경험하는가?`,
    meaning: `${phenomenon}의 의미는 어떻게 형성되고 해석되는가?`,
    process: `${phenomenon}는 어떤 시간 순서·과정·기제로 전개되는가?`,
    theory: `${phenomenon}를 설명하는 개념과 과정 이론을 어떻게 형성할 수 있는가?`,
    normative: `${phenomenon}에 관한 판단을 어떤 가치 전제와 논거로 정당화할 수 있는가?`,
    evaluation: `${phenomenon}의 과정·성과를 어떤 맥락과 기준에서 평가할 것인가?`,
    synthesis: `${phenomenon}의 문헌 지형과 확인된 근거·공백은 무엇인가?`,
    mixed: `${phenomenon}의 서로 다른 자료와 해석을 왜, 어디서 통합할 것인가?`
  };
  return { purpose: purposeId, label: purposeMap.get(purposeId).label, question: context + endings[purposeId], status: 'draft', generatedBy: 'transparent_template', requiresResearcherRevision: true };
}

function check(id, status, message, needed = [], scope = '입력된 구조화 정보의 일관성 검사') {
  return { id, status, message, needed, scope, sourceRefs: [specRef(Number(id.slice(1)) <= 24 ? '6' : Number(id.slice(1)) <= 32 ? '23.1' : '27.2')], validatesResearch: false };
}

export function assess(project = {}, registry = {}) {
  const p = createProject(project);
  const route = purposeMap.get(p.purpose);
  const design = p.design;
  const methods = Array.isArray(registry.methods) ? registry.methods : [];
  const lookup = new Map(methods.map(m => [m.id, m]));
  const groups = route?.groups ?? ['G04', 'G29', 'G35', 'G43', 'G47', 'G31', 'G41'];
  // Special-domain items remain searchable in the registry; do not infer a
  // user's discipline from their profile. An explicit project selection retains them.
  const allowSpecial = p.allowFieldSpecificMethods === true;
  const relevant = [...new Map(methods.filter(m => (groups.includes(m.groupId) || (m.crossGroups ?? []).some(g => groups.includes(g))) && (!specialMethods.has(m.id) || allowSpecial)).map(m => [m.id, m])).values()];
  const missing = ['question', 'context', 'unit', 'dataDescription', 'resources', 'falsifier'].filter(key => !filled(p[key]));
  if (!route) missing.unshift('purpose');
  const getCandidate = method => ({
    methodId: method.id, name: method.name, groupId: method.groupId, groupName: method.groupName,
    status: route && filled(p.question) ? 'conditional' : 'hold',
    reason: `${method.groupName ?? method.groupId} 영역을 목적과 대조하는 탐색 후보입니다. ${method.cardStatus==='source_reviewed'?'상세 카드의 원출처를 대조했습니다. 개별 연구에 맞는지와 추천 규칙은 검증하지 않았습니다.':method.cardStatus==='partial'?'상세 카드의 원출처를 일부 대조했습니다. 남은 근거 공백과 적용 조건을 확인해야 합니다.':'이 항목의 세부 적용 조건·전제·한계 카드는 아직 검토하지 않았습니다.'}`,
    question: filled(p.question) ? p.question : draftQuestion(p, route?.id ?? ({ G29: 'experience', G35: 'synthesis', G43: 'normative', G47: 'process', G31: 'mixed', G41: 'evaluation' }[method.groupId] ?? 'description')).question,
    unit: text(p.unit) || '미정: 관측·사례·추론 단위를 확인해 주세요.',
    requiredEvidence: [...(purposeNeeds[route?.id] ?? ['목적·질문', '대상·자료 구조', '대안 경로 비교']), '개별 방법의 원출처·적용 조건·한계 검토'],
    output: method.output ?? '미확인', outputScope: '명세의 영역 수준 산출물 초안',
    allowedConclusion: conclusions[route?.id] ?? '목적과 질문이 미정이므로 분석·결론을 확정하지 않습니다.',
    missingInformation: [...missing, ...(method.cardStatus==='source_reviewed'?['expertApplicabilityReview']:['methodCardReview'])],
    executionStatus: method.executionStatus ?? 'unsupported',
    sourceRefs: [method.source ? { ...method.source, accessLevel: 'specification_only', originalSourceReview: 'not_reviewed' } : specRef('21'), specRef('3'), ...(method.card?.claimSources??[])],
    verificationStatus: { ...(method.verificationStatus ?? {}), applicability: 'unverified', expertReview: 'not_run' },
    recommendationStatus: 'unverified', cardStatus: method.cardStatus ?? 'pending',
    alternatives: [], counterevidence: [], reviewerStatus: 'pending', automaticRecommendation: false
  });
  const allCandidates = relevant.map(getCandidate);
  // Provisional exemplars are editorial navigation choices, not an estimated
  // suitability score. Retain broad alternatives and never sort by an engine flag.
  const priorityIds = route?.preferred.length ? route.preferred : groups.map(g => relevant.find(m => m.groupId === g)?.id).filter(Boolean);
  const selected = [];
  for (const id of [...priorityIds, ...relevant.map(m => m.id)]) {
    if (selected.length >= 3) break;
    if (relevant.some(m => m.id === id) && !selected.includes(id)) selected.push(id);
  }
  const candidates = selected.map(id => getCandidate(lookup.get(id)));
  for (const c of candidates) c.alternatives = candidates.filter(other => other.methodId !== c.methodId).map(other => other.methodId);

  const checks = Array.from({ length: 48 }, (_, i) => check(`R${String(i + 1).padStart(2, '0')}`, 'not_run', '이 초기 버전에서 자동 검사하지 않았습니다. 전문 검토가 필요합니다.'));
  const set = value => { checks[Number(value.id.slice(1)) - 1] = value; };
  set(check('R01', route && filled(p.question) ? 'pass' : 'hold', route && filled(p.question) ? '목적과 질문이 기록되어 있습니다. 적합성 검증 완료를 뜻하지 않습니다.' : '목적 또는 질문이 미정입니다. 대안 질문을 비교하고 단일 분석 확정은 보류합니다.', ['purpose', 'question'].filter(k => !filled(p[k]))));
  if (p.purpose === 'causation' || p.conclusionType === 'causal') set(check('R02', filled(design.identification) ? 'pass' : 'hold', filled(design.identification) ? '식별 근거가 기록되었습니다. 가정의 성립과 인과 타당성은 사람이 검토해야 합니다.' : '식별 근거가 없습니다. 인과 결론의 확정은 보류하고 연관 경로 또는 설계 보강을 검토하세요.', ['design.identification']));
  if (p.purpose === 'prediction') set(check('R03', filled(design.evaluationPlan) && filled(p.predictionTime) ? 'pass' : 'hold', '평가 자료·분할·시점 기록을 확인합니다. 기록만으로 성능을 검증하지 않습니다.', ['design.evaluationPlan', 'predictionTime'].filter(k => !filled(k === 'predictionTime' ? p.predictionTime : design.evaluationPlan))));
  if (p.purpose === 'measurement') set(check('R04', filled(design.constructUse) && filled(design.measurementTarget) ? 'pass' : 'hold', '점수의 의미·용도와 사용 대상을 기록해야 합니다. 타당화 경로 확정은 별도 검토가 필요합니다.', ['constructUse', 'measurementTarget'].filter(k => !filled(design[k]))));
  set(check('R05', !filled(p.unit) || !filled(p.targetUnit) ? 'hold' : text(p.unit) === text(p.targetUnit) ? 'pass' : 'fail', !filled(p.unit) || !filled(p.targetUnit) ? '자료 단위와 추론 단위 중 미정 항목이 있습니다.' : text(p.unit) === text(p.targetUnit) ? '입력된 자료·추론 단위 문자열이 같습니다. 단위의 실제 적절성은 별도 검토입니다.' : '자료 단위와 추론 단위가 다릅니다. 해당 추론을 보류하고 집계·다층 구조 등을 검토하세요.', ['unit', 'targetUnit'].filter(k => !filled(p[k]))));
  if (['independent', 'clustered', 'repeated', 'clustered_repeated'].includes(design.dependence)) set(check('R06', design.dependence === 'independent' || filled(design.dependencePlan) ? 'pass' : 'hold', design.dependence === 'independent' ? '독립 자료라는 연구자 기록을 보존합니다. 독립성을 실증 검증하지 않았습니다.' : filled(design.dependencePlan) ? '의존 구조 처리 계획이 기록되었습니다. 방법의 적합성은 미검증입니다.' : '반복·군집 구조의 처리 계획이 필요합니다.', ['design.dependencePlan']));
  else set(check('R06', 'hold', '반복·군집 등 의존 구조가 미정입니다.', ['design.dependence']));
  if (p.purpose === 'normative' || design.conclusionBasis === 'statistics_only') set(check('R24', design.conclusionBasis === 'statistics_only' ? 'fail' : filled(design.normativeReason) ? 'pass' : 'hold', design.conclusionBasis === 'statistics_only' ? '통계값만으로 규범적 결론을 확정할 수 없습니다. 경험 결과와 가치 전제·논증을 구분하세요.' : '가치 전제와 규범적 논거의 기록 여부를 확인합니다. 논증의 타당성은 사람이 검토합니다.', ['design.normativeReason']));
  set(check('R25', 'pass', '전체 관련 영역에서 후보를 검색하며 내부 실행 지원 상태를 후보 순위에 사용하지 않습니다.', [], '후보 검색 코드의 구조적 성질; 방법의 적합성 검증은 미실시'));
  const methodQuery = text(p.methodQuery || p.requestedMethod || p.searchQuery || p.interest);
  const ambiguous = /^(IPA|LDA|Q)$/i.test(methodQuery);
  const ambiguityMatches = ambiguous ? methods.filter(m => new RegExp(`\\b${methodQuery}\\b`, 'i').test(m.name)).map(m => ({ methodId: m.id, name: m.name, groupId: m.groupId, sourceRefs: [m.source] })) : [];
  if (ambiguous) set(check('R26', 'hold', `${methodQuery.toUpperCase()}의 전체 명칭·목적·맥락을 확인해야 합니다. ${ambiguityMatches.map(m => m.name).join(' / ')}. 동약어를 자동 치환하지 않습니다.`, ['methodFullName', 'methodPurpose', 'context']));
  if (['experience', 'meaning', 'process', 'theory', 'normative', 'synthesis', 'mixed'].includes(p.purpose)) set(check('R28', 'pass', '비수치 산출물과 근거·해석 경로를 허용합니다. 수치·가설·p값을 필수 입력으로 요구하지 않습니다.', [], '안내 구조에 한정; 개별 전통 적합성 미검증'));
  set(check('R31', 'hold', `${allCandidates.length}개 탐색 후보 중 ${allCandidates.filter(m=>m.cardStatus==='source_reviewed').length}개의 카드 원출처를 대조했습니다. 추천 규칙·개별 연구 적합성의 전문 검토는 미실시이며 확정 추천을 제공하지 않습니다.`, ['expertApplicabilityReview', 'recommendationValidation']));
  set(check('R32', 'not_run', '47개 영역의 전문가 평가·사용자 비교를 수행하지 않았습니다. 전체 범위 성능 점수는 없습니다.'));
  if (p.claimValidation?.basis === 'reproduction' || p.claimValidation?.basis === 'execution_success') set(check('R42', 'fail', '재현·실행 성공은 주장 타당성의 승인이 아닙니다. 지지·반박·가정과 해석 근거를 별도 검토하세요.'));
  else set(check('R42', 'not_run', '생성 의존성과 논리적 지지 관계는 분리합니다. 주장의 타당성 검토는 수행하지 않았습니다.'));
  const recordedKinds=[p.dataKind,p.calculationInput?.dataKind,p.methodWorkspace?.dataKind,p.analysis?.dataKind,p.methodAnalysis?.input?.dataKind].map(text).filter(Boolean);
  const dataKind = recordedKinds.find(k=>['synthetic','simulation','llm','llm_generated','mixed'].includes(k))||recordedKinds[0]||'';
  if (['synthetic', 'simulation', 'llm', 'llm_generated', 'mixed'].includes(dataKind)) set(check('R43', p.conclusionTarget === 'real_humans' ? 'fail' : 'hold', p.conclusionTarget === 'real_humans' ? '프로젝트에 모의·LLM·혼합 자료가 포함되어 있습니다. 이 자료로 실제 인간의 효과·분포를 확정할 수 없습니다.' : '프로젝트의 모의·LLM·혼합 자료 생성 유형을 보존합니다. 모듈별 실제 관측과의 구분 및 행·변수·변환 출처를 추가 확인해야 합니다.', ['dataProvenance', 'transformationHistory']));
  else if (['human', 'human_observed', 'observational', 'administrative'].includes(dataKind)) set(check('R43', 'pass', '연구자가 기록한 자료 생성 유형을 보존합니다. 실제 출처를 독립 검증하지 않았습니다.'));
  if (p.figureSpec) {
    const f = p.figureSpec;
    const hasMetadata = ['unit', 'denominator', 'uncertainty', 'sourceLabel', 'sourceVersion'].every(key => f[key] !== undefined && f[key] !== null && f[key] !== '');
    const mismatch = filled(p.unit) && filled(f.unit) && p.unit !== f.unit;
    set(check('R21', hasMetadata ? 'pass' : 'hold', hasMetadata ? '그림 메타데이터가 기록되었습니다. 자료와 그림의 일치는 별도 확인해야 합니다.' : '단위·분모·오차 정의·출처·판본을 확인할 때까지 그림 생성의 확정을 보류합니다.', [], '구조화된 메타데이터 존재 여부만 검사'));
    if (f.dataLevel === 'summary' || f.hasRawData === false) {
      const fabricated = (f.requestedElements ?? []).some(element => ['distribution', 'individual_values', 'confidence_interval'].includes(element)) && f.hasSufficientSummary !== true;
      set(check('R22', fabricated ? 'fail' : 'hold', fabricated ? '평균 등 불충분한 요약값에서 개인 분포·신뢰구간을 생성할 수 없습니다.' : '요약자료의 충분성을 확인해야 합니다. 없는 원자료·분포·구간을 생성하지 않습니다.'));
    }
    set(check('R47', mismatch || !hasMetadata ? 'hold' : 'pass', mismatch ? '그림과 자료 단위가 다릅니다. 생성·해석을 재검토하세요.' : hasMetadata ? '그림의 단위·분모·불확실성·출처·판본이 기록되었습니다. 자료와 표현의 전문 검토는 남아 있습니다.' : '그림에 단위·분모·불확실성 정의·출처·판본이 필요합니다.', [], '구조화된 그림 메타데이터 검사; 그림 엔진 검증은 별도'));
  }
  return {
    questions: questions.map(q => ({ ...q, value: p[q.id] ?? '', status: filled(p[q.id]) ? 'recorded' : 'undecided' })), checks,
    candidates, allCandidates, ambiguityMatches,
    questionDrafts: (route ? [route.id] : ['description', 'association', 'causation', 'experience', 'process', 'normative', 'synthesis', 'mixed']).map(id => draftQuestion(p, id)),
    decisionStatus: route && filled(p.question) ? 'conditional_exploration' : 'hold',
    coverage: { registered: methods.length, groups: new Set(methods.map(m => m.groupId)).size, candidateCount: allCandidates.length, reviewedCards: 0, sourceReviewedCards: methods.filter(m => m.cardStatus === 'source_reviewed').length, partiallyReviewedCards:methods.filter(m=>m.cardStatus==='partial').length, expertEvaluation: 'not_run', performanceScore: null },
    notice: '이 결과는 명세의 영역 분류를 바탕으로 한 탐색 안내입니다. 후보 적합성·연구 타당성·방법별 계산 정확성을 검증한 추천이 아닙니다.',
    nextSteps: ['미정 정보를 저장하거나 질문 초안을 수정하세요.', '후보의 원출처·적용 조건·한계를 검토하고 선택 이유를 기록하세요.']
  };
}

/** Edges: produces goes prerequisite -> product. depends_on goes dependent ->
 * prerequisite. supports/opposes/assumes describe logic, never generation.
 * Returns new objects; a cycle is safe. A style/font edit touches only its figure.
 */
export function invalidateGraph(nodes = [], edges = [], changedId, changeKind = 'data') {
  const nextNodes = clone(nodes);
  const nextEdges = clone(edges);
  const nodeIds = new Set(nodes.map(node => node.id));
  if (!nodeIds.has(changedId)) return { nodes: nextNodes, edges: nextEdges, affectedIds: [], changedId, changeKind, warning: '변경 노드가 없습니다.' };
  const affected = new Set([changedId]);
  if (!['font', 'style', 'figure_style'].includes(changeKind)) {
    const queue = [changedId];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        const downstream = edge.type === 'produces' && edge.from === current ? edge.to : edge.type === 'depends_on' && edge.to === current ? edge.from : null;
        if (downstream && nodeIds.has(downstream) && !affected.has(downstream)) { affected.add(downstream); queue.push(downstream); }
      }
    }
  }
  for (const node of nextNodes) if (affected.has(node.id)) {
    node.status = node.id === changedId ? 'changed' : 'needs_review';
    node.invalidated = true;
    node.needsReview = true;
    node.invalidation = { changedId, changeKind, reason: node.id === changedId ? '입력 변경' : '생성 의존성의 선행 항목 변경' };
  }
  return { nodes: nextNodes, edges: nextEdges, affectedIds: [...affected], changedId, changeKind, validatesClaims: false };
}

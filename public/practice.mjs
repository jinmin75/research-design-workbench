// Product teaching fixtures: invented conditions, never observed research data.
export const PRACTICE_VERSION='1.0';
export const PRACTICE_SCENARIOS=[
 {id:'interest-only',title:'관심사만 있고 질문·자료는 미정',narrative:'지역 주민의 외로움이 궁금합니다. 아직 연구 질문이나 자료는 정하지 않았습니다.',conditions:['알아보고 싶은 현상만 정했습니다.','자료 수집 대상·시점·연구 방향은 아직 모릅니다.'],answers:{goal:'unknown',dataMode:'none',resources:'unknown'}},
 {id:'cross-sectional-cause',title:'한 시점 설문으로 인과효과를 말하려는 연구',narrative:'한 시점 설문으로 교육 프로그램의 인과효과를 주장하고 싶습니다.',conditions:['개인별 설문을 한 시점에 한 번 받았다고 가정합니다.','프로그램 참여는 본인 선택이었으며 무작위 배정은 하지 않았습니다.','현재 자료 안에서 진행해야 하고, 결측과 기존 차이는 검토하지 않았습니다.'],answers:{goal:'causation',dataMode:'survey',timing:'cross_sectional',assignment:'observed',repeated:'no',clustered:'no',targetMatch:'same',missingness:'unreviewed',resources:'existing'}},
 {id:'repeated-clustered',title:'같은 학생의 반복측정과 학교 소속',narrative:'학교별로 같은 학생을 학기마다 조사했습니다. 학생들의 점수와 경험이 함께 달라지는지 궁금합니다.',conditions:['같은 학생을 여러 시점에 확인했다고 가정합니다.','학생들은 학교에 속하며 한 학생의 기록이 여러 행 있습니다.','추적에서 빠진 학생과 결측 처리 방침은 아직 검토하지 않았습니다.'],answers:{goal:'association',dataMode:'survey',timing:'longitudinal',repeated:'yes',clustered:'yes',targetMatch:'same',missingness:'unreviewed',resources:'existing'}},
 {id:'interview-meaning',title:'면담에서 경험에 붙이는 의미 탐구',narrative:'돌봄 노동자가 경험한 돌봄의 의미를 면담에서 이해하고 싶습니다.',conditions:['여러 사람이 돌봄에 붙이는 의미를 탐구한다고 가정합니다.','면담 전사본이 있지만 반대 사례와 다른 해석은 아직 검토하지 않았습니다.','추가 면담이나 재접촉은 검토할 수 있습니다.'],answers:{goal:'meaning',dataMode:'interview',qualApproach:'meanings',qualCounter:'not_yet',resources:'new_possible'},qualitative:[{id:'practice-interview-1',tradition:'합성 연습 · 읽기 관점 미정',source:'합성 연습 전사본 v1 · 1쪽 1행 · 실제 참여자 없음',excerpt:'합성 발화: 함께 일하는 사람은 많지만 혼자 책임지는 느낌이에요.',interpretation:'연습용 해석 후보: 함께 있음과 책임 경험이 다를 수 있음',counterevidence:'합성 연습 · 다른 발화와 맥락은 미정',decision:'원문과 다른 해석을 비교하는 연습'}]},
 {id:'mixed-discordance',title:'설문과 면담이 엇갈리는 혼합연구',narrative:'설문은 만족도가 높지만 면담에서는 불만이 나오는 혼합연구입니다.',conditions:['설문과 면담에 서로 맞지 않는 결과가 있다고 가정합니다.','두 자료의 참여자·시점·만족 개념이 연결되는지는 아직 모릅니다.','추가 자료를 확인하거나 재접촉할 수 있다고 가정합니다.'],answers:{goal:'mixed',dataMode:'mixed',mixedAlignment:'unknown',mixedDiscordance:'yes',resources:'new_possible'},integration:[{concept:'합성 연습 · 만족',question:'합성 연습 · 무엇이 엇갈리는가?',unit:'합성 연습 · 대상 연결 미정',quantitative:'합성 연습 · 설문에서 만족 높음 (실제 수치 없음)',qualitative:'합성 연습 · 면담에 불만 표현 (실제 참여자 없음)',agreement:'합성 연습 · 불일치',alternative:'합성 연습 · 대상·시점·개념의 차이 가능성',decision:'합성 연습 · 불일치 보존, 통합 결론 미정',next:'합성 연습 · 대상·개념·시점 연결 확인'}]},
 {id:'important-unknown',title:'자료의 중요 조건을 아직 모르는 연구',narrative:'기관에 자료가 있다는 말만 들었습니다. 누구에게 언제 어떻게 모았는지 모릅니다.',conditions:['자료의 존재를 들었지만 파일이나 수집 기록은 확인하지 않았다고 가정합니다.','자료 유형·대상·시점·반복·소속 구조와 추가 접근 가능성을 모릅니다.'],answers:{goal:'unknown',dataMode:'unknown',timing:'unknown',repeated:'unknown',clustered:'unknown',targetMatch:'unknown',missingness:'unknown',resources:'unknown'}}
];
export function practiceScenario(project){return project?.practice?.synthetic===true?PRACTICE_SCENARIOS.find(item=>item.id===project.practice.scenarioId)??null:null;}
export function createPracticeProject(factory,scenarioId){
 const scenario=PRACTICE_SCENARIOS.find(item=>item.id===scenarioId);if(!scenario)throw Error('등록된 강의·연습 사례를 선택해 주세요.');
 const project=factory();project.title='합성 연습 · '+scenario.title;project.practice={scenarioId,version:PRACTICE_VERSION,synthetic:true};project.dataKind='synthetic';
 project.decisionWorkspace={narrative:scenario.narrative,answers:{},draftClaim:'',records:[],aiDrafts:[],adoptions:[],evidenceReviews:[]};return project;
}
export function currentPracticeAnswer(project,decision){
 const scenario=practiceScenario(project),question=decision?.questions?.[0];if(!scenario||!question)return null;
 const value=Object.hasOwn(scenario.answers,question.id)?scenario.answers[question.id]:'unknown',option=question.options?.find(item=>item.value===value);
 if(!option)return null;return {questionId:question.id,value,label:option.label,known:value!=='unknown'};
}
export function taskProgress(project,view){
 const workspace=project.decisionWorkspace??{},current=Boolean(view.decision&&!view.decisionStale&&view.decision.inputFingerprint&&view.decision.knowledgeFingerprint);
 const record=workspace.records?.findLast(item=>item&&item.inputFingerprint===view.decision?.inputFingerprint&&item.knowledgeFingerprint===view.decision?.knowledgeFingerprint);
 return [
  {id:'description',label:'연구 설명',status:workspace.narrative?.trim()||project.interest?.trim()?'written':'pending',detail:'관심사만 적어도 시작할 수 있습니다.'},
  {id:'guidance',label:'현재 조건으로 안내 검토',status:current?'current':view.decision?'needs_review':'pending',detail:'입력이 바뀌면 안내를 업데이트합니다.'},
  {id:'record',label:'현재 조건의 판단 기록',status:current&&record?'current':workspace.records?.length?'needs_review':'pending',detail:'대안을 직접 검토한 뒤 기록 버튼을 누릅니다.'},
  {id:'saved',label:'프로젝트 판본 저장',status:project.id&&project.version&&!view.dirty?'saved':view.dirty?'unsaved':'pending',detail:'저장 후 다시 열어 이어갈 수 있습니다.'}
 ];
}

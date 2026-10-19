import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Source review supplements the scope draft. It never changes navigation order,
// certifies a recommendation, or certifies an entire method's execution.
export function mergeRegistry(base, catalog) {
 const registry=structuredClone(base);
 const ids=new Set(registry.methods.map(m=>m.id)), seen=new Set();
 const sources=catalog.sources||[];
 const sourceIds=new Set(sources.map(s=>s.id));
 for(const card of catalog.cards||[]){
  if(!ids.has(card.methodId)||seen.has(card.methodId))throw Error('중복되거나 등록되지 않은 카드 ID: '+card.methodId);
  seen.add(card.methodId);
  if(!['source_reviewed','partial','pending'].includes(card.reviewStatus))throw Error('알 수 없는 카드 검토 상태');
  if((card.sourceIds||[]).some(id=>!sourceIds.has(id)))throw Error('카드 원출처가 없습니다: '+card.methodId);
  const method=registry.methods.find(m=>m.id===card.methodId);
  method.card={...method.card,...structuredClone(card)};
  method.cardStatus=card.reviewStatus;
  method.verificationStatus={...method.verificationStatus,source:card.reviewStatus==='source_reviewed'?'source_reviewed':card.reviewStatus==='partial'?'partially_reviewed':'not_reviewed',expertReview:'not_run',recommendation:'not_run'};
  method.recommendationStatus='unverified';
 }
 registry.sources=[...(registry.sources||[]),...sources];
 registry.cardCatalog={schemaVersion:catalog.schemaVersion,reviewedAt:catalog.reviewedAt};
 registry.meta={...registry.meta,sourceReviewedCards:registry.methods.filter(m=>m.cardStatus==='source_reviewed').length,partiallyReviewedCards:registry.methods.filter(m=>m.cardStatus==='partial').length,reviewedCards:0,expertReviewedCards:0,validatedRecommendations:0,validatedExecutions:0};
 registry.meta.arithmeticModule='M053 기술 요약; M050 빈도; M081 Pearson r; M087 절편 포함 단순 비가중 회귀 기술 요약. 각 엔진의 제한·검사 증거는 별도 기록.';
 for(const id of ['M050','M081','M087']){
  const m=registry.methods.find(m=>m.id===id);
  m.executionStatus='limited_internal_calculation';
  m.executionScope=id==='M050'?'범주 빈도와 명시적 분모의 기술 요약; 추론 제외':id==='M081'?'완전한 쌍의 Pearson r 기술 요약; p값·구간·인과 추론 제외':'절편 포함 단순 비가중 OLS의 기술 계수·잔차·레버리지. 다변량·가중·불확실성·인과·외부 예측 미지원';
  m.verificationStatus={...m.verificationStatus,numeric:'scoped_tests_available',endToEnd:'scoped_tests_available',methodExecution:'unverified'};
 }
 return registry;
}

export async function loadRegistry(root){
 const [base,catalog]=await Promise.all(['registry.json','method-cards.json'].map(f=>readFile(join(root,'data',f),'utf8').then(JSON.parse)));
 return mergeRegistry(base,catalog);
}

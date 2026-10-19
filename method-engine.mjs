import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fitSimpleOLS, REGRESSION_ENGINE_VERSION } from './regression.mjs';

export const METHOD_ENGINE_VERSION = 'method-descriptive-1.0.0';
export const engineVersionFor = methodId => methodId === 'M087' ? REGRESSION_ENGINE_VERSION : METHOD_ENGINE_VERSION;
export const METHOD_SOURCE_EVIDENCE = Object.freeze({
  M050: [
    { organization: 'Australian Bureau of Statistics', title: 'Describing frequencies', url: 'https://www.abs.gov.au/statistics/understanding-statistics/statistical-terms-and-concepts/describing-frequencies', section: 'Definition; Measuring frequency', sourceDate: '2023-02-02', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '출현 횟수와 빈도/명시한 분모의 비율 정의. 결측 분리·두 분모는 제품 구현 정책이며 출처가 권장한 결측 처리나 타당성 검증으로 표시하지 않음.' },
    { organization: 'Australian Bureau of Statistics', title: 'Frequency distribution', url: 'https://www.abs.gov.au/statistics/understanding-statistics/statistical-terms-and-concepts/frequency-distribution', section: 'Frequency tables; Frequency graphs, bar chart', sourceDate: '2023-02-02', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '범주별 횟수 표와 범주형 막대 표현. 표집 추론·가중 추정·결측 편향 해결 근거는 아님.' },
  ],
  M081: [
    { organization: 'NIST', title: 'Dataplot CORRELATION (LET)', url: 'https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/correlat.htm', section: 'Description (Sxx, Syy, Sxy, r); Note (same number of elements)', sourceDate: '2018-09-12 (page last updated)', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '같은 행의 두 수치 변수에서 중심화 제곱합·교차합으로 Pearson 선형 상관을 계산. 원문의 p값 기능은 구현하지 않음. 완전 쌍 선택·의존성 표시는 제품 정책이고 결측 편향·연구 적합성을 승인하지 않음.' },
  ],
  M087: [
    { organization: 'NIST', title: 'Linear Least Squares Regression', url: 'https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd141.htm', section: 'Definition; Why Least Squares; Disadvantages', sourceDate: '판본 날짜 본문 미표시', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '절편 포함 비가중 단순 선형 최소제곱의 좁은 기술 구현. 이상치 민감성·외삽 위험을 확인했으며 표집·인과·외부 예측 타당성을 승인하지 않음.' },
    { organization: 'NIST', title: 'How can I tell if a model fits my data?', url: 'https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd44.htm', section: 'R squared Is Not Enough; Residuals; Graphical Residual Analysis', sourceDate: '판본 날짜 본문 미표시', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '관측값-적합값의 잔차 정의, R²만으로 적합성을 보장할 수 없다는 한계. 잔차 그림을 자동 적합성 판정으로 표시하지 않음.' },
    { organization: 'NIST', title: 'Dataplot Regression Diagnostics', url: 'https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/regrdiag.htm', section: 'Description (hat matrix and leverage vs influence); Regression Diagnostics (Column 1)', sourceDate: '판본 날짜 별도 확인 안 함', checkedDate: '2026-10-18', access: 'full_relevant_sections', scope: '레버리지=hat 행렬 대각과 영향력의 구별. 절편·단일 X의 h=1/n+(x-평균X)²/Sxx는 이 행렬의 대수적 특수화이며 독립 수치 대조한다. 임계값·이상치 자동 판정·Cook 거리·전체 진단을 구현했다고 표시하지 않음.' },
  ],
});

const KINDS = new Set(['human_observed', 'administrative', 'synthetic', 'llm_generated']);
const DEPENDENCE = new Set(['independent', 'clustered', 'repeated', 'unknown']);
const COMMON_KEYS = ['methodId', 'label', 'unit', 'analysisUnit', 'sourceLabel', 'sourceVersion', 'dataKind', 'missingPolicy', 'dependence'];
const reject = message => { throw new TypeError(message); };
function text(value, key, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) reject(`${key}: 비어 있지 않은 ${max}자 이하 문자열이 필요합니다.`);
  return value.trim();
}
function array(value, key) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10000) reject(`${key}: 1–10000개 배열이 필요합니다.`);
  return Array.from(value);
}
function canonical(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) reject('입력 객체가 필요합니다.');
  if (!['M050', 'M081', 'M087'].includes(payload.methodId)) reject('구현한 방법은 M050, M081, M087입니다.');
  const methodId = payload.methodId;
  const allowed = new Set([...COMMON_KEYS, ...(methodId === 'M050' ? ['values', 'level'] : ['pairs', 'xLabel', 'yLabel', 'xUnit', 'yUnit'])]);
  for (const key of Object.keys(payload)) if (!allowed.has(key)) reject(`지원하지 않는 입력: ${key}`);
  const input = { methodId };
  for (const key of ['label', 'unit', 'analysisUnit', 'sourceLabel', 'sourceVersion']) input[key] = text(payload[key], key);
  if (!KINDS.has(payload.dataKind)) reject('dataKind: 자료 생성 유형을 명시하십시오.');
  if (!DEPENDENCE.has(payload.dependence)) reject('dependence: 독립·군집·반복·미정 상태를 명시하십시오.');
  input.dataKind = payload.dataKind;
  input.dependence = payload.dependence;
  if (methodId === 'M050') {
    if (!['nominal', 'ordinal'].includes(payload.level)) reject('빈도 계산은 명목·서열 범주만 받습니다.');
    if (payload.missingPolicy !== 'report_separately') reject('결측을 별도 보고하는 정책을 명시하십시오.');
    input.level = payload.level;
    input.missingPolicy = payload.missingPolicy;
    input.values = array(payload.values, 'values').map(value => {
      if (value === null) return null;
      text(value, 'category', 120);
      // Preserve exact category identity; no trimming, case folding or merging.
      return value;
    });
  } else {
    if (payload.missingPolicy !== 'complete_pairs_explicit') reject('두 변수 계산에는 complete_pairs_explicit의 명시적 선택이 필요합니다.');
    input.missingPolicy = payload.missingPolicy;
    for (const key of ['xLabel', 'yLabel', 'xUnit', 'yUnit']) input[key] = text(payload[key], key);
    if (methodId === 'M087' && input.unit !== `${input.yUnit}/${input.xUnit}`) reject('회귀 기울기 단위는 Y 단위/X 단위와 일치해야 합니다.');
    input.pairs = array(payload.pairs, 'pairs').map(row => {
      if (!Array.isArray(row) || row.length !== 2) reject('각 행은 [x,y] 두 칸이어야 합니다.');
      return Array.from(row).map(value => {
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) reject('각 수치는 유한한 number 또는 null이어야 합니다. 자동 형변환하지 않습니다.');
        return value;
      });
    });
  }
  return input;
}

function sum(values) {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
}
const binaryScale = value => value === 0 ? 1 : 2 ** Math.min(1023, Math.floor(Math.log2(value)));
function centered(values) {
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered[0] === ordered.at(-1)) throw new RangeError('상수 변수에서는 Pearson r를 정의할 수 없습니다.');
  const lower = ordered[Math.floor((ordered.length - 1) / 2)];
  const upper = ordered[Math.floor(ordered.length / 2)];
  const midpoint = lower === upper ? lower : (Number.isFinite(lower + upper) ? (lower + upper) / 2 : lower + (upper - lower) / 2);
  const origin = ordered[0] < 0 && ordered.at(-1) > 0 ? 0 : midpoint;
  const shifted = values.map(value => value - origin);
  const scale = binaryScale(Math.max(...shifted.map(Math.abs)));
  const normalized = shifted.map(value => value / scale);
  if (normalized.some((value, index) => !Number.isFinite(value) || (value === 0 && shifted[index] !== 0))) throw new RangeError('안전한 수치 범위를 벗어났습니다. 단위·크기를 검토하십시오.');
  const mean = sum(normalized) / normalized.length;
  return normalized.map(value => value - mean);
}

export function analyzeMethod(payload) {
  const input = canonical(payload);
  const limitations = ['산술 실행·재현은 측정·설계·표집·연구 타당성 또는 인과 해석의 검증이 아닙니다.', '가중치·복합표집·군집·반복 구조를 반영한 추정이나 불확실성을 계산하지 않았습니다.'];
  let summary, observations;
  if (input.methodId === 'M050') {
    const counts = new Map();
    for (const value of input.values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    const total = input.values.length;
    const valid = input.values.filter(value => value !== null).length;
    if (!valid) throw new RangeError('모든 범주가 결측입니다. 유효 빈도를 계산할 수 없습니다.');
    summary = { total, valid, missing: total - valid, totalDenominator: total, validDenominator: valid, categories: [...counts].map(([category, count]) => ({ category, count, proportionTotal: count / total, proportionValid: count / valid })) };
    limitations.push('null은 결측이며 별도 집계합니다. 범주는 원문 문자열 그대로 구분하고 등장 순서로 표시합니다. 서열의 실제 순서를 추정하거나 누적 비율을 만들지 않습니다.', '전체 입력 분모와 유효 관측 분모를 함께 표시합니다. 결측을 제외한 비율이 결측 편향 해소나 모집단 비율을 뜻하지 않습니다.');
  } else if (input.methodId === 'M087') {
    ({ summary, observations } = fitSimpleOLS(input.pairs));
    limitations.push('절편 포함 비가중 단순 선형회귀의 입력 자료 내 기술 요약입니다. 완전 관측 쌍만 사용하며 원행·변수별 결측 수를 보존합니다. 결측 편향을 해소하지 않습니다.', '기울기 단위는 Y/X, 절편·잔차·기술 RMSE의 단위는 Y입니다. RMSE=sqrt(SSE/n)이며 회귀 표준오차·신뢰구간·p값을 산출하지 않습니다.', '화면·그림 눈금은 반올림합니다. 잔차는 중심화해 계산하므로 큰 값에서는 표시한 Y−적합값과 마지막 자리 차이가 있을 수 있습니다. R²·잔차·레버리지는 확인할 기술량입니다. 자동 이상치 판정·적합성 승인·인과·표집 대표성·외부 예측 검증이 아닙니다. 적합선은 관측 X 범위 안에서만 표시합니다.');
    if (summary.constantY) limitations.push('관측 Y가 모두 같아 전체 변동이 0입니다. R²는 정의하지 않고 null로 보존합니다.');
  } else {
    const complete = input.pairs.filter(row => row[0] !== null && row[1] !== null);
    if (complete.length < 2) throw new RangeError('유효 완전 쌍이 2개 이상 필요합니다.');
    const x = centered(complete.map(row => row[0]));
    const y = centered(complete.map(row => row[1]));
    const xx = sum(x.map(value => value * value));
    const yy = sum(y.map(value => value * value));
    const xy = sum(x.map((value, index) => value * y[index]));
    // Centered normalized magnitudes are bounded by 4 and n<=10000, so
    // xx*yy cannot overflow. One square root avoids multiplying two rounded roots.
    const denominator = Math.sqrt(xx * yy);
    if (!(denominator > 0) || !Number.isFinite(denominator) || !Number.isFinite(xy)) throw new RangeError('분산·교차합이 안전한 수치 범위를 벗어났습니다.');
    let r = xy / denominator;
    if (!Number.isFinite(r) || Math.abs(r) > 1 + 1e-12) throw new RangeError('상관 계산 결과가 안전한 범위를 벗어났습니다.');
    r = complete.length === 2 ? Math.sign(xy) : Math.max(-1, Math.min(1, r));
    summary = { total: input.pairs.length, complete: complete.length, missingPairs: input.pairs.length - complete.length, missingX: input.pairs.filter(row => row[0] === null).length, missingY: input.pairs.filter(row => row[1] === null).length, denominator: complete.length, r, n2Boundary: complete.length === 2 };
    limitations.push('명시적으로 선택한 완전 쌍만 r 계산에 사용합니다. 원래 행과 null은 보존하며 누락 쌍 수를 보고합니다. 결측 기제·선택 편향을 검증하지 않았습니다.', 'Pearson r는 입력 쌍의 선형 연관 요약이며 항상 무차원입니다. 입력 unit은 별도 기록이고 X·Y의 실제 측정 단위는 xUnit·yUnit으로 표시합니다. p값·신뢰구간·모집단 추론·효과·인과·예측 성능은 산출하지 않습니다.');
    if (summary.n2Boundary) limitations.push('유효 n=2 경계 사례입니다. 두 비상수 쌍의 r=±1은 대수적 결과이며 안정성·유의성·재현성의 증거가 아닙니다.');
  }
  if (input.dependence !== 'independent') limitations.push(`관측 의존성은 ${input.dependence}로 기록되었습니다. 현재 수치는 해당 구조를 보정하지 않은 기술 요약입니다.`);
  const synthetic = ['synthetic', 'llm_generated'].includes(input.dataKind);
  if (synthetic) limitations.push('합성·LLM 생성 자료입니다. 실제 인간 관측·인간 모집단의 분포·연관·효과로 표시하지 마십시오.');
  return { methodId: input.methodId, engineVersion: engineVersionFor(input.methodId), input, summary, ...(observations ? {observations} : {}), uncertainty: 'none', synthetic, generatedAt: new Date().toISOString(), limitations, sourceEvidence: structuredClone(METHOD_SOURCE_EVIDENCE[input.methodId]) };
}

function verify(result) {
  const checked = analyzeMethod(result?.input);
  if (result.methodId !== checked.methodId || result.engineVersion !== checked.engineVersion || JSON.stringify(result.summary) !== JSON.stringify(checked.summary)) reject('현재 엔진의 재계산 결과와 저장된 요약이 일치하지 않습니다.');
  if (typeof result.generatedAt !== 'string' || !Number.isFinite(Date.parse(result.generatedAt))) reject('생성 일시가 필요합니다.');
  checked.generatedAt = result.generatedAt;
  if (result.contextFingerprint !== undefined) checked.contextFingerprint = text(result.contextFingerprint, 'contextFingerprint');
  return checked;
}
const xml = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const kind = input => ({ human_observed: '인간 관측', administrative: '행정·관찰 기록', synthetic: '합성(실제 연구 결과 아님)', llm_generated: 'LLM 생성(실제 인간 응답 아님)' })[input.dataKind];
const fmt = value => String(value);
function caption(result, raw) {
  const i = result.input;
  const s = result.summary;
  if (result.methodId === 'M087') return `${i.label} (M087). 절편 포함 비가중 단순 선형회귀 기술 요약. 분석 단위: ${i.analysisUnit}; X=${i.xLabel}(${i.xUnit}), Y=${i.yLabel}(${i.yUnit}); 기울기=${s.slope}(${i.unit}); 절편=${s.intercept}(${i.yUnit}); R²=${s.rSquared === null ? '정의 불가(상수 Y)' : s.rSquared}(무차원); SSE=${s.sse}(${i.yUnit}²); 기술 RMSE=sqrt(SSE/n)=${s.rmse}(${i.yUnit}). 전체 행=${s.total}, 완전 쌍 분모=${s.denominator}, 누락 쌍=${s.missingPairs}, X 결측=${s.missingX}, Y 결측=${s.missingY}. ${raw ? '관측 점·적합선(관측 X 범위만)·적합값 대 잔차를 표시. 레버리지는 무차원이며 이상치 자동 판정 없음.' : '공개 요약: 개별 관측·적합값·잔차·레버리지 행과 분포는 제외.'} 불확실성 미추정; p값·신뢰구간·오차막대·가중·군집 보정 없음. 자료 생성: ${kind(i)}; 의존성: ${i.dependence}. 출처: ${i.sourceLabel}; 판본: ${i.sourceVersion}; 엔진: ${result.engineVersion}; 생성: ${result.generatedAt}. 산술은 연구 타당성·인과·외부 예측 성능의 검증이 아님.`;
  return `${i.label} (${result.methodId}). 분석 단위: ${i.analysisUnit}; ${result.methodId === 'M050' ? `수량 단위 입력 기록: ${i.unit}` : `상관계수 r 단위: 무차원; unit 입력 기록: ${i.unit}(r의 단위 아님)`}. ${result.methodId === 'M050' ? `범주별 관측 빈도; 전체 분모=${s.totalDenominator}, 유효 분모=${s.validDenominator}, 결측=${s.missing}; null은 별도 집계. 막대 길이는 관측 횟수이며 범주 순서는 첫 등장 순서.` : `${raw ? '점 하나는 같은 행의 완전 관측 쌍. 겹친 쌍은 겹쳐 표시.' : '공개용 상관 요약. 개별 관측 점·분포는 포함하지 않음.'} X=${i.xLabel}(${i.xUnit}); Y=${i.yLabel}(${i.yUnit}); 전체 행=${s.total}, 완전 쌍 분모=${s.denominator}, 누락 쌍=${s.missingPairs}, X 결측=${s.missingX}, Y 결측=${s.missingY}; r=${fmt(s.r)}. ${s.n2Boundary ? 'n=2 경계: ±1은 대수적 결과.' : ''}`} 불확실성 추정 안 함; p값·신뢰구간·오차막대 없음. 자료 생성: ${kind(i)}; 의존성: ${i.dependence}. 출처: ${i.sourceLabel}; 판본: ${i.sourceVersion}. 엔진: ${result.engineVersion}; 생성: ${result.generatedAt}. 산술 실행은 연구 타당성·인과 검증이 아님.`;
}
function position(values, minimum, maximum, start, extent) {
  if (minimum === maximum) return values.map(() => start + extent / 2);
  const range = maximum - minimum;
  const scale = binaryScale(Math.max(Math.abs(minimum), Math.abs(maximum)));
  return values.map(value => start + (Number.isFinite(range) ? (value - minimum) / range : ((value / scale) - (minimum / scale)) / ((maximum / scale) - (minimum / scale))) * extent);
}
function svg(result, raw) {
  const i = result.input;
  const s = result.summary;
  const description = caption(result, raw);
  let body;
  let chartHeight;
  if (result.methodId === 'M050') {
    chartHeight = Math.max(160, s.categories.length * 30 + 60);
    const maximum = Math.max(...s.categories.map(row => row.count));
    body = s.categories.map((row, index) => `<g><title>${xml(`${row.category}: ${row.count}; 전체분모비율=${row.proportionTotal}; 유효분모비율=${row.proportionValid}`)}</title><text x="25" y="${80 + index * 30}" font-size="12">${xml(row.category.length > 20 ? row.category.slice(0, 18) + '…' : row.category)}</text><rect x="205" y="${64 + index * 30}" width="${(row.count / maximum * 470).toFixed(4)}" height="20" fill="#56758b" stroke="#142936"/><text x="690" y="${80 + index * 30}" font-size="12">${row.count}</text></g>`).join('\n');
    body += `<text x="205" y="${chartHeight - 5}" font-size="12">관측 횟수 (0–${maximum}) · 범주 순서: 첫 등장</text>`;
  } else if (raw && result.methodId === 'M087') {
    chartHeight = 700;
    const rows = result.observations;
    const xs = rows.map(r => r.x), ys = rows.flatMap(r => [r.y, r.fitted]);
    const xp = values => position(values, Math.min(...xs), Math.max(...xs), 100, 580);
    const yp = values => position(values, Math.min(...ys), Math.max(...ys), 290, -200);
    const x = xp(xs), y = yp(rows.map(r => r.y));
    const ends = [...rows].sort((a,b) => a.x-b.x);
    const lineX = xp([ends[0].x, ends.at(-1).x]), lineY = yp([ends[0].fitted, ends.at(-1).fitted]);
    body = `<path d="M100 70V300H700" stroke="#142936" fill="none"/><text x="100" y="60">관측과 적합선 · Y (${xml(i.yUnit)})</text><text x="400" y="340" text-anchor="middle">${xml(i.xLabel)} (${xml(i.xUnit)})</text><path data-fit-line="true" d="M${lineX[0]} ${lineY[0]}L${lineX[1]} ${lineY[1]}" stroke="#9d5729" stroke-width="2" fill="none"/>`;
    body += rows.map((r,k) => `<circle data-observation="${r.rowIndex}" cx="${x[k]}" cy="${y[k]}" r="4" fill="#245880"><title>${xml(`행 ${r.rowIndex}: X=${r.x}; Y=${r.y}; 적합=${r.fitted}`)}</title></circle>`).join('\n');
    const fitted = rows.map(r=>r.fitted), residuals = rows.map(r=>r.residual);
    const rx = position(fitted,Math.min(...fitted),Math.max(...fitted),100,580);
    const minR = Math.min(0,...residuals), maxR = Math.max(0,...residuals);
    const ry = position(residuals,minR,maxR,620,-200), zero = position([0],minR,maxR,620,-200)[0];
    body += `<path d="M100 400V630H700" stroke="#142936" fill="none"/><path d="M100 ${zero}H700" stroke="#aaa" stroke-dasharray="4 4"/><text x="100" y="390">잔차 (${xml(i.yUnit)}) · 자동 판정 없음</text><text x="400" y="670" text-anchor="middle">적합값 (${xml(i.yUnit)})</text>`;
    body += rows.map((r,k) => `<circle data-residual="${r.rowIndex}" cx="${rx[k]}" cy="${ry[k]}" r="4" fill="#56758b"><title>${xml(`행 ${r.rowIndex}: 적합=${r.fitted}; 잔차=${r.residual}; 레버리지=${r.leverage}`)}</title></circle>`).join('\n');
    const tick = value => String(Number(value.toPrecision(4)));
    for (const [label,xPos,yPos] of [[tick(Math.min(...xs)),100,320],[tick(Math.max(...xs)),680,320],[tick(Math.min(...ys)),25,290],[tick(Math.max(...ys)),25,85],[tick(Math.min(...fitted)),100,650],[tick(Math.max(...fitted)),680,650],[tick(minR),25,620],[tick(maxR),25,420]]) body += `<text x="${xPos}" y="${yPos}" font-size="11">${xml(label)}</text>`;
  } else if (raw) {
    chartHeight = 370;
    const complete = i.pairs.flatMap((row, index) => row.every(value => value !== null) ? [{ x: row[0], y: row[1], index }] : []);
    const xs = complete.map(row => row.x);
    const ys = complete.map(row => row.y);
    const x = position(xs, Math.min(...xs), Math.max(...xs), 100, 580);
    const y = position(ys, Math.min(...ys), Math.max(...ys), 300, -220);
    body = `<path d="M100 70V310H700" stroke="#142936" fill="none"/><text x="400" y="350" text-anchor="middle">${xml(i.xLabel)} (${xml(i.xUnit)})</text><text x="20" y="60">${xml(i.yLabel)} (${xml(i.yUnit)})</text>`;
    body += complete.map((row, index) => `<circle data-observation="${row.index + 1}" cx="${x[index].toFixed(4)}" cy="${y[index].toFixed(4)}" r="4" fill="#245880" fill-opacity="0.6"><title>${xml(`행 ${row.index + 1}: ${i.xLabel}=${row.x} ${i.xUnit}; ${i.yLabel}=${row.y} ${i.yUnit}`)}</title></circle>`).join('\n');
    body += `<text x="100" y="330" font-size="11">${xml(fmt(Math.min(...xs)))}</text><text x="680" y="330" text-anchor="end" font-size="11">${xml(fmt(Math.max(...xs)))}</text><text x="35" y="305" font-size="11">${xml(fmt(Math.min(...ys)))}</text><text x="35" y="85" font-size="11">${xml(fmt(Math.max(...ys)))}</text>`;
  } else {
    chartHeight = 140;
    body = result.methodId === 'M087' ? `<text x="35" y="80" font-size="20">기울기=${xml(s.slope)} (${xml(i.unit)}), 절편=${xml(s.intercept)} (${xml(i.yUnit)})</text><text x="35" y="110">R²=${xml(s.rSquared === null ? '정의 불가' : s.rSquared)} · 공개 요약; 행별 진단·점·분포 제외</text>` : `<text x="35" y="90" font-size="24">Pearson r = ${xml(fmt(s.r))}</text><text x="35" y="125">공개용 요약 · 개인 점과 분포 제외</text>`;
  }
  const lines = description.match(/.{1,75}/gu) ?? [];
  const height = chartHeight + 45 + lines.length * 23;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-labelledby="title description"><title id="title">${xml(i.label)}</title><desc id="description">${xml(description)}</desc><rect width="800" height="${height}" fill="white"/><g font-family="sans-serif" fill="#142936"><text x="25" y="30" font-size="18">${xml(i.label.length > 55 ? i.label.slice(0, 52) + '…' : i.label)}</text>${body}${lines.map((line, index) => `<text x="25" y="${chartHeight + 35 + index * 23}" font-size="12">${xml(line)}</text>`).join('\n')}</g></svg>`;
}
export function buildMethodFigure(result) { return svg(verify(result), true); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(content);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const json = value => JSON.stringify(value, null, 2) + '\n';
function publicMetadata(input) { return Object.fromEntries(Object.entries(input).filter(([key]) => !['pairs', 'values'].includes(key))); }
function publicProject(project) {
  const safe = {};
  for (const key of ['id', 'schemaVersion', 'version', 'title']) {
    const value = project[key];
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
  }
  if (Array.isArray(project.selectedMethods)) safe.selectedMethods = project.selectedMethods.filter(value => typeof value === 'string');
  return safe;
}
export function buildMethodBundle(project, result, options = { includeData: false }) {
  const checked = verify(result);
  if (!project || typeof project !== 'object' || Array.isArray(project)) reject('project 객체가 필요합니다.');
  if (!options || typeof options !== 'object' || (options.includeData !== undefined && typeof options.includeData !== 'boolean')) reject('includeData는 boolean이어야 합니다.');
  const includeData = options.includeData === true;
  const { input, observations: privateObservations, ...publicResult } = checked;
  const metadata = publicMetadata(input);
  const projectMetadata = publicProject(project);
  const provenance = {
    project: projectMetadata,
    contextFingerprint: checked.contextFingerprint ?? null,
    validity: {
      researchDesign: 'not_verified',
      numericalReproduction: includeData ? 'offline_recalculation_procedure_available' : 'partial_raw_input_required',
      claimValidity: 'not_verified',
      authentication: 'not_authenticated',
    },
    notice: '프로젝트 판본·연구설계 지문은 생성 관계 기록입니다. 지문·파일 SHA-256은 변조방지 인증이나 신원 인증이 아니며, 연구설계·주장 타당성을 승인하지 않습니다. 수치 재계산 성공도 별도 근거가 필요한 설계·주장 검증으로 승격하지 않습니다.',
  };
  const settings = { methodId: checked.methodId, missingPolicy: input.missingPolicy, dependence: input.dependence, uncertainty: 'none', inference: 'none', rawDataIncluded: includeData, privacy: includeData ? 'private_unencrypted' : 'public_summary_review_required', figure: checked.methodId === 'M050' ? 'category_counts' : checked.methodId === 'M087' ? (includeData ? 'complete_pair_fit_and_residuals' : 'ols_scalar_summary_only') : includeData ? 'complete_pair_scatter' : 'r_summary_only', random: 'not_used' };
  const files = {
    'analysis.json': json(includeData ? checked : { ...publicResult, metadata }),
    'project.json': json(includeData ? project : projectMetadata),
    'provenance.json': json(provenance),
    'figure.svg': svg(checked, includeData),
    'caption.txt': caption(checked, includeData) + '\n',
    'settings.json': json(settings),
    'metadata.json': json(metadata),
    'sources.json': json({ methodEvidence: checked.sourceEvidence, inputSource: { label: input.sourceLabel, version: input.sourceVersion, status: 'user_provided_not_independently_verified' }, researchValidity: 'not_verified' }),
    'environment.json': json({ runtime: 'Node.js', exportedFromNode: process.version, engineVersion: checked.engineVersion, dependencies: 'Node.js built-ins only', random: 'not_used' }),
    'limitations.txt': checked.limitations.join('\n') + '\n',
    'README.md': `# ${checked.methodId} 기술 요약 묶음\n\n${includeData ? '원자료 포함 비공개용입니다. 암호화되지 않았으며 project.json에 전체 프로젝트가 포함됩니다. 풀어낸 폴더에서 `node reproduce.mjs`를 실행하면 원자료 JSON을 재계산하고 저장 요약과 비교합니다. 파일 SHA-256과 원자료 일치도 검사합니다.' : '공개용 요약입니다. project.json에는 id·schemaVersion·version·title·문자열 selectedMethods만 포함합니다. 전체 프로젝트·원자료·개별 산점도 점은 제외합니다. 원자료가 없어 완전 재현할 수 없습니다. 범주 이름·작은 빈도·상관·메타데이터도 민감할 수 있으므로 공유 적합성을 검토하십시오.'}\n\n${provenance.notice}\n\n${checked.limitations.join('\n\n')}\n\n공식 출처는 정의와 수식의 해당 절만 확인했습니다. 출처 확인·산술 재현·추천 검증·연구 타당성은 서로 다른 상태입니다. SVG의 한글 글꼴·물리적 크기·투고처 요구는 사용 환경에서 확인하십시오.\n`,
  };
  if (includeData) {
    files['input.json'] = json(input);
    files['method-engine.mjs'] = readFileSync(new URL(import.meta.url), 'utf8');
    files['regression.mjs'] = readFileSync(new URL('./regression.mjs', import.meta.url), 'utf8');
    files['reproduce.mjs'] = `import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {analyzeMethod} from './method-engine.mjs';
const read = name => readFileSync(new URL(name,import.meta.url),'utf8');
const manifest = JSON.parse(read('manifest.json'));
for(const [name, expected] of Object.entries(manifest.files)) if(createHash('sha256').update(read(name)).digest('hex') !== expected.sha256) throw Error('File hash mismatch: '+name);
const stored = JSON.parse(read('analysis.json'));
const input = JSON.parse(read('input.json'));
if(JSON.stringify(input) !== JSON.stringify(stored.input)) throw Error('Input copy mismatch');
const actual = analyzeMethod(input);
const compare = (a,b) => {
 if(typeof a === 'number') return typeof b === 'number' && Number.isFinite(b) && Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a));
 if(a===null || typeof a!=='object') return a===b;
 return b!==null && typeof b==='object' && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(key=>compare(a[key],b[key]));
};
if(!compare(stored.summary,actual.summary)) throw Error('Summary mismatch');
console.log(JSON.stringify({status:'PASS',methodId:actual.methodId,summary:actual.summary,researchValidity:'not_verified'}));
`;
  }
  files['manifest.json'] = json({ format: 'research-workbench-method-bundle-1', engineVersion: checked.engineVersion, methodId: checked.methodId, generatedAt: checked.generatedAt, projectVersion: typeof project.version === 'number' ? project.version : null, dataIncluded: includeData, reproduction: includeData ? 'offline_arithmetic_only' : 'partial_raw_input_required', researchValidity: 'not_verified', metadata, files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) }])) });
  return zip(files);
}

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const ENGINE_VERSION = 'descriptive-1.0.1';
const DATA_KINDS = new Set(['human_observed', 'administrative', 'synthetic', 'llm_generated']);
const LIMITATIONS = [
  '단일 수치 변수의 기술 요약입니다. 표집·가중치·군집·대응 구조를 반영한 모집단 추론은 수행하지 않았습니다.',
  '결측값은 null로 보존하고 수치 계산에서 제외합니다. 결측 이유·편향·처리 가정은 검증하지 않았습니다.',
  '표본 표준편차는 유효 관측 2개 이상에서 n−1을 분모로 계산합니다. 신뢰구간·오차막대는 추정하지 않았습니다.',
  '산술 재현은 측정·설계·인과·해석·연구 타당성 또는 출처 지지의 검증이 아닙니다.',
];

function metadata(value, key) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new TypeError(`${key}: 1–500자의 비어 있지 않은 문자열이 필요합니다.`);
  }
  return value.trim();
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

// Binary scaling does not perturb the represented significand. Shifting first
// preserves small differences when a variable has a large common offset.
function binaryScale(maximum) {
  return maximum === 0 ? 1 : 2 ** Math.min(1023, Math.floor(Math.log2(maximum)));
}

/** Descriptive arithmetic only; null never becomes zero or an observed response. */
export function analyze(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.values) || payload.values.length < 1 || payload.values.length > 10000) {
    throw new TypeError('values: 1–10000개의 수치 또는 null 배열이 필요합니다.');
  }
  const values = Array.from(payload.values);
  if (values.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
    throw new TypeError('관측값은 유한한 number 또는 null이어야 합니다. 자동 형변환하지 않습니다.');
  }
  const label = metadata(payload.label, 'label');
  const unit = metadata(payload.unit, 'unit');
  const sourceLabel = metadata(payload.sourceLabel, 'sourceLabel');
  const sourceVersion = metadata(payload.sourceVersion, 'sourceVersion');
  if (!DATA_KINDS.has(payload.dataKind)) throw new TypeError('dataKind: 자료 생성 유형을 명시해야 합니다.');
  const observed = values.filter(value => value !== null).sort((a, b) => a - b);
  const n = observed.length;
  if (!n) throw new RangeError('모든 값이 결측입니다. 수치 요약을 계산할 수 없습니다.');
  const lower = observed[Math.floor((n - 1) / 2)];
  const upper = observed[Math.floor(n / 2)];
  const midpointSum = lower + upper;
  const median = lower === upper ? lower : (Number.isFinite(midpointSum) ? midpointSum / 2 : lower + (upper - lower) / 2);
  // A zero origin for mixed signs avoids an overflowing subtraction and keeps
  // cancellation visible to compensated summation. Same-sign centered values
  // avoid subtracting two rounded normalized measurements near one.
  const origin = observed[0] < 0 && observed[n - 1] > 0 ? 0 : median;
  const shifted = observed.map(value => value - origin);
  const scale = binaryScale(Math.max(...shifted.map(Math.abs)));
  const normalized = shifted.map(value => value / scale);
  if (normalized.some((value, index) => !Number.isFinite(value) || (value === 0 && shifted[index] !== 0))) {
    throw new RangeError('수치 범위를 벗어난 계산입니다. 단위를 조정한 뒤 다시 계산하십시오.');
  }
  const normalizedMean = sum(normalized) / n;
  const mean = origin + normalizedMean * scale;
  const sampleSD = n < 2 ? null : Math.sqrt(sum(normalized.map(value => (value - normalizedMean) ** 2)) / (n - 1)) * scale;
  if (![mean, median, ...(sampleSD === null ? [] : [sampleSD])].every(Number.isFinite)) {
    throw new RangeError('수치 범위를 벗어난 계산입니다. 단위를 조정한 뒤 다시 계산하십시오.');
  }
  return {
    engineVersion: ENGINE_VERSION, label, unit, sourceLabel, sourceVersion,
    dataKind: payload.dataKind, values,
    summary: { n, missing: values.length - n, denominator: values.length, mean, median, sampleSD, min: observed[0], max: observed[n - 1] },
    uncertainty: 'none', synthetic: ['synthetic', 'llm_generated'].includes(payload.dataKind),
    limitations: [...LIMITATIONS, ...(['synthetic', 'llm_generated'].includes(payload.dataKind)
      ? ['합성·LLM 생성 자료입니다. 실제 인간의 관측 결과·효과·모집단 분포로 해석하지 마십시오.'] : [])],
  };
}

const xml = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const format = value => value === null ? '산출 불가(n<2)' : Number(value).toPrecision(7).replace(/\.0+(?=e|$)/u, '');
const kindName = kind => ({ human_observed: '인간 관측', administrative: '행정·관찰 기록', synthetic: '합성 자료(실제 연구 결과 아님)', llm_generated: 'LLM 생성 자료(실제 인간 응답 아님)' })[kind];

function verifiedAnalysis(analysis) {
  const recalculated = analyze(analysis);
  if (JSON.stringify(recalculated.summary) !== JSON.stringify(analysis.summary) || analysis.engineVersion !== ENGINE_VERSION) {
    throw new TypeError('현재 엔진으로 재계산한 요약과 분석 기록이 일치하지 않습니다.');
  }
  return recalculated;
}

function captionFor(analysis, raw) {
  const s = analysis.summary;
  return `${analysis.label}. ${raw ? '점 하나는 입력한 유효 관측값 하나이며 겹친 값은 겹쳐 표시됩니다.' : '공개용 평균 요약이며 개인 관측값·분포를 포함하지 않습니다.'} 단위: ${analysis.unit}. 유효 n=${s.n}; 전체 입력 분모=${s.denominator}; 결측=${s.missing}(계산 제외). 평균=${format(s.mean)}. 불확실성: 추정하지 않음; 오차막대·신뢰구간 없음. 자료 유형: ${kindName(analysis.dataKind)}. 출처: ${analysis.sourceLabel}; 판본: ${analysis.sourceVersion}. 엔진: ${analysis.engineVersion}. 연구 타당성은 검증하지 않았습니다.`;
}

function figure(analysis, raw) {
  const s = analysis.summary;
  const range = s.max - s.min;
  const scale = binaryScale(Math.max(Math.abs(s.min), Math.abs(s.max)));
  const position = value => range === 0 ? 400 : 85 + (Number.isFinite(range)
    ? (value - s.min) / range
    : ((value / scale) - (s.min / scale)) / ((s.max / scale) - (s.min / scale))) * 630;
  const caption = captionFor(analysis, raw);
  const points = raw ? analysis.values.flatMap((value, index) => value === null ? [] : [
    `<circle cx="${position(value).toFixed(4)}" cy="115" r="4" fill="#245880" fill-opacity="0.45" data-observation="${index + 1}"><title>${xml(`${index + 1}번째 관측: ${value} ${analysis.unit}`)}</title></circle>`,
  ]).join('\n') : '';
  const captionLines = [
    `${raw ? '입력 관측값 점도표' : '공개용 평균 요약'} · 단위: ${analysis.unit}`,
    `유효 n=${s.n} / 전체 입력 ${s.denominator} · 결측 ${s.missing}(계산 제외) · 평균 ${format(s.mean)}`,
    '불확실성 추정 안 함 · 오차막대·신뢰구간 없음',
    `자료 유형: ${kindName(analysis.dataKind)}`,
    `출처: ${analysis.sourceLabel} · 판본: ${analysis.sourceVersion}`,
    `엔진 ${analysis.engineVersion} · 연구 타당성 미검증`,
  ];
  // The complete accessible caption and external caption.txt retain long metadata.
  const visibleLines = captionLines.map(line => line.length > 85 ? `${line.slice(0, 82)}… (전체 설명 참조)` : line);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400" role="img" aria-labelledby="figure-title figure-description">
<title id="figure-title">${xml(analysis.label)}</title><desc id="figure-description">${xml(caption)}</desc>
<rect width="800" height="400" fill="white"/>
<g font-family="sans-serif" fill="#172c3d"><text x="35" y="35" font-size="20">${xml(analysis.label.length > 60 ? `${analysis.label.slice(0, 57)}…` : analysis.label)}</text>
<line x1="85" x2="715" y1="150" y2="150" stroke="#172c3d"/>
${points}
<path d="M ${position(s.mean).toFixed(4)} 135 l -6 -10 h 12 z" fill="#8a3418"><title>${xml(`평균 ${s.mean} ${analysis.unit}`)}</title></path>
<text x="85" y="174" font-size="12">${xml(format(s.min))}</text><text x="715" y="174" text-anchor="end" font-size="12">${xml(format(s.max))}</text>
${visibleLines.map((line, index) => `<text x="35" y="${215 + index * 27}" font-size="13">${xml(line)}</text>`).join('\n')}
</g></svg>`;
}

export function buildFigure(analysis) { return figure(verifiedAnalysis(analysis), true); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name, 'utf8');
    const bytes = Buffer.from(content, 'utf8');
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(33, 12); // DOS date: 1980-01-01; stable archive bytes.
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

const json = value => JSON.stringify(value, null, 2) + '\n';
export function buildBundle(project, analysis, registryMeta, options = { includeData: false }) {
  const checked = verifiedAnalysis(analysis);
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw new TypeError('project 객체가 필요합니다.');
  if (!options || typeof options !== 'object' || (options.includeData !== undefined && typeof options.includeData !== 'boolean')) throw new TypeError('includeData는 명시적인 boolean이어야 합니다.');
  const includeData = options.includeData === true;
  const { values, ...publicAnalysis } = checked;
  const projectMetadata = Object.fromEntries(['id', 'schemaVersion', 'version', 'title', 'selectedMethods'].filter(key => project?.[key] !== undefined).map(key => [key, project[key]]));
  const settings = { figure: includeData ? 'observed_points_with_mean' : 'mean_only', uncertainty: 'none', missing: 'preserve_null_exclude_from_arithmetic', sampleSD: 'n_minus_1', privacy: includeData ? 'private_raw_data_opt_in' : 'public_summary', random: 'none', engineVersion: ENGINE_VERSION };
  const exportedLimitations = [...checked.limitations, ...(includeData ? ['원자료 포함 비공개용 묶음입니다. 암호화되지 않았으며 공유 전 접근 권한과 비식별 여부를 검토해야 합니다.'] : ['공개용 묶음은 원자료·개별 점·전체 프로젝트를 제외합니다. 평균·범위·요약 수치는 남으므로 공개 가능 여부를 검토하십시오. 원자료가 없어 계산을 완전히 재현할 수 없습니다.'])];
  const files = {
    'analysis.json': json(includeData ? checked : publicAnalysis),
    'project.json': json(includeData ? project : projectMetadata),
    'figure.svg': figure(checked, includeData),
    'caption.txt': captionFor(checked, includeData) + '\n',
    'summary.csv': 'n,missing,denominator,mean,median,sampleSD,min,max\n' + Object.values(checked.summary).map(value => value ?? '').join(',') + '\n',
    'settings.json': json(settings),
    'sources.json': json({ dataSource: { label: checked.sourceLabel, version: checked.sourceVersion, dataKind: checked.dataKind, reviewStatus: 'user_provided_not_independently_verified' }, registry: registryMeta ?? null, scientificSourceReview: 'not_performed_by_arithmetic_engine' }),
    'environment.json': json({ runtime: 'Node.js', exportedFromNode: process.version, engineVersion: ENGINE_VERSION, dependencies: 'Node.js built-ins only', random: 'not_used', portability: 'offline reproduce.mjs requires Node.js with ES module support; exported runtime recorded, other versions not certified' }),
    'limitations.txt': exportedLimitations.join('\n') + '\n',
    'README.md': `# 연구 수치 요약 묶음\n\n${includeData ? '원자료 포함 비공개용 묶음입니다. 암호화되지 않았습니다.\n\n압축을 푼 폴더에서 `node reproduce.mjs`를 실행하면 저장된 기술 요약을 재계산하고 허용오차 1e-12로 비교합니다. data.csv와 analysis.json의 입력 일치, 엔진 파일의 SHA-256도 검사합니다.' : '공개용 요약 묶음입니다. 원자료와 개인 점은 포함하지 않습니다. 원자료가 없으므로 완전 재계산은 불가능합니다.'}\n\n${exportedLimitations.join('\n\n')}\n\nfigure.svg의 전체 설명은 접근성 설명(desc)과 caption.txt에 보존되어 있습니다. 사용 환경의 한글 글꼴과 출력 크기는 투고 전에 확인하십시오. 생성 일시는 manifest.json의 generatedAt을 참조하십시오.\n`,
  };
  if (includeData) {
    files['data.csv'] = 'observation,value,status\n' + values.map((value, index) => `${index + 1},${value === null ? '' : value},${value === null ? 'missing' : 'observed'}`).join('\n') + '\n';
    files['calculation.mjs'] = readFileSync(new URL(import.meta.url), 'utf8');
    files['reproduce.mjs'] = `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyze } from './calculation.mjs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
for (const [name, expected] of Object.entries(manifest.files)) {
  if (createHash('sha256').update(read(name)).digest('hex') !== expected.sha256) throw new Error('File hash mismatch: ' + name);
}
const stored = JSON.parse(read('analysis.json'));
const rows = read('data.csv').trimEnd().split(/\\r?\\n/).slice(1);
const values = rows.map((row, index) => {
  const [number, value, status] = row.split(',');
  if (number !== String(index + 1) || !['missing', 'observed'].includes(status) || (status === 'missing' && value !== '') || (status === 'observed' && value === '')) throw new Error('Invalid CSV row');
  return status === 'missing' ? null : Number(value);
});
if (JSON.stringify(values) !== JSON.stringify(stored.values)) throw new Error('CSV and analysis inputs differ');
const actual = analyze({ ...stored, values });
for (const [key, expected] of Object.entries(stored.summary)) {
  const result = actual.summary[key];
  if (expected === null ? result !== null : !Number.isFinite(result) || Math.abs(result - expected) > 1e-12 * Math.max(1, Math.abs(expected))) throw new Error('Summary mismatch: ' + key);
}
console.log(JSON.stringify({ status: 'PASS', engineVersion: actual.engineVersion, summary: actual.summary, scientificValidity: 'not_verified' }));
`;
  }
  files['manifest.json'] = json({ format: 'research-workbench-bundle-1', generatedAt: options.generatedAt ?? new Date().toISOString(), projectVersion: project?.version ?? null, engineVersion: ENGINE_VERSION, dataIncluded: includeData, privacy: settings.privacy, reproducibility: includeData ? 'offline_arithmetic_recalculation' : 'summary_only_raw_data_required', scientificValidity: 'not_verified', caption: 'caption.txt', unit: checked.unit, denominator: checked.summary.denominator, uncertainty: 'none', sourceVersion: checked.sourceVersion, files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content, 'utf8') }])) });
  return zip(files);
}

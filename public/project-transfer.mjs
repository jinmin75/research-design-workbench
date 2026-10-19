// Portable project data only. This envelope is not a research-validity certificate.
// Leave room for the POST {backup: envelope} wrapper under the server's 2 MB cap.
export const PROJECT_BACKUP_LIMIT = 1_900_000;
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function encode(value) {
  let serialized;
  try { serialized = JSON.stringify(value, (key, item) => key === 'figureSvg' ? undefined : item); }
  catch { throw Error('백업을 JSON으로 읽을 수 없습니다. 순환 참조가 없는 프로젝트를 사용해 주세요.'); }
  if (!serialized || new TextEncoder().encode(serialized).length > PROJECT_BACKUP_LIMIT) throw Error('프로젝트 백업은 1.9 MB 이하여야 합니다.');
  return serialized;
}
function safeTree(value, depth = 0) {
  if (depth > 60) throw Error('백업의 중첩 구조가 너무 깊습니다.');
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('허용되지 않는 백업 속성입니다.');
    safeTree(item, depth + 1);
  }
}
export function readProjectBackup(backup) {
  const envelope = typeof backup === 'string' ? (() => {
    if (new TextEncoder().encode(backup).length > PROJECT_BACKUP_LIMIT) throw Error('프로젝트 백업은 1.9 MB 이하여야 합니다.');
    try { return JSON.parse(backup); } catch { throw Error('JSON 백업 파일을 읽을 수 없습니다.'); }
  })() : backup;
  const copy = JSON.parse(encode(envelope));
  safeTree(copy);
  if (copy?.format !== 'research-workbench-project' || copy.formatVersion !== '1.0') throw Error('지원하는 연구 작업실 프로젝트 백업(1.0)이 아닙니다.');
  if (typeof copy.exportedAt !== 'string' || !Number.isFinite(Date.parse(copy.exportedAt))) throw Error('백업 생성 시각이 올바르지 않습니다.');
  const project = copy.project;
  if (!isObject(project) || typeof project.title !== 'string') throw Error('백업에 프로젝트 제목과 자료가 필요합니다.');
  if (project.schemaVersion !== undefined && !['1.0', '1.0.0'].includes(project.schemaVersion)) throw Error('지원하지 않는 프로젝트 자료 판본입니다.');
  if (project.id !== undefined && typeof project.id !== 'string') throw Error('프로젝트 식별자 형식이 올바르지 않습니다.');
  if (project.version !== undefined && (!Number.isInteger(project.version) || project.version < 0)) throw Error('프로젝트 판본 형식이 올바르지 않습니다.');
  for (const key of ['selectedMethods', 'qualitative', 'integration', 'unregisteredMethods', 'nodes', 'edges', 'history']) {
    if (project[key] !== undefined && !Array.isArray(project[key])) throw Error(`${key}: 목록 형식이 필요합니다.`);
  }
  for (const key of ['qualitative', 'integration', 'nodes', 'edges', 'history']) {
    if (project[key]?.some(row => !isObject(row))) throw Error(`${key}: 각 행은 비어 있지 않은 자료 객체여야 합니다.`);
  }
  if (project.selectedMethods?.some(id => typeof id !== 'string')) throw Error('선택한 방법은 문자열 목록이어야 합니다.');
  if (project.nodes?.some(node => typeof node.id !== 'string' || !node.id.trim())) throw Error('변경 추적 노드의 식별자가 필요합니다.');
  if (project.edges?.some(edge => typeof (edge.from || edge.source) !== 'string' || !(edge.from || edge.source).trim() || typeof (edge.to || edge.target) !== 'string' || !(edge.to || edge.target).trim())) throw Error('변경 추적 연결의 시작과 끝 식별자가 필요합니다.');
  if (project.decisionWorkspace !== undefined && !isObject(project.decisionWorkspace)) throw Error('연구 안내 기록 형식이 올바르지 않습니다.');
  return project;
}
export function createProjectBackup(project) {
  const envelope = { format: 'research-workbench-project', formatVersion: '1.0', exportedAt: new Date().toISOString(), project };
  return { ...JSON.parse(encode(envelope)), project: readProjectBackup(envelope) };
}

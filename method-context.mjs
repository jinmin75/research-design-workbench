import {analyzeMethod} from './method-engine.mjs';

// Parsing mirrors the visible entry format; the engine still validates all
// numeric types, policies and metadata independently.
export function workspacePayload(w){
 if(!w||typeof w!=='object'||Array.isArray(w)||typeof w.raw!=='string'||!w.raw.trim())throw Error('모듈 작업 입력이 없습니다.');
 const keys=['methodId','label','unit','analysisUnit','sourceLabel','sourceVersion','dataKind','missingPolicy','dependence'];
 const payload=Object.fromEntries(keys.map(k=>[k,w[k]]));
 const lines=w.raw.replaceAll('\r','').split('\n');
 if(lines.at(-1)===''&&w.raw.endsWith('\n'))lines.pop();
 const number=t=>{const s=t.trim();if(!s||/^(na|null|nan)$/i.test(s))return null;const n=Number(s);if(!Number.isFinite(n))throw Error('유한한 수치가 필요합니다.');return n;};
 if(w.methodId==='M050'){
  payload.level=w.level;
  payload.missingPolicy='report_separately';
  payload.values=lines.map(t=>{const s=t.trim();return !s||/^(na|null)$/i.test(s)?null:t;});
 }else if(['M081','M087'].includes(w.methodId)){
  for(const k of ['xLabel','yLabel','xUnit','yUnit'])payload[k]=w[k];
  payload.pairs=lines.map(line=>{if(!line.trim())return[null,null];const parts=line.split(',');if(parts.length!==2)throw Error('같은 행에 x,y 두 칸이 필요합니다.');return parts.map(number);});
 }else throw Error('지원하는 모듈 ID가 아닙니다.');
 return payload;
}

export function methodInputMatches(project,result){
 if(!project.methodWorkspace)return false;
 try{return JSON.stringify(analyzeMethod(workspacePayload(project.methodWorkspace)).input)===JSON.stringify(result.input);}catch{return false;}
}

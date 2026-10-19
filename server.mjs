import http from 'node:http';
import {readFile,writeFile,readdir,mkdir,rename,unlink,open,stat} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createProject,assess,purposes,invalidateGraph} from './core.mjs';
import {analyze,buildFigure,buildBundle} from './calculation.mjs';
import {analyzeMethod,buildMethodFigure,buildMethodBundle,engineVersionFor} from './method-engine.mjs';
import {methodInputMatches} from './method-context.mjs';
import {loadRegistry} from './registry.mjs';
import {evaluateDecision,recordDecision,validateAdoptionHistory} from './decision.mjs';
import {evidenceWorkspace,recordEvidence,reviseFromEvidence,validateEvidenceHistory,validateEvidenceSnapshot} from './evidence-review.mjs';
import {buildAssistContext,buildAssistBrief,importExternalDraft} from './subscription-ai.mjs';
import {createResearchAI} from './research-ai.mjs';
import {inspectProposals,previewAdoption,applyAdoption} from './ai-adoption.mjs';
import {createClassroom} from './classroom.mjs';
import {readProjectBackup} from './public/project-transfer.mjs';
import {resolveProviderPaths,createProviderLogin} from './provider-login.mjs';
import {buildConnectorPackage} from './connector-package.mjs';

export const APP_ROOT=dirname(fileURLToPath(import.meta.url));
const LIMIT=2_000_000;
const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(id);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const semanticFields=['interest','context','purpose','question','conclusion','dataDescription','resources','falsifier','unit','targetUnit','predictionTime','design','dataKind','qualitative','integration','selectedMethods','decisionWorkspace'];
function decisionInputs(p){
 const d=p.decisionWorkspace;
 if(!d||(!d.narrative&&!d.draftClaim&&!Object.keys(d.answers||{}).length&&!d.selectedAlternativeId))return undefined;
 return {narrative:d.narrative||'',answers:d.answers||{},draftClaim:d.draftClaim||'',...(d.selectedAlternativeId?{selectedAlternativeId:d.selectedAlternativeId}:{})};
}
function semanticValue(p,k){return k==='decisionWorkspace'?decisionInputs(p):p[k];}
function semanticProjection(p){return Object.fromEntries(semanticFields.filter(k=>k!=='decisionWorkspace'||decisionInputs(p)!==undefined).map(k=>[k,semanticValue(p,k)??null]));}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value??null;}
function contextFingerprint(p){const normalized={...createProject(),...p};normalized.dataKind=p.calculationInput?.dataKind||p.dataKind||'';return createHash('sha256').update(JSON.stringify(canonical(semanticProjection(normalized)))).digest('hex');}
function methodFingerprint(p){const normalized={...createProject(),...p};normalized.dataKind=p.methodWorkspace?.dataKind||p.methodAnalysis?.input?.dataKind||'';return createHash('sha256').update(JSON.stringify(canonical(semanticProjection(normalized)))).digest('hex');}
const baselineIds=new Set(['analysis','figure','interpretation']);
const methodIds=new Set(['method-analysis','method-figure']);
const stale=n=>['needs_review','stale','recompute_required'].includes(n.status)||n.invalidated===true||n.stale===true||n.needsReview===true;
function markResults(p,ids){p.nodes=(p.nodes||[]).map(n=>ids.has(n.id)?{...n,status:'needs_review',invalidated:true,needsReview:true}:n);}
function inputMatches(p,a){
 if(!p.calculationInput)return true;
 const i=p.calculationInput;
 if(typeof i.raw!=='string'||!i.raw.trim())return false;
 const tokens=i.raw.replaceAll('\r','').split(/[\n,]/);if(tokens.at(-1)===''&&i.raw.endsWith('\n'))tokens.pop();
 const values=tokens.map(t=>{const s=t.trim();return !s||/^(na|null|nan)$/i.test(s)?null:Number(s);});
 return values.every(v=>v===null||Number.isFinite(v))&&JSON.stringify(values)===JSON.stringify(a.values)&&['unit','sourceLabel','sourceVersion','dataKind','label'].every(k=>typeof i[k]==='string'&&(k==='dataKind'?i[k]:i[k].trim())===a[k]);
}
function validateObject(value,depth=0){
 if(depth>30)throw fail(400,'입력 구조가 너무 깊습니다.');
 if(value===null)return;
 if(typeof value==='string'&&value.length>100_000)throw fail(400,'텍스트 길이 제한을 초과했습니다.');
 if(typeof value==='number'&&!Number.isFinite(value))throw fail(400,'유한한 숫자가 필요합니다.');
 if(Array.isArray(value)){if(value.length>10000)throw fail(400,'항목 상한은 10,000개입니다.'); for(const item of value)validateObject(item,depth+1);}
 else if(typeof value==='object')for(const [key,item]of Object.entries(value)){
  if(['__proto__','constructor','prototype'].includes(key))throw fail(400,'허용하지 않는 키입니다.'); validateObject(item,depth+1);
 }
}
async function body(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'application/json 입력이 필요합니다.');
 let bytes=0;const chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>LIMIT)throw fail(413,'요청은 2MB 이하로 보내 주세요.'); chunks.push(chunk);}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'JSON 형식이 올바르지 않습니다.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'객체 형식이 필요합니다.');validateObject(data);return data;
}
function checkedAnalysis(input){
 if(!input||typeof input!=='object')throw fail(400,'분석 자료가 없습니다.');
 try{const a=analyze({values:input.values,unit:input.unit,sourceLabel:input.sourceLabel,sourceVersion:input.sourceVersion,dataKind:input.dataKind,label:input.label});return {...a,...(typeof input.contextFingerprint==='string'?{contextFingerprint:input.contextFingerprint}:{})};}catch(error){throw fail(400,error.message);}
}
function checkedMethod(input){
 if(!input||typeof input!=='object')throw fail(400,'모듈 분석 자료가 없습니다.');
 try{
  if(input.engineVersion!==engineVersionFor(input.input?.methodId))throw Error('엔진 판본이 다릅니다. 현재 엔진에서 다시 계산해 주세요.');
  const a=analyzeMethod(input.input);
  if(typeof input.generatedAt==='string'&&Number.isFinite(Date.parse(input.generatedAt)))a.generatedAt=input.generatedAt;
  if(typeof input.contextFingerprint==='string')a.contextFingerprint=input.contextFingerprint;
  return a;
 }catch(error){throw fail(400,error.message);}
}
function validateProject(p){
 for(const k of ['title','interest','context','purpose','question','conclusion','dataDescription','resources','falsifier','unit','targetUnit','decisionReason'])if(p[k]!==undefined&&typeof p[k]!=='string')throw fail(400,k+'은 텍스트여야 합니다.');
 for(const k of ['selectedMethods','qualitative','integration','nodes','edges','history','unregisteredMethods'])if(p[k]!==undefined&&!Array.isArray(p[k]))throw fail(400,k+'은 목록이어야 합니다.');
 for(const k of ['qualitative','integration','nodes','edges','history'])if(p[k]?.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw fail(400,k+'의 각 행은 객체여야 합니다.');
 if(p.selectedMethods?.some(id=>typeof id!=='string'))throw fail(400,'선택한 방법 ID는 텍스트여야 합니다.');
 if(p.nodes?.some(row=>typeof row.id!=='string'||!row.id.trim()||row.id.length>100))throw fail(400,'추적 항목의 ID를 확인해 주세요.');
 if(p.edges?.some(row=>[row.from||row.source,row.to||row.target].some(id=>typeof id!=='string'||!id.trim()||id.length>100)))throw fail(400,'추적 관계의 시작·도착 ID를 확인해 주세요.');
 if(p.design!==undefined&&(!p.design||typeof p.design!=='object'||Array.isArray(p.design)))throw fail(400,'design은 객체여야 합니다.');
 if(p.methodWorkspace!==undefined&&(!p.methodWorkspace||typeof p.methodWorkspace!=='object'||Array.isArray(p.methodWorkspace)))throw fail(400,'methodWorkspace는 객체여야 합니다.');
 if(p.decisionWorkspace!==undefined){
  const d=p.decisionWorkspace;
  if(!d||typeof d!=='object'||Array.isArray(d))throw fail(400,'연구 안내 기록은 객체여야 합니다.');
  for(const k of ['narrative','draftClaim'])if(d[k]!==undefined&&(typeof d[k]!=='string'||d[k].length>12000))throw fail(400,'연구 설명과 주장은 12,000자 이하의 텍스트여야 합니다.');
  if(d.answers!==undefined&&(!d.answers||typeof d.answers!=='object'||Array.isArray(d.answers)||Object.values(d.answers).some(v=>typeof v!=='string'||v.length>100)))throw fail(400,'질문 답변 형식이 올바르지 않습니다.');
  for(const k of ['records','aiDrafts'])if(d[k]!==undefined&&(!Array.isArray(d[k])||d[k].length>200||d[k].some(v=>!v||typeof v!=='object'||Array.isArray(v))))throw fail(400,'판단·초안 기록은 각 200개 이하의 객체 목록이어야 합니다.');
  try{validateAdoptionHistory(d.adoptions);for(const record of d.records??[])validateAdoptionHistory(record.aiAdoptions);}catch(error){throw fail(400,error.message);}
  validateEvidenceHistory(d.evidenceReviews);
  for(const record of d.records??[])validateEvidenceSnapshot(record.evidenceReview);
  if(d.selectedAlternativeId!==undefined&&(typeof d.selectedAlternativeId!=='string'||d.selectedAlternativeId.length>100))throw fail(400,'선택한 설계 대안 ID 형식을 확인해 주세요.');
 }
 if(p.nodes?.length>1000||p.edges?.length>3000)throw fail(400,'추적 그래프 크기 제한을 초과했습니다.');
 if(p.analysis){const a=checkedAnalysis(p.analysis);p.analysis={...a,figureSvg:buildFigure(a)};}
 if(p.methodAnalysis){const a=checkedMethod(p.methodAnalysis);p.methodAnalysis={...a,figureSvg:buildMethodFigure(a)};}
 return p;
}
function checkedDecision(p,registry,options){
 try{return options?recordDecision(p,registry,options):evaluateDecision(p,registry);}
 catch(error){throw fail(400,error.message);}
}
export async function createApp({dataDir=process.env.RESEARCH_DATA_DIR||join(APP_ROOT,'projects'),classroom=null,ai}={}){
 const registry=await loadRegistry(APP_ROOT);
 await mkdir(dataDir,{recursive:true});
 const access=classroom?await createClassroom({dataDir,...classroom}):null;
 const requestScope=new AsyncLocalStorage();
 const scopedDir=(...parts)=>join(requestScope.getStore()?.dataDir||dataDir,...parts);
 const localSession={mode:'local',authenticated:true,accountId:'local',label:'이 컴퓨터',aiMode:'subscription_local'};
 const servicePolicy={plan:'classroom-pilot',billingEnabled:false,limits:{projects:50,storedBytes:100_000_000},identity:'personal_recovery_key',permanentAccount:false};
 let localLogin;
 let localAI=ai?Promise.resolve(ai):null;
 const getLocalAI=()=>localAI??=createResearchAI();
 async function checkQuota(id,bytes){
  if(!access||!requestScope.getStore()?.session)return;
  const dirs=(await readdir(scopedDir(),{withFileTypes:true})).filter(d=>d.isDirectory()&&safeId(d.name));
  if(!dirs.some(d=>d.name===id)&&dirs.length>=servicePolicy.limits.projects)throw fail(413,'개인 작업 공간의 프로젝트 50개 한도입니다. 먼저 백업하고 운영자에게 문의해 주세요.');
  let total=0;
  for(const dir of dirs)for(const file of await readdir(scopedDir(dir.name)))if(/^v\d{6}\.json$/.test(file))total+=(await stat(scopedDir(dir.name,file))).size;
  if(total+bytes>servicePolicy.limits.storedBytes)throw fail(413,'개인 작업 공간의 저장 한도입니다. 현재 작업을 JSON으로 백업하고 운영자에게 문의해 주세요.');
 }
 async function versions(id){
  if(!safeId(id))throw fail(400,'프로젝트 ID가 올바르지 않습니다.');
  try{return(await readdir(scopedDir(id))).filter(f=>/^v\d{6}\.json$/.test(f)).sort();}catch(e){if(e.code==='ENOENT')return[];throw e;}
 }
 async function load(id,version){
  const vs=await versions(id);const file=version?`v${String(version).padStart(6,'0')}.json`:vs.at(-1);
  if(!file||!vs.includes(file))throw fail(404,'프로젝트 또는 판본이 없습니다.');return JSON.parse(await readFile(scopedDir(id,file),'utf8'));
 }
 const brief=p=>({id:p.id,title:p.title||'제목 미정',interest:p.interest||'',version:p.version,updatedAt:p.updatedAt,purpose:p.purpose});
 const workspaceSaves=new Map();
 async function save(input,options={}){
  const accountId=requestScope.getStore()?.session?.accountId;
  if(!access||!accountId)return saveVersion(input,options);
  let release;const pending=new Promise(done=>{release=done;}),prior=workspaceSaves.get(accountId)||Promise.resolve();
  workspaceSaves.set(accountId,pending);
  await prior;
  try{return await saveVersion(input,options);}
  finally{release();if(workspaceSaves.get(accountId)===pending)workspaceSaves.delete(accountId);}
 }
 async function saveVersion(input,{restored=false}={}){
  const p=validateProject(structuredClone(input));
  if(access&&requestScope.getStore()?.session)p.ownerId=requestScope.getStore().session.accountId;
  const id=p.id||randomUUID();if(!safeId(id))throw fail(400,'프로젝트 ID가 올바르지 않습니다.');
  await checkQuota(id,0);
  const dir=scopedDir(id);await mkdir(dir,{recursive:true});let lock;
  try{lock=await open(join(dir,'.save.lock'),'wx');}catch(e){if(e.code==='EEXIST')throw fail(409,'다른 저장이 진행 중입니다. 다시 저장해 주세요.');throw e;}
  let tmp;
  try{
   const vs=await versions(id);const old=vs.length?await load(id):null;
   const current=old?.version||0;
   if((p.version||0)!==current)throw fail(409,'새 판본이 이미 있습니다. 현재 내용을 내보내 보존한 뒤 최신 판본을 열어 비교해 주세요.');
   for(const key of ['aiDrafts','adoptions','records','evidenceReviews']){
    const prior=old?.decisionWorkspace?.[key]??[],next=p.decisionWorkspace?.[key]??[];
    if(prior.length>next.length||prior.some((item,index)=>JSON.stringify(canonical(item))!==JSON.stringify(canonical(next[index]))))throw fail(409,'보존한 AI 원문·반영 이력·판단 기록은 수정하거나 삭제할 수 없습니다. 새 기록으로 이어가 주세요.');
   }
   if(current>=999999)throw fail(400,'판본 상한에 도달했습니다.');
   const now=new Date().toISOString();
   const semantic=[...semanticFields,'calculationInput','methodWorkspace'];
   const changed=old?semantic.filter(k=>JSON.stringify(semanticValue(old,k))!==JSON.stringify(semanticValue(p,k))):[];
   const regenerated=p.analysis?.contextFingerprint===contextFingerprint(p)&&inputMatches(p,p.analysis);
   const methodRegenerated=p.methodAnalysis?.contextFingerprint===methodFingerprint(p)&&methodInputMatches(p,p.methodAnalysis);
   const commonChanged=changed.some(k=>semanticFields.includes(k));
   if(changed.length&&p.nodes?.length){
    const changedIds=new Set(commonChanged?['question','design']:[]);
    if(changed.includes('calculationInput'))changedIds.add('data');
    if(changed.includes('methodWorkspace'))changedIds.add('method-data');
    let nodes=p.nodes,edges=p.edges||[];
    for(const cid of changedIds){const updated=invalidateGraph(nodes,edges,cid,'semantic');nodes=updated.nodes;}
    const affected=new Set([...(commonChanged||changed.includes('calculationInput')?baselineIds:[]),...(commonChanged||changed.includes('methodWorkspace')?methodIds:[])]);
    // Fresh calculations already bound to current inputs stay current. Other
    // output families remain untouched by an unrelated module-input edit.
    p.nodes=nodes.map(n=>((regenerated&&baselineIds.has(n.id))||(methodRegenerated&&methodIds.has(n.id)))?(input.nodes||[]).find(oldNode=>oldNode.id===n.id)||n:affected.has(n.id)?{...n,status:'needs_review',invalidated:true,needsReview:true}:n);
   }
   if(p.analysis&&(!inputMatches(p,p.analysis)||(p.analysis.contextFingerprint&&p.analysis.contextFingerprint!==contextFingerprint(p))))markResults(p,baselineIds);
   if(p.methodAnalysis&&(!methodInputMatches(p,p.methodAnalysis)||p.methodAnalysis.contextFingerprint!==methodFingerprint(p)))markResults(p,methodIds);
   const prior=old?.history||[],known=new Set(prior.map(e=>e.id||JSON.stringify(e)));
   const additions=restored&&!old?structuredClone(p.history||[]):(p.history||[]).filter(e=>!known.has(e.id||JSON.stringify(e))).map(e=>({...e,id:e.id||randomUUID(),recordedAt:now,validity:'researcher_record_unverified'}));
   const saved={...createProject(),...p,id,version:current+1,schemaVersion:'1.0.0',createdAt:old?.createdAt||now,updatedAt:now,history:[...prior,...additions,{id:randomUUID(),version:current+1,at:now,actor:'local_researcher',action:'save',changedFields:changed,validity:'not_certified'}]};
   const serialized=JSON.stringify(saved,null,2)+'\n';
   await checkQuota(id,Buffer.byteLength(serialized,'utf8'));
   tmp=join(dir,randomUUID()+'.tmp');await writeFile(tmp,serialized,{flag:'wx'});await rename(tmp,join(dir,`v${String(saved.version).padStart(6,'0')}.json`));tmp=null;return saved;
  }finally{if(tmp)await unlink(tmp).catch(()=>{});await lock.close();await unlink(join(dir,'.save.lock'));}
 }
 const server=http.createServer((req,res)=>requestScope.run({dataDir,session:null},async()=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  const send=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
  try{
   const addr=server.address();const expectedPort=addr?.port;
   const allowedHosts=[`127.0.0.1:${expectedPort}`,`localhost:${expectedPort}`,...(access?[new URL(access.origin).host]:[])];
   if(!allowedHosts.includes(req.headers.host))throw fail(403,'로컬 호스트에서만 접근할 수 있습니다.');
   const allowedOrigins=access?[access.origin]:allowedHosts.map(h=>'http://'+h);
   if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))throw fail(403,'다른 사이트의 접근은 허용하지 않습니다.');
   if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'외부 사이트의 접근은 허용하지 않습니다.');
   const url=new URL(req.url,'http://127.0.0.1');const route=url.pathname;
   let session=null;
   if(access){
    session=await access.authenticate(req.headers.cookie);
    if(req.method==='POST'&&req.headers.origin!==access.origin)throw fail(403,'같은 서비스 화면에서 요청해 주세요.');
    if(req.method==='POST'&&['/api/session/join','/api/session/login'].includes(route)){
     const input=await body(req),result=route.endsWith('/join')?await access.join(input,req.socket.remoteAddress):await access.login(input,req.socket.remoteAddress);
     res.setHeader('Set-Cookie',access.cookie(result.token));
     return send(200,{session:{...access.sessionInfo(result.session),policy:servicePolicy},...(result.recoveryKey?{recoveryKey:result.recoveryKey}:{})});
    }
    if(route.startsWith('/api/')&&!['/api/health','/api/session'].includes(route)){
     if(!session)throw fail(401,'개인 작업 공간에 다시 접속해 주세요. 현재 입력은 그대로 두고 JSON으로 백업할 수 있습니다.');
     if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrfToken)throw Object.assign(fail(403,'접속 상태가 변경되었습니다. 다시 접속해 주세요.'),{code:'SESSION_CHANGED'});
    }
    if(session){
     const scoped=requestScope.getStore();scoped.session=session;scoped.dataDir=join(dataDir,'_classroom','workspaces',session.accountId,'projects');
     await mkdir(scoped.dataDir,{recursive:true});
    }
   }
   if(req.method==='GET'&&route==='/api/session')return send(200,access?{...access.sessionInfo(session),policy:servicePolicy}:localSession);
   if(req.method==='POST'&&route==='/api/session/logout'){
    await body(req);
    if(access){await access.logout(req.headers.cookie);res.setHeader('Set-Cookie',access.clearCookie());}
    return send(200,{ok:true});
   }
   if(req.method==='GET'){
    if(route==='/api/registry')return send(200,registry);
    if(route==='/api/purposes')return send(200,purposes);
    if(route==='/api/health')return send(200,{status:'ok',specVersion:'4.0',appVersion:'0.9.0',mode:access?'classroom':'local',externalAI:access?'personal_handoff':'on_explicit_request',...(access?{}:{appRoot:APP_ROOT})});
    if(route==='/api/ai/status')return send(200,access?{mode:'personal_handoff',providers:[['codex','GPT · Codex'],['claude','Claude'],['gemini','Gemini API']].map(([id,label])=>({id,label,mode:'manual_handoff',status:'personal_handoff',available:false,detail:id==='gemini'?'개인 PC 연결기에서 본인의 Gemini API 키를 입력하세요. 공유 서버는 키를 받지 않습니다.':'개인 PC의 공식 도구에서 본인 구독으로 로그인하세요. 공유 서버의 구독 계정은 사용하지 않습니다.'}))}:await (await getLocalAI()).status());
    if(route==='/api/student-connector-package'){
     res.setHeader('Content-Disposition','attachment; filename="research-student-connector.zip"');
     return send(200,await buildConnectorPackage(APP_ROOT),'application/zip');
    }
    if(route==='/api/projects'){
     const dirs=await readdir(scopedDir(),{withFileTypes:true});const all=[];
     for(const d of dirs)if(d.isDirectory()&&safeId(d.name)){try{all.push(brief(await load(d.name)));}catch(e){if(e.status!==404)throw e;}}
     return send(200,all.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
    }
    const match=route.match(/^\/api\/projects\/([\w-]+)(?:\/versions(?:\/(\d+))?)?$/);
    if(match){
     if(route.endsWith('/versions')){const list=[],files=await versions(match[1]);if(access&&!files.length)throw fail(404,'프로젝트 또는 판본이 없습니다.');for(const v of files)list.push(brief(await load(match[1],Number(v.slice(1,7)))));return send(200,list.reverse());}
     return send(200,await load(match[1],match[2]?Number(match[2]):undefined));
    }
    const files={'/':'public/index.html','/app.mjs':'public/app.mjs','/decision-view.mjs':'public/decision-view.mjs','/connector-client.mjs':'public/connector-client.mjs','/practice.mjs':'public/practice.mjs','/project-transfer.mjs':'public/project-transfer.mjs','/styles.css':'public/styles.css','/spec':'SPEC-v4.0.md'};
    if(files[route]){const types=route.endsWith('.mjs')?'text/javascript; charset=utf-8':route==='/styles.css'?'text/css; charset=utf-8':route==='/spec'?'text/plain; charset=utf-8':'text/html; charset=utf-8';return send(200,await readFile(join(APP_ROOT,files[route])),types);}
    if(route==='/favicon.ico'){res.writeHead(204);return res.end();}
   }else if(req.method==='POST'){
    const data=await body(req);
    if(route==='/api/ai/gemini-key'){
     if(access)throw fail(403,'Gemini API 키는 학생 PC의 개인 연결기에 입력하세요. 공유 서버는 키를 받지 않습니다.');
     if(!allowedOrigins.includes(req.headers.origin))throw fail(403,'이 컴퓨터의 작업실 화면에서 API 키를 설정해 주세요.');
     try{return send(200,{provider:(await getLocalAI()).configureGemini({apiKey:data.apiKey,model:data.model,acknowledged:data.acknowledged})});}
     catch(error){throw Object.assign(fail(error.safeToExpose?400:503,error.safeToExpose?error.message:'Gemini API 키를 설정하지 못했습니다.'),{code:error.safeToExpose?error.code:undefined});}
    }
    if(route==='/api/ai/login'){
     if(access)throw fail(403,'학생 PC의 개인 연결기에서 로그인해 주세요. 공유 서버의 계정을 변경하지 않습니다.');
     if(!allowedOrigins.includes(req.headers.origin))throw fail(403,'이 컴퓨터의 작업실 화면에서 로그인해 주세요.');
     if(data.provider==='gemini')throw Object.assign(fail(400,'Gemini는 API 키를 입력해 연결합니다.'),{code:'GEMINI_API_REQUIRED'});
     try{localLogin??=createProviderLogin({paths:await resolveProviderPaths()});return send(200,await localLogin.start(data.provider));}
     catch(error){throw Object.assign(fail(error.code==='LOGIN_BUSY'?429:503,error.safeToExpose?error.message:'공식 로그인 창을 시작하지 못했습니다.'),{code:error.safeToExpose?error.code:undefined});}
    }
    if(route==='/api/decision')return send(200,checkedDecision(validateProject(data.project||{}),registry));
    if(route==='/api/decision/record')return send(200,checkedDecision(validateProject(data.project||{}),registry,{alternativeId:data.alternativeId,note:data.note}));
    if(route==='/api/evidence/workspace')return send(200,evidenceWorkspace(validateProject(data.project||{}),registry,{recordId:data.recordId}));
    if(route==='/api/evidence/record')return send(200,recordEvidence(validateProject(data.project||{}),registry,{recordId:data.recordId,entry:data.entry}));
    if(route==='/api/evidence/revise')return send(200,reviseFromEvidence(validateProject(data.project||{}),registry,{recordId:data.recordId,claim:data.claim,reason:data.reason,nextAction:data.nextAction,burden:data.burden,confirmed:data.confirmed}));
    if(route==='/api/ai/proposals')return send(200,inspectProposals(validateProject(data.project||{}),registry,{draftIndex:data.draftIndex}));
    if(route==='/api/ai/adoption/preview')return send(200,previewAdoption(validateProject(data.project||{}),registry,{draftRef:data.draftRef,selections:data.selections}));
    if(route==='/api/ai/adoption/apply')return send(200,applyAdoption(validateProject(data.project||{}),registry,{draftRef:data.draftRef,selections:data.selections,previewToken:data.previewToken,confirmed:data.confirmed}));
    if(route==='/api/ai/preview'||route==='/api/ai/handoff'){
     const p=validateProject(data.project||{}),decision=checkedDecision(p,registry);
     const context=buildAssistContext(p,decision);
     const brief=buildAssistBrief(context);
     return send(200,{context,brief});
    }
    if(route==='/api/ai/assist'){
     if(access)throw fail(403,'공유 서버에서는 서버 소유자의 구독 도구를 실행할 수 없습니다. 본인 구독 서비스에 맥락을 전달한 후 실제 응답을 가져와 주세요.');
     if(data.consent!==true)throw fail(400,'선택 맥락의 전송 동의가 필요합니다.');
     if(!['codex','claude','gemini'].includes(data.provider))throw fail(400,'GPT / Codex, Claude 또는 Gemini API를 선택해 주세요.');
     const p=validateProject(data.project||{});
     if((p.decisionWorkspace?.aiDrafts?.length||0)>=200)throw fail(400,'초안 기록 한도에 도달했습니다. 기존 프로젝트를 저장·보존해 주세요.');
     const context=buildAssistContext(p,checkedDecision(p,registry));
     const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.once('close',cancel);
     try{const draft=await (await getLocalAI()).assist(data.provider,context,{signal:controller.signal});if(!res.destroyed)return send(200,{draft});}
     catch(error){throw Object.assign(fail(/BUSY|LIMIT/.test(error.code||'')?429:/TIMEOUT/.test(error.code||'')?504:503,error.safeToExpose===true?error.message:'AI 요청을 완료하지 못했습니다.'),{code:error.safeToExpose===true?error.code:undefined});}
     finally{res.removeListener('close',cancel);}
     return;
    }
    if(route==='/api/ai/import'){
     const p=validateProject(data.project||{}),decision=checkedDecision(p,registry);
     if((p.decisionWorkspace?.aiDrafts?.length||0)>=200)throw fail(400,'초안 기록 한도에 도달했습니다. 기존 프로젝트를 저장·보존해 주세요.');
     const sourceFingerprint=data.sourceInputFingerprint;
     if(sourceFingerprint!==undefined&&sourceFingerprint!==null&&(typeof sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(sourceFingerprint)))throw fail(400,'전달 시점의 조건 지문이 올바르지 않습니다.');
     try{
      const draft=importExternalDraft({provider:data.provider,text:data.text,inputFingerprint:sourceFingerprint||decision.inputFingerprint});
      draft.inputFingerprint=sourceFingerprint||null;
      draft.currentInputFingerprint=decision.inputFingerprint;
      draft.contextStatus=sourceFingerprint?(sourceFingerprint===decision.inputFingerprint?'current':'needs_review'):'unknown';
      return send(200,{draft});
     }
     catch(error){throw fail(400,error.message);}
    }
    if(route==='/api/ai/connector-result'){
     if(data.consent!==true)throw fail(400,'개인 구독 응답을 가져올 동의가 필요합니다.');
     const p=validateProject(data.project||{}),decision=checkedDecision(p,registry);
     if((p.decisionWorkspace?.aiDrafts?.length||0)>=200)throw fail(400,'초안 기록 한도에 도달했습니다. 기존 프로젝트를 저장해 주세요.');
     if(data.sourceInputFingerprint!==decision.inputFingerprint||data.sourceKnowledgeFingerprint!==decision.knowledgeFingerprint)throw fail(409,'요청 후 연구 조건 또는 근거 판본이 달라졌습니다. 현재 내용으로 맥락을 다시 준비해 주세요.');
     let draft;try{draft=importExternalDraft({provider:data.provider,text:data.text,inputFingerprint:data.sourceInputFingerprint});}catch(error){throw fail(400,error.message);}
     const transport=data.sourceTransport;
     if(transport!==undefined&&!['api','cli'].includes(transport))throw fail(400,'연결기 전송 방식을 확인해 주세요.');
     if(transport==='api'&&(data.provider!=='gemini'||typeof data.sourceModel!=='string'||!/^gemini-[a-z0-9._-]{1,80}$/.test(data.sourceModel)))throw fail(400,'Gemini API 모델 정보를 확인해 주세요.');
     return send(200,{draft:{...draft,mode:'local_connector',...(transport?{transport}:{}),...(transport==='api'?{model:data.sourceModel}:{}),knowledgeFingerprint:decision.knowledgeFingerprint,currentInputFingerprint:decision.inputFingerprint,contextStatus:'current',executionVerification:'not_server_verified'}});
    }
    if(route==='/api/projects')return send(200,await save(data));
    if(route==='/api/projects/import'){
     let imported;try{imported=readProjectBackup(data.backup);}catch(error){throw fail(400,error.message);}
     const original={id:imported.id||null,version:imported.version||0};
     imported.id='';imported.version=0;
     imported.importedFrom={...original,restoredAt:new Date().toISOString(),kind:'user_selected_backup',validity:'not_certified'};
     return send(200,await save(imported,{restored:true}));
    }
    if(route==='/api/assess')return send(200,assess(validateProject(data),registry));
    if(route==='/api/invalidate'){
     if(!Array.isArray(data.nodes)||!Array.isArray(data.edges)||typeof data.changedId!=='string')throw fail(400,'nodes, edges, changedId가 필요합니다.');
     return send(200,invalidateGraph(data.nodes,data.edges,data.changedId,data.changeKind||'semantic'));
    }
    if(route==='/api/calculate'){const a=checkedAnalysis(data);delete a.contextFingerprint;if(data.projectContext){validateProject(data.projectContext);a.contextFingerprint=contextFingerprint(data.projectContext);}return send(200,{...a,figureSvg:buildFigure(a)});}
    if(route==='/api/method/calculate'){
     const {projectContext,...payload}=data;let a;
     try{a=analyzeMethod(payload);}catch(error){throw fail(400,error.message);}
     if(projectContext){validateProject(projectContext);if(!methodInputMatches(projectContext,a))throw fail(409,'모듈 입력과 작업 공간이 다릅니다.');a.contextFingerprint=methodFingerprint(projectContext);}
     return send(200,{...a,figureSvg:buildMethodFigure(a)});
    }
    if(route==='/api/method/export'){
     const p=validateProject(data.project||{}),a=checkedMethod(data.run||p.methodAnalysis);
     if(p.nodes?.some(n=>methodIds.has(n.id)&&stale(n)))throw fail(409,'모듈 입력·설계 변경 후 다시 계산해 주세요.');
     if(!methodInputMatches(p,a))throw fail(409,'현재 모듈 입력과 분석 판본이 다릅니다.');
     if(!a.contextFingerprint||a.contextFingerprint!==methodFingerprint(p))throw fail(409,'모듈의 연구설계 판본이 변경되었거나 연결되지 않았습니다.');
     if(p.methodAnalysis&&JSON.stringify(p.methodAnalysis.input)!==JSON.stringify(a.input))throw fail(409,'저장한 모듈 분석과 내보낼 분석이 다릅니다.');
     const zip=buildMethodBundle(p,a,{includeData:data.includeData===true});
     res.setHeader('Content-Disposition','attachment; filename="method-research-bundle.zip"');return send(200,zip,'application/zip');
    }
    if(route==='/api/export'){
     const p=validateProject(data.project||{});
     if(p.nodes?.some(n=>baselineIds.has(n.id)&&stale(n)))throw fail(409,'변경 후 재검토가 필요한 산출물이 있습니다. 이전 판본으로 보존하고 현재 자료로 다시 계산해 주세요.');
     const a=checkedAnalysis(data.analysis||p.analysis);
     if(!inputMatches(p,a))throw fail(409,'현재 입력 자료와 분석 판본이 다릅니다. 현재 입력으로 다시 계산해 주세요.');
     if(p.calculationInput&&!a.contextFingerprint)throw fail(409,'연구설계 판본 연결이 없습니다. 현재 프로젝트에서 다시 계산해 주세요.');
     if(a.contextFingerprint&&a.contextFingerprint!==contextFingerprint(p))throw fail(409,'연구 질문·설계·근거 판본이 변경되었습니다. 현재 판본으로 다시 계산하고 해석을 검토해 주세요.');
     if(p.analysis){const current=checkedAnalysis(p.analysis);if(JSON.stringify(current.values)!==JSON.stringify(a.values)||['unit','sourceLabel','sourceVersion','dataKind','label'].some(k=>current[k]!==a[k]))throw fail(409,'프로젝트 자료 판본과 내보낼 분석이 다릅니다.');}
     const zip=buildBundle(p,a,registry.meta,{includeData:data.includeData===true});
     res.setHeader('Content-Disposition','attachment; filename="research-design-bundle.zip"');return send(200,zip,'application/zip');
    }
   }
   throw fail(404,'요청한 경로가 없습니다.');
  }catch(error){const status=error.status||500;if(status===500)console.error(error);send(status,{error:status===500?'로컬 서버 처리에 실패했습니다. 서버 로그를 확인해 주세요.':error.message,...(status!==500&&error.code?{code:error.code}:{})});}
 }));
 server.requestTimeout=30_000;server.headersTimeout=15_000;
 return {server,registry,dataDir,save,load,mode:access?'classroom':'local'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.PORT||4317);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be 1–65535');
 const classroom=process.env.RESEARCH_MODE==='classroom'?{classCode:process.env.RESEARCH_CLASSROOM_CODE,publicOrigin:process.env.RESEARCH_PUBLIC_ORIGIN,...(process.env.RESEARCH_SESSION_SECRET?{sessionSecret:process.env.RESEARCH_SESSION_SECRET}:{})}:null;
 if(process.env.RESEARCH_MODE&&!['local','classroom'].includes(process.env.RESEARCH_MODE))throw Error('RESEARCH_MODE must be local or classroom');
 const {server,dataDir}=await createApp({classroom});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'포트를 사용 중입니다. PORT 환경변수로 다른 포트를 지정해 주세요.':e);process.exitCode=1;});
 const host=classroom?(process.env.RESEARCH_BIND_HOST||'127.0.0.1'):'127.0.0.1';
 server.listen(port,host,()=>console.log(`Research Design Workbench ${classroom?classroom.publicOrigin:'http://127.0.0.1:'+port}\nMode: ${classroom?'classroom':'local'}\nProject storage: ${dataDir}\nSpec v4.0; recommendation and research validity remain unverified.`));
}

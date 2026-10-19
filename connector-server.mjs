import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildAssistBrief} from './subscription-ai.mjs';
import {createResearchAI} from './research-ai.mjs';
import {resolveProviderPaths,createProviderLogin} from './provider-login.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const error=(status,code,message)=>Object.assign(new Error(message),{status,code});
const providers=new Set(['codex','claude','gemini']);
function inspect(value,depth=0){
 if(depth>24)throw error(400,'INVALID_CONTEXT','맥락 구조가 너무 깊습니다.');
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
  if(['__proto__','constructor','prototype'].includes(key))throw error(400,'INVALID_CONTEXT','허용하지 않는 맥락 속성입니다.');
  inspect(item,depth+1);
 }
}
export function checkedConnectorContext(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw error(400,'INVALID_CONTEXT','선택한 연구 맥락이 필요합니다.');
 const keys=['version','inputFingerprint','knowledgeFingerprint','answerCatalog','narrative','answers','draftClaim','decision','practice'];
 if(Object.keys(value).some(key=>!keys.includes(key))||value.version!=='subscription-context-1.0.0'||!/^[a-f0-9]{64}$/.test(value.inputFingerprint||'')||typeof value.narrative!=='string'||typeof value.draftClaim!=='string'||!value.answers||typeof value.answers!=='object'||Array.isArray(value.answers)||!value.decision||typeof value.decision!=='object'||Array.isArray(value.decision))throw error(400,'INVALID_CONTEXT','작업실에서 만든 연구 맥락을 다시 준비해 주세요.');
 if(value.knowledgeFingerprint&&!/^[a-f0-9]{64}$/.test(value.knowledgeFingerprint))throw error(400,'INVALID_CONTEXT','근거 판본 지문을 확인해 주세요.');
 inspect(value);
 if(Buffer.byteLength(JSON.stringify(value),'utf8')>48_000)throw error(413,'CONTEXT_TOO_LARGE','선택 맥락은 48KB 이하로 보내 주세요.');
 buildAssistBrief(value);
 return structuredClone(value);
}
async function readBody(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw error(415,'JSON_REQUIRED','JSON 요청이 필요합니다.');
 let bytes=0;const chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>55_000)throw error(413,'REQUEST_TOO_LARGE','요청 크기 제한을 초과했습니다.');chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error(400,'INVALID_JSON','JSON 형식을 확인해 주세요.');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw error(400,'INVALID_JSON','객체 형식이 필요합니다.');
 inspect(value);return value;
}
// This listener serves no projects, credentials or account files. Account sign-in remains in the official tools.
export async function createConnectorApp({bridge,login}={}){
 if(!bridge||!login){const paths=await resolveProviderPaths();bridge??=await createResearchAI();login??=createProviderLogin({paths});}
 const csrfToken=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  const send=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
  try{
   const port=server.address()?.port,hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
   if(!hosts.includes(req.headers.host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw error(403,'LOCAL_ONLY','이 컴퓨터에서만 연결할 수 있습니다.');
   const route=new URL(req.url,'http://127.0.0.1').pathname;
   const origins=hosts.map(host=>'http://'+host);
   const navigation=req.method==='GET'&&['/','/connect'].includes(route);
   if(req.headers.origin&&!origins.includes(req.headers.origin))throw error(403,'ORIGIN_DENIED','연결기 화면에서 요청해 주세요.');
   if(!navigation&&req.headers['sec-fetch-site']==='cross-site')throw error(403,'ORIGIN_DENIED','다른 사이트에서 직접 요청할 수 없습니다.');
   if(req.method==='GET'){
    if(route==='/api/connector/health')return send(200,{status:'ok',kind:'student-local-connector',version:'1.2.0'});
    if(route==='/api/connector/session')return send(200,{csrfToken});
    if(route==='/api/connector/status')return send(200,await bridge.status());
    const files={'/':'public/connector.html','/connect':'public/connector.html','/connector-page.mjs':'public/connector-page.mjs','/styles.css':'public/styles.css'};
    if(files[route])return send(200,await readFile(join(ROOT,files[route])),route.endsWith('.mjs')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    if(route==='/favicon.ico')return send(204,'');
   }
   if(req.method==='POST'){
    const token=req.headers['x-connector-token'];
    if(!origins.includes(req.headers.origin)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(csrfToken)))throw error(403,'CONNECTOR_AUTH_REQUIRED','연결기 화면을 다시 열고 승인해 주세요.');
    const input=await readBody(req);
    if(route==='/api/connector/gemini-key'){
     try{return send(200,{provider:bridge.configureGemini({apiKey:input.apiKey,model:input.model,acknowledged:input.acknowledged})});}
     catch(e){if(e.safeToExpose)e.status=400;throw e;}
    }
    if(!providers.has(input.provider))throw error(400,'UNKNOWN_PROVIDER','지원하는 구독 제공자를 선택해 주세요.');
    if(route==='/api/connector/login'){
     if(input.provider==='gemini')throw error(400,'GEMINI_API_REQUIRED','Gemini는 이 창에서 API 키를 입력해 연결합니다.');
     return send(200,await login.start(input.provider));
    }
    if(route==='/api/connector/assist'){
     if(input.consent!==true)throw error(400,'CONSENT_REQUIRED','보낼 맥락을 확인하고 동의해 주세요.');
     const context=checkedConnectorContext(input.context),controller=new AbortController();
     const cancel=()=>{if(!res.writableEnded)controller.abort();};
     res.once('close',cancel);
     try{const draft=await bridge.assist(input.provider,context,{signal:controller.signal});if(!res.destroyed)return send(200,{draft});}
     finally{res.removeListener('close',cancel);}
     return;
    }
   }
   throw error(404,'NOT_FOUND','요청한 연결 기능이 없습니다.');
  }catch(e){const exposed=e.status||e.safeToExpose;send(e.status||((e.code==='CLI_BUSY'||e.code==='LOGIN_BUSY')?429:503),{error:exposed?e.message:'개인 연결기의 요청을 완료하지 못했습니다.',code:exposed?e.code:'CONNECTOR_FAILED'});}
 });
 server.requestTimeout=30_000;server.headersTimeout=15_000;
 return {server};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.RESEARCH_CONNECTOR_PORT||4319);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('RESEARCH_CONNECTOR_PORT must be 1024–65535');
 const {server}=await createConnectorApp();
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'개인 연결기 포트를 사용 중입니다. 기존 연결기를 확인해 주세요.':'개인 연결기를 시작하지 못했습니다.');process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`학생 개인 구독 연결기: http://127.0.0.1:${port}/connect\n공식 로그인과 전송 승인은 이 기기에서 진행합니다.`));
}

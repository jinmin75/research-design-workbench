import {readFile,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep,win32} from 'node:path';
import {createHash} from 'node:crypto';

// Explicit distribution boundary: never scan the installation or include user data.
export const CONNECTOR_FILES=Object.freeze([
 'connector-server.mjs','subscription-ai.mjs','provider-login.mjs','decision.mjs','gemini-api.mjs','research-ai.mjs',
 'scripts/Provider-Login.ps1','public/connector.html','public/connector-page.mjs','public/styles.css',
 'Start-Connector.ps1','Start-Connector.cmd','Stop-Connector.ps1','Stop-Connector.cmd','CONNECTOR-README.md',
 'scripts/Dependency-Setup.psm1','dependency-lock.json','Setup.ps1','Setup.cmd',
 'AUTO-SETUP.md','GEMINI-API.md','상세한 사용법 및 활용법.md'
]);
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function packagePath(value){
 if(typeof value!=='string'||!value||value.includes('\\')||isAbsolute(value)||win32.isAbsolute(value)||/[\x00-\x1f<>:"|?*]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('Package paths must be portable relative file names.');
 return value;
}
// Explicit files only; never discover files by traversing the installation.
export async function buildFilePackage(root,{files,format,version}){
 if(!Array.isArray(files)||files.length>65534||typeof format!=='string'||!format||format.length>128||typeof version!=='string'||!version||version.length>64)throw Error('Invalid package definition.');
 const names=new Set(),sources=files.map(file=>{
  const name=packagePath(typeof file==='string'?file:file?.name),source=packagePath(typeof file==='string'?file:file?.source??file?.name),key=name.toLowerCase();
  if(key==='manifest.json'||names.has(key))throw Error('Duplicate or reserved package entry.');
  names.add(key);return {name,source};
 });
 const resolvedRoot=await realpath(root);
 const entries=await Promise.all(sources.map(async({name,source})=>{
  const resolved=await realpath(join(resolvedRoot,source)),within=relative(resolvedRoot,resolved);
  if(within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw Error('Package source escapes the package root.');
  return {name,bytes:await readFile(resolved)};
 }));
 const manifest={format,version,files:entries.map(({name,bytes})=>({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
 entries.push({name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
 const local=[],central=[];let offset=0;
 for(const {name,bytes}of entries){
  const filename=Buffer.from(name,'utf8'),crc=crc32(bytes),head=Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0x0800,6);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(filename.length,26);
  local.push(head,filename,bytes);
  const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x0800,8);index.writeUInt16LE(33,14);index.writeUInt32LE(crc,16);index.writeUInt32LE(bytes.length,20);index.writeUInt32LE(bytes.length,24);index.writeUInt16LE(filename.length,28);index.writeUInt32LE(offset,42);central.push(index,filename);
  offset+=head.length+filename.length+bytes.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
// Stored ZIP, stable timestamps and names. The Windows bootstrap prepares the runtime separately.
export function buildConnectorPackage(root){return buildFilePackage(root,{files:CONNECTOR_FILES,format:'research-student-connector',version:'1.2.0'});}

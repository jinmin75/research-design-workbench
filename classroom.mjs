import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, open, readFile, readdir, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const SESSION_MS = 8 * 60 * 60 * 1000;
const FAILURE_MS = 10 * 60 * 1000;
const JOIN_MS = 60 * 60 * 1000;
const COOKIE = 'rdw_session';
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^rk_[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const fail = (status, message) => Object.assign(new Error(message), {status});
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const labelValid = label => typeof label === 'string' && label.length <= 64 && !CONTROL.test(label);

function classroomOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw fail(500, 'CLASSROOM_ORIGIN에 정확한 http(s) 출처를 지정해 주세요.'); }
  if (typeof value !== 'string' || value !== url.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw fail(500, 'CLASSROOM_ORIGIN은 경로·계정·질의가 없는 정확한 http(s) 출처여야 합니다.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? host.split('.').map(Number) : [];
  const localV4 = octets.length === 4 && octets.every(n => n <= 255) && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  const localV6 = host === '::1' || /^(?:fc|fd)[a-f0-9]{2}:/i.test(host);
  if (url.protocol === 'http:' && !(host === 'localhost' || localV4 || localV6)) throw fail(500, '공개 주소는 HTTPS가 필요합니다. HTTP는 localhost와 사설 LAN IP에서만 허용합니다.');
  return {origin: url.origin, secure: url.protocol === 'https:'};
}

async function exclusiveJson(file, value) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
}

/** Local, persistent classroom accounts. Recovery keys and session tokens are never stored verbatim. */
export async function createClassroom({dataDir, classCode, publicOrigin, sessionSecret, clock = Date.now, maxAccounts = 300, maxJoinsPerHour = 300, maxLoginsPerHour = 1000, maxAuthAttemptsPerHour = 1000} = {}) {
  const {origin, secure} = classroomOrigin(publicOrigin);
  if (typeof dataDir !== 'string' || !dataDir || typeof clock !== 'function') throw fail(500, '수업 저장 경로와 시계를 확인해 주세요.');
  if (typeof classCode !== 'string' || classCode.length < 12 || classCode.length > 256 || /\s/.test(classCode) || CONTROL.test(classCode)) throw fail(500, '수업 코드는 공백·제어문자 없이 12~256자로 설정해 주세요.');
  if ([maxAccounts, maxJoinsPerHour, maxLoginsPerHour, maxAuthAttemptsPerHour].some(value => !Number.isInteger(value) || value < 1 || value > 10_000)) throw fail(500, '수업 계정과 가입·로그인 한도를 확인해 주세요.');
  if (sessionSecret !== undefined && (typeof sessionSecret !== 'string' || !HASH.test(sessionSecret))) throw fail(500, 'CLASSROOM_SESSION_SECRET은 64자리 소문자 hex여야 합니다.');
  const root = resolve(dataDir, '_classroom');
  const accountsDir = join(root, 'accounts');
  const sessionsDir = join(root, 'sessions');
  await mkdir(accountsDir, {recursive: true, mode: 0o700});
  await mkdir(sessionsDir, {recursive: true, mode: 0o700});
  let secret = sessionSecret;
  if (secret === undefined) {
    const secretPath = join(root, 'secret.key');
    try {
      const handle = await open(secretPath, 'wx', 0o600);
      try { await handle.writeFile(randomBytes(32).toString('hex')); } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'EEXIST') throw fail(503, '수업 인증 비밀을 저장할 수 없습니다.'); }
    try { secret = await readFile(secretPath, 'utf8'); } catch { throw fail(503, '수업 인증 비밀을 읽을 수 없습니다.'); }
    if (!HASH.test(secret)) throw fail(500, '저장된 수업 인증 비밀이 손상되었습니다. 교체 전 기존 계정 복구 영향을 확인해 주세요.');
  }
  const secretBytes = Buffer.from(secret, 'hex');
  const digest = (domain, value) => createHmac('sha256', secretBytes).update(domain).update('\0').update(value).digest('hex');
  const codeHash = digest('class-code', classCode);
  const signed = payload => ({payload, mac: digest('stored-record', JSON.stringify(payload))});
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw fail(503, '서버 시각을 확인해 주세요.');
    return value;
  };
  const accountValid = account => exactKeys(account, ['version', 'type', 'accountId', 'label', 'createdAt']) && account.version === 1 && account.type === 'account' && UUID.test(account.accountId) && labelValid(account.label) && Number.isSafeInteger(account.createdAt) && account.createdAt >= 0;
  const sessionValid = session => exactKeys(session, ['version', 'type', 'accountHash', 'accountId', 'label', 'csrfToken', 'createdAt', 'expiresAt']) && session.version === 1 && session.type === 'session' && HASH.test(session.accountHash) && UUID.test(session.accountId) && labelValid(session.label) && TOKEN.test(session.csrfToken) && Number.isSafeInteger(session.createdAt) && session.createdAt >= 0 && Number.isSafeInteger(session.expiresAt) && session.expiresAt - session.createdAt === SESSION_MS;
  async function load(file, validate) {
    let handle;
    try {
      handle = await open(file, 'r');
      if ((await handle.stat()).size > 16_384) return null;
      const raw = await handle.readFile('utf8');
      let record;
      try { record = JSON.parse(raw); } catch { return null; }
      if (!exactKeys(record, ['payload', 'mac']) || typeof record.mac !== 'string' || !HASH.test(record.mac) || !equal(record.mac, digest('stored-record', JSON.stringify(record.payload))) || !validate(record.payload)) return null;
      return record.payload;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw fail(503, '수업 인증 저장소를 읽을 수 없습니다.');
    } finally { if (handle) await handle.close(); }
  }
  const failures = new Map();
  const attempts = new Map();
  const joins = new Map();
  const logins = new Map();
  function remoteKey(remoteAddress) { return typeof remoteAddress === 'string' && remoteAddress.length <= 128 && !CONTROL.test(remoteAddress) ? remoteAddress : 'unknown'; }
  function bucket(map, remote, windowMs) {
    const time = now();
    const key = remoteKey(remote);
    let value = map.get(key);
    if (!value || time >= value.start + windowMs || time < value.start) {
      for (const [storedKey, entry] of map) if (time >= entry.start + windowMs || time < entry.start) map.delete(storedKey);
      if (!map.has(key) && map.size >= 4096) throw fail(429, '접속이 많습니다. 잠시 뒤 다시 시도해 주세요.');
      value = {start: time, count: 0}; map.set(key, value);
    }
    return value;
  }
  function limited(remote, kind, credential, operation) {
    const address = bucket(attempts, remote, JOIN_MS);
    if (address.count >= maxAuthAttemptsPerHour) return Promise.reject(fail(429, '이 접속 주소의 인증 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'));
    address.count++;
    // Bound before hashing. A rejected credential cannot lock out other students behind the same proxy.
    const submitted = typeof credential === 'string' && credential.length <= (kind === 'join' ? 256 : 46) ? credential : '#invalid-input';
    const failureKey = digest('credential-failure', remoteKey(remote) + '\0' + kind + '\0' + submitted);
    const entry = bucket(failures, failureKey, FAILURE_MS);
    if ((entry.pending || 0) >= 350) return Promise.reject(fail(429, '인증 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'));
    entry.pending = (entry.pending || 0) + 1;
    const result = (entry.queue || Promise.resolve()).then(async () => {
      if (entry.count >= 10) throw fail(429, '인증 실패가 반복되었습니다. 10분 뒤 다시 시도해 주세요.');
      try { return await operation(); } catch (error) {
        if ([401, 403].includes(error.status)) entry.count++;
        throw error;
      }
    });
    entry.queue = result.catch(() => {}).finally(() => { entry.pending--; });
    return result;
  }
  function publicSession(session) { return {accountId: session.accountId, label: session.label, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString()}; }
  let sessionQueue = Promise.resolve();
  let sessionIndex;
  let lastScan;
  async function removeSession(name) {
    // Only the server's exact digest filenames can be removed; unrelated files stay untouched.
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw fail(503, '잘못된 세션 저장 이름입니다.');
    try { await unlink(join(sessionsDir, name)); } catch (error) { if (error.code !== 'ENOENT') throw fail(503, '오래된 세션을 정리할 수 없습니다.'); }
    sessionIndex?.delete(name);
  }
  async function cleanSessions(time) {
    // Full on restart and at most once a minute thereafter; active-session accounting stays in memory.
    if (!sessionIndex || lastScan === undefined || time < lastScan || time >= lastScan + 60_000) {
      const fresh = new Map();
      const checkedAccounts = new Map();
      let names;
      try { names = await readdir(sessionsDir); } catch { throw fail(503, '세션 저장소를 확인할 수 없습니다.'); }
      for (const name of names) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const session = await load(join(sessionsDir, name), sessionValid);
        let account;
        if (session) {
          if (!checkedAccounts.has(session.accountHash)) checkedAccounts.set(session.accountHash, await load(join(accountsDir, session.accountHash + '.json'), accountValid));
          account = checkedAccounts.get(session.accountHash);
        }
        if (!session || session.expiresAt <= time || session.createdAt > time || !account || account.accountId !== session.accountId || account.label !== session.label || account.createdAt > session.createdAt) await removeSession(name);
        else fresh.set(name, session);
      }
      sessionIndex = fresh;
      const byAccount = new Map();
      for (const [name, session] of fresh) {
        if (!byAccount.has(session.accountHash)) byAccount.set(session.accountHash, []);
        byAccount.get(session.accountHash).push([name, session]);
      }
      for (const active of byAccount.values()) {
        active.sort((a, b) => a[1].createdAt - b[1].createdAt);
        for (const [oldName] of active.slice(0, Math.max(0, active.length - 10))) await removeSession(oldName);
      }
      lastScan = time;
    } else {
      for (const [name, session] of sessionIndex) if (session.expiresAt <= time || session.createdAt > time) await removeSession(name);
    }
  }
  async function createSession(account, accountHash) {
    const createdAt = now();
    await cleanSessions(createdAt);
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = randomBytes(32).toString('base64url');
      const session = {version: 1, type: 'session', accountHash, accountId: account.accountId, label: account.label, csrfToken: randomBytes(32).toString('base64url'), createdAt, expiresAt: createdAt + SESSION_MS};
      const name = digest('session-token', token) + '.json';
      try { await exclusiveJson(join(sessionsDir, name), signed(session)); }
      catch (error) { if (error.code === 'EEXIST') continue; throw fail(503, '수업 세션을 저장할 수 없습니다.'); }
      sessionIndex.set(name, session);
      try {
        const active = [...sessionIndex].filter(([, value]) => value.accountHash === accountHash).sort((a, b) => a[1].createdAt - b[1].createdAt);
        for (const [oldName] of active.slice(0, Math.max(0, active.length - 10))) await removeSession(oldName);
      } catch (error) { await removeSession(name); throw error; }
      return {session: publicSession(session), token};
    }
    throw fail(503, '수업 세션을 만들 수 없습니다.');
  }
  function newSession(account, accountHash) { const result = sessionQueue.then(() => createSession(account, accountHash)); sessionQueue = result.catch(() => {}); return result; }
  // Serialize account allocation so concurrent requests cannot exceed the configured cap.
  let joinQueue = Promise.resolve();
  function serializeJoin(operation) { const result = joinQueue.then(operation); joinQueue = result.catch(() => {}); return result; }
  async function joinAccount(input, remoteAddress) {
    return limited(remoteAddress, 'join', input?.classCode, () => serializeJoin(async () => {
      if (!plain(input) || typeof input.classCode !== 'string' || input.classCode.length > 256 || !equal(codeHash, digest('class-code', input.classCode))) throw fail(401, '수업 코드를 확인해 주세요.');
      const label = input.label === undefined ? '' : input.label;
      if (!labelValid(label)) throw fail(400, '별명은 제어문자 없이 64자 이하로 입력해 주세요.');
      const joinBucket = bucket(joins, remoteAddress, JOIN_MS);
      if (joinBucket.count >= maxJoinsPerHour) throw fail(429, '이 접속 주소의 시간당 새 계정 한도에 도달했습니다. 기존 개인 키로 로그인해 주세요.');
      const names = await readdir(accountsDir);
      if (names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length >= maxAccounts) throw fail(503, '수업 계정 한도에 도달했습니다. 기존 개인 키로 로그인하거나 담당자에게 알려 주세요.');
      for (let attempt = 0; attempt < 3; attempt++) {
        const recoveryKey = 'rk_' + randomBytes(32).toString('base64url');
        const accountHash = digest('recovery-key', recoveryKey);
        const account = {version: 1, type: 'account', accountId: randomUUID(), label: label.trim(), createdAt: now()};
        const file = join(accountsDir, accountHash + '.json');
        try { await exclusiveJson(file, signed(account)); } catch (error) {
          if (error.code === 'EEXIST') continue;
          throw fail(503, '개인 계정을 저장할 수 없습니다.');
        }
        let created;
        try { created = await newSession(account, accountHash); } catch (error) { await unlink(file).catch(() => {}); throw error; }
        joinBucket.count++;
        return {...created, recoveryKey};
      }
      throw fail(503, '개인 계정을 만들 수 없습니다.');
    }));
  }
  async function login(input, remoteAddress) {
    return limited(remoteAddress, 'login', input?.recoveryKey, async () => {
      if (!plain(input) || typeof input.recoveryKey !== 'string' || !KEY.test(input.recoveryKey)) throw fail(401, '개인 키를 확인해 주세요.');
      const accountHash = digest('recovery-key', input.recoveryKey);
      const account = await load(join(accountsDir, accountHash + '.json'), accountValid);
      if (!account) throw fail(401, '개인 키를 확인해 주세요.');
      const loginBucket = bucket(logins, remoteAddress, JOIN_MS);
      if (loginBucket.count >= maxLoginsPerHour) throw fail(429, '이 접속 주소의 시간당 로그인 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.');
      loginBucket.count++;
      try { return await newSession(account, accountHash); } catch (error) { loginBucket.count--; throw error; }
    });
  }
  function cookieToken(header) {
    if (typeof header !== 'string' || header.length > 8192 || CONTROL.test(header)) return null;
    const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith(COOKIE + '='));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(COOKIE.length + 1);
    return TOKEN.test(token) ? token : null;
  }
  async function authenticate(header) {
    const token = cookieToken(header);
    if (!token) return null;
    const file = join(sessionsDir, digest('session-token', token) + '.json');
    const session = await load(file, sessionValid);
    if (!session) return null;
    const time = now();
    if (session.expiresAt <= time || session.createdAt > time) return null;
    const account = await load(join(accountsDir, session.accountHash + '.json'), accountValid);
    if (!account || account.accountId !== session.accountId || account.label !== session.label || account.createdAt > session.createdAt) return null;
    return publicSession(session);
  }
  async function logout(header) {
    const token = cookieToken(header);
    if (!token) return false;
    const name = digest('session-token', token) + '.json';
    const result = sessionQueue.then(async () => {
      try { await unlink(join(sessionsDir, name)); sessionIndex?.delete(name); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw fail(503, '세션을 종료할 수 없습니다.'); }
    });
    sessionQueue = result.catch(() => {});
    return result;
  }
  function cookie(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw fail(500, '잘못된 세션 쿠키입니다.');
    return `${COOKIE}=${token}; Max-Age=${SESSION_MS / 1000}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }
  function clearCookie() { return `${COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`; }
  function sessionInfo(session) { return {mode: 'classroom', authenticated: !!session, ...(session ? {accountId: session.accountId, label: session.label, csrfToken: session.csrfToken, expiresAt: session.expiresAt} : {}), aiMode: 'personal_handoff'}; }
  return {origin, secure, join: joinAccount, login, authenticate, logout, sessionInfo, cookie, clearCookie};
}

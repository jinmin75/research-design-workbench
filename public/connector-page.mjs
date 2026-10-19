const PROTOCOL = 'rdw-connector-v1';
const PROVIDERS = new Map([['codex', 'GPT · Codex'], ['claude', 'Claude'], ['gemini', 'Gemini API']]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
const safeText = (value, length = 1200) => typeof value === 'string' ? value.slice(0, length) : '';

export function allowedPeerOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  } catch { return false; }
}
export function projectConnectorStatus(value) {
  return {
    mode: safeText(value?.mode, 80), checkedAt: safeText(value?.checkedAt, 80),
    providers: (Array.isArray(value?.providers) ? value.providers : []).filter(provider => PROVIDERS.has(provider?.id)).map(provider => ({
      id: provider.id, label: safeText(provider.label, 100), mode: safeText(provider.mode, 80), status: safeText(provider.status, 100),
      available: provider.available === true, detail: safeText(provider.detail), model: safeText(provider.model, 120),
      lastAttempt: object(provider.lastAttempt) ? { status: safeText(provider.lastAttempt.status, 100), code: safeText(provider.lastAttempt.code, 100), at: safeText(provider.lastAttempt.at, 80) } : null
    }))
  };
}
function readContext(value) {
  if (!object(value)) throw failure('INVALID_CONTEXT', '연구 설명과 질문 답변을 포함한 맥락이 필요합니다.');
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw failure('INVALID_CONTEXT', '연구 맥락을 읽을 수 없습니다.'); }
  if (new TextEncoder().encode(serialized).byteLength > 48_000) throw failure('CONTEXT_TOO_LARGE', '전송할 연구 맥락은 48 KB 이하여야 합니다.');
  return JSON.parse(serialized);
}

// The opener proves its source and origin; only a click here authorizes that origin.
export function createConnectorPage({ windowObject = window, documentObject = document, fetcher = windowObject.fetch.bind(windowObject), timeoutMs = 120_000 } = {}) {
  const element = id => documentObject.getElementById(id);
  const schedule = windowObject.setTimeout?.bind(windowObject) || setTimeout;
  const cancelTimer = windowObject.clearTimeout?.bind(windowObject) || clearTimeout;
  const duration = Math.min(120_000, Math.max(100, Number(timeoutMs) || 120_000));
  const random = new Uint8Array(32); windowObject.crypto.getRandomValues(random);
  const channel = Array.from(random, value => value.toString(16).padStart(2, '0')).join('');
  let csrfToken = '', pendingOrigin = '', deniedOrigin = '', peer = null, active = null, manualBusy = false, helloTimer = null;
  let loginButtons = [], lastStatus = { providers: [] };

  const showMessage = text => { element('message').textContent = text; };
  function updateControls() {
    const busy = Boolean(active || manualBusy);
    element('refresh').disabled = busy;
    element('approve').disabled = busy;
    for (const id of ['gemini-api-key', 'gemini-api-model', 'gemini-api-ack', 'gemini-key-save', 'gemini-key-delete']) element(id).disabled = busy;
    for (const button of loginButtons) button.disabled = busy;
  }
  function send(data, origin = peer?.origin) {
    if (!windowObject.opener || !origin) return;
    try { windowObject.opener.postMessage({ protocol: PROTOCOL, channel, ...data }, origin); }
    catch { showMessage('연구 작업실 창에 응답을 전달하지 못했습니다. 다시 연결해 주세요.'); }
  }
  function hello() {
    if (!windowObject.opener || peer) return;
    // No project data, credentials or local CSRF token are included in hello.
    send({ type: 'hello' }, '*');
    helloTimer = schedule(hello, 400);
  }
  async function api(path, body, signal) {
    const response = await fetcher(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Connector-Token': csrfToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let data;
    try { data = await response.json(); }
    catch { throw failure('CONNECTOR_INVALID_RESPONSE', '로컬 연결기의 응답 형식을 확인하지 못했습니다.'); }
    if (!response.ok) throw failure(safeText(data?.code, 100) || 'CONNECTOR_REQUEST_FAILED', safeText(data?.error || data?.message) || '로컬 구독 도구가 요청을 완료하지 못했습니다.');
    return data;
  }
  async function session() {
    if (csrfToken) return;
    const data = await api('/api/connector/session');
    if (typeof data?.csrfToken !== 'string' || !data.csrfToken || data.csrfToken.length > 512) throw failure('CONNECTOR_SESSION_FAILED', '로컬 연결 승인 정보를 받지 못했습니다.');
    csrfToken = data.csrfToken;
  }
  function renderStatus(value) {
    const status = projectConnectorStatus(value), container = element('providers');lastStatus = status;
    container.replaceChildren(); loginButtons = [];
    for (const [id, label] of PROVIDERS) {
      const provider = status.providers.find(item => item.id === id);
      const row = documentObject.createElement('div'); row.className = 'provider';
      const name = documentObject.createElement('strong'); name.textContent = label; row.append(name);
      const detail = documentObject.createElement('p');
      detail.textContent = provider ? `${id === 'gemini' && provider.status === 'configured_unverified' ? '키 형식 등록 · 실제 API 응답 미확인' : provider.status}: ${provider.detail}${provider.model ? ` · 모델 ${provider.model}` : ''}` : '상태를 확인하지 못했습니다.'; row.append(detail);
      if (id === 'gemini') { const hint = documentObject.createElement('p'); hint.textContent = 'Gemini는 구독 로그인 대신 아래의 개인 API 키 설정을 사용합니다.'; row.append(hint); container.append(row); continue; }
      const button = documentObject.createElement('button'); button.type = 'button'; button.textContent = `${label} 공식 로그인 시작`;
      button.disabled = Boolean(active || manualBusy);
      button.addEventListener('click', () => manualLogin(id)); loginButtons.push(button); row.append(button); container.append(row);
    }
    return status;
  }
  async function refreshStatus() {
    if (active || manualBusy) return;
    manualBusy = true; updateControls();
    try { await session(); renderStatus(await api('/api/connector/status')); showMessage('공식 도구의 현재 상태를 확인했습니다. 실제 AI 응답은 별도 요청 후 확인합니다.'); }
    catch (cause) { showMessage(cause.message); }
    finally { manualBusy = false; updateControls(); }
  }
  async function manualLogin(provider) {
    if (active || manualBusy) return;
    if (provider === 'gemini') { showMessage('Gemini는 아래의 개인 API 키 설정을 사용합니다.'); return; }
    manualBusy = true; updateControls();
    showMessage(`${PROVIDERS.get(provider)}의 공식 로그인 시작을 요청하고 있습니다.`);
    try {
      await session(); const result = await api('/api/connector/login', { provider });
      showMessage(safeText(result?.message) || '공식 로그인 시작을 요청했습니다. 로그인 후 상태를 다시 확인하세요. 인증 완료로 처리하지 않았습니다.');
    } catch (cause) { showMessage(cause.message); }
    finally { manualBusy = false; updateControls(); }
  }
  async function configureGemini(remove = false) {
    if (active || manualBusy) return;
    const keyInput = element('gemini-api-key'), apiKey = remove ? '' : String(keyInput.value || '').trim();
    keyInput.value = '';
    const model = element('gemini-api-model').value || 'gemini-3.8-flash';
    if (!['gemini-3.8-flash', 'gemini-3.5-flash-lite'].includes(model)) { showMessage('지원하는 Gemini API 모델을 선택해 주세요. 키 입력값은 지웠습니다.'); return; }
    if (!remove && (!apiKey || element('gemini-api-ack').checked !== true)) { showMessage('API 키와 18세 이상·이용 조건 확인이 필요합니다. 키 입력값은 지웠습니다.'); return; }
    manualBusy = true; updateControls();
    try {
      await session();
      const result = await api('/api/connector/gemini-key', { apiKey, model, acknowledged: true });
      const provider = projectConnectorStatus({ providers: [result?.provider] }).providers[0];
      if (!provider || provider.id !== 'gemini') throw failure('INVALID_CONFIGURATION_STATUS', 'Gemini 설정 상태를 확인하지 못했습니다.');
      const metadata = { ...provider, mode: 'api_key', status: remove ? 'key_required' : 'configured_unverified', available: !remove && provider.available, model: provider.model || model, lastAttempt: null };
      renderStatus({ ...lastStatus, providers: [...lastStatus.providers.filter(item => item.id !== 'gemini'), metadata] });
      showMessage(remove ? '이 프로세스의 Gemini API 키를 삭제했습니다. 이미 처리된 사용량·요금은 취소되지 않습니다.' : 'Gemini API 키 형식을 등록했습니다. 프로세스 메모리에만 보관하며 종료하면 삭제합니다. 실제 API 응답은 아직 확인하지 않았습니다.');
    } catch { showMessage('Gemini API 키 설정을 완료하지 못했습니다. 입력값은 지웠습니다. 로컬 연결 상태와 키를 확인해 다시 입력해 주세요.'); }
    finally { manualBusy = false; updateControls(); }
  }
  function finish(current, result, cause) {
    if (active !== current) return;
    cancelTimer(current.timer); active = null;
    element('context-review').hidden = true; element('context-preview').textContent = '';
    element('send-context').disabled = false; updateControls();
    if (cause) send({ type: 'response', id: current.id, ok: false, error: { code: safeText(cause.code, 100) || 'CONNECTOR_ERROR', message: safeText(cause.message) || '요청을 완료하지 못했습니다.' } }, current.origin);
    else send({ type: 'response', id: current.id, ok: true, result }, current.origin);
  }
  function cancelActive(code = 'REQUEST_CANCELLED', message = '학생이 로컬 구독 요청을 취소했습니다. 자동 재시도하지 않았습니다.') {
    if (!active) return;
    const current = active; current.controller.abort(); finish(current, null, failure(code, message)); showMessage(message);
  }
  async function execute(current) {
    if (active !== current || current.running) return;
    current.running = true; element('send-context').disabled = true;
    try {
      await session();
      if (active !== current) return;
      if (current.operation === 'status') {
        const result = renderStatus(await api('/api/connector/status', undefined, current.controller.signal));
        finish(current, result);
      } else if (current.operation === 'login') {
        const result = await api('/api/connector/login', { provider: current.provider }, current.controller.signal);
        const message = safeText(result?.message) || '공식 로그인 시작을 요청했습니다. 로그인 완료와 실제 응답은 아직 확인하지 않았습니다.';
        showMessage(message);
        finish(current, { provider: current.provider, started: result?.started === true || result?.status === 'login_started', status: safeText(result?.status, 100), message });
      } else {
        showMessage(`${PROVIDERS.get(current.provider)}에 승인한 연구 맥락을 보내고 있습니다.`);
        const result = await api('/api/connector/assist', { provider: current.provider, context: current.context, consent: true }, current.controller.signal);
        if (active !== current) return;
        if (!object(result?.draft)) throw failure('CONNECTOR_INVALID_RESPONSE', 'AI 설명 초안을 확인하지 못했습니다.');
        finish(current, { draft: result.draft });
        showMessage('실제 AI 응답을 연구 작업실로 전달했습니다. 연구 조건과 근거를 검토한 뒤 적용해 주세요.');
      }
    } catch (cause) {
      if (active === current) { finish(current, null, cause); showMessage(cause.message || '요청을 완료하지 못했습니다.'); }
    }
  }
  function disconnect() {
    cancelActive('CONNECTOR_DISCONNECTED', '연구 작업실 연결을 해제했습니다.');
    if (peer) send({ type: 'disconnected' });
    peer = null; pendingOrigin = ''; element('approval').hidden = true; element('disconnect').hidden = true;
    element('connection-status').textContent = '공유 연구 작업실과 연결되지 않았습니다.';
    showMessage('연구 작업실 연결을 해제했습니다. 공식 도구의 계정 로그인은 유지됩니다.');
  }
  function onMessage(event) {
    const data = event.data;
    if (!windowObject.opener || event.source !== windowObject.opener || !allowedPeerOrigin(event.origin) || !object(data) || data.protocol !== PROTOCOL) return;
    if (data.type === 'hello') {
      if (!data.channel) { send({ type: 'hello' }, event.origin); return; }
      if (data.channel !== channel) return;
      if (peer) { if (event.origin === peer.origin) send({ type: 'paired', origin: windowObject.location.origin }); return; }
      if (event.origin === deniedOrigin || (pendingOrigin && pendingOrigin !== event.origin)) return;
      pendingOrigin = event.origin; element('peer-origin').textContent = event.origin; element('approval').hidden = false;
      send({ type: 'approval_required' }, event.origin); return;
    }
    if (!peer || event.origin !== peer.origin || data.channel !== channel) return;
    if (data.type === 'disconnect') { disconnect(); return; }
    if (data.type === 'cancel') { if (active?.id === data.id) cancelActive(); return; }
    if (data.type !== 'request' || typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(data.id)) return;
    const reject = cause => send({ type: 'response', id: data.id, ok: false, error: { code: cause.code, message: cause.message } });
    if (active || manualBusy) return reject(failure('CONNECTOR_BUSY', '이전 요청을 완료하거나 취소한 뒤 다시 요청해 주세요.'));
    if (!['status', 'login', 'assist'].includes(data.operation)) return reject(failure('INVALID_OPERATION', '지원하지 않는 연결 요청입니다.'));
    if (data.operation !== 'status' && !PROVIDERS.has(data.provider)) return reject(failure('UNKNOWN_PROVIDER', '지원하는 구독 도구를 선택해 주세요.'));
    if (data.operation === 'login' && data.provider === 'gemini') return reject(failure('API_KEY_REQUIRED', 'Gemini는 개인 연결기 창에서 API 키를 직접 설정해 주세요.'));
    let context;
    if (data.operation === 'assist') {
      if (data.consent !== true) return reject(failure('CONSENT_REQUIRED', '연구 작업실에서 AI 요청에 먼저 동의해 주세요.'));
      try { context = readContext(data.context); }
      catch (cause) { return reject(cause); }
    }
    const current = { id: data.id, origin: peer.origin, operation: data.operation, provider: data.provider, context, controller: new AbortController(), running: false };
    active = current; updateControls();
    current.timer = schedule(() => cancelActive('CONNECTOR_TIMEOUT', '로컬 구독 요청의 제한 시간이 지났습니다. 자동 재시도하지 않았습니다.'), duration);
    if (data.operation === 'assist') {
      element('context-preview').textContent = JSON.stringify(context, null, 2);
      element('request-provider').textContent = `선택한 제공자: ${PROVIDERS.get(data.provider)}`;
      element('context-review').hidden = false; element('send-context').disabled = false;
      showMessage('연구 맥락을 확인하고 이 창에서 전송을 승인해 주세요. 아직 AI에 보내지 않았습니다.');
    } else execute(current);
  }
  element('approve').addEventListener('click', () => {
    if (!pendingOrigin || !windowObject.opener || peer) return;
    peer = { origin: pendingOrigin }; pendingOrigin = '';
    if (helloTimer) cancelTimer(helloTimer);
    element('approval').hidden = true; element('disconnect').hidden = false;
    element('connection-status').textContent = `승인한 연구 작업실: ${peer.origin}`;
    send({ type: 'paired', origin: windowObject.location.origin });
    showMessage('연구 작업실 연결을 승인했습니다. AI 요청은 맥락을 확인한 뒤 매번 따로 승인합니다.');
  });
  element('reject').addEventListener('click', () => {
    if (pendingOrigin) { deniedOrigin = pendingOrigin; send({ type: 'denied' }, pendingOrigin); }
    pendingOrigin = ''; element('approval').hidden = true; showMessage('이 사이트의 연결을 거절했습니다. 다시 연결하려면 이 창을 새로 여세요.');
  });
  element('refresh').addEventListener('click', refreshStatus);
  element('disconnect').addEventListener('click', disconnect);
  element('send-context').addEventListener('click', () => { if (active?.operation === 'assist') execute(active); });
  element('cancel-request').addEventListener('click', () => cancelActive());
  element('gemini-key-save').addEventListener('click', () => configureGemini());
  element('gemini-key-delete').addEventListener('click', () => configureGemini(true));
  windowObject.addEventListener('message', onMessage);
  windowObject.addEventListener('beforeunload', () => { if (peer) send({ type: 'disconnected' }); active?.controller.abort(); });
  if (windowObject.opener) hello();
  else showMessage('공식 도구의 로그인 상태를 이 창에서 확인할 수 있습니다. 공유 연구 작업실에서 개인 구독 연결 버튼을 눌러 이 창을 여세요.');
  renderStatus({ providers: [] });
  const ready = Promise.resolve();
  return { ready, disconnect };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') createConnectorPage();

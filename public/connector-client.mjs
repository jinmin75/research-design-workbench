const PROTOCOL = 'rdw-connector-v1';
const CHANNEL = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set(['status', 'login', 'assist']);
const PROVIDERS = new Set(['codex', 'claude', 'gemini']);
const CONTEXT_LIMIT = 48_000;
const error = (code, message) => Object.assign(new Error(message), { code });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createConnectorClient({ windowObject = window, origin = 'http://127.0.0.1:4319', timeoutMs = 120_000 } = {}) {
  const connectorOrigin = new URL(origin);
  if (connectorOrigin.origin !== origin || connectorOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(connectorOrigin.hostname)) {
    throw error('INVALID_CONNECTOR_ORIGIN', '연결기는 이 컴퓨터의 localhost 주소만 사용할 수 있습니다.');
  }
  const duration = Math.min(120_000, Math.max(100, Number(timeoutMs) || 120_000));
  const schedule = windowObject.setTimeout?.bind(windowObject) || setTimeout;
  const cancelTimer = windowObject.clearTimeout?.bind(windowObject) || clearTimeout;
  let popup = null, channel = '', paired = false, connecting = null, pending = null, monitor = null, sequence = 0;

  function post(message) {
    try { popup?.postMessage({ protocol: PROTOCOL, ...message }, origin); }
    catch { disconnectWith(error('CONNECTOR_UNAVAILABLE', '로컬 연결 창에 메시지를 전달하지 못했습니다.')); }
  }
  function clearPending(failure) {
    if (!pending) return;
    const current = pending; pending = null;
    cancelTimer(current.timer);
    current.reject(failure);
  }
  function disconnectWith(failure) {
    paired = false; channel = '';
    if (monitor) cancelTimer(monitor);
    monitor = null;
    if (connecting) {
      const current = connecting; connecting = null;
      cancelTimer(current.timer); current.reject(failure);
    }
    clearPending(failure);
    popup = null;
  }
  function watch() {
    if (!popup) return;
    if (popup.closed) return disconnectWith(error('CONNECTOR_CLOSED', '로컬 연결 창이 닫혔습니다. 다시 연결해 주세요.'));
    // A popup which loads after its first hello can receive a second handshake.
    if (!paired) post({ type: 'hello', ...(channel ? { channel } : {}) });
    if (popup) monitor = schedule(watch, 400);
  }
  function onMessage(event) {
    const data = event.data;
    if (!popup || event.source !== popup || event.origin !== origin || !object(data) || data.protocol !== PROTOCOL) return;
    if (data.type === 'hello' && CHANNEL.test(data.channel || '')) {
      if (paired || (channel && channel !== data.channel)) return;
      channel = data.channel;
      post({ type: 'hello', channel });
      return;
    }
    if (!channel || data.channel !== channel) return;
    if (data.type === 'paired' && data.origin === origin && connecting) {
      const current = connecting; connecting = null;
      cancelTimer(current.timer); paired = true;
      current.resolve({ origin, protocol: PROTOCOL });
    } else if (data.type === 'denied' && connecting) {
      disconnectWith(error('CONNECTOR_DENIED', '로컬 연결 창에서 이 사이트의 연결을 거절했습니다.'));
    } else if (data.type === 'disconnected') {
      disconnectWith(error('CONNECTOR_DISCONNECTED', '로컬 연결이 해제되었습니다. 다시 연결해 주세요.'));
    } else if (data.type === 'response' && paired && pending && data.id === pending.id) {
      const current = pending; pending = null;
      cancelTimer(current.timer);
      if (data.ok === true) current.resolve(data.result);
      else current.reject(error(typeof data.error?.code === 'string' ? data.error.code : 'CONNECTOR_ERROR', typeof data.error?.message === 'string' ? data.error.message : '로컬 구독 도구가 요청을 완료하지 못했습니다.'));
    }
  }
  windowObject.addEventListener('message', onMessage);

  function connect() {
    if (paired && popup && !popup.closed) return Promise.resolve({ origin, protocol: PROTOCOL });
    if (connecting && popup && !popup.closed) { popup.focus?.(); return connecting.promise; }
    if (popup?.closed) disconnectWith(error('CONNECTOR_CLOSED', '로컬 연결 창이 닫혔습니다.'));
    // This must run during the user's click, before any await or network request.
    popup = windowObject.open(`${origin}/connect`, 'rdw-local-subscription', 'popup,width=720,height=800');
    if (!popup) return Promise.reject(error('POPUP_BLOCKED', '브라우저가 로컬 연결 창을 차단했습니다. 이 사이트의 팝업을 허용한 뒤 다시 연결해 주세요.'));
    paired = false; channel = '';
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    connecting = { promise, resolve, reject, timer: schedule(() => disconnectWith(error('CONNECTOR_TIMEOUT', '로컬 연결 승인을 제한 시간 안에 받지 못했습니다. 연결기 실행과 승인 화면을 확인해 주세요.')), duration) };
    watch();
    return promise;
  }
  function request(operation, payload = {}) {
    if (!OPERATIONS.has(operation)) return Promise.reject(error('INVALID_OPERATION', '지원하지 않는 연결 요청입니다.'));
    if (!paired || !popup || popup.closed) {
      if (popup?.closed) disconnectWith(error('CONNECTOR_CLOSED', '로컬 연결 창이 닫혔습니다.'));
      return Promise.reject(error('CONNECTOR_NOT_CONNECTED', '로컬 구독 연결을 먼저 승인해 주세요.'));
    }
    if (pending) return Promise.reject(error('CONNECTOR_BUSY', '이전 요청을 완료하거나 취소한 뒤 다시 요청해 주세요.'));
    if (operation !== 'status' && !PROVIDERS.has(payload.provider)) return Promise.reject(error('UNKNOWN_PROVIDER', '지원하는 구독 도구를 선택해 주세요.'));
    let context;
    if (operation === 'assist') {
      if (payload.consent !== true) return Promise.reject(error('CONSENT_REQUIRED', '보낼 연구 맥락을 확인하고 AI 요청에 동의해 주세요.'));
      if (!object(payload.context)) return Promise.reject(error('INVALID_CONTEXT', '연구 안내를 먼저 갱신해 주세요.'));
      try {
        const serialized = JSON.stringify(payload.context);
        if (new TextEncoder().encode(serialized).byteLength > CONTEXT_LIMIT) throw error('CONTEXT_TOO_LARGE', '전송할 연구 맥락은 48 KB 이하여야 합니다.');
        context = JSON.parse(serialized);
      } catch (cause) { return Promise.reject(cause?.code ? cause : error('INVALID_CONTEXT', '연구 맥락을 읽을 수 없습니다.')); }
    }
    const id = `request-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, timer: schedule(() => {
        if (pending?.id !== id) return;
        post({ type: 'cancel', channel, id });
        clearPending(error('CONNECTOR_TIMEOUT', '로컬 구독 요청의 제한 시간이 지났습니다. 자동 재시도하지 않았습니다.'));
      }, duration) };
      post({ type: 'request', channel, id, operation, ...(operation !== 'status' ? { provider: payload.provider } : {}), ...(context ? { context, consent: true } : {}) });
    });
  }
  function disconnect() {
    if (popup && channel) post({ type: 'disconnect', channel });
    disconnectWith(error('CONNECTOR_DISCONNECTED', '로컬 구독 연결을 해제했습니다.'));
  }
  return { connect, request, disconnect, isConnected: () => Boolean(paired && popup && !popup.closed) };
}

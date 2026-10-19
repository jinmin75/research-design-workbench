import {buildAssistBrief} from './subscription-ai.mjs';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_MODELS = Object.freeze([DEFAULT_GEMINI_MODEL, 'gemini-3.5-flash-lite']);
const API_ORIGIN = 'https://generativelanguage.googleapis.com';
const MAX_RESPONSE_BYTES = 256_000;
const MAX_TEXT_BYTES = 60_000;
const MAX_SIGNATURE_BYTES = 128_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeToExpose = true;
  return error;
}

function httpFailure(status) {
  if (status === 401 || status === 403) return fail('GEMINI_API_AUTH', 'Gemini API 키의 권한과 프로젝트 설정을 확인해 주세요. 구독 계정으로 전환하지 않았습니다.');
  if (status === 429) return fail('GEMINI_API_LIMIT', 'Gemini API의 요청 또는 사용 한도에 도달했습니다. 자동 재시도하거나 다른 모델로 전환하지 않았습니다.');
  if (status === 404) return fail('GEMINI_API_MODEL', '선택한 Gemini API 모델을 이 프로젝트에서 사용할 수 없습니다. 다른 모델로 전환하지 않았습니다.');
  if (status >= 500) return fail('GEMINI_API_UNAVAILABLE', 'Gemini API가 요청을 완료하지 못했습니다. 자동 재시도하지 않았습니다.');
  return fail('GEMINI_API_REQUEST', 'Gemini API가 요청을 받아들이지 않았습니다. 키와 모델 설정을 확인해 주세요.');
}

async function boundedResponse(response, signal) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel?.().catch(() => {});
    throw fail('GEMINI_API_OUTPUT_LIMIT', 'Gemini API 응답이 허용 크기를 넘었습니다.');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw fail('GEMINI_API_RESPONSE', 'Gemini API의 응답 형식을 확인하지 못했습니다.');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw fail('GEMINI_API_CANCELLED', 'Gemini API 요청을 취소했습니다. 이미 처리된 사용량까지 취소되지는 않습니다.');
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw fail('GEMINI_API_OUTPUT_LIMIT', 'Gemini API 응답이 허용 크기를 넘었습니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
  catch { throw fail('GEMINI_API_RESPONSE', 'Gemini API의 JSON 응답을 확인하지 못했습니다.'); }
  return payload;
}

function responseText(payload) {
  if (!payload || typeof payload !== 'object' || payload.error) throw fail('GEMINI_API_RESPONSE', 'Gemini API 응답을 설명 초안으로 사용할 수 없습니다.');
  if (payload.promptFeedback?.blockReason || payload.promptFeedback?.safetyRatings?.some(item => item?.blocked === true)) {
    throw fail('GEMINI_API_BLOCKED', 'Gemini API가 이 요청을 차단했습니다. 응답 초안으로 저장하지 않았습니다.');
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) throw fail('GEMINI_API_RESPONSE', 'Gemini API의 단일 응답 초안을 확인하지 못했습니다.');
  const candidate = payload.candidates[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw fail('GEMINI_API_TRUNCATED', 'Gemini API 응답이 길이 한도로 중단되었습니다. 불완전한 초안을 저장하지 않았습니다.');
  if (candidate?.finishReason !== 'STOP' || candidate?.safetyRatings?.some(item => item?.blocked === true)) {
    throw fail('GEMINI_API_BLOCKED', 'Gemini API 응답이 정상적으로 완료되지 않았습니다. 응답 초안으로 저장하지 않았습니다.');
  }
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts) || !parts.length || parts.some(part => {
    if (!part || typeof part.text !== 'string' || Object.keys(part).some(key => !['text', 'thoughtSignature'].includes(key))) return true;
    return Object.hasOwn(part, 'thoughtSignature') && (typeof part.thoughtSignature !== 'string' || Buffer.byteLength(part.thoughtSignature, 'utf8') > MAX_SIGNATURE_BYTES);
  })) {
    throw fail('GEMINI_API_NON_TEXT', 'Gemini API 응답에 텍스트 외의 내용이 포함되어 초안으로 사용하지 않았습니다.');
  }
  // Final text can carry an opaque signature. This single-turn app discards it;
  // it is never a draft, saved metadata, or input for a subsequent request.
  const result = parts.map(part => part.text).join('');
  if (!result.trim()) throw fail('GEMINI_API_RESPONSE', 'Gemini API가 비어 있는 응답을 반환했습니다.');
  if (Buffer.byteLength(result, 'utf8') > MAX_TEXT_BYTES) throw fail('GEMINI_API_OUTPUT_LIMIT', 'Gemini API 설명 초안이 허용 크기를 넘었습니다.');
  return result;
}

// Credentials live only in this instance's closure. Status and failures never contain provider payloads.
export function createGeminiApi({fetchImpl = fetch, timeoutMs = 90_000} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const requestTimeout = Number.isFinite(timeoutMs) ? Math.min(90_000, Math.max(1, timeoutMs)) : 90_000;
  let credential = '';
  let selectedModel = DEFAULT_GEMINI_MODEL;
  let busy = false;
  let ready = false;
  let lastAttempt = null;

  function status() {
    return {
      id: 'gemini', label: 'Gemini API', mode: 'api_key',
      status: credential ? ready ? 'ready' : 'configured_unverified' : 'key_required',
      available: Boolean(credential), model: selectedModel, busy,
      lastAttempt: lastAttempt ? {...lastAttempt} : null,
      detail: credential ? '이 실행 세션에만 API 키가 설정되어 있습니다. API 과금·한도가 적용되며 연구 타당성은 검증하지 않습니다.' : 'Google AI Studio의 Gemini API 키를 입력해 주세요. Gemini 구독과 API 과금·한도는 별개입니다.'
    };
  }

  function configure({apiKey, model = selectedModel, acknowledged} = {}) {
    if (busy) throw fail('GEMINI_API_BUSY', 'Gemini API 요청이 진행 중입니다. 완료 또는 취소 후 설정을 바꿔 주세요.');
    if (typeof apiKey !== 'string') throw fail('GEMINI_API_KEY_INVALID', 'Gemini API 키를 문자열로 입력해 주세요.');
    if (!GEMINI_MODELS.includes(model)) throw fail('GEMINI_API_MODEL', '지원하는 Gemini API 모델을 선택해 주세요.');
    const nextCredential = apiKey.trim();
    if (nextCredential && (nextCredential.length < 20 || nextCredential.length > 512 || !/^[A-Za-z0-9._-]+$/.test(nextCredential))) {
      throw fail('GEMINI_API_KEY_INVALID', 'Gemini API 키의 형식을 확인해 주세요. 키 값은 오류 메시지에 표시하지 않습니다.');
    }
    if (nextCredential && acknowledged !== true) throw fail('GEMINI_API_ACK_REQUIRED', 'Gemini API의 별도 과금·한도와 Google 전송 조건을 확인해 주세요.');
    credential = nextCredential;
    selectedModel = model;
    ready = false;
    lastAttempt = null;
    return status();
  }

  async function assist(context, {signal} = {}) {
    if (signal?.aborted) throw fail('GEMINI_API_CANCELLED', '이미 취소한 Gemini API 요청입니다.');
    if (!credential) throw fail('GEMINI_API_KEY_REQUIRED', '이 실행 세션에 Gemini API 키를 먼저 입력해 주세요.');
    if (busy) throw fail('GEMINI_API_BUSY', '다른 Gemini API 요청이 진행 중입니다. 완료 후 다시 요청해 주세요.');
    const brief = buildAssistBrief(context);
    const activeCredential = credential;
    const activeModel = selectedModel;
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    busy = true;
    try {
      const response = await fetchImpl(`${API_ORIGIN}/v1beta/models/${activeModel}:generateContent`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/json', 'x-goog-api-key': activeCredential},
        body: JSON.stringify({contents: [{role: 'user', parts: [{text: brief}]}], generationConfig: {candidateCount: 1, maxOutputTokens: 8192, responseMimeType: 'application/json'}})
      });
      if (!response || !Number.isInteger(response.status)) throw fail('GEMINI_API_RESPONSE', 'Gemini API의 응답을 확인하지 못했습니다.');
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel?.().catch(() => {});
        throw httpFailure(response.status);
      }
      const payload = await boundedResponse(response, controller.signal);
      if (controller.signal.aborted) throw fail('GEMINI_API_CANCELLED', 'Gemini API 요청을 취소했습니다.');
      const text = responseText(payload).split(activeCredential).join('[API 키 삭제됨]');
      const at = new Date().toISOString();
      ready = true;
      lastAttempt = {at, status: 'succeeded', code: null, message: '실제 Gemini API 설명 초안을 받았습니다. 연구 적합성과 계산을 검증한 결과는 아닙니다.'};
      return {text, provider: 'gemini', at, mode: 'live_api', status: 'unverified_draft', model: activeModel, inputFingerprint: context.inputFingerprint, knowledgeFingerprint: context.knowledgeFingerprint || null};
    } catch (error) {
      const safeError = timedOut
        ? fail('GEMINI_API_TIMEOUT', 'Gemini API가 제한 시간 안에 응답하지 않았습니다. 자동 재시도하지 않았습니다.')
        : controller.signal.aborted
          ? fail('GEMINI_API_CANCELLED', 'Gemini API 요청을 취소했습니다. 이미 처리된 사용량까지 취소되지는 않습니다.')
          : error?.safeToExpose ? error : fail('GEMINI_API_NETWORK', 'Gemini API 연결을 완료하지 못했습니다. 네트워크 상태를 확인해 주세요. 자동 재시도하지 않았습니다.');
      ready = false;
      lastAttempt = {at: new Date().toISOString(), status: 'failed', code: safeError.code, message: safeError.message};
      throw safeError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      busy = false;
    }
  }
  return {configure, status, assist};
}

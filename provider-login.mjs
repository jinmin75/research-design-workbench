import { spawn } from 'node:child_process';
import { mkdtemp, rmdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDERS = ['codex', 'claude', 'gemini'];
const LOGIN_SCRIPT = fileURLToPath(new URL('./scripts/Provider-Login.ps1', import.meta.url));
const COOLDOWN_MS = 10_000;
const ENV_KEYS = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'CODEX_HOME']);

function fail(code, message) {
  return Object.assign(new Error(message), { code, safeToExpose: true });
}

async function fileExists(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

function checkedPath(value, platform, scriptAllowed = true) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !api.isAbsolute(value) || /[\x00-\x1f\x7f"]/u.test(value)) {
    throw fail('INVALID_PROVIDER_PATH', '공식 도구의 서버 설정 경로를 확인해 주세요.');
  }
  const extension = api.extname(value).toLowerCase();
  if (platform === 'win32' && !['.exe', ...(scriptAllowed ? ['.js', '.mjs', '.cjs'] : [])].includes(extension)) {
    throw fail('INVALID_PROVIDER_PATH', '공식 도구의 실행 파일 또는 Node 스크립트를 지정해 주세요.');
  }
  return api.normalize(value);
}

function environmentValue(env, name) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
}

// Searches executable names and known package entry points only; it never executes a PATH shim.
export async function resolveProviderPaths({ home = homedir(), env = process.env, platform = process.platform } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const windows = platform === 'win32';
  const appData = environmentValue(env, 'APPDATA') || api.join(home, 'AppData', 'Roaming');
  const localData = environmentValue(env, 'LOCALAPPDATA') || api.join(home, 'AppData', 'Local');
  const pathDirectories = String(environmentValue(env, 'PATH') || '').split(windows ? ';' : ':').map(value => value.replace(/^"|"$/g, '')).filter(value => api.isAbsolute(value));
  const npmRoots = [...new Set([
    api.join(appData, 'npm', 'node_modules'),
    environmentValue(env, 'npm_config_prefix') && api.join(environmentValue(env, 'npm_config_prefix'), 'node_modules'),
    ...pathDirectories.flatMap(directory => [api.join(directory, 'node_modules'), api.join(directory, '..', 'lib', 'node_modules')])
  ].filter(Boolean))];
  const candidates = {
    codex: [
      ...(windows ? [api.join(localData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')] : []),
      ...pathDirectories.map(directory => api.join(directory, windows ? 'codex.exe' : 'codex')),
      ...npmRoots.map(root => api.join(root, '@openai', 'codex', 'bin', 'codex.js'))
    ],
    claude: [
      ...(windows ? [api.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), api.join(home, '.local', 'bin', 'claude.exe')] : [api.join(home, '.local', 'bin', 'claude')]),
      ...pathDirectories.map(directory => api.join(directory, windows ? 'claude.exe' : 'claude')),
      ...npmRoots.map(root => api.join(root, '@anthropic-ai', 'claude-code', 'cli.js'))
    ],
    gemini: [
      ...npmRoots.flatMap(root => [api.join(root, '@google', 'gemini-cli', 'bundle', 'gemini.js'), api.join(root, '@google', 'gemini-cli', 'dist', 'index.js')]),
      ...pathDirectories.map(directory => api.join(directory, windows ? 'gemini.exe' : 'gemini'))
    ]
  };
  const result = { node: process.execPath };
  for (const provider of PROVIDERS) {
    const override = environmentValue(env, `RESEARCH_${provider.toUpperCase()}_PATH`);
    if (override !== undefined && override !== '') {
      result[provider] = checkedPath(override, platform);
      continue;
    }
    const unique = [...new Set(candidates[provider].map(value => api.normalize(value)))];
    result[provider] = unique[0] || api.join(home, '.local', 'bin', provider);
    for (const candidate of unique) {
      if (await fileExists(candidate)) { result[provider] = candidate; break; }
    }
  }
  return result;
}

function loginEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => ENV_KEYS.has(key.toUpperCase()) && typeof value === 'string'));
}

function launchWindow(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', () => { void rmdir(options.cwd).catch(() => {}); });
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// This module starts official login UI only. The subscription bridge must independently check login status.
export function createProviderLogin({ paths, exists = fileExists, launch = launchWindow, clock = Date.now, platform = process.platform, scriptPath = LOGIN_SCRIPT } = {}) {
  const pending = new Set();
  const started = new Map();
  let resolved;
  const getPaths = async () => {
    if (!resolved) resolved = paths ? Promise.resolve({ node: process.execPath, ...paths }) : resolveProviderPaths({ platform });
    return resolved;
  };
  return {
    async start(provider) {
      if (!PROVIDERS.includes(provider)) throw fail('UNKNOWN_PROVIDER', '지원하는 연결을 선택해 주세요.');
      if (platform !== 'win32') throw fail('LOGIN_UNSUPPORTED_PLATFORM', '이 환경에서는 공식 CLI에서 직접 로그인한 뒤 연결 상태를 갱신해 주세요.');
      const now = Number(clock());
      if (pending.has(provider) || (started.has(provider) && now - started.get(provider) < COOLDOWN_MS)) {
        throw fail('LOGIN_IN_PROGRESS', '로그인 창을 이미 열었습니다. 창에서 로그인을 마친 뒤 연결 상태를 갱신해 주세요.');
      }
      pending.add(provider);
      let directory;
      try {
        const configured = await getPaths();
        const executable = checkedPath(configured[provider], platform);
        const node = checkedPath(configured.node, platform, false);
        if (!(await exists(executable)) || (/\.[cm]?js$/i.test(executable) && !(await exists(node)))) {
          throw fail('CLI_UNAVAILABLE', '이 PC에 공식 도구가 설치되어 있는지 확인해 주세요.');
        }
        if (!(await exists(scriptPath))) throw fail('LOGIN_START_FAILED', '로그인 실행 파일을 확인하지 못했습니다. 프로그램 설치 상태를 확인해 주세요.');
        directory = await mkdtemp(path.join(tmpdir(), 'rdw-provider-login-'));
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const command = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        await launch(command, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Provider', provider, '-Executable', executable, '-NodeExecutable', node], {
          cwd: directory, env: loginEnvironment(), shell: false, detached: false, windowsHide: false, stdio: 'ignore'
        });
        started.set(provider, now);
        return { provider, status: 'login_started', message: '이 PC에 공식 로그인 창을 열었습니다. 로그인 후 연결 상태를 갱신해 주세요. 아직 연결 완료를 확인한 상태는 아닙니다.' };
      } catch (error) {
        if (directory) await rmdir(directory).catch(() => {});
        if (error?.safeToExpose) throw error;
        throw fail('LOGIN_START_FAILED', '공식 로그인 창을 열지 못했습니다. 설치 상태와 로컬 실행 권한을 확인해 주세요.');
      } finally { pending.delete(provider); }
    },
    async status() {
      const configured = await getPaths();
      return { providers: await Promise.all(PROVIDERS.map(async id => {
        const installed = typeof configured[id] === 'string' && await exists(configured[id]);
        const lastStartedAt = started.has(id) ? new Date(started.get(id)).toISOString() : undefined;
        return { id, installed, status: installed ? (lastStartedAt ? 'login_started' : 'ready') : 'not_installed', message: installed ? '공식 도구의 로그인 상태는 연결 상태 갱신으로 확인합니다.' : '이 PC에 공식 도구를 설치해 주세요.', ...(lastStartedAt ? { lastStartedAt } : {}) };
      })) };
    }
  };
}

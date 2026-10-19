// Simple unweighted OLS with an intercept. No sampling inference is computed.
// NIST: pmd141.htm (least squares); pmd44.htm (residuals, limits of R²).
export const REGRESSION_ENGINE_VERSION = 'simple-ols-1.0.0';
const unsafe = () => { throw new RangeError('안전한 수치 범위를 벗어났습니다. 단위·크기를 검토하십시오.'); };
const finite = value => { if (!Number.isFinite(value)) unsafe(); return value; };
const MIN_NORMAL = 2 ** -1022;
function product(a, b) {
  const value = finite(a * b);
  if (a !== 0 && b !== 0 && Math.abs(value) < MIN_NORMAL) unsafe();
  return value;
}
function sum(values) {
  let total = 0, correction = 0;
  for (const value of values) {
    const next = finite(total + value);
    correction = finite(correction + (Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total));
    total = next;
  }
  return finite(total + correction);
}
function coordinates(values, allowConstant = false) {
  const ordered = [...values].sort((a, b) => a - b);
  const constant = ordered[0] === ordered.at(-1);
  if (constant && !allowConstant) throw new RangeError('X가 상수이면 기울기를 계산할 수 없습니다.');
  const origin = ordered[0] < 0 && ordered.at(-1) > 0 ? 0 : ordered[Math.floor(ordered.length / 2)];
  const shifted = values.map(value => finite(value - origin));
  const largest = Math.max(...shifted.map(Math.abs));
  const scale = largest === 0 ? 1 : 2 ** Math.min(1023, Math.floor(Math.log2(largest)));
  if (!(scale > 0)) unsafe();
  const normalized = shifted.map(value => {
    const normalizedValue = finite(value / scale);
    if (normalizedValue === 0 && value !== 0) unsafe();
    return normalizedValue;
  });
  const mean = sum(normalized) / values.length;
  const centered = normalized.map(value => finite(value - mean));
  return { origin, scale, mean, centered, constant };
}

export function fitSimpleOLS(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > 10000) throw new TypeError('1–10000개의 [x,y] 행이 필요합니다.');
  const rows = Array.from(pairs, (row, index) => {
    if (!Array.isArray(row) || row.length !== 2) throw new TypeError('각 행은 [x,y] 두 칸이어야 합니다.');
    const [x, y] = Array.from(row);
    for (const value of [x, y]) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('각 수치는 유한한 number 또는 null이어야 합니다. 자동 형변환하지 않습니다.');
    return { rowIndex: index + 1, x, y };
  });
  const completeRows = rows.filter(row => row.x !== null && row.y !== null);
  const n = completeRows.length;
  if (n < 3) throw new RangeError('단순 OLS 기술 요약에는 완전 쌍 3개 이상이 필요합니다.');
  const x = coordinates(completeRows.map(row => row.x));
  const y = coordinates(completeRows.map(row => row.y), true);
  const xx = sum(x.centered.map(value => product(value, value)));
  if (!(xx > 0)) unsafe();
  const yy = sum(y.centered.map(value => product(value, value)));
  const xy = sum(x.centered.map((value, index) => product(value, y.centered[index])));
  const normalizedSlope = finite(xy / xx);
  if (xy !== 0 && normalizedSlope === 0) unsafe();
  const scaleRatio = normalizedSlope === 0 ? 1 : finite(y.scale / x.scale);
  if (scaleRatio === 0 && normalizedSlope !== 0) unsafe();
  const slope = y.constant ? 0 : product(normalizedSlope, scaleRatio);
  // Keep mean offsets separate: rounding a large meanX first can corrupt a small intercept.
  const intercept = y.constant ? y.origin : sum([y.origin, -product(slope, x.origin), product(y.scale, y.mean), -product(slope, product(x.scale, x.mean))]);
  const normalizedResiduals = [];
  const observations = completeRows.map((row, index) => {
    const centeredFit = product(normalizedSlope, x.centered[index]);
    const normalizedResidual = finite(y.centered[index] - centeredFit);
    normalizedResiduals.push(normalizedResidual);
    const fitted = y.constant ? y.origin : finite(y.origin + product(y.scale, y.mean + centeredFit));
    // Centered subtraction retains residual precision when y has a large offset.
    const residual = y.constant ? 0 : product(y.scale, normalizedResidual);
    const leverage = finite(1 / n + product(x.centered[index], x.centered[index]) / xx);
    if (leverage < 0 || leverage > 1 + 1e-12) unsafe();
    return { ...row, fitted, residual, leverage: Math.min(1, leverage) };
  });
  const sse = sum(observations.map(row => product(row.residual, row.residual)));
  const mse = sse / n;
  if (sse !== 0 && mse < MIN_NORMAL) unsafe();
  let rSquared = null;
  if (!y.constant) {
    if (!(yy > 0)) unsafe();
    rSquared = finite(1 - sum(normalizedResiduals.map(value => product(value, value))) / yy);
    if (rSquared < -1e-12 || rSquared > 1 + 1e-12) unsafe();
    rSquared = Math.max(0, Math.min(1, rSquared));
  }
  return {
    summary: {
      total: rows.length, complete: n, missingPairs: rows.length - n,
      missingX: rows.filter(row => row.x === null).length,
      missingY: rows.filter(row => row.y === null).length,
      denominator: n, slope, intercept, rSquared, sse, rmse: Math.sqrt(mse),
      maxLeverage: Math.max(...observations.map(row => row.leverage)),
      maxAbsResidual: Math.max(...observations.map(row => Math.abs(row.residual))),
      constantY: y.constant,
    },
    observations,
  };
}

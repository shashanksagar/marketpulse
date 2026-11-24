export function ema(values: number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error("EMA period must be positive");
  let value: number | null = null;
  return values.map((close, i) => {
    if (!Number.isFinite(close)) throw new Error("Invalid EMA input");
    if (i < period - 1) return null;
    value = value === null ? values.slice(0, period).reduce((a, b) => a + b, 0) / period : close * (2 / (period + 1)) + value * (1 - 2 / (period + 1));
    return value;
  });
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (i <= period) { gain += Math.max(delta, 0) / period; loss += Math.max(-delta, 0) / period; }
    else { gain = (gain * (period - 1) + Math.max(delta, 0)) / period; loss = (loss * (period - 1) + Math.max(-delta, 0)) / period; }
  }
  return loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
}

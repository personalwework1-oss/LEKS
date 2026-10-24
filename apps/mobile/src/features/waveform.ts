const BARS = 48;

export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Squeezes loudness samples (dBFS) into a fixed number of bars between 0 and 1. */
export function toWaveform(samples: number[], bars = BARS): number[] {
  if (samples.length === 0) return [];
  const level = samples.map((db) => Math.min(1, Math.max(0, (db + 50) / 50)));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * level.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * level.length) / bars));
    const slice = level.slice(from, to);
    out.push(slice.length ? Math.max(...slice) : 0);
  }
  return out;
}

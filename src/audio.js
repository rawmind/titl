export class RingBuffer {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.total = 0;
  }

  get oldest() {
    return Math.max(0, this.total - this.buf.length);
  }

  push(chunk) {
    const cap = this.buf.length;
    for (let i = 0; i < chunk.length; i++) this.buf[(this.total + i) % cap] = chunk[i];
    this.total += chunk.length;
  }

  slice(start, end) {
    start = Math.max(start, this.oldest);
    const cap = this.buf.length;
    const out = new Float32Array(Math.max(0, end - start));
    for (let i = 0; i < out.length; i++) out[i] = this.buf[(start + i) % cap];
    return out;
  }
}

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export function encodeWav(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return view.buffer;
}

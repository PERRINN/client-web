export const MAX_VOICE_SAMPLES = 16000 * 30;

export function voiceWav(samples: Float32Array): Uint8Array {
  if (samples.length < 6400 || samples.length > MAX_VOICE_SAMPLES) throw new Error('Record between 0.4 and 30 seconds.');
  let energy = 0;
  for (const value of samples) energy += value * value;
  if (Math.sqrt(energy / samples.length) < 0.002) throw new Error('No speech detected. Try again.');
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => {
    const clipped = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + i * 2, Math.round(clipped * (clipped < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

export function voiceBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

const { createHash } = require('node:crypto');

class VoiceInputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A deliberately narrow format lets us enforce duration before paying a provider.
function validateInput(data) {
  const fail = () => { throw new VoiceInputError('invalid-argument', 'Record between 0.4 and 30 seconds of speech.'); };
  if (!data || Object.keys(data).some(key => !['requestId', 'audio', 'sourcePage'].includes(key))
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.requestId || '') || data.sourcePage !== '/prototypes/voice-input'
    || typeof data.audio !== 'string' || data.audio.length > 1280060
    || data.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.audio)) fail();
  const audio = Buffer.from(data.audio, 'base64');
  if (audio.length < 12844 || audio.length > 960044 || audio.toString('base64') !== data.audio
    || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.readUInt32LE(4) !== audio.length - 8
    || audio.toString('ascii', 8, 16) !== 'WAVEfmt ' || audio.readUInt32LE(16) !== 16
    || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
    || audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000
    || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
    || audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44
    || (audio.length - 44) % 2 !== 0) fail();
  let energy = 0;
  for (let i = 44; i < audio.length; i += 2) energy += (audio.readInt16LE(i) / 32768) ** 2;
  if (Math.sqrt(energy / ((audio.length - 44) / 2)) < 0.002) {
    throw new VoiceInputError('invalid-argument', 'No speech detected. Try again.');
  }
  return { audio, durationMs: (audio.length - 44) / 32,
    fingerprint: createHash('sha256').update(audio).digest('hex') };
}

module.exports = { VoiceInputError, validateInput };

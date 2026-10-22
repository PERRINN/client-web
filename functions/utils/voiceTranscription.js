const { VoiceInputError } = require('./voiceAudio');

async function transcribe(audio, { apiKey, model, fetcher = fetch }) {
  if (!apiKey || !model) throw new VoiceInputError('failed-precondition', 'Voice input is not configured.');
  const body = new FormData();
  body.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
  body.append('model', model);
  body.append('response_format', 'json');
  // One attempt only. A timeout may still have incurred a provider charge.
  try {
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body,
      signal: AbortSignal.timeout(40000)
    });
    if (!response.ok) throw new Error('Provider rejected request');
    const text = (await response.json())?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
      throw new VoiceInputError('failed-precondition', 'No transcript returned. Record again.');
    }
    return text.trim();
  } catch (error) {
    if (error instanceof VoiceInputError) throw error;
    // Never propagate provider bodies, audio, transcripts or credentials.
    throw new VoiceInputError('unavailable', 'Transcription failed. Record again.');
  }
}

module.exports = { transcribe };

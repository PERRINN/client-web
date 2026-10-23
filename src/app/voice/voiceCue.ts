// A short radio-style cue, followed by a brief tail before capture can begin.
export type VoiceCueEvent = 'scheduled' | 'ended' | 'timeout' | 'skipped' | 'failed';

export function voiceCue(context: AudioContext, opening: boolean, observe?: (event: VoiceCueEvent) => void): Promise<void> {
  let oscillator: OscillatorNode | undefined, gain: GainNode | undefined;
  const disconnect = () => { oscillator?.disconnect(); gain?.disconnect(); };
  // Diagnostic observers must never alter playback or recording behavior.
  const report = (event: VoiceCueEvent) => { try { observe?.(event); } catch { /* Best effort only. */ } };
  try {
    if (context.state !== 'running') { report('skipped'); return Promise.resolve(); }
    oscillator = context.createOscillator(); gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(opening ? 1040 : 920, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.07, now + .005);
    gain.gain.setValueAtTime(.07, now + .035);
    gain.gain.linearRampToValueAtTime(0, now + .06);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(now + .065);
    report('scheduled');
    return new Promise(resolve => {
      let tail: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(deadline); clearTimeout(tail);
        oscillator!.onended = null; disconnect(); resolve();
      };
      // Follow audio playback rather than a wall-clock estimate: iOS can pause
      // its audio timeline during route changes. Always release within 500 ms.
      const deadline = setTimeout(() => { report('timeout'); finish(); }, 500);
      oscillator!.onended = () => { report('ended'); tail = setTimeout(finish, 30); };
    });
  } catch {
    disconnect();
    report('failed');
    // Playback is optional: an unavailable cue must never prevent recording.
    return Promise.resolve();
  }
}

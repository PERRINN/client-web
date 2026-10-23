// A short radio-style cue, followed by a brief tail before capture can begin.
export function voiceCue(context: AudioContext, opening: boolean): Promise<void> {
  let oscillator: OscillatorNode | undefined, gain: GainNode | undefined;
  const disconnect = () => { oscillator?.disconnect(); gain?.disconnect(); };
  try {
    if (context.state !== 'running') return Promise.resolve();
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
    return new Promise(resolve => {
      let tail: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(deadline); clearTimeout(tail);
        oscillator!.onended = null; disconnect(); resolve();
      };
      // Follow audio playback rather than a wall-clock estimate: iOS can pause
      // its audio timeline during route changes. Always release within 500 ms.
      const deadline = setTimeout(finish, 500);
      oscillator!.onended = () => { tail = setTimeout(finish, 30); };
    });
  } catch {
    disconnect();
    // Playback is optional: an unavailable cue must never prevent recording.
    return Promise.resolve();
  }
}

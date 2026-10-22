// A short radio-style cue, followed by a brief tail before capture can begin.
export function voiceCue(context: AudioContext, opening: boolean): Promise<void> {
  let oscillator: OscillatorNode | undefined, gain: GainNode | undefined;
  const disconnect = () => { oscillator?.disconnect(); gain?.disconnect(); };
  try {
    if (context.state !== 'running') return Promise.resolve();
    oscillator = context.createOscillator(); gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'triangle';
    const frequencies = opening ? [1040] : [1040, 920];
    frequencies.forEach((frequency, index) => {
      const start = now + index * .09;
      oscillator!.frequency.setValueAtTime(frequency, start);
      gain!.gain.setValueAtTime(0, start);
      gain!.gain.linearRampToValueAtTime(.07, start + .005);
      gain!.gain.setValueAtTime(.07, start + .035);
      gain!.gain.linearRampToValueAtTime(0, start + .06);
    });
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(now + (frequencies.length - 1) * .09 + .065);
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

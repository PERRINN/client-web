// A short radio-style cue, followed by a brief tail before capture can begin.
export function voiceCue(context: AudioContext, opening: boolean): Promise<void> {
  let oscillator: OscillatorNode | undefined, gain: GainNode | undefined;
  const disconnect = () => { oscillator?.disconnect(); gain?.disconnect(); };
  try {
    if (context.state !== 'running') return Promise.resolve();
    oscillator = context.createOscillator(); gain = context.createGain();
    const now = context.currentTime;
    // A running context can still be warming up a newly activated audio route.
    // Render silence before the opening tone, rather than losing a 60 ms cue
    // at the edge of microphone acquisition. Use the same sequence on all devices.
    const start = now + (opening ? .25 : 0);
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(opening ? 1040 : 920, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.07, start + .005);
    gain.gain.setValueAtTime(.07, start + .035);
    gain.gain.linearRampToValueAtTime(0, start + .06);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(start + .065);
    return new Promise(resolve => {
      let tail: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(deadline); clearTimeout(tail);
        oscillator!.onended = null; disconnect(); resolve();
      };
      // onended marks rendering completion, not sound reaching the speaker.
      // Keep capture/teardown behind the output buffer plus the existing tail.
      // Older browsers may omit latency estimates; reject invalid values and
      // cap the additional wait at 500 ms. Stalled playback releases within 1 s.
      const deadline = setTimeout(finish, 1000);
      oscillator!.onended = () => {
        const latency = [context.baseLatency, context.outputLatency]
          .reduce((total, value) => total + (Number.isFinite(value) && value > 0 ? value : 0), 0);
        tail = setTimeout(finish, 30 + Math.min(.5, latency) * 1000);
      };
    });
  } catch {
    disconnect();
    // Playback is optional: an unavailable cue must never prevent recording.
    return Promise.resolve();
  }
}

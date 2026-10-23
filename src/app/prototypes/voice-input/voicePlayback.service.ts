import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { VoiceConversationService, VoiceMessage } from './voiceConversation.service';
import { VoiceInputService } from '../../voice/voiceInput.service';
import { VoiceAudioSessionService, VoicePageEvent } from '../../voice/voiceAudioSession.service';

interface PlaybackResponse { skipped?: boolean; audio?: string; expiresAt?: number }

@Injectable()
export class VoicePlaybackService implements OnDestroy {
  active = '';
  loading = '';
  error = '';
  readonly idleLevels = [.15, .45, .8, .35, 1, .6, .25, .7, .2];
  levels = this.idleLevels;
  private get context(): AudioContext | undefined { return this.audioSession.current; }
  private source?: AudioBufferSourceNode;
  private finish?: () => void;
  private cache = new Map<string, { buffer: AudioBuffer; expiresAt: number }>();
  private queue: VoiceMessage[] = [];
  private subscriptions = new Subscription();
  private epoch = 0;
  private owner = '';
  private processing = false;
  private destroyed = false;
  private waveformTimer?: ReturnType<typeof setInterval>;
  private readonly cancelled = new Subject<void>();
  private readonly hide = () => { if (document.hidden) this.leave('Page hidden'); else this.returned('Page visible'); };

  constructor(private functions: AngularFireFunctions, private injector: EnvironmentInjector,
    private conversation: VoiceConversationService, private voice: VoiceInputService, private audioSession: VoiceAudioSessionService) {
    this.subscriptions.add(conversation.changed.subscribe(() => {
      const owner = conversation.allowed ? conversation.uid : '';
      if (owner !== this.owner) {
        this.owner = owner; this.cancelPlayback(); this.cache.clear();
        this.loading = ''; this.error = '';
      }
    }));
    this.owner = conversation.allowed ? conversation.uid : '';
    this.subscriptions.add(conversation.incoming.subscribe(message => {
      // No history prefetch, background downloads or unbounded backlog.
      if (this.foreground && this.context?.state === 'running' && this.available(message) && this.queue.length < 10) {
        this.queue.push(message); void this.drain();
      }
    }));
    this.subscriptions.add(voice.changed.subscribe(() => {
      if (voice.busy) {
        if (this.loading || this.active || this.queue.length) { this.audioSession.note('Capture priority'); this.cancelPlayback(); }
      }
      else void this.drain();
    }));
    document.addEventListener('visibilitychange', this.hide);
  }

  private get foreground(): boolean { return !document.hidden && document.hasFocus(); }
  get diagnosticRows() {
    return [...this.audioSession.diagnosticRows, { label: 'Playback',
      value: `${this.active ? 'Playing' : this.loading ? 'Loading' : 'Idle'} · ${this.queue.length}/10 queued`,
      ok: !this.voice.busy || !this.active && !this.loading && !this.queue.length }];
  }
  leave(reason: VoicePageEvent): void {
    this.audioSession.note(`${reason} · playback ${this.active ? 'playing' : this.loading ? 'loading' : 'idle'} · mic ${this.voice.busy ? 'busy' : 'idle'}`);
    this.cancelPlayback();
    this.voice.cancel();
    this.audioSession.release();
    this.notify();
  }
  returned(reason: VoicePageEvent): void { this.audioSession.note(reason); this.notify(); }
  private cancelPlayback(): void {
    this.epoch++; this.queue = []; this.loading = ''; this.stop(); this.cancelled.next();
  }
  available(message: VoiceMessage): boolean { return !!message.audioExpiresAt && message.audioExpiresAt > Date.now(); }
  label(message: VoiceMessage): string {
    return !this.available(message) ? 'Voice recording unavailable' : this.loading === message.id ? 'Loading recording'
      : this.active === message.id ? 'Stop recording playback' : 'Play voice recording';
  }
  // Called in a real pointer/keyboard gesture outside the microphone control.
  unlock(): void {
    if (!this.owner || this.destroyed || this.voice.busy || !this.foreground) return;
    try {
      const context = this.audioSession.acquire();
      if (context.state !== 'running') void this.audioSession.resume(context, 'Playback').catch(() => {});
    } catch { /* The play button remains available on unsupported devices. */ }
  }
  toggle(message: VoiceMessage): void {
    this.unlock();
    if (this.active === message.id || this.loading === message.id) { this.cancelPlayback(); this.notify(); return; }
    if (!this.available(message) || this.voice.busy || this.loading || !this.foreground) return;
    this.queue = []; this.stop(); void this.play(message, false);
  }
  private async drain(): Promise<void> {
    if (this.processing || this.loading || this.active || this.voice.busy || !this.owner || this.destroyed) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.loading && !this.active && !this.voice.busy && this.foreground && !this.destroyed) {
        const message = this.queue.shift()!;
        if (this.available(message)) await this.play(message, true);
      }
    } finally { this.processing = false; }
  }
  private async play(message: VoiceMessage, automatic: boolean): Promise<void> {
    const epoch = this.epoch, owner = this.owner;
    if (!owner || !this.conversation.allowed || !this.available(message)) return;
    this.loading = message.id; this.error = ''; this.notify();
    try {
      let cached = this.cache.get(message.id);
      if (cached && cached.expiresAt <= Date.now()) { this.cache.delete(message.id); cached = undefined; }
      if (!cached || automatic) {
        const result = await firstValueFrom(runInInjectionContext(this.injector, () =>
          this.functions.httpsCallable<{ eventId: string; automatic: boolean }, PlaybackResponse>('voicePlayback', { timeout: 20000 })(
            { eventId: message.id, automatic })
        ).pipe(timeout({ first: 20000 }), takeUntil(this.cancelled)));
        if (epoch !== this.epoch || owner !== this.owner || this.destroyed) return;
        if (result.skipped) return;
        if (!result.audio || result.audio.length > 1280060 || !result.expiresAt || result.expiresAt <= Date.now()) throw Error('Unavailable');
        const bytes = Uint8Array.from(atob(result.audio), value => value.charCodeAt(0));
        if (bytes.length > 960044 || !this.context) throw Error('Unavailable');
        const buffer = await this.context.decodeAudioData(bytes.buffer);
        if (epoch !== this.epoch || owner !== this.owner || this.destroyed) return;
        cached = { buffer, expiresAt: result.expiresAt };
        this.cache.delete(message.id); this.cache.set(message.id, cached);
        if (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value!);
      }
      if (epoch !== this.epoch || !this.foreground || this.voice.busy || !this.context || this.context.state !== 'running') {
        if (epoch === this.epoch) this.error = 'Tap play to listen.';
        return;
      }
      this.stop();
      const source = this.context.createBufferSource();
      source.buffer = cached.buffer; source.connect(this.context.destination); this.source = source;
      this.loading = ''; this.active = message.id; this.notify();
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.stop(); resolve(); }, 35000);
        this.finish = () => { clearTimeout(timer); resolve(); };
        source.onended = () => { if (this.source === source) this.stop(); };
        source.start();
        this.startWaveform(cached.buffer);
      });
    } catch {
      if (epoch === this.epoch && owner === this.owner) { this.stop(); this.error = 'Could not play recording. Tap play to retry.'; }
    } finally {
      if (epoch === this.epoch && owner === this.owner) { this.loading = ''; this.notify(); }
    }
  }
  private startWaveform(buffer: AudioBuffer): void {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.levels = Array<number>(9).fill(.35); this.notify(); return;
    }
    const samples = buffer.getChannelData(0), startedAt = this.context!.currentTime;
    // Read only the current 32 ms of already decoded audio, at most 13 times/s.
    // The same nine-sample history drives both mirrored halves of the button.
    this.waveformTimer = setInterval(() => {
      const start = Math.floor((this.context!.currentTime - startedAt) * buffer.sampleRate);
      const end = Math.min(start + 512, samples.length);
      let energy = 0;
      for (let i = start; i < end; i++) energy += samples[i] ** 2;
      const level = Math.min(1, Math.sqrt(energy / Math.max(1, end - start)) * 5);
      this.levels = [...this.levels.slice(1), level]; this.notify();
    }, 80);
  }
  private stop(): void {
    clearInterval(this.waveformTimer); this.waveformTimer = undefined; this.levels = this.idleLevels;
    const source = this.source; this.source = undefined; this.active = '';
    if (source) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.finish?.(); this.finish = undefined;
  }
  private notify(): void { this.conversation.changed.next(); }
  ngOnDestroy(): void {
    this.destroyed = true; this.cancelPlayback(); this.cache.clear(); this.cancelled.complete();
    this.subscriptions.unsubscribe(); document.removeEventListener('visibilitychange', this.hide);
  }
}

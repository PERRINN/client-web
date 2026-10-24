import { EnvironmentInjector, Injectable, NgZone, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { VoiceInputService } from '../voice/voiceInput.service';
import { VoiceAudioSessionService } from '../voice/voiceAudioSession.service';
import { ChatMessage } from './chatData';

interface AudioResponse { audio?: string; expiresAt?: number; skipped?: boolean; }

/** Chat-scoped playback. Every playback/download reauthorizes; no retained audio cache. */
@Injectable()
export class ChatVoiceService implements OnDestroy {
  readonly changed = new Subject<void>();
  chain = '';
  mode: 'text' | 'voice' = 'text';
  keyboard = false;
  canListen = false;
  active = '';
  loading = '';
  error = '';
  errorId = '';
  private uid = '';
  private epoch = 0;
  private initialized = false;
  private openedAt = Date.now();
  private seen = new Set<string>();
  private automaticCount = 0;
  private queue: ChatMessage[] = [];
  private source?: AudioBufferSourceNode;
  private playbackTimer?: ReturnType<typeof setTimeout>;
  private cancelled = new Subject<void>();
  private capture: Subscription;
  private readonly hide = () => { if (document.hidden) this.leave(); };
  private readonly blur = () => this.leave();

  constructor(public input: VoiceInputService, private session: VoiceAudioSessionService,
    private functions: AngularFireFunctions, private injector: EnvironmentInjector, private zone: NgZone) {
    this.capture = input.changed.subscribe(() => {
      if (input.busy && (this.loading || this.active || this.queue.length)) this.cancelPlayback();
    });
    document.addEventListener('visibilitychange', this.hide);
    window.addEventListener('blur', this.blur);
  }

  configure(chain: string, mode: 'text' | 'voice', uid: string, recipients: string[], messages: ChatMessage[]): void {
    const changed = chain !== this.chain || uid !== this.uid;
    const allowed = !!uid && recipients.includes(uid);
    if (changed || allowed !== this.canListen) {
      this.cancelPlayback(); this.error = ''; this.errorId = '';
      if (changed) { this.initialized = false; this.openedAt = Date.now(); this.seen.clear(); this.automaticCount = 0; this.keyboard = false; }
    }
    this.chain = chain; this.uid = uid; this.canListen = allowed; this.mode = mode;
    this.input.setDestination('chat:' + chain);
    this.input.setAccess(allowed && mode === 'voice', uid);
    for (const message of messages) {
      if (!this.seen.has(message.id) && this.initialized && message.verified && message.timestamp >= this.openedAt && message.voice && !message.own
        && this.available(message) && this.foreground && this.session.current?.state === 'running'
        && !this.input.busy && this.queue.length < 10 && this.automaticCount < 100) {
        this.queue.push(message); this.automaticCount++;
      }
      // Unverified messages can arrive before the platform verification update.
      if (message.verified || !this.initialized) this.seen.add(message.id);
    }
    // Keep identities within the loaded window; history never triggers automatic playback.
    const visible = new Set(messages.map(message => message.id));
    for (const id of this.seen) if (!visible.has(id)) this.seen.delete(id);
    this.initialized = true;
    void this.drain();
  }

  get foreground(): boolean { return !document.hidden && document.hasFocus(); }
  available(message: ChatMessage): boolean { return this.canListen && !!message.voice && message.voice.expiresAt > Date.now(); }
  useKeyboard(): void { this.input.cancel(); this.keyboard = true; }
  useVoice(): void { this.keyboard = false; }
  unlock(): void {
    if (!this.canListen || !this.foreground || this.input.busy) return;
    try {
      const context = this.session.acquire();
      if (context.state !== 'running') void this.session.resume(context, 'Playback').catch(() => {});
    }
    catch { /* Explicit playback reports unsupported browsers. */ }
  }
  toggle(message: ChatMessage): void {
    if (this.active === message.id || this.loading === message.id) { this.cancelPlayback(); return; }
    this.cancelPlayback(); this.unlock(); void this.play(message, false);
  }
  private async drain(): Promise<void> {
    if (this.loading || this.active || this.input.busy || !this.foreground) return;
    const message = this.queue.shift();
    if (message) await this.play(message, true);
  }
  private async audio(message: ChatMessage, automatic: boolean): Promise<AudioResponse> {
    if (!this.available(message)) throw Error('Recording unavailable.');
    const result = await firstValueFrom(runInInjectionContext(this.injector, () =>
      this.functions.httpsCallable('voicePlayback', { timeout: 20000 })({ eventId: message.voice!.eventId, automatic })
    ).pipe(timeout({ first: 20000 }), takeUntil(this.cancelled)));
    if (result.skipped) return result;
    if (typeof result.audio !== 'string' || result.audio.length > 1280060 || !Number.isFinite(result.expiresAt)
      || result.expiresAt <= Date.now()) throw Error('Recording unavailable.');
    return result;
  }
  private bytes(response: AudioResponse): Uint8Array { return Uint8Array.from(atob(response.audio!), char => char.charCodeAt(0)); }
  private async play(message: ChatMessage, automatic: boolean): Promise<void> {
    if (!this.available(message) || this.input.busy) return;
    const epoch = this.epoch;
    this.loading = message.id; this.error = ''; this.errorId = ''; this.notify();
    try {
      const response = await this.audio(message, automatic);
      if (response.skipped || epoch !== this.epoch || !this.foreground || this.input.busy) return;
      const context = this.session.current;
      if (!context || context.state !== 'running') throw Error('Tap the recording to listen.');
      const buffer = await context.decodeAudioData(this.bytes(response).buffer as ArrayBuffer);
      if (epoch !== this.epoch || !this.available(message) || !this.foreground || this.input.busy) return;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      this.source = source; this.active = message.id;
      source.onended = () => this.zone.run(() => { if (this.source === source) { this.stop(); this.notify(); void this.drain(); } });
      source.start(); this.playbackTimer = setTimeout(() => { this.stop(); this.notify(); void this.drain(); }, 35000);
    } catch { if (epoch === this.epoch) { this.error = 'Recording unavailable. Tap to try again.'; this.errorId = message.id; } }
    finally { if (epoch === this.epoch) { this.loading = ''; if (!this.active) void this.drain(); this.notify(); } }
  }
  private stop(): void {
    clearTimeout(this.playbackTimer);
    const source = this.source; this.source = undefined; this.active = '';
    if (source) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
  }
  private notify(): void { this.zone.run(() => this.changed.next()); }
  private cancelPlayback(): void { this.epoch++; this.cancelled.next(); this.queue = []; this.loading = ''; this.stop(); this.notify(); }
  private leave(): void { this.cancelPlayback(); this.input.cancel(); this.session.release(); }
  ngOnDestroy(): void {
    this.leave(); this.capture.unsubscribe(); this.cancelled.complete(); this.changed.complete();
    document.removeEventListener('visibilitychange', this.hide); window.removeEventListener('blur', this.blur);
  }
}

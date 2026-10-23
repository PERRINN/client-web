import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { VoiceInputService, VoiceReply } from './voiceInput.service';
import { VoiceConversationService, VoiceMessage } from './voiceConversation.service';
import { VoiceQueueService } from './voiceQueue.service';
import { VoiceDiagnosticRow, VoiceKeyDiagnostics, voiceDiagnosticRows } from './voiceDiagnostics';

interface ConversationEntry { id: string; createdAt: number; message?: VoiceMessage; reply?: VoiceReply }

@Component({
  selector: 'app-voice-input', standalone: false,
  templateUrl: './voice-input.component.html', styleUrls: ['./voice-input.component.css'],
  providers: [VoiceCaptureService, VoiceQueueService, VoiceInputService, VoiceConversationService]
})
export class VoiceInputComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('replies') private replies?: ElementRef<HTMLElement>;
  @ViewChild('dock') private dock?: ElementRef<HTMLButtonElement>;
  private renderedReplies = '';
  private timelineMessages?: VoiceMessage[];
  private timelineLocal = '';
  private timeline: ConversationEntry[] = [];
  private conversationChanges: Subscription;
  private pointer?: { downAt: number; id: number; x: number; y: number; uid: string; started: boolean; held: boolean };
  private keyboard?: { downAt: number; code: string; uid: string; started: boolean };
  private holdTimer?: ReturnType<typeof setTimeout>;
  private changes: Subscription;
  private diagnosticTimer?: ReturnType<typeof setInterval>;
  diagnosticRows: VoiceDiagnosticRow[] = [];
  diagnosticSummary: VoiceDiagnosticRow[] = [];
  diagnosticDetails: VoiceDiagnosticRow[] = [];
  diagnosticUpdatedAt = 0;
  diagnosticBuild = '';
  private diagnosticsActive = false;
  private readonly keyDiagnostics = new VoiceKeyDiagnostics();
  constructor(public voice: VoiceInputService, public conversation: VoiceConversationService, private changeDetector: ChangeDetectorRef) {
    this.conversationChanges = conversation.changed.subscribe(() => {
      voice.setAccess(conversation.allowed, conversation.uid);
      changeDetector.markForCheck();
    });
    voice.setAccess(conversation.allowed, conversation.uid);
    this.changes = voice.changed.subscribe(() => {
      this.keyDiagnostics.observePhase(voice.phase);
      if (this.pointer && (this.pointer.uid !== voice.uid
        || (this.pointer.started && voice.phase !== 'requesting' && voice.phase !== 'recording'))) this.clearPointer();
      if (this.keyboard && (this.keyboard.uid !== voice.uid
        || (this.keyboard.started && voice.phase !== 'requesting' && voice.phase !== 'recording'))) {
        const reason = this.keyboard.uid !== voice.uid ? 'Account changed' : `Capture ${voice.phase}`;
        this.keyDiagnostics.note(`P cleared: ${reason} · ${Date.now() - this.keyboard.downAt} ms`);
        this.keyboard = undefined;
      }
      if (this.diagnosticsActive) this.updateDiagnostics();
      changeDetector.markForCheck();
    });
  }

  ngOnInit(): void {
    this.diagnosticsActive = true;
    const bundle = Array.from(document.scripts).map(script => script.src).find(src => /main(?:\.[a-f0-9]+)?\.js/.test(src));
    this.diagnosticBuild = bundle?.match(/main\.([a-f0-9]+)\.js/)?.[1].slice(0, 8) || 'Development';
    this.updateDiagnostics();
    this.diagnosticTimer = setInterval(() => { if (!document.hidden) this.updateDiagnostics(); }, 1000);
  }
  private updateDiagnostics(): void {
    const now = Date.now();
    if (now - this.diagnosticUpdatedAt < 1000) return;
    this.diagnosticUpdatedAt = now;
    this.diagnosticRows = voiceDiagnosticRows(this.voice, this.voice.queue.diagnostics, this.voice.captureDiagnostics, {
      online: navigator.onLine !== false, visible: !document.hidden, secure: window.isSecureContext,
      gesture: this.pointer ? (this.pointer.held ? 'Held' : 'Pressed')
        : this.keyboard ? (now - this.keyboard.downAt >= 600 ? 'Held' : 'Pressed') : 'Released',
      gestureSince: this.pointer?.downAt || this.keyboard?.downAt || 0
    }, this.diagnosticUpdatedAt).concat(this.keyDiagnostics.rows());
    this.diagnosticSummary = this.diagnosticRows.filter(row => row.label === 'Opening cue' || row.label === 'Closing cue');
    this.diagnosticDetails = [
      ...this.diagnosticRows.filter(row => row.label === 'Audio trace'),
      ...this.diagnosticRows.filter(row => row.label !== 'Audio trace' && row.label !== 'Opening cue' && row.label !== 'Closing cue')
    ];
    this.changeDetector.markForCheck();
  }

  ngAfterViewChecked(): void {
    const dock = this.dock?.nativeElement;
    if (dock) {
      const bars = Array.from(dock.querySelectorAll<HTMLElement>('.waveform i'));
      this.keyDiagnostics.observeDock(dock.dataset.phase || 'Unknown', bars.length,
        Math.max(0, ...bars.map(bar => Number.parseFloat(bar.style.height) || 0)));
    }
    const rendered = this.conversationEntries.at(-1)?.id || '';
    if (this.renderedReplies === rendered) return;
    this.renderedReplies = rendered;
    this.replies?.nativeElement.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  get conversationEntries(): ConversationEntry[] {
    const messages = this.conversation.messages;
    const local = this.voice.replies.map(reply => `${reply.id}:${!!reply.private}:${reply.recording?.id || ''}`).join('|');
    if (this.timelineMessages === messages && this.timelineLocal === local) return this.timeline;
    this.timelineMessages = messages; this.timelineLocal = local;
    const shared = new Set(messages.filter(message => message.userId === this.voice.uid).map(message => message.requestId));
    const entries: ConversationEntry[] = messages.map(message => ({ id: 'message:' + message.id, createdAt: message.createdAt.toMillis(), message }));
    for (const reply of this.voice.replies) {
      if (reply.private || reply.recording && (reply.recording.conversationId !== 'pilot' || shared.has(reply.recording.id))) continue;
      entries.push({ id: 'reply:' + reply.id, createdAt: reply.createdAt ?? reply.recording?.createdAt ?? 0, reply });
    }
    this.timeline = entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return this.timeline;
  }

  toggle(): void {
    if (this.voice.phase === 'recording' || this.voice.phase === 'requesting') void this.voice.release();
    else if (this.voice.canRecord) void this.voice.press();
  }
  pointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || this.pointer || this.keyboard || !this.voice.canToggle) return;
    event.preventDefault();
    this.pointer = { downAt: Date.now(), id: event.pointerId, x: event.clientX, y: event.clientY,
      uid: this.voice.uid, started: false, held: false };
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
    catch { this.clearPointer(); return; }
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      if (this.pointer) this.pointer.held = true;
    }, 600);
    this.pointer.started = this.voice.canRecord;
    this.toggle();
  }
  pointerMove(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 10) this.cancelPointer();
  }
  pointerUp(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    this.pointerMove(event);
    const finish = this.pointer?.started && this.pointer.held && this.pointer.uid === this.voice.uid;
    this.clearPointer();
    if (finish) void this.voice.release();
  }
  pointerCancel(event: PointerEvent): void {
    if (this.pointer?.id === event.pointerId) this.cancelPointer();
  }
  private cancelPointer(): void {
    const cancel = this.pointer?.started && this.pointer.uid === this.voice.uid;
    this.clearPointer();
    if (cancel) this.voice.cancel();
  }
  private clearPointer(): void {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined; this.pointer = undefined;
  }
  @HostListener('document:keydown', ['$event'])
  shortcutKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const editable = !!(target?.isContentEditable
      || target?.closest?.('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])'));
    const heldRepeat = !!this.keyboard && event.key.toLowerCase() === 'p' && event.code === this.keyboard.code
      && !editable && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const ignored = event.key.toLowerCase() !== 'p' ? 'Not P'
      : event.defaultPrevented ? 'Already prevented' : event.repeat ? 'Repeat ignored' : event.isComposing ? 'IME composition'
      : event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ? 'Modified shortcut'
      : this.pointer ? 'Pointer active' : heldRepeat ? 'Held repeat ignored' : this.keyboard ? 'P already down' : !this.voice.canToggle ? 'Mic control locked'
      : editable ? 'Editable field' : '';
    if (this.keyDiagnostics.relevant(event)) this.keyDiagnostics.event(event, 'down', ignored || `Toggle from ${this.voice.phase}`,
      !ignored || ignored === 'Repeat ignored' || heldRepeat, heldRepeat);
    // External Android buttons can repeat keydown without setting event.repeat.
    // Own every event in an accepted hold so native long-press handling cannot compete.
    if (heldRepeat) event.preventDefault();
    if (ignored) return;
    event.preventDefault();
    this.keyboard = { downAt: Date.now(), code: event.code, uid: this.voice.uid, started: this.voice.canRecord };
    this.toggle();
  }
  @HostListener('document:keyup', ['$event'])
  shortcutKeyUp(event: KeyboardEvent): void {
    const ignored = !this.keyboard ? 'No active P press' : event.code !== this.keyboard.code ? 'Code mismatch' : '';
    const duration = this.keyboard ? Date.now() - this.keyboard.downAt : 0;
    if (this.keyboard || this.keyDiagnostics.relevant(event)) this.keyDiagnostics.event(event, 'up', ignored
      || `${duration} ms · ${this.keyboard.started && duration >= 600 ? 'Held release: stop/cancel' : 'Toggle kept'} · ${this.voice.phase}`,
      ignored !== 'Code mismatch');
    if (ignored) return;
    event.preventDefault();
    const finish = this.keyboard.started && this.keyboard.uid === this.voice.uid && Date.now() - this.keyboard.downAt >= 600;
    this.keyboard = undefined;
    if (finish) void this.voice.release();
  }
  keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.interrupt('Escape'); return; }
    if ([' ', 'Enter'].includes(event.key) && (event.repeat || event.altKey || event.ctrlKey || event.metaKey)) event.preventDefault();
  }
  @HostListener('window:blur', ['"Window blur"'])
  interrupt(reason = 'Control blur'): void {
    this.keyDiagnostics.note(`Interrupt: ${reason} · ${this.voice.phase}${this.keyboard ? ' · ' + (Date.now() - this.keyboard.downAt) + ' ms' : ''}`);
    this.clearPointer(); this.keyboard = undefined; this.voice.cancel();
  }
  @HostListener('document:visibilitychange')
  visibility(): void { if (document.hidden) this.interrupt('Page hidden'); }
  @HostListener('window:pagehide')
  pageHide(): void { this.interrupt('Page hide'); }
  ngOnDestroy(): void { clearInterval(this.diagnosticTimer); this.diagnosticsActive = false; this.clearPointer(); this.keyboard = undefined; this.changes.unsubscribe(); this.conversationChanges.unsubscribe(); }
}

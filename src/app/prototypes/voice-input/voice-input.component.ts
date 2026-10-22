import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { VoiceInputService } from './voiceInput.service';
import { VoiceQueueService } from './voiceQueue.service';
import { VoiceDiagnosticRow, voiceDiagnosticRows } from './voiceDiagnostics';

@Component({
  selector: 'app-voice-input', standalone: false,
  templateUrl: './voice-input.component.html', styleUrls: ['./voice-input.component.css'],
  providers: [VoiceCaptureService, VoiceQueueService, VoiceInputService]
})
export class VoiceInputComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('replies') private replies?: ElementRef<HTMLElement>;
  private renderedReplies = 0;
  private pointer?: { downAt: number; id: number; x: number; y: number; uid: string; started: boolean; held: boolean };
  private holdTimer?: ReturnType<typeof setTimeout>;
  private changes: Subscription;
  private diagnosticTimer?: ReturnType<typeof setInterval>;
  diagnosticRows: VoiceDiagnosticRow[] = [];
  diagnosticUpdatedAt = 0;
  diagnosticBuild = '';
  private diagnosticsActive = false;
  constructor(public voice: VoiceInputService, private changeDetector: ChangeDetectorRef) {
    this.changes = voice.changed.subscribe(() => {
      if (this.pointer && (this.pointer.uid !== voice.uid
        || (this.pointer.started && voice.phase !== 'requesting' && voice.phase !== 'recording'))) this.clearPointer();
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
      gesture: this.pointer ? (this.pointer.held ? 'Held' : 'Pressed') : 'Released', gestureSince: this.pointer?.downAt || 0
    }, this.diagnosticUpdatedAt);
    this.changeDetector.markForCheck();
  }

  ngAfterViewChecked(): void {
    if (this.renderedReplies === this.voice.replies.length) return;
    this.renderedReplies = this.voice.replies.length;
    this.replies?.nativeElement.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  toggle(): void {
    if (this.voice.phase === 'recording' || this.voice.phase === 'requesting') void this.voice.release();
    else if (this.voice.canRecord) void this.voice.press();
  }
  pointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || this.pointer || !this.voice.canToggle) return;
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
  keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.interrupt(); return; }
    if ([' ', 'Enter'].includes(event.key) && (event.repeat || event.altKey || event.ctrlKey || event.metaKey)) event.preventDefault();
  }
  @HostListener('window:blur')
  interrupt(): void { this.clearPointer(); this.voice.cancel(); }
  @HostListener('document:visibilitychange')
  visibility(): void { if (document.hidden) this.interrupt(); }
  @HostListener('window:pagehide')
  pageHide(): void { this.interrupt(); }
  ngOnDestroy(): void { clearInterval(this.diagnosticTimer); this.diagnosticsActive = false; this.clearPointer(); this.changes.unsubscribe(); }
}

import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { VoiceInputService } from '../voiceInput.service';

export interface VoiceComposerStatus { phase: string; pending: number; error: string; }

@Component({ selector: 'app-voice-composer', standalone: false,
  templateUrl: './voice-composer.component.html', styleUrls: ['./voice-composer.component.css'] })
export class VoiceComposerComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() disabled = false;
  @Output() statusChange = new EventEmitter<VoiceComposerStatus>();
  @Output() keyboardRequested = new EventEmitter<void>();
  private pointer?: { id: number; at: number; started: boolean; uid: string };
  private key?: { code: string; at: number; started: boolean; uid: string };
  private heldCode?: string;
  private changes: Subscription;
  private lastStatus = '';
  constructor(public voice: VoiceInputService, detector: ChangeDetectorRef) {
    this.changes = voice.changed.subscribe(() => {
      const status = { phase: voice.phase, pending: voice.pendingCount, error: this.error };
      const key = JSON.stringify(status);
      if (key !== this.lastStatus) { this.lastStatus = key; this.statusChange.emit(status); }
      detector.markForCheck();
    });
  }
  get error(): string {
    const replies = this.voice.replies.filter(reply => !reply.recording || reply.recording.conversationId === 'chat:' + this.chain);
    return this.voice.queue.storageError || [...replies].reverse().find(reply => reply.recording?.error || this.voice.phase === 'error' && reply.kind === 'error')?.text || '';
  }
  get status(): string { return this.error || (this.voice.pendingCount ? `${this.voice.pendingCount} ${this.voice.pendingCount === 1 ? 'recording' : 'recordings'} processing` : this.voice.label); }
  ngOnChanges(): void { this.interrupt(); }
  toggle(): void {
    if (this.disabled) return;
    if (this.voice.phase === 'recording' || this.voice.phase === 'requesting') void this.voice.release();
    else void this.voice.press();
  }
  pointerDown(event: PointerEvent): void {
    if (this.disabled || !event.isPrimary || event.button !== 0 || this.pointer || this.key || !this.voice.canToggle) return;
    event.preventDefault();
    this.pointer = { id: event.pointerId, at: Date.now(), started: this.voice.canRecord, uid: this.voice.uid };
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
    catch { this.pointer = undefined; return; }
    this.toggle();
  }
  pointerUp(event: PointerEvent): void {
    const press = this.pointer;
    if (press?.id !== event.pointerId) return;
    this.pointer = undefined;
    if (press.started && press.uid === this.voice.uid && Date.now() - press.at >= 600) void this.voice.release();
  }
  pointerCancel(event: PointerEvent): void { if (this.pointer?.id === event.pointerId) this.interrupt(); }
  @HostListener('document:keydown', ['$event'])
  shortcutDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (event.key.toLowerCase() !== 'p' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')) return;
    if (this.heldCode === event.code) { event.preventDefault(); return; }
    if (event.repeat || event.defaultPrevented || this.disabled || this.pointer || this.key || !this.voice.canToggle) return;
    event.preventDefault(); this.heldCode = event.code;
    this.key = { code: event.code, at: Date.now(), started: this.voice.canRecord, uid: this.voice.uid }; this.toggle();
  }
  @HostListener('document:keyup', ['$event'])
  shortcutUp(event: KeyboardEvent): void {
    if (this.heldCode === event.code) { event.preventDefault(); this.heldCode = undefined; }
    if (!this.key || this.key.code !== event.code) return;
    const press = this.key; this.key = undefined;
    if (press.started && press.uid === this.voice.uid && Date.now() - press.at >= 600) void this.voice.release();
  }
  keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.interrupt(); }
    if ([' ', 'Enter'].includes(event.key) && (event.repeat || event.altKey || event.ctrlKey || event.metaKey)) event.preventDefault();
  }
  keyboard(): void { this.interrupt(); this.keyboardRequested.emit(); }
  @HostListener('window:blur')
  @HostListener('window:pagehide')
  interrupt(): void { this.pointer = undefined; this.key = undefined; this.heldCode = undefined; this.voice.cancel(); }
  @HostListener('document:visibilitychange')
  visibility(): void { if (document.hidden) this.interrupt(); }
  ngOnDestroy(): void { this.changes.unsubscribe(); this.interrupt(); }
}

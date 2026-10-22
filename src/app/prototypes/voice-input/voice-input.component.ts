import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { VoiceInputService } from './voiceInput.service';

@Component({
  selector: 'app-voice-input', standalone: false,
  templateUrl: './voice-input.component.html', styleUrls: ['./voice-input.component.css'],
  providers: [VoiceCaptureService, VoiceInputService]
})
export class VoiceInputComponent implements AfterViewChecked, OnDestroy {
  @ViewChild('replies') private replies?: ElementRef<HTMLElement>;
  private renderedReplies = 0;
  private pointer?: number;
  private key = '';
  private changes: Subscription;
  constructor(public voice: VoiceInputService, changeDetector: ChangeDetectorRef) {
    this.changes = voice.changed.subscribe(() => changeDetector.markForCheck());
  }

  ngAfterViewChecked(): void {
    if (this.renderedReplies === this.voice.replies.length) return;
    this.renderedReplies = this.voice.replies.length;
    this.replies?.nativeElement.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  pointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || this.pointer !== undefined || this.key || !this.voice.canRecord) return;
    event.preventDefault();
    this.pointer = event.pointerId;
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
    catch { this.pointer = undefined; return; }
    void this.voice.press();
  }
  pointerUp(event: PointerEvent): void {
    if (this.pointer !== event.pointerId) return;
    this.pointer = undefined; void this.voice.release();
  }
  pointerCancel(event: PointerEvent): void {
    if (this.pointer !== event.pointerId) return;
    this.pointer = undefined; this.voice.cancel();
  }
  keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.interrupt(); return; }
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat || this.key || this.pointer !== undefined || event.altKey || event.ctrlKey || event.metaKey || !this.voice.canRecord) return;
    this.key = event.key; void this.voice.press();
  }
  keyUp(event: KeyboardEvent): void {
    if (event.key !== this.key) return;
    event.preventDefault(); this.key = ''; void this.voice.release();
  }
  @HostListener('window:blur')
  interrupt(): void { this.pointer = undefined; this.key = ''; this.voice.cancel(); }
  @HostListener('document:visibilitychange')
  visibility(): void { if (document.hidden) this.interrupt(); }
  @HostListener('window:pagehide')
  pageHide(): void { this.interrupt(); }
  ngOnDestroy(): void { this.changes.unsubscribe(); }
}

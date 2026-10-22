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
  private pointer?: { id: number; touch: boolean; x: number; y: number };
  private pressTimer?: ReturnType<typeof setTimeout>;
  private changes: Subscription;
  constructor(public voice: VoiceInputService, changeDetector: ChangeDetectorRef) {
    this.changes = voice.changed.subscribe(() => changeDetector.markForCheck());
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
    this.pointer = { id: event.pointerId, touch: event.pointerType === 'touch', x: event.clientX, y: event.clientY };
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
    catch { this.clearPointer(); return; }
    if (this.pointer.touch) {
      const uid = this.voice.uid;
      this.pressTimer = setTimeout(() => {
        this.pressTimer = undefined;
        if (this.voice.uid === uid) this.toggle();
      }, 120);
    }
  }
  pointerMove(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 10) this.clearPointer();
  }
  pointerUp(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    this.pointerMove(event);
    const activate = this.pointer && !this.pointer.touch;
    this.clearPointer();
    if (activate) this.toggle();
  }
  pointerCancel(event: PointerEvent): void {
    if (this.pointer?.id === event.pointerId) this.clearPointer();
  }
  private clearPointer(): void { clearTimeout(this.pressTimer); this.pressTimer = undefined; this.pointer = undefined; }
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
  ngOnDestroy(): void { this.clearPointer(); this.changes.unsubscribe(); }
}

import { ChangeDetectorRef, Component, HostListener, OnDestroy } from '@angular/core';
import { RadioAvatarsService } from './radioAvatars.service';
import { RadioRoomService } from './radioRoom.service';
import { RadioLifecycleService } from './radioLifecycle.service';
import { Subscription } from 'rxjs';
import { acceptsTalkKey } from './radioState';

@Component({
  selector: 'app-team-radio', standalone: false,
  templateUrl: './team-radio.component.html', styleUrls: ['./team-radio.component.css'],
  providers: [RadioAvatarsService]
})
export class TeamRadioComponent implements OnDestroy {
  radio: RadioRoomService;
  busy = false;
  diagnosticsCopyLabel = 'Copy details';
  private pointer?: number;
  private destroyed = false;
  private changes: Subscription;
  constructor(public lifecycle: RadioLifecycleService, private changeDetector: ChangeDetectorRef, public avatars: RadioAvatarsService) {
    const radio = this.radio = lifecycle.enterPage();
    avatars.sync(radio.seats.map(person => person.uid), radio.user?.uid);
    this.changes = radio.changed.subscribe(() => {
      avatars.sync(radio.seats.map(person => person.uid), radio.user?.uid);
      changeDetector.markForCheck();
    });
  }
  get talkLabel() {
    if (this.radio.transmitting) return 'Talking';
    return this.radio.floor ? 'Channel busy' : 'Talk';
  }
  async run(action: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true; this.radio.error = '';
    try { await action(); } catch (error) { this.radio.showError(error); }
    finally { if (!this.destroyed) { this.busy = false; this.changeDetector.markForCheck(); } }
  }
  async copyDiagnostics() {
    try {
      const trace = { version: 1, capturedAt: new Date().toISOString(), events: this.radio.audio.diagnostics.snapshot() };
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      this.diagnosticsCopyLabel = 'Copied';
    } catch { this.diagnosticsCopyLabel = 'Copy failed'; }
    if (!this.destroyed) this.changeDetector.markForCheck();
  }
  pointerDown(event: PointerEvent) {
    if (event.button !== 0 || this.busy) return;
    event.preventDefault(); this.pointer = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    void this.radio.talk();
  }
  pointerUp(event: PointerEvent) {
    if (this.pointer !== event.pointerId) return;
    this.pointer = undefined; void this.radio.releaseTalk();
  }
  @HostListener('window:keydown', ['$event'])
  keyDown(event: KeyboardEvent) {
    if (this.radio.joined && this.radio.speakingPlace !== undefined && !this.busy && acceptsTalkKey(event)) {
      event.preventDefault(); void this.radio.talk();
    }
  }
  @HostListener('window:keyup', ['$event'])
  keyUp(event: KeyboardEvent) { if (event.code === 'Space') { event.preventDefault(); void this.radio.releaseTalk(); } }
  @HostListener('window:blur')
  blur() { this.pointer = undefined; void this.radio.releaseTalk(); }
  @HostListener('document:visibilitychange')
  visibility() { if (document.hidden) this.blur(); }
  ngOnDestroy() { this.destroyed = true; this.changes.unsubscribe(); this.lifecycle.leavePage(); }
}

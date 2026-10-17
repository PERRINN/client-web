import { ChangeDetectorRef, Component, HostListener, OnDestroy } from '@angular/core';
import { RadioRoomService } from './radioRoom.service';
import { RadioAudioService } from './radioAudio.service';
import { Subscription } from 'rxjs';
import { acceptsTalkKey } from './radioState';

@Component({
  selector: 'app-team-radio', standalone: false,
  templateUrl: './team-radio.component.html', styleUrls: ['./team-radio.component.css'],
  providers: [RadioRoomService, RadioAudioService]
})
export class TeamRadioComponent implements OnDestroy {
  busy = false;
  choosingKey = false;
  key = 'Space';
  private pointer?: number;
  private destroyed = false;
  private changes: Subscription;
  constructor(public radio: RadioRoomService, private changeDetector: ChangeDetectorRef) {
    this.changes = radio.changed.subscribe(() => changeDetector.markForCheck());
    try { this.key = localStorage.getItem('teamRadioKey') || 'Space'; } catch { /* Storage is optional. */ }
  }
  get keyLabel() { return this.key.replace(/^(Key|Digit)/, ''); }
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
    if (this.choosingKey) {
      event.preventDefault();
      if (event.code === 'Escape') { this.choosingKey = false; return; }
      if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab'].includes(event.code) || event.repeat || !event.code) return;
      this.key = event.code; this.choosingKey = false;
      try { localStorage.setItem('teamRadioKey', this.key); } catch { /* Storage is optional. */ }
      return;
    }
    if (this.radio.joined && this.radio.speakingPlace !== undefined && !this.busy && acceptsTalkKey(event, this.key)) {
      event.preventDefault(); void this.radio.talk();
    }
  }
  @HostListener('window:keyup', ['$event'])
  keyUp(event: KeyboardEvent) { if (event.code === this.key) { event.preventDefault(); void this.radio.releaseTalk(); } }
  @HostListener('window:blur')
  blur() { this.pointer = undefined; void this.radio.releaseTalk(); }
  @HostListener('document:visibilitychange')
  visibility() { if (document.hidden) this.blur(); }
  ngOnDestroy() { this.destroyed = true; this.changes.unsubscribe(); void this.radio.releaseTalk(); }
}

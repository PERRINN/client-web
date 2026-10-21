import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy } from '@angular/core';
import { RadioAvatarsService } from './radioAvatars.service';
import { RadioRoomService } from './radioRoom.service';
import { RadioLifecycleService } from './radioLifecycle.service';
import { Subscription } from 'rxjs';
import { acceptsTalkKey } from './radioState';
import { SILENT_LEVELS } from './radioLevels';

@Component({
  selector: 'app-team-radio', standalone: false,
  templateUrl: './team-radio.component.html', styleUrls: ['./team-radio.component.css'],
  providers: [RadioAvatarsService]
})
export class TeamRadioComponent implements OnDestroy {
  radio: RadioRoomService;
  busy = false;
  diagnosticsCopyLabel = 'Copy details';
  levels = SILENT_LEVELS;
  private pointer?: number;
  private destroyed = false;
  private changes: Subscription;
  private levelTimer?: ReturnType<typeof setInterval>;
  constructor(public lifecycle: RadioLifecycleService, private changeDetector: ChangeDetectorRef, public avatars: RadioAvatarsService, private zone: NgZone) {
    const radio = this.radio = lifecycle.enterPage();
    avatars.sync(radio.seats.map(person => person.uid), radio.user?.uid);
    this.changes = radio.changed.subscribe(() => {
      avatars.sync(radio.seats.map(person => person.uid), radio.user?.uid);
      this.updateLevels();
      changeDetector.markForCheck();
    });
    this.updateLevels();
  }
  private updateLevels() {
    if (!this.radio.joined || !this.radio.floor || (typeof document !== 'undefined' && document.hidden)) {
      clearInterval(this.levelTimer); this.levelTimer = undefined;
      this.levels = SILENT_LEVELS; this.radio.audio.releaseLevels(); return;
    }
    if (this.levelTimer !== undefined) return;
    this.zone.runOutsideAngular(() => {
      this.levelTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) { this.zone.run(() => this.updateLevels()); return; }
        this.levels = this.radio.floor ? this.radio.audio.readLevels(this.radio.floor.seat) : SILENT_LEVELS;
        this.zone.run(() => this.changeDetector.markForCheck());
      }, 100);
    });
  }
  get talkLabel() {
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
      const trace = { version: 1, capturedAt: new Date().toISOString(), events: this.radio.captureDiagnostics() };
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
  visibility() { if (document.hidden) this.blur(); this.updateLevels(); }
  ngOnDestroy() {
    this.destroyed = true; clearInterval(this.levelTimer); this.radio.audio.releaseLevels();
    this.changes.unsubscribe(); this.lifecycle.leavePage();
  }
}

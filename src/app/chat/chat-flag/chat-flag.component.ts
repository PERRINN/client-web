import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subscription } from 'rxjs';
import { ReadCursorService } from '../../readCursor.service';

@Component({ selector: 'app-chat-flag', templateUrl: './chat-flag.component.html', styleUrls: ['./chat-flag.component.css'], standalone: false })
export class ChatFlagComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  userId = '';
  flagged = false;
  ready = false;
  saving = false;
  unavailable = false;
  error = '';
  private generation = 0;
  private session;
  private subscriptions = new Subscription();

  constructor(private cursors: ReadCursorService, auth: AngularFireAuth, private zone: NgZone, private cd: ChangeDetectorRef) {
    this.session = cursors.createSession();
    this.subscriptions.add(this.session.changes.subscribe(state => this.zone.run(() => {
      this.flagged = !!state.flags[this.chain]; this.ready = state.ready && !state.unavailable;
      this.unavailable = state.unavailable;
      this.cd.markForCheck();
    })));
    this.subscriptions.add(auth.authState.subscribe(user => this.zone.run(() => {
      this.userId = user?.uid || ''; this.ngOnChanges(); this.cd.markForCheck();
    })));
  }
  ngOnChanges(): void {
    this.generation++; this.error = ''; this.saving = false;
    this.session.update(this.userId || null, this.chain ? [this.chain] : []);
  }
  retry(): void { this.session.update(null, []); this.ngOnChanges(); }
  async toggle(): Promise<void> {
    if (!this.userId || !this.chain || !this.ready || this.saving) return;
    const generation = this.generation;
    this.saving = true; this.error = '';
    try { await this.cursors.setFlag(this.userId, this.chain, !this.flagged); }
    catch {
      this.zone.run(() => {
        if (generation !== this.generation) return;
        this.error = 'Flag couldn’t save. Try again.';
        this.cd.markForCheck();
      });
    } finally {
      this.zone.run(() => {
        if (generation !== this.generation) return;
        this.saving = false;
        this.cd.markForCheck();
      });
    }
  }
  ngOnDestroy(): void { this.generation++; this.subscriptions.unsubscribe(); this.session.destroy(); }
}

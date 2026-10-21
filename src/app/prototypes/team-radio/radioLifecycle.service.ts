import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireDatabase } from '@angular/fire/compat/database';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { createEnvironmentInjector, EnvironmentInjector, Injectable, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { RadioAudioService } from './radioAudio.service';
import { RadioReturnSession, RadioRoomService } from './radioRoom.service';
import { RECONNECT_GRACE_MS } from './radioState';

const RETURN_KEY = 'perrinn.teamRadio.return';

/** Own the radio only while its page, away window or per-tab return is active. */
@Injectable({ providedIn: 'root' })
export class RadioLifecycleService implements OnDestroy {
  readonly changed = new Subject<void>();
  radio?: RadioRoomService;
  private scope?: EnvironmentInjector;
  private changes?: Subscription;
  private pageAttached = false;
  private pageHidden = false;
  private focused = true;
  private awayUntil = 0;
  private pending?: RadioReturnSession;
  private saved = '';
  private label = '';
  private updating = false;
  private joining?: RadioRoomService;
  private joinAttempt = '';
  private handlers: [EventTarget, string, EventListener][] = [];

  get returnLabel() { return this.label; }

  private computeLabel() {
    if (!this.radio?.joined || this.pageAttached || !this.awayUntil) return '';
    const seconds = Math.max(0, Math.ceil((Math.min(this.awayUntil, this.radio.returnUntil) - Date.now()) / 1000));
    return `Radio · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  constructor(private parent: EnvironmentInjector) {
    this.listen(window, 'blur', () => { this.focused = false; this.update(); });
    this.listen(window, 'focus', () => { this.focused = true; this.update(); });
    this.listen(document, 'visibilitychange', () => { if (!document.hidden) this.focused = true; this.update(); });
    this.listen(window, 'pagehide', () => {
      this.pageHidden = true; this.update();
      this.radio?.suspendPage();
    });
    this.listen(window, 'pageshow', () => {
      this.pageHidden = false; this.focused = true; this.update(); this.radio?.resumePage();
    });
    try {
      const value = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
      if (this.valid(value)) { this.pending = value; this.saved = JSON.stringify(value); this.awayUntil = value.until; this.ensureRadio(); }
      else sessionStorage.removeItem(RETURN_KEY);
    } catch { /* Storage may be unavailable; in-app navigation still works. */ }
  }

  enterPage() {
    this.pageAttached = true;
    this.ensureRadio(); this.update();
    return this.radio;
  }

  leavePage() { this.pageAttached = false; this.update(); }

  ngOnDestroy() {
    this.handlers.forEach(([target, name, handler]) => target.removeEventListener(name, handler));
    this.dispose(); this.changed.complete();
  }

  private ensureRadio() {
    if (this.scope) return;
    // AngularFire compat services are scoped to "any" injector; reuse the app's
    // instances so the radio follows the existing authentication/connection.
    const firebase = [AngularFireAuth, AngularFireDatabase, AngularFirestore].map(token => ({ provide: token, useValue: this.parent.get<unknown>(token) }));
    this.scope = createEnvironmentInjector([...firebase, RadioRoomService, RadioAudioService], this.parent);
    this.radio = this.scope.get(RadioRoomService);
    this.changes = this.radio.changed.subscribe(() => this.update());
  }

  private update() {
    if (this.updating || !this.radio) return;
    this.updating = true;
    try {
      const radio = this.radio;
      const active = this.pageAttached && !document.hidden && !this.pageHidden && this.focused;
      radio.setPageActive(active);
      if (this.pending) {
        if (!radio.authResolved) return;
        if (radio.user && (radio.loading || !radio.connected)) return;
        const ticket = this.pending; this.pending = undefined;
        if (this.valid(ticket) && ticket.uid === radio.user?.uid) {
          void radio.recover(ticket).catch(error => radio.showError(error));
        }
      }
      if (radio.joined) {
        // Check expiry before cancelling the away window on a late return.
        if (this.awayUntil && Date.now() >= this.awayUntil) radio.exit();
        else if (active) this.awayUntil = 0;
        else if (!this.awayUntil) this.awayUntil = Date.now() + RECONNECT_GRACE_MS;
      }
      if (active && !radio.joined && !this.pending && radio.authResolved && radio.user && !radio.loading && radio.connected && !radio.error) {
        this.autoJoin(radio);
      }
      if (!radio.connected) this.joinAttempt = '';
      if (radio.joined) {
        const until = Math.min(this.awayUntil || Infinity, radio.returnUntil);
        // Active tickets renew at most once every five seconds; away deadlines never move.
        const ticket = { uid: radio.user.uid, seat: radio.seat, session: radio.session,
          until: this.awayUntil || radio.reconnecting ? until : Math.floor(until / 5000) * 5000 };
        this.store(JSON.stringify(ticket));
      } else {
        this.awayUntil = 0; this.store('');
        if (!this.pageAttached) this.dispose();
      }
      const label = this.computeLabel();
      if (label !== this.label) { this.label = label; this.changed.next(); }
    } finally { this.updating = false; }
  }

  private autoJoin(radio: RadioRoomService) {
    if (this.joining || radio.reservedElsewhere || (radio.seat === undefined && radio.seats.length >= 10)) return;
    // Retry a lost capacity race only when the roster changes, not every clock tick.
    const attempt = JSON.stringify([radio.user.uid, radio.seats.map(seat => [seat.id, seat.uid])]);
    if (attempt === this.joinAttempt) return;
    this.joinAttempt = attempt; this.joining = radio;
    void Promise.resolve().then(() => {
      if (this.radio === radio && this.pageAttached && !document.hidden && !this.pageHidden && this.focused
        && !radio.joined && !radio.reservedElsewhere && radio.user && radio.connected && !radio.loading && !radio.error) return radio.join();
      if (this.radio === radio) this.joinAttempt = '';
    }).catch(error => {
      if (this.radio === radio && error?.message !== 'Room full. All 10 places are taken.') radio.showError(error);
    }).finally(() => {
      if (this.joining === radio) this.joining = undefined;
      if (this.radio === radio) this.update();
    });
  }

  private valid(value: any): value is RadioReturnSession {
    return value && typeof value.uid === 'string' && value.uid.length > 0 && value.uid.length <= 128
      && typeof value.seat === 'string' && /^[0-9]$/.test(value.seat)
      && typeof value.session === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.session)
      && typeof value.until === 'number' && value.until > Date.now() && value.until <= Date.now() + RECONNECT_GRACE_MS;
  }

  private store(value: string) {
    if (value === this.saved) return;
    this.saved = value;
    try { if (value) sessionStorage.setItem(RETURN_KEY, value); else sessionStorage.removeItem(RETURN_KEY); }
    catch { /* A denied storage write must not interrupt listening. */ }
  }

  private dispose() {
    this.changes?.unsubscribe(); this.changes = undefined;
    const scope = this.scope; this.scope = undefined; this.radio = undefined;
    this.joining = undefined; this.joinAttempt = '';
    scope?.destroy();
  }

  private listen(target: EventTarget, name: string, handler: () => void) {
    target.addEventListener(name, handler); this.handlers.push([target, name, handler]);
  }
}

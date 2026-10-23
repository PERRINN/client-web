import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

type WakeState = 'off' | 'requesting' | 'active' | 'paused' | 'blocked' | 'unsupported';

/** One screen lock for the app lifetime, independent of routes and sign-in. */
@Injectable({ providedIn: 'root' })
export class ScreenWakeLockService implements OnDestroy {
  readonly supported = window.isSecureContext && typeof navigator.wakeLock?.request === 'function';
  private readonly state = new BehaviorSubject<WakeState>(this.supported ? 'off' : 'unsupported');
  readonly state$ = this.state.asObservable();
  enabled = false;
  private started = false;
  private suspended = false;
  private requesting = false;
  private generation = 0;
  private lock?: WakeLockSentinel;
  private readonly visibility = () => this.reconcile();
  private readonly hide = () => { this.suspended = true; this.reconcile(); };
  private readonly show = () => { this.suspended = false; this.reconcile(); };

  get label(): string {
    return ({ off: 'Keep awake', requesting: 'Starting…', active: 'Screen on',
      paused: 'Paused', blocked: 'Not active', unsupported: 'Unavailable' })[this.state.value];
  }
  get description(): string {
    return ({ off: 'Keep screen awake: off', requesting: 'Keep screen awake: requesting permission',
      active: 'Keep screen awake: preventing idle dimming and automatic locking', paused: 'Keep screen awake: paused while the app is hidden',
      blocked: 'Keep screen awake: the phone or browser did not allow it',
      unsupported: 'Keep screen awake is not supported by this browser' })[this.state.value];
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.enabled = this.supported && (window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.hide);
    window.addEventListener('pageshow', this.show);
    this.reconcile();
  }

  toggle(): void {
    if (!this.supported || !this.started) return;
    this.enabled = !this.enabled;
    this.reconcile();
  }

  private get eligible(): boolean {
    return this.started && this.supported && this.enabled && !this.suspended && !document.hidden;
  }
  private reconcile(): void {
    if (!this.eligible) {
      this.generation++;
      this.release();
      this.state.next(!this.supported ? 'unsupported' : this.enabled ? 'paused' : 'off');
    } else if (this.lock && !this.lock.released) this.state.next('active');
    else if (!this.requesting) void this.acquire();
  }
  private async acquire(): Promise<void> {
    const generation = this.generation;
    this.requesting = true;
    this.state.next('requesting');
    try {
      // A screen wake lock inhibits both idle dimming and automatic locking.
      const lock = await navigator.wakeLock.request('screen');
      if (generation !== this.generation || !this.eligible) {
        void lock.release().catch(() => undefined);
        return;
      }
      if (lock.released) { this.state.next('blocked'); return; }
      this.lock = lock;
      lock.addEventListener('release', () => {
        if (this.lock !== lock) return;
        this.lock = undefined;
        this.state.next(this.eligible ? 'blocked' : this.enabled ? 'paused' : 'off');
      }, { once: true });
      this.state.next('active');
    } catch {
      if (generation === this.generation && this.eligible) this.state.next('blocked');
    } finally {
      this.requesting = false;
      // A hidden/disabled request may finish after returning or re-enabling.
      // Release that stale lock first, then acquire once for the current state.
      if (generation !== this.generation && this.eligible) this.reconcile();
    }
  }
  private release(): void {
    const lock = this.lock;
    this.lock = undefined;
    if (lock && !lock.released) void lock.release().catch(() => undefined);
  }
  ngOnDestroy(): void {
    this.started = false; this.enabled = false; this.generation++;
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.hide);
    window.removeEventListener('pageshow', this.show);
    this.release(); this.state.complete();
  }
}

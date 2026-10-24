import { EnvironmentInjector, Injectable, NgZone, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Subscription } from 'rxjs';
import { serverTimestamp } from 'firebase/firestore';

interface ReadCursor {
  serverTimestamp?: { seconds?: number; toMillis?: () => number };
  blueFlag?: boolean;
  messageId?: string;
}
export interface CursorState {
  userId: string | null;
  readyChains: Record<string, boolean>;
  messageIds: Record<string, string>;
  timestamps: Record<string, number>;
  flags: Record<string, boolean>;
  ready: boolean;
  unavailable: boolean;
}

// Each consumer owns a session; loaded-chain changes reuse surviving listeners.
export class ReadCursorSession {
  private userId: string | null = null;
  private closed = false;
  private tokens = new Map<string, object>();
  private listeners = new Map<string, Subscription>();
  private records = new Map<string, ReadCursor>();
  private pending = new Set<string>();
  private failures = new Set<string>();
  private state = new BehaviorSubject<CursorState>({ userId: null, readyChains: {}, messageIds: {}, timestamps: {}, flags: {}, ready: false, unavailable: false });
  readonly changes = this.state.asObservable();

  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector, private zone: NgZone) {}

  update(userId: string | null, chains: string[]) {
    if (this.closed) return;
    if (userId !== this.userId) {
      this.userId = userId;
      this.clear();
    }
    const wanted = new Set(userId ? chains.filter(Boolean) : []);
    for (const [chain, listener] of this.listeners) if (!wanted.has(chain)) {
      this.tokens.delete(chain);
      this.listeners.delete(chain);
      listener.unsubscribe();
      this.records.delete(chain);
      this.pending.delete(chain);
      this.failures.delete(chain);
    }
    const additions = [...wanted].filter(chain => !this.listeners.has(chain));
    additions.forEach(chain => this.pending.add(chain));
    this.publish();
    additions.forEach(chain => {
      const token = {};
      this.tokens.set(chain, token);
      const subscription = runInInjectionContext(this.injector, () =>
        this.afs.doc<ReadCursor>(`lastSeen/${userId}/chats/${chain}`).valueChanges()
      ).subscribe({
        next: record => {
          if (this.closed || this.userId !== userId || this.tokens.get(chain) !== token) return;
          this.records.set(chain, record || {});
          this.pending.delete(chain);
          this.failures.delete(chain);
          this.publish();
        },
        error: () => {
          if (this.closed || this.userId !== userId || this.tokens.get(chain) !== token) return;
          this.pending.delete(chain);
          this.failures.add(chain);
          this.records.delete(chain);
          this.publish();
        }
      });
      if (this.closed || this.tokens.get(chain) !== token) subscription.unsubscribe();
      else this.listeners.set(chain, subscription);
    });
    this.publish();
  }

  retry() {
    if (this.closed) return;
    const wanted = [...this.listeners.keys()];
    for (const chain of [...this.failures]) {
      this.failures.delete(chain);
      this.tokens.delete(chain);
      this.listeners.get(chain)?.unsubscribe();
      this.listeners.delete(chain);
    }
    this.update(this.userId, wanted);
  }

  private publish() {
    const timestamps: Record<string, number> = {};
    const flags: Record<string, boolean> = {};
    const readyChains: Record<string, boolean> = {};
    const messageIds: Record<string, string> = {};
    this.records.forEach((record, chain) => {
      const timestamp = record.serverTimestamp;
      timestamps[chain] = typeof timestamp?.seconds === 'number' ? timestamp.seconds * 1000 : timestamp?.toMillis?.() || 0;
      flags[chain] = record.blueFlag === true;
      readyChains[chain] = !this.pending.has(chain) && !this.failures.has(chain);
      messageIds[chain] = record.messageId || '';
    });
    this.zone.run(() => this.state.next({ userId: this.userId, readyChains, messageIds, timestamps, flags, ready: !this.pending.size && !this.failures.size, unavailable: !!this.failures.size }));
  }

  private clear() {
    this.tokens.clear();
    this.listeners.forEach(listener => listener.unsubscribe());
    this.listeners.clear();
    this.records.clear();
    this.pending.clear();
    this.failures.clear();
  }

  destroy() {
    this.closed = true;
    this.userId = null;
    this.clear();
    this.state.complete();
  }
}

@Injectable({ providedIn: 'root' })
export class ReadCursorService {
  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector, private zone: NgZone) {}
  setFlag(userId: string, chain: string, flagged: boolean) {
    return runInInjectionContext(this.injector, () =>
      this.afs.doc(`lastSeen/${userId}/chats/${chain}`).set({ blueFlag: flagged, updatedAt: serverTimestamp() }, { merge: true })
    );
  }
  createSession() { return new ReadCursorSession(this.afs, this.injector, this.zone); }
}

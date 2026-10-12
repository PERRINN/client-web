import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Subscription } from 'rxjs';

interface ReadCursor {
  serverTimestamp?: { seconds?: number; toMillis?: () => number };
  blueFlag?: boolean;
}
export interface CursorState {
  timestamps: Record<string, number>;
  flags: Record<string, boolean>;
  ready: boolean;
  unavailable: boolean;
}

// Each profile owns a session; loaded-chain changes reuse surviving listeners.
export class ReadCursorSession {
  private userId: string | null = null;
  private listeners = new Map<string, Subscription>();
  private records = new Map<string, ReadCursor>();
  private pending = new Set<string>();
  private failures = new Set<string>();
  private state = new BehaviorSubject<CursorState>({ timestamps: {}, flags: {}, ready: false, unavailable: false });
  readonly changes = this.state.asObservable();

  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}

  update(userId: string | null, chains: string[]) {
    if (userId !== this.userId) {
      this.clear();
      this.userId = userId;
    }
    const wanted = new Set(userId ? chains.filter(Boolean) : []);
    for (const [chain, listener] of this.listeners) if (!wanted.has(chain)) {
      listener.unsubscribe();
      this.listeners.delete(chain);
      this.records.delete(chain);
      this.pending.delete(chain);
      this.failures.delete(chain);
    }
    const additions = [...wanted].filter(chain => !this.listeners.has(chain));
    additions.forEach(chain => this.pending.add(chain));
    additions.forEach(chain => {
      const subscription = runInInjectionContext(this.injector, () =>
        this.afs.doc<ReadCursor>(`lastSeen/${userId}/chats/${chain}`).valueChanges()
      ).subscribe({
        next: record => {
          this.records.set(chain, record || {});
          this.pending.delete(chain);
          this.failures.delete(chain);
          this.publish();
        },
        error: () => {
          this.pending.delete(chain);
          this.failures.add(chain);
          this.records.delete(chain);
          this.publish();
        }
      });
      this.listeners.set(chain, subscription);
    });
    this.publish();
  }

  private publish() {
    const timestamps: Record<string, number> = {};
    const flags: Record<string, boolean> = {};
    this.records.forEach((record, chain) => {
      const timestamp = record.serverTimestamp;
      timestamps[chain] = typeof timestamp?.seconds === 'number' ? timestamp.seconds * 1000 : timestamp?.toMillis?.() || 0;
      flags[chain] = !!record.blueFlag;
    });
    this.state.next({ timestamps, flags, ready: !this.pending.size && !this.failures.size, unavailable: !!this.failures.size });
  }

  private clear() {
    this.listeners.forEach(listener => listener.unsubscribe());
    this.listeners.clear();
    this.records.clear();
    this.pending.clear();
    this.failures.clear();
  }

  destroy() {
    this.clear();
    this.state.complete();
  }
}

@Injectable({ providedIn: 'root' })
export class ReadCursorService {
  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}
  createSession() { return new ReadCursorSession(this.afs, this.injector); }
}

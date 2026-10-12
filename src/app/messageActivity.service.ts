import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ActivitySummary {
  mention: boolean;
  recipient: boolean;
  other: boolean;
  flagged: boolean;
  unavailable?: boolean;
}
const emptySummary: ActivitySummary = { mention: false, recipient: false, other: false, flagged: false };

// The sidebar owns the loaded conversation records and publishes their dot state.
@Injectable({ providedIn: 'root' })
export class MessageActivityService {
  private state = new BehaviorSubject<ActivitySummary>(emptySummary);
  private pending = emptySummary;
  private scheduled = false;

  constructor(private zone: NgZone) {}

  summary() { return this.state.asObservable(); }

  update(summary: ActivitySummary) {
    const next = { ...summary };
    if (next.mention) { next.recipient = false; next.other = false; }
    else if (next.recipient) next.other = false;
    if (JSON.stringify(next) === JSON.stringify(this.pending)) return;
    this.pending = next;
    if (this.scheduled) return;
    this.scheduled = true;
    // Publish after the current view check, with Angular rendering enabled.
    queueMicrotask(() => this.zone.run(() => {
      this.scheduled = false;
      this.state.next(this.pending);
    }));
  }

  clear() { this.update(emptySummary); }
}

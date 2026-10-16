import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BubbleMessage, firstUnread, isAfterPosition, ReadPosition } from './chatBubbleData';
import { ChatBubbleDataService } from './chatBubbleData.service';

interface ReadContext {
  messages: BubbleMessage[];
  userId: string | null;
  seen: ReadPosition | null;
  cursorUnavailable: boolean;
  hasMore?: boolean;
}

// One session per open Bubbles component. DOM observation stays out of data access.
@Injectable()
export class ChatBubbleReadService implements OnDestroy {
  error = '';
  paused = false;
  private chain = '';
  private context?: ReadContext;
  private baseline?: ReadPosition;
  private entryUnreadId?: string;
  private saved: ReadPosition = { timestamp: 0, messageId: '' };
  private list?: HTMLElement;
  private mutations?: MutationObserver;
  private resize?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private writing = false;
  private acknowledged = new Set<string>();
  private submissions: Subscription;
  private refresh = () => this.scan();

  constructor(private data: ChatBubbleDataService, private zone: NgZone) {
    this.submissions = data.submitted.subscribe(message => {
      if (message.chain !== this.chain || message.userId !== this.context?.userId) return;
      this.acknowledged.add(message.messageId); this.scan();
    });
  }

  update(chain: string, context: ReadContext): string {
    if (chain !== this.chain || context.userId !== this.context?.userId) {
      this.generation++; this.baseline = undefined; this.entryUnreadId = undefined; this.saved = { timestamp: 0, messageId: '' };
      this.error = ''; this.writing = false; clearTimeout(this.timer);
      this.acknowledged.clear();
    }
    this.chain = chain; this.context = context;
    if (context.cursorUnavailable) this.error = 'Read position couldn’t load.';
    else if (!this.baseline && context.seen) { this.baseline = context.seen; this.saved = context.seen; this.error = ''; }
    else if (context.seen && isAfterPosition(context.seen, this.saved)) this.saved = context.seen;
    if (this.entryUnreadId === undefined && this.baseline) {
      this.entryUnreadId = firstUnread(context.messages.filter(message => !message.own), this.baseline.timestamp, this.baseline.messageId);
    }
    this.scan();
    return this.entryUnreadId || '';
  }

  reset(): void {
    this.generation++; clearTimeout(this.timer); this.context = undefined; this.baseline = undefined; this.entryUnreadId = undefined;
    this.saved = { timestamp: 0, messageId: '' }; this.chain = ''; this.error = ''; this.writing = false; this.paused = false;
    this.acknowledged.clear();
  }

  retry(): void { this.error = ''; this.scan(); }

  attach(list: HTMLElement): void {
    this.list = list;
    list.addEventListener('scroll', this.refresh, { passive: true });
    list.addEventListener('load', this.refresh, true);
    document.addEventListener('visibilitychange', this.refresh);
    window.addEventListener('focus', this.refresh);
    document.addEventListener('close', this.refresh, true);
    this.mutations = new MutationObserver(this.refresh);
    this.mutations.observe(list, { childList: true, subtree: true });
    const page = list.closest('#main_container');
    if (page) this.mutations.observe(page, { attributes: true, attributeFilter: ['inert'] });
    this.resize = new ResizeObserver(this.refresh); this.resize.observe(list);
    this.scan();
  }

  private active(): boolean {
    return !!this.list && !!this.context?.userId && !!this.baseline && !this.error && !this.context.cursorUnavailable
      && document.visibilityState === 'visible' && document.hasFocus()
      && !this.list.closest('[inert]') && !document.querySelector('dialog[open]');
  }

  private visible(): boolean { return this.active() && !!this.list?.clientHeight && !this.paused; }

  scan(): void {
    clearTimeout(this.timer);
    if (!this.active() || (!this.visible() && !this.acknowledged.size) || this.writing) return;
    this.timer = setTimeout(() => { void this.saveVisible(); }, 300);
  }

  private async saveVisible(): Promise<void> {
    if (!this.active() || this.writing || !this.list || !this.context?.userId) return;
    const bounds = this.list.getBoundingClientRect();
    const visible = new Set(Array.from(this.list.querySelectorAll<HTMLElement>('[data-message-id]'))
      .filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom <= bounds.bottom + 1 && rect.bottom > bounds.top + Math.min(rect.height, 20); })
      .map(row => row.dataset.messageId));
    const message = this.visible() ? [...this.context.messages].reverse().find(row => row.timestamp > 0 && visible.has(row.id)) : undefined;
    const reached = message ? { timestamp: message.timestamp, messageId: message.id } : this.saved;
    let candidate = isAfterPosition(reached, this.saved) ? reached : this.saved;
    // A cursor represents everything through a message. Never leap over unseen
    // incoming messages just because the user submitted an action in details.
    const boundaryKnown = !this.context.hasMore || isAfterPosition(reached, this.saved)
      || this.context.messages.some(row => row.timestamp > 0 && !isAfterPosition({ timestamp: row.timestamp, messageId: row.id }, this.saved));
    for (const row of boundaryKnown ? this.context.messages : []) {
      if (!row.timestamp) break;
      const position = { timestamp: row.timestamp, messageId: row.id };
      if (!isAfterPosition(position, candidate)) continue;
      if (!row.own || !this.acknowledged.has(row.id)) break;
      candidate = position;
    }
    if (!isAfterPosition(candidate, this.saved)) return;
    const generation = this.generation;
    this.writing = true;
    let completed = false;
    try {
      const saved = await this.data.advanceReadCursor(this.chain, this.context.userId, candidate);
      completed = !!saved;
      if (generation === this.generation && saved) {
        if (isAfterPosition(saved, this.saved)) this.saved = saved;
        for (const row of this.context.messages) if (row.timestamp > 0 && !isAfterPosition({ timestamp: row.timestamp, messageId: row.id }, this.saved)) this.acknowledged.delete(row.id);
      }
    } catch {
      if (generation === this.generation) this.zone.run(() => this.error = 'Read position couldn’t save.');
    } finally {
      if (generation === this.generation) { this.writing = false; if (completed) this.scan(); }
    }
  }

  ngOnDestroy(): void {
    this.generation++; clearTimeout(this.timer); this.mutations?.disconnect(); this.resize?.disconnect();
    this.list?.removeEventListener('scroll', this.refresh); this.list?.removeEventListener('load', this.refresh, true);
    document.removeEventListener('visibilitychange', this.refresh); window.removeEventListener('focus', this.refresh);
    document.removeEventListener('close', this.refresh, true); this.submissions.unsubscribe();
  }
}

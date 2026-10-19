/** Pointer sorting is confined to the handle; the rest of the list keeps native touch scrolling. */
export class ChannelDrag {
  private gesture?: {
    id: number; channel: string; label: string; list: HTMLElement; original: string[]; order: string[];
    startX: number; startY: number; y: number; offset: number; left: number; width: number; started: boolean;
  };
  private frame?: number;
  private lastFrame = 0;
  constructor(private actions: {
    valid(): boolean; reorder(id: string, index: number): void; restore(order: string[]): void;
    changed(): void; announce(message: string): void;
  }) {}
  get pending() { return !!this.gesture; }
  get active() { return !!this.gesture?.started; }
  get channel() { return this.gesture?.started ? this.gesture.channel : undefined; }
  get preview() {
    const g = this.gesture;
    return g?.started ? { label: g.label, top: g.y - g.offset, left: g.left, width: g.width } : undefined;
  }
  start(event: PointerEvent, list: HTMLElement, channel: string, label: string, order: string[]) {
    if (!event.isPrimary) { this.cancel(); return; }
    if (event.button !== 0 || this.gesture || !this.actions.valid() || !order.includes(channel)) return;
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.channel-option');
    if (!row) return;
    event.preventDefault();
    const box = row.getBoundingClientRect();
    this.gesture = { id: event.pointerId, channel, label, list, original: order.slice(), order: order.slice(),
      startX: event.clientX, startY: event.clientY, y: event.clientY, offset: event.clientY - box.top,
      left: box.left, width: box.width, started: false };
    list.setPointerCapture(event.pointerId);
  }
  move(event: PointerEvent) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.id) return;
    if (!this.actions.valid()) { this.cancel(); return; }
    g.y = event.clientY;
    if (!g.started && Math.hypot(event.clientX - g.startX, g.y - g.startY) < 6) return;
    g.started = true;
    event.preventDefault();
    this.target(); this.schedule(); this.actions.changed();
  }
  private target() {
    const g = this.gesture;
    if (!g?.started) return;
    const rows = Array.from(g.list.querySelectorAll<HTMLElement>('.channel-option')).slice(0, g.order.length);
    const current = rows.findIndex(row => row.dataset['channel'] === g.channel);
    if (current < 0) { this.cancel(); return; }
    const box = g.list.getBoundingClientRect(), y = Math.max(box.top + 1, Math.min(box.bottom - 1, g.y));
    const origin = rows[current].getBoundingClientRect();
    const direction = y < (origin.top + origin.bottom) / 2 ? -1 : 1;
    let target = current;
    for (let index = current + direction; index >= 0 && index < rows.length; index += direction) {
      const rect = rows[index].getBoundingClientRect(), middle = (rect.top + rect.bottom) / 2;
      if (direction === -1 ? y >= middle : y <= middle) break;
      target = index;
    }
    const from = g.order.indexOf(g.channel);
    if (target === from) return;
    g.order.splice(from, 1); g.order.splice(target, 0, g.channel);
    this.actions.reorder(g.channel, target);
    this.actions.announce(g.label + ', position ' + (target + 1) + ' of ' + g.order.length);
  }
  private schedule() {
    if (this.frame === undefined) this.frame = requestAnimationFrame(time => this.scroll(time));
  }
  private scroll(time: number) {
    this.frame = undefined;
    const g = this.gesture;
    if (!g?.started) return;
    if (!this.actions.valid()) { this.cancel(); return; }
    const box = g.list.getBoundingClientRect(), edge = Math.min(32, box.height / 4);
    const direction = g.y < box.top + edge ? -1 : g.y > box.bottom - edge ? 1 : 0;
    const elapsed = this.lastFrame ? Math.min(32, time - this.lastFrame) : 16;
    this.lastFrame = time;
    const previous = g.list.scrollTop;
    g.list.scrollTop += direction * elapsed * .4;
    // Continue frames only while an edge drag actually scrolls; no idle/background loop.
    if (g.list.scrollTop !== previous) { this.target(); this.actions.changed(); this.schedule(); }
  }
  finish(event: PointerEvent) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.id) return;
    this.move(event);
    if (this.gesture !== g) return;
    this.release();
    if (g.started) this.actions.announce(g.label + ', position ' + (g.order.indexOf(g.channel) + 1) + ' of ' + g.order.length);
    this.actions.changed();
  }
  cancel(event?: PointerEvent) {
    const g = this.gesture;
    if (!g || event && event.pointerId !== g.id) return;
    this.release();
    if (g.started) { this.actions.restore(g.original); this.actions.announce('Reordering cancelled'); }
    this.actions.changed();
  }
  private release() {
    const g = this.gesture; this.gesture = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.lastFrame = 0;
    if (g?.list.hasPointerCapture(g.id)) g.list.releasePointerCapture(g.id);
  }
}

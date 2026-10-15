/** Recognise two stationary single-finger taps on the same chart. */
export class ChartDoubleTap {
  private pointers = new Set<number>();
  private current?: { id: number; chart: EventTarget; x: number; y: number; time: number };
  private previous?: { chart: EventTarget; x: number; y: number; time: number };
  start(event: PointerEvent) {
    if (event.pointerType !== 'touch') { this.previous = undefined; return event.isPrimary; }
    this.pointers.add(event.pointerId);
    if (!event.isPrimary || this.pointers.size > 1) {
      this.current = this.previous = undefined;
      return false;
    }
    this.current = { id: event.pointerId, chart: event.currentTarget!, x: event.clientX, y: event.clientY, time: event.timeStamp };
    return true;
  }
  move(event: PointerEvent) {
    const tap = this.current;
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= 6) {
      this.current = this.previous = undefined;
    }
  }
  finish(event: PointerEvent) {
    this.move(event);
    this.pointers.delete(event.pointerId);
    const tap = this.current;
    if (!tap || tap.id !== event.pointerId) return false;
    this.current = undefined;
    if (event.timeStamp - tap.time > 250) { this.previous = undefined; return false; }
    const previous = this.previous;
    const double = !!previous && previous.chart === tap.chart && event.timeStamp - previous.time <= 350 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 24;
    this.previous = double ? undefined : { chart: tap.chart, x: event.clientX, y: event.clientY, time: event.timeStamp };
    return double;
  }
  cancel(event?: PointerEvent) {
    // A normal release also emits lostpointercapture; preserve the completed tap.
    if (event && !this.pointers.has(event.pointerId)) return;
    if (event) this.pointers.delete(event.pointerId); else this.pointers.clear();
    this.current = this.previous = undefined;
  }
}

interface ChartRange { start: number; end: number }
export class ChartSelection {
  private drag?: { id: number; chart: SVGElement; anchor: number; position: number; clientX: number; moved: boolean; range: ChartRange };
  get active() { return !!this.drag; }
  get band() {
    const d = this.drag;
    return d?.moved ? { x: Math.min(d.anchor, d.position) * 300, width: Math.abs(d.position - d.anchor) * 300 } : undefined;
  }
  overviewBand(origin: number, end: number) {
    const band = this.band, d = this.drag;
    if (!band || !d || end <= origin) return undefined;
    const scale = (d.range.end - d.range.start) / (end - origin);
    return { x: (d.range.start - origin) / (end - origin) * 300 + band.x * scale, width: band.width * scale };
  }
  start(event: PointerEvent, range: ChartRange) {
    if (event.button !== 0 || !event.isPrimary || this.drag) return false;
    const chart = event.currentTarget as SVGElement, box = chart.getBoundingClientRect();
    if (!box.width || range.end <= range.start) return false;
    event.preventDefault(); chart.blur();
    const anchor = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    this.drag = { id: event.pointerId, chart, anchor, position: anchor, clientX: event.clientX, moved: false, range };
    chart.setPointerCapture(event.pointerId); return true;
  }
  move(event: PointerEvent) {
    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    const box = d.chart.getBoundingClientRect();
    if (!box.width) return;
    d.position = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    d.moved ||= Math.abs(event.clientX - d.clientX) >= 6;
  }
  finish(event: PointerEvent): ChartRange | undefined {
    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    this.move(event);
    const band = this.band;
    this.release();
    const width = d.range.end - d.range.start;
    if (!band || band.width / 300 * width < .02) return;
    return { start: d.range.start + band.x / 300 * width, end: d.range.start + (band.x + band.width) / 300 * width };
  }
  end(event?: PointerEvent) {
    if (!this.drag || event && event.pointerId !== this.drag.id) return;
    this.release();
  }
  private release() {
    const d = this.drag; this.drag = undefined;
    if (d?.chart.hasPointerCapture(d.id)) d.chart.releasePointerCapture(d.id);
  }
  bandFor(chart: SVGElement) { return this.drag?.chart === chart ? this.band : undefined; }
}

import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import type { GreenpowerChannel } from './greenpowerData';
import { isLapMetric, londonTime, pointIndex } from './greenpowerData';
import { ChartWindow, elapsedTime, chartY, channelReading, clockTicks, formatAxisValue, formatTelemetryValue, channelLimit, nearestPoint, plotFor } from './greenpowerChart';
import { SessionInterval, visibleSessions } from './greenpowerSessions';
import { ChartDoubleTap } from '../telemetry/chartDoubleTap';
import { lapAt, LapInterval, visibleLaps } from './greenpowerLaps';
import type { OverlayTrace } from './greenpowerOverlay';

@Component({
  selector: 'app-greenpower-chart', standalone: false,
  templateUrl: './greenpower-chart.component.html', styleUrls: ['./greenpower-chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GreenpowerChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) channel!: GreenpowerChannel;
  @Input() comparison?: GreenpowerChannel;
  @Input() heading = '';
  @Input() start = 0;
  @Input() end = 0;
  @Input() cursor?: number;
  @Input() laps: LapInterval[] = [];
  @Input() sessions: SessionInterval[] = [];
  @Input() context = '';
  @Input() overlays: OverlayTrace[] = [];
  @Output() overlayVisibilityChange = new EventEmitter<string>();
  @Output() windowChange = new EventEmitter<ChartWindow | undefined>();
  @Output() cursorChange = new EventEmitter<number | undefined>();
  @ViewChild('plot') plot?: ElementRef<SVGSVGElement>;
  model = plotFor([], 0, 0, 300);
  ticks = clockTicks(0, 0, 300);
  lapBands = visibleLaps([], 0, 0, 300);
  sessionBands = visibleSessions([], 0, 0);
  get limit() { return channelLimit(this.channel); }
  get limitY() { return chartY(this.limit!, this.model.axis); }
  get cursorLap() {
    if (isLapMetric(this.channel.id)) {
      const point = this.reading;
      const lap = point && this.laps[pointIndex(this.laps, point.time) - 1];
      return lap?.end === point?.time ? lap?.lap : undefined;
    }
    return this.cursor === undefined ? undefined : lapAt(this.laps, this.cursor);
  }
  comparisonY(value: number) { return chartY(value, this.model.axis); }
  formatAxis = formatAxisValue;
  time(value: number) { return this.overlays.length ? elapsedTime(value) : londonTime(value); }
  overlayValue(trace: OverlayTrace) {
    if (trace.hidden) return '—';
    const points = trace.channel.points;
    const point = this.cursor === undefined || this.cursor < (points[0]?.time ?? Infinity) || this.cursor > (points.at(-1)?.time ?? -Infinity)
      ? undefined : channelReading(trace.channel, this.cursor, this.start, this.end);
    return point ? formatTelemetryValue(point.value, this.model.axis.min, this.model.axis.max) : '—';
  }
  lapDots: { time: number; value: number }[] = [];
  overlayDots: { time: number; value: number }[][] = [];
  get dotRadiusX() { return 3 * 800 / Math.max(1, this.width); }
  get dotRadiusY() { return this.overlays.length ? 1.2 : 2.4; }
  dotX(time: number) { return (time - this.start) / Math.max(1, this.end - this.start) * 800; }
  private width = 300;
  private renderPending = false;
  private observer?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  // Pointer capture alone cannot stop the browser taking a vertical touch gesture.
  // Keep the first touchmove cancellable so a completed hold owns this gesture.
  private readonly touchMove = (event: TouchEvent) => {
    if (this.drag && this.drag.mode !== 'pending' && event.touches.length === 1 && event.cancelable) event.preventDefault();
  };
  private taps = new ChartDoubleTap();
  private doubleClickReady = true;
  private drag?: { id: number; x: number; y: number; anchor: number; position: number; mode: 'pending' | 'zoom' | 'cursor'; range: ChartWindow };
  constructor(private change: ChangeDetectorRef, private zone: NgZone) {}
  get cursorPosition() {
    const point = this.reading ?? this.comparisonReading;
    return point ? (point.time - this.start) / Math.max(1, this.end - this.start) * 800 : undefined;
  }
  get markerY() {
    const point = this.reading, axis = this.model.axis;
    if (!point) return undefined;
    return chartY(point.value, axis);
  }
  // The SVG stretches horizontally; compensate to keep the marker circular in CSS pixels.
  get markerRadiusX() { return 4 * 800 / Math.max(1, this.width); }
  get reading() { return this.cursor === undefined ? undefined : channelReading(this.channel, this.cursor, this.start, this.end); }
  get comparisonReading() { return this.cursor === undefined || !this.comparison ? undefined : nearestPoint(this.comparison.points, this.cursor, this.start, this.end); }
  get comparisonLabel() {
    const point = this.comparisonReading;
    return point ? formatTelemetryValue(point.value, this.model.axis.min, this.model.axis.max) + ' ' + this.comparison!.unit : '—';
  }
  get cursorLabel() {
    const point = this.reading;
    return point ? formatTelemetryValue(point.value, this.model.axis.min, this.model.axis.max) + (this.channel.unit ? ' ' + this.channel.unit : '') : '—';
  }
  get band() {
    const d = this.drag;
    return d?.mode === 'zoom' ? { x: Math.min(d.anchor, d.position) * 800, width: Math.abs(d.anchor - d.position) * 800 } : undefined;
  }
  zoomLap(lap: LapInterval) {
    this.zoomRange({ start: lap.time, end: lap.end });
  }
  zoomSession(session: SessionInterval) {
    this.zoomRange({ start: session.start, end: session.end });
  }
  private zoomRange(range: ChartWindow) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return;
    this.cancel(); this.taps.cancel();
    this.cursorChange.emit(undefined);
    this.windowChange.emit(range);
  }
  ngOnChanges(changes: SimpleChanges) {
    if (changes['context'] || changes['overlays']) this.cancel();
    if (changes['channel'] || changes['comparison'] || changes['overlays'] || changes['start'] || changes['end'] || changes['laps'] || changes['sessions']) {
      if (this.drag) this.renderPending = true;
      else this.render();
    }
  }
  ngAfterViewInit() {
    this.observer = new ResizeObserver(entries => this.zone.run(() => {
      this.width = entries[0].contentRect.width; this.render(); this.change.markForCheck();
    }));
    this.observer.observe(this.plot!.nativeElement);
    this.plot!.nativeElement.addEventListener('touchmove', this.touchMove, { passive: false });
  }
  private render() {
    this.model = plotFor(this.overlays.length ? [] : this.channel.points, this.start, this.end, this.width, this.limit, this.comparison?.points, this.overlays.map(trace => trace.hidden ? [] : trace.channel.points));
    const dots = (channel: GreenpowerChannel) => isLapMetric(channel.id)
      ? channel.points.slice(pointIndex(channel.points, this.start), pointIndex(channel.points, this.end, true)) : [];
    this.lapDots = this.overlays.length ? [] : dots(this.channel);
    this.overlayDots = this.overlays.map(trace => trace.hidden ? [] : dots(trace.channel));
    this.ticks = clockTicks(this.start, this.end, this.width);
    if (this.overlays.length) this.ticks = this.ticks.map(tick => ({ ...tick, label: elapsedTime(this.start + tick.position / 100 * (this.end - this.start)) }));
    this.sessionBands = visibleSessions(this.sessions, this.start, this.end, this.width);
    this.lapBands = visibleLaps(this.laps, this.start, this.end, this.width);
  }
  private fraction(event: PointerEvent) {
    const box = this.plot!.nativeElement.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - box.left) / (box.width || 1)));
  }
  down(event: PointerEvent) {
    if (!this.taps.start(event)) { this.cancel(); return; }
    if (event.button !== 0 || this.end <= this.start) return;
    this.cancel();
    const anchor = this.fraction(event);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, anchor, position: anchor, mode: 'pending', range: { start: this.start, end: this.end } };
    this.plot!.nativeElement.setPointerCapture(event.pointerId);
    const gesture = this.drag;
    this.timer = setTimeout(() => {
      if (this.drag !== gesture || gesture.mode !== 'pending') return;
      gesture.mode = 'cursor'; this.inspect(anchor, gesture.range); this.change.markForCheck();
    }, 300);
  }
  move(event: PointerEvent) {
    this.taps.move(event);
    const d = this.drag;
    if (!d) return;
    if (event.pointerId !== d.id) return;
    const dx = Math.abs(event.clientX - d.x), dy = Math.abs(event.clientY - d.y);
    if (d.mode === 'pending' && Math.hypot(dx, dy) >= 6) {
      clearTimeout(this.timer);
      if (event.pointerType === 'touch' && dy > dx) { this.cancel(); return; }
      d.mode = 'zoom'; this.cursorChange.emit(undefined);
    }
    d.position = this.fraction(event);
    if (d.mode === 'cursor') this.inspect(d.position, d.range);
  }
  private inspect(position: number, range: ChartWindow = { start: this.start, end: this.end }) {
    const time = range.start + position * (range.end - range.start);
    this.cursorChange.emit(this.overlays.length ? time : nearestPoint(this.channel.points.length ? this.channel.points : this.comparison?.points ?? [], time, range.start, range.end)?.time);
  }
  up(event: PointerEvent) {
    this.move(event);
    const d = this.drag;
    const double = this.taps.finish(event);
    if (!d || d.id !== event.pointerId) return;
    const band = this.band;
    this.doubleClickReady = d.mode === 'pending';
    this.cancel();
    if (double) this.reset();
    else if (band && Math.abs(d.position - d.anchor) >= .005) {
      this.windowChange.emit({ start: d.range.start + band.x / 800 * (d.range.end - d.range.start), end: d.range.start + (band.x + band.width) / 800 * (d.range.end - d.range.start) });
    }
  }
  cancel(event?: PointerEvent) {
    if (event) this.taps.cancel(event);
    if (event && this.drag?.id !== event.pointerId) return;
    clearTimeout(this.timer);
    const drag = this.drag; this.drag = undefined;
    if (drag && this.plot?.nativeElement.hasPointerCapture(drag.id)) this.plot.nativeElement.releasePointerCapture(drag.id);
    if (this.renderPending) { this.renderPending = false; this.render(); }
  }
  doubleClick() { if (this.doubleClickReady) this.reset(); }
  reset() { this.cancel(); this.taps.cancel(); this.cursorChange.emit(undefined); this.windowChange.emit(undefined); }
  key(event: KeyboardEvent) {
    if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); this.reset(); }
    else if (event.key === 'Escape') { this.cancel(); this.cursorChange.emit(undefined); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const points = this.overlays.length ? this.overlays.filter(trace => !trace.hidden).reduce((longest, trace) =>
        (trace.channel.points.at(-1)?.time ?? 0) > (longest.at(-1)?.time ?? 0) ? trace.channel.points : longest, [] as typeof this.channel.points) : this.channel.points.length ? this.channel.points : this.comparison?.points ?? [];
      const first = pointIndex(points, this.start), last = pointIndex(points, this.end, true) - 1;
      if (first > last) { this.cursorChange.emit(undefined); return; }
      const index = this.cursor === undefined
        ? pointIndex(points, nearestPoint(points, (this.start + this.end) / 2, this.start, this.end)!.time)
        : event.key === 'ArrowRight' ? pointIndex(points, this.cursor, true) : pointIndex(points, this.cursor) - 1;
      this.cursorChange.emit(points[Math.max(first, Math.min(last, index))].time);
    }
  }
  ngOnDestroy() {
    this.plot?.nativeElement.removeEventListener('touchmove', this.touchMove);
    this.cancel(); this.observer?.disconnect();
  }
}

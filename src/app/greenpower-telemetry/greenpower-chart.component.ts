import type { ChartMarker } from './greenpowerMarkers';
import type { LegendHighlight } from './greenpowerChart';
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import type { GreenpowerChannel } from './greenpowerData';
import { formatChannelNumber, isLapMetric, isRaceTime, londonTime, pointIndex } from './greenpowerData';
import { ChartWindow, elapsedTime, chartY, channelReading, channelReadout, clockTicks, formatAxisValue, channelMarker, nearestPoint, plotFor } from './greenpowerChart';
import { SessionInterval, visibleSessions } from './greenpowerSessions';
import { ChartDoubleTap } from '../telemetry/chartDoubleTap';
import { lapAt, LapInterval, visibleLaps } from './greenpowerLaps';
import type { OverlayTrace } from './greenpowerOverlay';

@Component({
  selector: 'app-greenpower-chart', standalone: false,
  templateUrl: './greenpower-chart.component.html', styleUrls: ['./greenpower-chart.component.css', './math-channel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GreenpowerChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) channel!: GreenpowerChannel;
  @Input() markerSetting?: ChartMarker;
  @Input() comparison?: GreenpowerChannel;
  @Input() heading = '';
  @Input() start = 0;
  @Input() end = 0;
  @Input() live = false;
  @Input() cursor?: number;
  @Input() laps: LapInterval[] = [];
  @Input() sessions: SessionInterval[] = [];
  @Input() context = '';
  @Input() overlays: OverlayTrace[] = [];
  @Input() legendHighlight?: LegendHighlight;
  @Output() legendHighlightChange = new EventEmitter<LegendHighlight | undefined>();
  protected hoveredLegend?: LegendHighlight;
  private focusedLegend?: LegendHighlight;
  legendEnter(channelId: string, sessionId?: string, event?: PointerEvent) {
    if (event?.pointerType === 'touch' || !this.legendAvailable(channelId, sessionId)) return;
    this.hoveredLegend = { channelId, sessionId };
    this.legendHighlightChange.emit(this.hoveredLegend);
  }
  legendLeave() {
    this.hoveredLegend = undefined;
    this.legendHighlightChange.emit(this.focusedLegend);
  }
  legendFocus(channelId?: string, sessionId?: string) {
    this.focusedLegend = channelId && this.legendAvailable(channelId, sessionId) ? { channelId, sessionId } : undefined;
    this.legendHighlightChange.emit(this.hoveredLegend ?? this.focusedLegend);
  }
  private legendAvailable(channelId: string, sessionId?: string) {
    return !this.overlays.length || this.overlays.some(trace => trace.channel.id === channelId && trace.sessionId === sessionId && !trace.hidden && !trace.excluded);
  }
  dimmed(channelId: string, sessionId?: string) {
    const highlight = this.legendHighlight;
    if (!highlight) return false;
    if (highlight.sessionId !== sessionId) return true;
    // Follow the session across metrics; distinguish paired traces where available.
    const hasChannel = !this.overlays.length || this.overlays.some(trace => !trace.hidden && trace.channel.id === highlight.channelId);
    return hasChannel && !!highlight.channelId && highlight.channelId !== channelId;
  }
  @Output() overlayVisibilityChange = new EventEmitter<string>();
  @Output() windowChange = new EventEmitter<ChartWindow | undefined>();
  @Output() cursorChange = new EventEmitter<number | undefined>();
  @ViewChild('plot') plot?: ElementRef<SVGSVGElement>;
  model = plotFor([], 0, 0, 300);
  ticks = clockTicks(0, 0, 300);
  lapBands = visibleLaps([], 0, 0, 300);
  sessionBands = visibleSessions([], 0, 0);
  get marker() { return channelMarker(this.channel, this.markerSetting); }
  get raceTime() { return isRaceTime(this.channel); }
  get markerY() { return chartY(this.marker!, this.model.axis); }
  get cursorLap() {
    if (isLapMetric(this.channel.id)) {
      const point = this.reading;
      const lap = point && this.laps[pointIndex(this.laps, point.time) - 1];
      return lap?.end === point?.time ? lap?.lap : undefined;
    }
    const time = this.cursor ?? this.reading?.time ?? this.comparisonReading?.time;
    return time === undefined ? undefined : lapAt(this.laps, time);
  }
  comparisonY(value: number) { return chartY(value, this.model.axis); }
  formatAxis = formatAxisValue;
  formatNumber = formatChannelNumber;
  time(value: number) { return this.overlays.length ? elapsedTime(value) : londonTime(value); }
  private latestOverlayTime?: number;
  get overlayCursor() { return this.cursor ?? this.latestOverlayTime; }
  overlayValue(trace: OverlayTrace) {
    if (trace.hidden || trace.excluded) return '—';
    const point = nearestPoint(trace.channel.points, this.cursor ?? this.end, this.start, this.end);
    return point ? channelReadout(trace.channel, point.value, this.model.axis.min, this.model.axis.max, false) : '—';
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
  get cursorY() {
    const point = this.reading, axis = this.model.axis;
    if (!point) return undefined;
    return chartY(point.value, axis);
  }
  // The SVG stretches horizontally; compensate to keep the cursor point circular in CSS pixels.
  get cursorRadiusX() { return 4 * 800 / Math.max(1, this.width); }
  get reading() {
    if (this.cursor !== undefined) return channelReading(this.channel, this.cursor, this.start, this.end);
    return nearestPoint(this.channel.points, this.end, this.start, this.end);
  }
  get comparisonReading() {
    if (!this.comparison) return undefined;
    return nearestPoint(this.comparison.points, this.cursor ?? this.end, this.start, this.end);
  }
  get comparisonLabel() {
    const point = this.comparisonReading;
    return point ? channelReadout(this.comparison!, point.value, this.model.axis.min, this.model.axis.max) : '—';
  }
  get cursorLabel() {
    const point = this.reading;
    return point ? channelReadout(this.channel, point.value, this.model.axis.min, this.model.axis.max) : '—';
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
    if (!this.legendHighlight || changes['context']) this.hoveredLegend = this.focusedLegend = undefined;
    const overlays = changes['overlays'];
    const identity = (traces: OverlayTrace[] = []) => traces.map(trace => `${trace.id}:${!!trace.hidden}:${!!trace.excluded}`).join('|');
    if (changes['context'] || overlays && identity(overlays.previousValue) !== identity(overlays.currentValue)) this.cancel();
    if (changes['markerSetting'] || changes['channel'] || changes['comparison'] || changes['overlays'] || changes['start'] || changes['end'] || changes['laps'] || changes['sessions']) {
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
    this.latestOverlayTime = undefined;
    for (const trace of this.overlays) {
      if (trace.hidden || trace.excluded) continue;
      const point = nearestPoint(trace.channel.points, this.end, this.start, this.end);
      if (point && (this.latestOverlayTime === undefined || point.time > this.latestOverlayTime)) this.latestOverlayTime = point.time;
    }
    this.model = plotFor(this.overlays.length ? [] : this.channel.points, this.start, this.end, this.width, this.marker, this.comparison?.points, this.overlays.map(trace => trace.hidden ? [] : trace.channel.points));
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
      // Reaching the right edge includes points received during the gesture too.
      const end = this.live && Math.max(d.anchor, d.position) === 1 ? Math.max(d.range.end, this.end)
        : d.range.start + (band.x + band.width) / 800 * (d.range.end - d.range.start);
      this.windowChange.emit({ start: d.range.start + band.x / 800 * (d.range.end - d.range.start), end });
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
      const points = this.overlays.length ? this.overlays.filter(trace => !trace.hidden && !trace.excluded).reduce((longest, trace) =>
        (trace.channel.points.at(-1)?.time ?? 0) > (longest.at(-1)?.time ?? 0) ? trace.channel.points : longest, [] as typeof this.channel.points) : this.channel.points.length ? this.channel.points : this.comparison?.points ?? [];
      const first = pointIndex(points, this.start), last = pointIndex(points, this.end, true) - 1;
      if (first > last) { this.cursorChange.emit(undefined); return; }
      const index = this.cursor === undefined
        ? event.key === 'ArrowLeft' ? pointIndex(points, points[last].time) - 1 : last
        : event.key === 'ArrowRight' ? pointIndex(points, this.cursor, true) : pointIndex(points, this.cursor) - 1;
      this.cursorChange.emit(points[Math.max(first, Math.min(last, index))].time);
    }
  }
  ngOnDestroy() {
    this.plot?.nativeElement.removeEventListener('touchmove', this.touchMove);
    this.cancel(); this.observer?.disconnect();
  }
}

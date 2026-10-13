import { Component, OnDestroy, NgZone, ElementRef } from '@angular/core';
import { LiveSample } from './sessionHistory';
import { UnityLiveLinkService } from './unityLiveLink.service';

@Component({
  selector: 'app-unity-live-link', standalone: false,
  templateUrl: './unity-live-link.component.html',
  styleUrls: ['./unity-live-link.component.css'], providers: [UnityLiveLinkService]
})
export class UnityLiveLinkComponent implements OnDestroy {
  token = '';
  cursor?: LiveSample;
  cursorTime?: number;
  cursorPinned = false;
  private drag?: { id: number; chart: SVGElement };
  get dragging() { return !!this.drag; }
  private cursorFraction?: number;
  drafts: Record<string, number> = {};
  traces: { path: string; min: number; max: number; ticks: { value: number; y: number }[] }[] = [];
  timeTicks: { value: number; position: number }[] = [];
  overviewTicks: { value: number; position: number }[] = [];
  readonly gridX = [0, 75, 150, 225, 300];
  readonly gridY = [8, 19, 30, 41, 52];
  overview = '';
  start = 0;
  end = 30;
  span = 30;
  follow = true;
  full = false;
  eventPage = 0;
  markers: { x: number; label: string }[] = [];
  gaps: { x: number; width: number; label: string }[] = [];
  private rendered = '';
  private overviewAt = 0;
  private overviewResolution = 0;
  private overviewVersion = -1;
  private overviewRange = '';
  private session = '';
  private refresh: ReturnType<typeof setInterval>;
  constructor(public live: UnityLiveLinkService, zone: NgZone, private element: ElementRef<HTMLElement>) {
    zone.runOutsideAngular(() => {
      this.refresh = setInterval(() => zone.run(() => this.render()), 100);
    });
  }
  connect() { this.drafts = {}; this.live.connect(this.token); this.token = ''; }
  openSample() { this.drafts = {}; void this.live.openSample(); }
  openRecording(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) { this.drafts = {}; void this.live.openRecording(input.files); }
    input.value = '';
  }
  get duration() { return this.live.history.end; }
  get maxStart() { return Math.max(0, this.duration - this.span); }
  get windowEvents() { return this.live.history.events.filter(e => e.time >= this.start && e.time <= this.end); }
  get shownEvents() { return this.windowEvents.slice(this.eventPage * 20, (this.eventPage + 1) * 20); }
  get overviewX() { return this.duration ? this.start / this.duration * 300 : 0; }
  get overviewWidth() { return this.duration ? (this.end - this.start) / this.duration * 300 : 300; }
  all() { this.full = true; this.follow = false; this.rendered = ''; }
  followLive() { this.full = false; this.follow = true; this.span = 30; this.rendered = ''; }
  pan(value: number) { this.full = this.follow = false; this.start = Math.max(0, Math.min(this.maxStart, Number(value))); this.end = Math.min(this.duration, this.start + this.span); this.eventPage = 0; this.rendered = ''; }
  zoom(factor: number) {
    this.full = false;
    const center = this.cursorPinned && this.cursorTime !== undefined
      ? this.cursor?.time ?? this.cursorTime : (this.start + this.end) / 2;
    this.span = Math.max(0.2, Math.min(Math.max(0.2, this.duration), (this.end - this.start) * factor));
    this.pan(Math.max(0, Math.min(this.maxStart, center - this.span / 2)));
  }
  selectOverview(event: MouseEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    this.pan(Math.max(0, Math.min(this.maxStart, (event.clientX - box.left) / box.width * this.duration - this.span / 2)));
  }
  get cursorX() { return ((this.cursor?.time ?? this.cursorTime ?? this.start) - this.start) / Math.max(0.02, this.end - this.start) * 300; }
  inspectTime(time: number) {
    this.cursorTime = Math.max(this.start, Math.min(this.end, time));
    this.cursor = this.live.history.nearest(this.cursorTime, this.start, this.end);
  }
  hover(event: PointerEvent) {
    if (this.drag) {
      if (event.pointerId === this.drag.id) this.pinCursor(event);
      return;
    }
    if (this.cursorPinned) return;
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    if (box.width) {
      this.cursorFraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      this.inspectTime(this.start + this.cursorFraction * (this.end - this.start));
    }
  }
  clearCursor(force = false) {
    if (this.cursorPinned && !force) return;
    this.endDrag();
    this.cursor = undefined; this.cursorTime = undefined; this.cursorFraction = undefined; this.cursorPinned = false;
  }
  focusCursor() { if (!this.cursorPinned) this.inspectTime(this.start); }
  get cursorVisible() { return this.cursorTime !== undefined && (this.cursor?.time ?? this.cursorTime) >= this.start && (this.cursor?.time ?? this.cursorTime) <= this.end; }
  pinCursor(event?: MouseEvent) {
    if (!this.live.history.length) return;
    if (event) {
      const box = (event.currentTarget as SVGElement).getBoundingClientRect();
      if (box.width) this.inspectTime(this.start + (event.clientX - box.left) / box.width * (this.end - this.start));
    } else if (this.cursorTime === undefined) this.inspectTime(this.start);
    this.cursorTime = this.cursor?.time ?? this.cursorTime;
    this.cursorPinned = true; this.cursorFraction = undefined; this.follow = false;
  }
  startDrag(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !this.live.history.length) return;
    const chart = event.currentTarget as SVGElement;
    this.pinCursor(event);
    this.drag = { id: event.pointerId, chart };
    chart.setPointerCapture(event.pointerId);
  }
  finishDrag(event: PointerEvent) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.pinCursor(event); this.endDrag();
  }
  endDrag(event?: PointerEvent) {
    if (!this.drag || event && event.pointerId !== this.drag.id) return;
    const drag = this.drag; this.drag = undefined;
    if (drag.chart.hasPointerCapture(drag.id)) drag.chart.releasePointerCapture(drag.id);
  }
  stepCursor(direction: number) {
    this.cursorFraction = undefined;
    const index = this.cursor ? this.cursor.sequence - 1 + direction : (this.live.history.nearest(this.start)?.sequence ?? 0) - 1;
    const sample = this.live.history.sampleAt(index);
    if (sample && sample.time >= this.start && sample.time <= this.end) this.inspectTime(sample.time);
  }
  cursorY(channel: number) {
    const value = this.cursor?.values[channel], trace = this.traces[channel];
    return value === null || value === undefined || !trace ? 30 : 52 - (value - trace.min) / (trace.max - trace.min || 1) * 44;
  }
  private valueTicks(min: number, max: number) {
    return min === max ? [{ value: min, y: 52 }] : [{ value: max, y: 8 }, { value: (min + max) / 2, y: 30 }, { value: min, y: 52 }];
  }
  private axisTimes(start: number, end: number) {
    return [0, 50, 100].map(position => ({ position, value: start + (end - start) * position / 100 }));
  }
  private render() {
    const history = this.live.history;
    if (this.session !== this.live.session) { this.session = this.live.session; this.clearCursor(true); this.followLive(); this.overviewAt = 0; this.overview = ''; this.eventPage = 0; }
    for (const p of this.live.parameters) if (this.drafts[p.id] === undefined) this.drafts[p.id] = p.value;
    if (this.full) { this.start = history.start; this.end = history.end; }
    else if (this.follow) { this.end = history.end; this.start = Math.max(history.start, this.end - this.span); }
    if (this.cursorFraction !== undefined) this.inspectTime(this.start + this.cursorFraction * (this.end - this.start));
    if (this.cursorTime !== undefined && !this.cursorPinned) {
      if (this.cursorTime < this.start || this.cursorTime > this.end) this.clearCursor();
      else this.inspectTime(this.cursorTime);
    }
    const resolution = (selector: string) => {
      const width = this.element.nativeElement.querySelector(selector)?.getBoundingClientRect().width || 300;
      return Math.max(128, Math.min(4096, Math.ceil(width * (window.devicePixelRatio || 1))));
    };
    const chartResolution = resolution('.channel svg'), overviewResolution = resolution('.overview');
    const key = `${history.version}:${this.start}:${this.end}:${chartResolution}:${overviewResolution}`;
    const speedRange = history.range(0), rangeKey = `${speedRange.min}:${speedRange.max}`;
    if (!this.overview || this.overviewRange !== rangeKey || this.overviewResolution !== overviewResolution ||
        this.overviewVersion !== history.version && performance.now() - this.overviewAt >= 1000) {
      this.overview = history.trace(0, history.start, history.end, overviewResolution).path;
      this.overviewAt = performance.now(); this.overviewResolution = overviewResolution; this.overviewVersion = history.version; this.overviewRange = rangeKey;
    }
    if (this.rendered === key) return;
    this.rendered = key;
    this.timeTicks = this.axisTimes(this.start, this.end);
    this.overviewTicks = this.axisTimes(history.start, history.end);
    this.traces = this.live.channels.map((_, i) => {
      const trace = history.trace(i, this.start, this.end, chartResolution);
      return { ...trace, ticks: history.hasRange(i) ? this.valueTicks(trace.min, trace.max) : [] };
    });
    const x = (t: number) => Math.max(0, Math.min(300, (t - this.start) / Math.max(0.02, this.end - this.start) * 300));
    this.markers = this.windowEvents.map(e => ({ x: x(e.time), label: `${e.time.toFixed(2)} s · ${e.result.parameter} = ${e.result.value} · frame ${e.result.effectiveFromFrame}` }));
    this.gaps = history.gaps.filter(g => g.end >= this.start && g.start <= this.end).map(g => ({ x: x(g.start), width: Math.max(1, x(g.end) - x(g.start)), label: `No recorded samples · ${g.start.toFixed(2)}–${g.end.toFixed(2)} s` }));

  }
  ngOnDestroy() { this.endDrag(); clearInterval(this.refresh); this.live.disconnect(); }
}

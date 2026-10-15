import { chartIndices, channelName, fixedChartRange } from './chartChannels';
import { TrackTrajectory } from './trackTrajectory';
import { timeAxis, TimeTick } from './timeAxis';
import { axisY, VerticalAxis } from './verticalAxis';
import { Component, OnInit, OnDestroy, NgZone, ElementRef } from '@angular/core';
import { formatAxisValue, LiveSample, SessionHistory } from './sessionHistory';
import { UnityLiveLinkService } from './unityLiveLink.service';

@Component({
  selector: 'app-unity-live-link', standalone: false,
  templateUrl: './unity-live-link.component.html',
  styleUrls: ['./unity-live-link.component.css'], providers: [UnityLiveLinkService]
})
export class UnityLiveLinkComponent implements OnInit, OnDestroy {
  readonly formatAxisValue = formatAxisValue;
  token = '';
  cursor?: LiveSample;
  cursorTime?: number;
  cursorPinned = false;
  readonly track = new TrackTrajectory();
  private navigationDrag?: { id: number; chart: SVGElement; offset: number; mode: 'pan' | 'left' | 'right'; anchor: number };
  get resizingNavigation() { return !!this.navigationDrag && this.navigationDrag.mode !== 'pan'; }
  private drag?: { id: number; chart: SVGElement };
  get dragging() { return !!this.drag; }
  private cursorFraction?: number;
  drafts: Record<string, number> = {};
  traces: { path: string; above: string; below: string; min: number; max: number; axis: VerticalAxis; ticks: { value: number; y: number }[] }[] = [];
  timeTicks: TimeTick[] = [];
  overviewTicks: TimeTick[] = [];
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
  private recordedHistory?: SessionHistory;
  private refresh: ReturnType<typeof setInterval>;
  constructor(public live: UnityLiveLinkService, zone: NgZone, private element: ElementRef<HTMLElement>) {
    zone.runOutsideAngular(() => {
      this.refresh = setInterval(() => zone.run(() => this.render()), 100);
    });
  }
  connect() { this.drafts = {}; this.live.connect(this.token); this.token = ''; }
  ngOnInit() { void this.live.openSample(); }
  openRecording(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) { this.drafts = {}; void this.live.openRecording(input.files); }
    input.value = '';
  }
  get chartIndices() { return chartIndices(this.live.channels); }
  readonly channelName = channelName;
  get duration() { return this.live.history.end; }
  get maxStart() { return Math.max(0, this.duration - this.span); }
  get windowEvents() { return this.live.history.events.filter(e => e.time >= this.start && e.time <= this.end); }
  get shownEvents() { return this.windowEvents.slice(this.eventPage * 20, (this.eventPage + 1) * 20); }
  get overviewX() { return (this.start - this.live.history.start) / Math.max(0.02, this.duration - this.live.history.start) * 300; }
  get overviewWidth() { return this.duration ? (this.end - this.start) / Math.max(0.02, this.duration - this.live.history.start) * 300 : 300; }
  get overviewCursorX() { return ((this.cursor?.time ?? this.cursorTime ?? 0) - this.live.history.start) / Math.max(0.02, this.duration - this.live.history.start) * 300; }
  get mapDot() { return this.track.position(this.cursorTime === undefined ? this.live.latest : this.cursor); }
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
  panOverview(direction: number) { this.span = Math.max(0.02, this.end - this.start); this.pan(this.start + direction * this.span / 2); }
  pointerFocus(event: PointerEvent) { event.preventDefault(); (event.currentTarget as SVGElement).blur(); }
  startNavigation(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !this.live.history.length) return;
    this.pointerFocus(event);
    const chart = event.currentTarget as SVGElement, box = chart.getBoundingClientRect();
    if (!box.width) return;
    const time = this.live.history.start + (event.clientX - box.left) / box.width * (this.duration - this.live.history.start);
    this.span = Math.max(0.02, this.end - this.start);
    const leftDistance = Math.abs(event.clientX - box.left - this.overviewX / 300 * box.width);
    const rightDistance = Math.abs(event.clientX - box.left - (this.overviewX + this.overviewWidth) / 300 * box.width);
    const mode = Math.min(leftDistance, rightDistance) <= (event.pointerType === 'touch' ? 16 : 8)
      ? leftDistance <= rightDistance ? 'left' : 'right' : 'pan';
    const edge = mode === 'left' ? this.start : this.end;
    this.navigationDrag = { id: event.pointerId, chart, mode, anchor: mode === 'left' ? this.end : this.start,
      offset: mode === 'pan' ? time >= this.start && time <= this.end ? time - this.start : this.span / 2 : time - edge };
    chart.setPointerCapture(event.pointerId); this.moveNavigation(event);
  }
  moveNavigation(event: PointerEvent) {
    if (this.navigationDrag?.id !== event.pointerId) return;
    const box = this.navigationDrag.chart.getBoundingClientRect();
    if (!box.width) return;
    const drag = this.navigationDrag, time = this.live.history.start + (event.clientX - box.left) / box.width * (this.duration - this.live.history.start) - drag.offset;
    if (drag.mode === 'pan') { this.pan(time); return; }
    const minimum = Math.min(0.2, this.duration - this.live.history.start);
    this.full = this.follow = false;
    if (drag.mode === 'left') { this.end = drag.anchor; this.start = Math.max(this.live.history.start, Math.min(this.end - minimum, time)); }
    else { this.start = drag.anchor; this.end = Math.min(this.duration, Math.max(this.start + minimum, time)); }
    this.span = this.end - this.start; this.eventPage = 0; this.rendered = '';
  }
  endNavigation(event?: PointerEvent) {
    if (!this.navigationDrag || event && event.pointerId !== this.navigationDrag.id) return;
    const drag = this.navigationDrag; this.navigationDrag = undefined;
    if (drag.chart.hasPointerCapture(drag.id)) drag.chart.releasePointerCapture(drag.id);
  }
  selectMap(event: MouseEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect(), scale = Math.min(box.width, box.height) / 160;
    const x = (event.clientX - box.left - (box.width - scale * 160) / 2) / scale;
    const y = (event.clientY - box.top - (box.height - scale * 160) / 2) / scale;
    const sample = this.track.nearest(x, y, this.cursor?.time ?? (this.start + this.end) / 2);
    if (!sample) return;
    if (sample.time < this.start || sample.time > this.end) this.pan(sample.time - (this.end - this.start) / 2);
    this.inspectTime(sample.time); this.pinCursor();
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
    this.pointerFocus(event);
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
    return value === null || value === undefined || !trace ? 30 : Math.max(8, Math.min(52, axisY(value, trace.axis)));
  }
  cursorOverflow(channel: number) {
    const value = this.cursor?.values[channel], axis = this.traces[channel]?.axis;
    return value !== null && value !== undefined && !!axis && (value < axis.min || value > axis.max);
  }
  private render() {
    const history = this.live.history;
    if (this.session !== this.live.session || this.live.state === 'Recorded session' && this.recordedHistory !== history) {
      this.session = this.live.session; this.clearCursor(true); this.endNavigation();
      this.recordedHistory = this.live.state === 'Recorded session' ? history : undefined;
      if (this.recordedHistory) this.all(); else this.followLive();
      this.overviewAt = 0; this.overview = ''; this.eventPage = 0;
    }
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
      this.track.update(history, this.live.channels.map(c => c.id));
      this.overview = history.trace(0, history.start, history.end, overviewResolution).path;
      this.overviewAt = performance.now(); this.overviewResolution = overviewResolution; this.overviewVersion = history.version; this.overviewRange = rangeKey;
    }
    if (this.rendered === key) return;
    this.rendered = key;
    this.timeTicks = timeAxis(this.start, this.end, this.element.nativeElement.querySelector('.channel svg')?.getBoundingClientRect().width || 300);
    this.overviewTicks = timeAxis(history.start, history.end, this.element.nativeElement.querySelector('.overview')?.getBoundingClientRect().width || 300);
    this.traces = this.live.channels.map((channel, i) => {
      const range = fixedChartRange(channel.id);
      const trace = history.trace(i, this.start, this.end, chartResolution, range);
      return { ...trace, ticks: range || history.hasRange(i) ? trace.axis.ticks : [] };
    });
    const x = (t: number) => Math.max(0, Math.min(300, (t - this.start) / Math.max(0.02, this.end - this.start) * 300));
    this.markers = this.windowEvents.map(e => ({ x: x(e.time), label: `${e.time.toFixed(2)} s · ${e.result.parameter} = ${e.result.value} · frame ${e.result.effectiveFromFrame}` }));
    this.gaps = history.gaps.filter(g => g.end >= this.start && g.start <= this.end).map(g => ({ x: x(g.start), width: Math.max(1, x(g.end) - x(g.start)), label: `No recorded samples · ${g.start.toFixed(2)}–${g.end.toFixed(2)} s` }));

  }
  ngOnDestroy() { this.endNavigation(); this.endDrag(); clearInterval(this.refresh); this.live.disconnect(); }
}

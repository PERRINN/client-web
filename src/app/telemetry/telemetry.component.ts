import { simulationDuration } from './simulationPace';
import { comparison, deltaTime, target, setupError, LapChange } from './sessionSetup';
import { ChartDoubleTap } from './chartDoubleTap';
import { ChartSelection } from './chartSelection';
import { ChartNavigation } from './chartNavigation';
import { LapOverlay, LapTrace } from './lapOverlay';
import { TelemetryTrace, telemetryPlots } from './telemetryPlots';
import { SessionAnalysis, SessionLap, lapTime } from './sessionAnalysis';
import { chartGroups, channelName } from './chartChannels';
import { TrackTrajectory } from './trackTrajectory';
import { timeAxis, TimeTick } from './timeAxis';
import { axisY, verticalAxis } from './verticalAxis';
import { Title } from '@angular/platform-browser';
import { Component, OnInit, OnDestroy, NgZone, ElementRef } from '@angular/core';
import { formatAxisValue, LiveSample, SessionHistory } from './sessionHistory';
import { TelemetryService } from './telemetry.service';
@Component({
  selector: 'app-telemetry', standalone: false,
  templateUrl: './telemetry.component.html',
  styleUrls: ['./telemetry.component.css'], providers: [TelemetryService]
})
export class TelemetryComponent implements OnInit, OnDestroy {
  readonly formatAxisValue = formatAxisValue;
  readonly analysis = new SessionAnalysis();
  readonly lapTime = lapTime;
  readonly simulationDuration = simulationDuration;
  readonly overlay = new LapOverlay();
  private readonly navigation = new ChartNavigation();
  private readonly doubleTap = new ChartDoubleTap();
  overviewLayers: LapTrace[] = [];
  distanceAxis = false;
  private distancePreferred = true;
  get axisLabel() { return this.distanceAxis ? 'Distance' : 'Time'; }
  get axisUnit() { return this.distanceAxis ? 'm' : 's'; }
  get origin() { return this.distanceAxis ? 0 : this.live.history.start; }
  private fraction(time: number, start = this.start, end = this.end) {
    return (time - start) / Math.max(0.02, end - start);
  }
  private timeAtFraction(fraction: number, start = this.start, end = this.end) {
    return start + fraction * (end - start);
  }
  toggleAxis() {
    if (!this.distanceAxis && !this.overlay.tracks.length) return;
    const sample = this.cursor;
    this.endNavigation(); this.endDrag(); this.clearCursor(true); this.distanceAxis = !this.distanceAxis; this.distancePreferred = this.distanceAxis;
    this.all(); this.start = this.origin; this.end = this.duration; this.overview = ''; this.overviewLayers = [];
    if (sample) { if (this.distanceAxis) this.overlay.select(sample); this.inspectTime(this.distanceAxis ? this.overlay.distance(sample) : sample.time); }
  }
  selectLap(lap: SessionLap) {
    if (this.distanceAxis) { this.overlay.activeLap = lap.number; if (this.cursorTime !== undefined) this.inspectTime(this.overlay.cursorDistance ?? this.start); return; }
    this.full = this.follow = false; this.start = lap.start; this.end = lap.end;
    this.span = Math.max(0.02, this.end - this.start); this.clearCursor(true); this.rendered = '';
  }
  token = '';
  pairingRequested = false;
  cursor?: LiveSample;
  cursorTime?: number;
  readonly track = new TrackTrajectory();
  get resizingNavigation() { return this.navigation.resizing; }
  readonly selection = new ChartSelection();
  private cursorFraction?: number;
  readonly sessionRows = [1, 2, 3];
  readonly deltaTime = deltaTime;
  readonly comparison = comparison;
  get setupLocked() { return this.live.editor.starting || ['Connecting', 'Pairing', 'Connected', 'Reconnecting'].includes(this.live.state) || this.live.stopping; }
  get setupParameters() { return this.live.baselineParameters.length ? this.live.baselineParameters : this.live.parameters; }
  lapRow(number: number) { return this.analysis.laps[number - 1]; }
  get sectorIndices() { return Array.from({length: Math.max(3, ...this.analysis.laps.slice(0, 3).flatMap(l => l.sectors.map(s => s.index)))}, (_, i) => i + 1); }
  sectorTime(number: number, index: number) { return this.lapRow(number)?.sectors.find(s => s.index === index)?.time; }
  sectorInvalid(number: number, index: number) { return this.lapRow(number)?.sectors.find(s => s.index === index)?.valid === false; }
  lapStatus(number: number) { const lap = this.lapRow(number); return lap ? lap.complete ? lap.valid ? 'Complete' : 'Invalid' : this.live.state === 'Connected' && !this.live.stopping ? 'Running' : 'Incomplete' : 'Pending'; }
  changeParameter(change: LapChange) { change.mode = 'offset'; change.amount = 0; }
  changeMode(change: LapChange) { change.amount = change.mode === 'gain' ? 1 : 0; }
  parameterUnit(change: LapChange) { return this.setupParameters.find(p => p.id === change.parameter)?.unit || ''; }
  setupTarget(change: LapChange) { return target(change, this.setupParameters); }
  setupError(change: LapChange) { return setupError(change, this.setupParameters); }
  traces: TelemetryTrace[] = [];
  timeTicks: TimeTick[] = [];
  overviewTicks: TimeTick[] = [];
  overviewAxisStep = 1;
  overviewYTicks: {value:number;y:number}[] = [];
  overview = '';
  start = 0;
  end = 30;
  span = 30;
  follow = true;
  full = false;
  markers: { x: number; label: string }[] = [];
  private rendered = '';
  private overviewAt = 0;
  private overviewResolution = 0;
  private overviewVersion = -1;
  private overviewRange = '';
  private session = '';
  private previousTitle?: string;
  private recordedHistory?: SessionHistory;
  private refresh: ReturnType<typeof setInterval>;
  constructor(public live: TelemetryService, zone: NgZone, private element: ElementRef<HTMLElement>, private title: Title) {
    zone.runOutsideAngular(() => {
      this.refresh = setInterval(() => zone.run(() => this.render()), 100);
    });
  }
  startSimulation() {
    this.pairingRequested = true;
    if (this.live.editor.needsPairing && !this.token.trim()) return;
    this.live.startSimulation(this.token); this.token = '';
  }
  ngOnInit() { this.previousTitle = this.title.getTitle(); this.title.setTitle('424 Nürburgring Telemetry'); this.live.editor.watch(); void this.live.openSample(); }
  openRecording(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) { void this.live.openRecording(input.files); }
    input.value = '';
  }
  get frontRideIndex() { return this.live.channels.findIndex(c=>c.id==='RideHeightFront'); }
  get rearRideIndex() { return this.live.channels.findIndex(c=>c.id==='RideHeightRear'); }
  get missingTrajectoryError() { return !this.live.channels.some(c=>c.id==='AutopilotDistanceError'); }
  trackGroup = (_: number, group: {label:string}) => group.label;
  get chartGroups() { return chartGroups(this.live.channels); }
  readonly channelName = channelName;
  get duration() { return this.distanceAxis ? this.overlay.max : this.live.history.end; }
  get maxStart() { return Math.max(this.origin, this.duration - this.span); }
  get windowEvents() { return this.live.history.events.filter(e => (this.distanceAxis ? this.overlay.distance(this.live.history.nearest(e.time)) >= this.start && this.overlay.distance(this.live.history.nearest(e.time)) <= this.end : e.time >= this.start && e.time <= this.end)); }
  get overviewX() { return this.fraction(this.start, this.origin, this.duration) * 300; }
  get overviewWidth() { return this.duration ? (this.fraction(this.end, this.origin, this.duration) - this.fraction(this.start, this.origin, this.duration)) * 300 : 300; }
  get overviewCursorX() { return this.fraction(this.distanceAxis ? this.overlay.cursorDistance ?? 0 : this.cursor?.time ?? this.cursorTime ?? 0, this.origin, this.duration) * 300; }
  get mapDot() { return this.track.position(this.cursorTime === undefined ? this.live.latest : this.cursor); }
  all() { this.full = true; this.follow = false; this.rendered = ''; }
  followLive() { this.clearCursor(true); this.full = false; this.follow = true; this.span = 30; this.rendered = ''; }
  pan(value: number) { this.full = this.follow = false; this.start = Math.max(this.origin, Math.min(this.maxStart, Number(value))); this.end = Math.min(this.duration, this.start + this.span); this.rendered = ''; }
  private distanceWindow(start: number, width: number) {
    this.span = Math.min(width, this.duration); this.pan(start);
  }
  zoom(factor: number) {
    if (this.distanceAxis) {
      const width = Math.max(0.2, (this.end - this.start) * factor);
      const center = (this.start + this.end) / 2;
      this.distanceWindow(center - width / 2, width); return;
    }
    this.full = false;
    const center = (this.start + this.end) / 2;
    this.span = Math.max(0.2, Math.min(Math.max(0.2, this.duration), (this.end - this.start) * factor));
    this.pan(Math.max(0, Math.min(this.maxStart, center - this.span / 2)));
  }
  panOverview(direction: number) { if (this.distanceAxis) { const width = this.end - this.start; this.distanceWindow(this.start + direction * width / 2, width); return; } this.span = Math.max(0.02, this.end - this.start); this.pan(this.start + direction * this.span / 2); }
  pointerFocus(event: PointerEvent) { event.preventDefault(); (event.currentTarget as SVGElement).blur(); }
  startNavigation(event: PointerEvent) {
    if (!this.live.history.length) return;
    if (!this.doubleTap.start(event)) { this.endNavigation(); return; }
    const navigating = this.navigation.start(event, {start:this.start,end:this.end,origin:this.origin,duration:this.duration}, (start,end)=>{
      this.start=start;this.end=end;this.span=end-start;this.full=this.follow=false;this.rendered='';
    });
    if (!navigating) this.selection.start(event, {start:this.origin,end:this.duration});
  }
  moveNavigation(event: PointerEvent) {
    this.doubleTap.move(event);
    if (this.selection.active) this.moveSelection(event); else this.navigation.move(event);
  }
  finishNavigation(event: PointerEvent) {
    this.navigation.move(event); this.navigation.end(event); this.finishDrag(event);
  }
  endNavigation(event?: PointerEvent) { this.navigation.end(event); this.endDrag(event); }
  selectMap(event: MouseEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect(), scale = Math.min(box.width, box.height) / 160;
    const x = (event.clientX - box.left - (box.width - scale * 160) / 2) / scale;
    const y = (event.clientY - box.top - (box.height - scale * 160) / 2) / scale;
    const sample = this.track.nearest(x, y, this.cursor?.time ?? (this.start + this.end) / 2);
    if (!sample) return;
    const position = this.distanceAxis ? this.overlay.distance(sample) : sample.time;
    if (!Number.isFinite(position)) return;
    if (this.distanceAxis) this.overlay.select(sample);
    if (position < this.start || position > this.end) this.pan(position - (this.end - this.start) / 2);
    this.inspectTime(position);
  }
  get cursorX() { return this.fraction(this.distanceAxis ? this.overlay.cursorDistance ?? this.start : this.cursor?.time ?? this.cursorTime ?? this.start) * 300; }
  inspectTime(time: number) {
    if (!Number.isFinite(time)) return;
    if (this.distanceAxis) { this.cursor = this.overlay.inspect(Math.max(this.start, Math.min(this.end,time))); this.cursorTime = this.cursor?.time ?? 0; return; }
    this.cursorTime = Math.max(this.start, Math.min(this.end, time));
    this.cursor = this.live.history.nearest(this.cursorTime, this.start, this.end);
  }
  inspectScatter(sample?: LiveSample) { this.cursorFraction=undefined; if (!sample) return this.clearCursor(); if (this.distanceAxis) { this.overlay.select(sample); const reading=this.overlay.readings.find(r=>r.lap===this.overlay.activeLap); if (reading) reading.sample=sample; } this.cursor=sample; this.cursorTime=sample.time; }
  private moveSelection(event: PointerEvent) { this.selection.move(event); if (this.selection.band) this.full = this.follow = false; }
  hover(event: PointerEvent) {
    this.doubleTap.move(event);
    if (this.selection.active) { this.moveSelection(event); return; }
    this.inspectPointer(event);
  }
  private inspectPointer(event: PointerEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    if (box.width) {
      this.cursorFraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      this.inspectTime(this.timeAtFraction(this.cursorFraction));
    }
  }
  clearCursor(force = false) {
    if (this.selection.active && !force) return;
    this.overlay.cursorDistance = undefined; this.overlay.readings = [];
    this.selection.end();
    this.cursor = undefined; this.cursorTime = undefined; this.cursorFraction = undefined;
  }
  leaveChart(event: PointerEvent) { if (event.pointerType !== 'touch') this.clearCursor(); }
  focusCursor() { if (this.cursorTime === undefined) this.inspectTime(this.start); }
  get cursorVisible() { const position = this.distanceAxis ? this.overlay.cursorDistance : this.cursor?.time ?? this.cursorTime; return position !== undefined && position >= this.start && position <= this.end; }
  resetChart() { this.endNavigation(); this.clearCursor(true); this.all(); }
  startDrag(event: PointerEvent) {
    if (!this.doubleTap.start(event)) { this.endNavigation(); return; }
    if (this.live.history.length && this.selection.start(event, {start:this.start,end:this.end}) && event.pointerType === 'touch') this.inspectPointer(event);
  }
  finishDrag(event: PointerEvent) {
    if (this.doubleTap.finish(event)) { event.preventDefault(); this.resetChart(); return; }
    const range = this.selection.finish(event);
    if (!range) return;
    this.start = range.start; this.end = range.end; this.span = range.end - range.start;
    this.full = this.follow = false; this.rendered = ''; this.clearCursor();
  }
  endDrag(event?: PointerEvent) { this.doubleTap.cancel(event); this.selection.end(event); }
  stepCursor(direction: number) {
    this.cursorFraction = undefined;
    const active = this.overlay.tracks.find(t=>t.lap.number===this.overlay.activeLap);
    const index = this.cursor ? this.cursor.sequence - 1 + direction : this.distanceAxis ? active?.rows[0] ?? -1 : (this.live.history.nearest(this.start)?.sequence ?? 0) - 1;
    const sample = this.live.history.sampleAt(index);
    if (sample) {
      if (this.distanceAxis && (!active || sample.time < active.lap.start || sample.time > active.lap.end)) return;
      const position = this.distanceAxis ? this.overlay.distance(sample) : sample.time;
      if (position >= this.start && position <= this.end) { if (this.distanceAxis) this.overlay.select(sample); this.inspectTime(position); }
    }
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
      this.overviewAt = 0; this.overview = '';
    }
    this.analysis.update(history, this.live.channels);
    this.overlay.update(history, this.live.channels, this.analysis.laps);
    const distanceAxis = this.distancePreferred && !!this.overlay.tracks.length;
    if (this.distanceAxis !== distanceAxis) { this.distanceAxis = distanceAxis; this.overview = ''; }
    if (this.full) { this.start = this.origin; this.end = this.duration; }
    else if (this.follow) { if (this.distanceAxis) { const window = this.overlay.followWindow(); this.start = window.start; this.end = window.end; } else { this.end = history.end; this.start = Math.max(history.start,this.end-this.span); } }
    if (this.cursorFraction !== undefined) this.inspectTime(this.timeAtFraction(this.cursorFraction));
    if (this.cursorTime !== undefined && !this.distanceAxis) {
      if (this.cursorTime < this.start || this.cursorTime > this.end) this.clearCursor();
      else this.inspectTime(this.cursorTime);
    }
    const resolution = (selector: string) => {
      const width = this.element.nativeElement.querySelector(selector)?.getBoundingClientRect().width || 300;
      return Math.max(128, Math.min(4096, Math.ceil(width * (window.devicePixelRatio || 1))));
    };
    const chartResolution = resolution('.channel svg'), overviewResolution = resolution('.overview');
    const key = `${this.distanceAxis}:${history.version}:${this.start}:${this.end}:${chartResolution}:${overviewResolution}`;
    const speedRange = history.range(0), rangeKey = `${speedRange.min}:${speedRange.max}`;
    if (!this.overview || this.overviewRange !== rangeKey || this.overviewResolution !== overviewResolution ||
        this.overviewVersion !== history.version && performance.now() - this.overviewAt >= 1000) {
      this.track.update(history, this.live.channels.map(c => c.id));
      const range = this.distanceAxis ? this.overlay.windowRange(0,0,this.duration) : history.windowRange(0,history.start,history.end);
      const axis = verticalAxis(range.min,range.max);
      this.overviewAxisStep = axis.step;
      this.overviewYTicks = range.hasValues ? axis.ticks : [];
      this.overview = history.trace(0, history.start, history.end, overviewResolution,axis).path;
      this.overviewLayers = this.distanceAxis ? this.overlay.trace(0,axis,0,this.duration,overviewResolution) : [];
      this.overviewAt = performance.now(); this.overviewResolution = overviewResolution; this.overviewVersion = history.version; this.overviewRange = rangeKey;
    }
    if (this.rendered === key) return;
    this.rendered = key;
    this.timeTicks = timeAxis(this.start, this.end, this.element.nativeElement.querySelector('.channel svg')?.getBoundingClientRect().width || 300, this.axisUnit);
    this.overviewTicks = timeAxis(this.origin, this.duration, this.element.nativeElement.querySelector('.overview')?.getBoundingClientRect().width || 300, this.axisUnit);
    this.traces = telemetryPlots(history,this.live.channels,this.start,this.end,chartResolution,this.distanceAxis?this.overlay:undefined);
    const x = (t: number) => Math.max(0, Math.min(300, this.fraction(t) * 300));
    this.markers = this.windowEvents.map(e => ({ x: x(this.distanceAxis ? this.overlay.distance(history.nearest(e.time)) : e.time), label: `${e.time.toFixed(2)} s · ${e.result.parameter} = ${e.result.value} · frame ${e.result.effectiveFromFrame}` }));
  }
  ngOnDestroy() { if (this.previousTitle !== undefined) this.title.setTitle(this.previousTitle); this.endNavigation(); this.endDrag(); clearInterval(this.refresh); this.live.disconnect(); }
}

import type { LegendHighlight } from './greenpowerChart';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { GreenpowerChannel, isVehicleSpeed, MOTOR_DERIVED_SPEED, VOLTAGE_LEFT, VOLTAGE_RIGHT, londonDay, sampleTime } from './greenpowerData';
import { ChartWindow, scalarReadout } from './greenpowerChart';
import { GreenpowerLapService } from './greenpowerLap.service';
import { FinishLine, GpsLap } from './greenpowerGps';
import { GreenpowerMapComponent } from './greenpower-map.component';
import { ChannelDrag } from './channelDrag';
import { orderFor, ViewKind } from './greenpowerView';
import { GreenpowerViewService } from './greenpowerView.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';
import { DaySession, RecordedEvent } from './greenpowerDay';
import { SessionInterval, sessionIntervals, sessionLapAnalysis, sessionAmpHours, savedGear, withEnergy, withDistance } from './greenpowerSessions';
import { GreenpowerOverlayService } from './greenpowerOverlay.service';
import { motorLapSpeeds, withMotorDerivedSpeed } from './greenpowerSpeed';
import { lapMetricChannels } from './greenpowerLapMetrics';
import { recordingHeader } from './greenpowerContext';

@Component({
  selector: 'app-greenpower-telemetry', standalone: false,
  templateUrl: './greenpower-telemetry.component.html', styleUrls: ['./greenpower-telemetry.component.css', './math-channel.css'],
  providers: [GreenpowerTelemetryService, GreenpowerViewService, GreenpowerLapService, GreenpowerEventsService, GreenpowerEventEditService, GreenpowerOverlayService]
})
export class GreenpowerTelemetryComponent implements OnDestroy {
  @ViewChild('historyButton') private historyButton?: ElementRef<HTMLButtonElement>;
  @ViewChild(GreenpowerMapComponent) private map?: GreenpowerMapComponent;
  channels: GreenpowerChannel[] = [];
  historyOpen = false;
  overlayOpen = false;
  activeView: 'data' | 'track' | 'laps' = 'data';
  editorPanel: 'view' | 'event' | 'sessions' = 'view';
  metadataEditing = false;
  private loadedEvent?: RecordedEvent;
  sessions: SessionInterval[] = [];
  recordingSessions: DaySession[] = [];
  sessionsLoading = false;
  sessionsMore = false;
  sessionsError = '';
  private sessionAfter?: { start: number; id: string };
  get header() {
    const data = this.telemetry;
    return recordingHeader({ signedIn: data.access === 'signed-in', live: data.live, day: data.day,
      loading: data.loading, partial: data.more, error: !!data.error, hasSamples: !!data.latest && !!data.channels.length,
      start: data.start, end: data.end, lastReceived: data.latest?.receivedAt, liveStatus: this.liveStatus,
      event: this.loadedEvent });
  }
  get heading() { return this.overlay.active ? this.overlay.title : this.header.title; }
  get wholeEventLoaded() { return !!this.loadedEvent && !this.telemetry.live; }
  get editing() { return this.view.editing || this.metadataEditing; }
  get dataset() { return this.telemetry.day + ':' + this.telemetry.live + ':' + this.telemetry.recordingKey; }
  scalars: GreenpowerChannel[] = [];
  charts: GreenpowerChannel[] = [];
  isVehicleSpeed = isVehicleSpeed;
  motorDerivedSpeed?: GreenpowerChannel;
  readonly voltageLeftId = VOLTAGE_LEFT;
  voltageRight?: GreenpowerChannel;
  laps: GpsLap[] = [];
  private numberedLaps: GpsLap[] = [];
  private rawLaps?: GpsLap[];
  private lapSessions?: SessionInterval[];
  private lapChannel?: GreenpowerChannel;
  available: GreenpowerChannel[] = [];
  editorKind: ViewKind = 'scalars';
  selectedCount = 0;
  orderNotice = '';
  readonly drag: ChannelDrag;
  private dragKind: ViewKind = 'scalars';
  @ViewChild('channelOptions') private channelOptions?: ElementRef<HTMLElement>;
  window?: ChartWindow;
  private followLatest = false;
  cursor?: number;
  legendHighlight?: LegendHighlight;
  scalarReadout = scalarReadout;
  private context = '';
  get start() { return this.window?.start ?? this.telemetry.start; }
  get end() {
    if (!this.window) return this.telemetry.end;
    return this.followLatest && this.telemetry.live ? Math.max(this.window.end, this.telemetry.end) : this.window.end;
  }
  selectView(view: 'data' | 'track' | 'laps') { this.legendHighlight = undefined; this.drag.cancel(); if (!this.overlay.active || view === 'data') this.activeView = view; }
  selectLap(window: ChartWindow) { this.zoom(window); this.selectView('data'); }
  zoom(window?: ChartWindow) {
    this.followLatest = !!window && this.telemetry.live && window.end >= this.telemetry.end;
    this.window = window; this.cursor = undefined;
  }
  now = Date.now();
  private readonly previousTitle: string;
  private readonly changes: Subscription;
  private readonly clock: ReturnType<typeof setInterval>;
  constructor(public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef, private title: Title, public view: GreenpowerViewService, public lapConfig: GreenpowerLapService, public events: GreenpowerEventsService, public eventEdit: GreenpowerEventEditService, public overlay: GreenpowerOverlayService) {
    this.drag = new ChannelDrag({
      valid: () => this.activeView === 'data' && this.editorPanel === 'view' && view.editing && view.canEdit && !view.saving && this.editorKind === this.dragKind,
      reorder: (id, index) => view.reorder(this.dragKind, id, index),
      restore: order => view.restoreOrder(this.dragKind, order),
      changed: () => change.markForCheck(), announce: message => this.orderNotice = message
    });
    this.context = this.dataset + ':' + telemetry.access;
    this.previousTitle = title.getTitle(); title.setTitle('424 Greenpower Telemetry · PERRINN');
    this.changes = telemetry.changed.subscribe(() => {
      if (telemetry.access !== 'signed-in') { this.loadedEvent = undefined; this.eventEdit.cancel(); this.eventEdit.recordingEvent = undefined; this.clearSessions(); }
      const context = this.dataset + ':' + telemetry.access;
      if (this.context !== context || !telemetry.channels.length) { this.legendHighlight = undefined; this.zoom(); this.context = context; }
      this.refreshView(); this.syncHeader(); change.markForCheck();
    });
    let comparing = overlay.active;
    this.changes.add(overlay.changed.subscribe(() => {
      if (comparing !== overlay.active) { comparing = overlay.active; this.legendHighlight = undefined; this.drag.cancel(); this.view.cancel(); }
      if (overlay.active) this.activeView = 'data';
      this.refreshEditor(); this.syncHeader(); change.markForCheck();
    }));
    this.changes.add(view.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(lapConfig.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(events.changed.subscribe(() => {
      if (!events.canEdit) { this.metadataEditing = false; this.eventEdit.cancel(); }
      this.syncHeader(); change.markForCheck();
    }));
    this.changes.add(eventEdit.saved.subscribe(({ event, session }) => {
      if (this.loadedEvent?.date !== event.date) return;
      this.loadedEvent = event;
      if (session) this.recordingSessions = [...this.recordingSessions.filter(item => item.id !== session.id), session]
        .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
      this.sessions = sessionIntervals(event, this.recordingSessions);
      this.refreshView(); this.syncHeader(); change.markForCheck();
    }));
    this.changes.add(eventEdit.changed.subscribe(() => change.markForCheck()));

    this.refreshView();
    this.syncHeader();
    this.clock = setInterval(() => { this.now = Date.now(); telemetry.tick(); change.markForCheck(); }, 1000);
  }
  private syncHeader() {
    const title = this.heading + ' · PERRINN';
    if (this.title.getTitle() !== title) this.title.setTitle(title);
  }
  private refreshView() {
    if ((!this.view.editing || !this.view.canEdit || this.view.saving) && this.drag.pending) this.drag.cancel();
    if (!this.view.editing) this.orderNotice = '';
    this.lapConfig.select(this.dataset);
    this.lapConfig.syncEditing(this.view.editing && !this.overlay.active);
    this.lapConfig.update(this.telemetry.channels, this.telemetry.end);
    const analysis = this.lapConfig.analysis;
    if (this.rawLaps !== analysis.laps || this.lapSessions !== this.sessions) {
      const numbered = sessionLapAnalysis(analysis, this.sessions, {
        channels: this.telemetry.channels, fixes: this.lapConfig.fixes, end: this.telemetry.end,
        configured: !!this.lapConfig.line && !this.lapConfig.mismatch
      });
      this.rawLaps = analysis.laps; this.lapSessions = this.sessions;
      this.numberedLaps = numbered.laps; this.lapChannel = numbered.channel;
    }
    const latestTime = this.telemetry.latest ? sampleTime(this.telemetry.latest) : undefined;
    const electrical = withEnergy(this.telemetry.channels, this.recordingSessions, latestTime);
    this.channels = savedGear(electrical.map(channel => sessionAmpHours(channel, this.recordingSessions, latestTime)),
      this.loadedEvent, this.recordingSessions, this.telemetry.start, Math.max(this.telemetry.end, latestTime ?? 0), latestTime,
      !this.sessionsLoading && !this.sessionsMore && !this.sessionsError);
    this.channels = withDistance(withMotorDerivedSpeed(this.channels, this.loadedEvent, latestTime), this.recordingSessions, latestTime);
    this.laps = motorLapSpeeds(this.numberedLaps, this.channels);
    this.channels = [...this.channels, this.lapChannel!, ...lapMetricChannels(this.laps, this.channels)];
    this.motorDerivedSpeed = this.channels.find(channel => channel.id === MOTOR_DERIVED_SPEED);
    this.voltageRight = this.channels.find(channel => channel.id === VOLTAGE_RIGHT);
    this.scalars = this.view.scalars(this.channels);
    this.charts = this.view.charts(this.channels);
    if (this.legendHighlight && !this.charts.some(channel => channel.id === this.legendHighlight!.channelId
      || channel.id === VOLTAGE_LEFT && this.legendHighlight!.channelId === this.voltageRight?.id
      || isVehicleSpeed(channel.id) && this.legendHighlight!.channelId === this.motorDerivedSpeed?.id)) this.legendHighlight = undefined;
    this.refreshEditor();
  }
  private get editorChannels() { return this.overlay.active ? this.overlay.channels : this.channels; }
  private refreshEditor() {
    this.selectedCount = Object.keys(this.view.draft[this.editorKind]).length;
    this.available = this.view.editing ? this.view.available(this.editorChannels, this.editorKind) : [];
  }
  saveView() { void this.view.save(this.overlay.active ? undefined : this.lapConfig.selectionWrite()); }
  toggleOverlay() {
    this.drag.cancel(); this.historyOpen = false; this.overlayOpen = !this.overlayOpen; this.activeView = 'data';
  }
  toggleEditing() {
    if (this.overlay.active && !this.view.canEdit) return;
    if (!this.overlay.active) this.overlayOpen = false;
    if (this.activeView === 'laps' && (!this.events.canEdit || !this.eventEdit.canEditSessions) || this.eventEdit.locked || this.view.saving || this.lapConfig.saving) return;
    if (this.historyOpen) {
      this.historyOpen = false;
      if (this.editing) return;
    }
    if (this.editing) { this.view.cancel(); this.eventEdit.cancel(); this.metadataEditing = false; }
    else {
      if (this.activeView === 'laps') { this.metadataEditing = true; this.editorPanel = 'sessions'; }
      else if (this.view.canEdit) {
        if (this.overlay.active) { this.editorPanel = 'view'; this.editorKind = 'charts'; }
        this.view.edit(this.editorChannels);
      }
      else { this.metadataEditing = true; this.editorPanel = 'event'; }
    }
  }
  editSession(id: string) {
    if (!this.editing || this.historyOpen || !this.events.canEdit || !this.eventEdit.canEditSessions || this.eventEdit.mode || this.view.saving || this.lapConfig.saving) return;
    const session = this.recordingSessions.find(item => item.id === id);
    if (!session) return;
    this.eventEdit.session(false, undefined, session);
    if (!this.eventEdit.sessionDraft) return;
    this.drag.cancel(); this.historyOpen = false; this.metadataEditing = true; this.editorPanel = 'sessions';
  }
  sessionsPanel() { this.drag.cancel(); this.editorPanel = 'sessions'; }
  eventPanel() {
    this.drag.cancel(); this.editorPanel = 'event';
    if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents();
  }
  loadSelectedRecording() {
    if (!this.events.eventReady || !this.events.selectedEvent || this.eventEdit.locked || this.telemetry.loading) return;
    this.overlay.clear(); this.overlayOpen = false;
    this.loadedEvent = JSON.parse(JSON.stringify(this.events.selectedEvent));
    this.eventEdit.cancel();
    this.eventEdit.recordingEvent = this.events.migrated ? this.loadedEvent : undefined;
    this.clearSessions();
    void this.loadRecordingSessions();
    this.historyOpen = false;
    this.fetchLoadedRecording();
    this.historyButton?.nativeElement.focus({ preventScroll: true });
  }
  private clearSessions() {
    this.recordingSessions = []; this.sessions = []; this.sessionAfter = undefined;
    this.sessionsLoading = this.sessionsMore = false; this.sessionsError = '';
  }
  async loadRecordingSessions() {
    const event = this.loadedEvent;
    if (!event || this.sessionsLoading) return;
    this.sessionsLoading = true; this.sessionsError = '';
    try {
      const page = await this.events.recordingSessionPage(event.date, this.sessionAfter);
      if (this.loadedEvent !== event) return;
      this.recordingSessions = [...this.recordingSessions, ...page.sessions.filter(session => !this.recordingSessions.some(item => item.id === session.id))];
      this.sessions = sessionIntervals(this.loadedEvent!, this.recordingSessions);
      const last = page.sessions.at(-1);
      if (last) this.sessionAfter = { start: last.startAt, id: last.id };
      this.sessionsMore = page.more;
    } catch { if (this.loadedEvent === event) this.sessionsError = 'Could not load session details.'; }
    finally { if (this.loadedEvent === event) { this.sessionsLoading = false; this.refreshView(); } }
  }
  private fetchLoadedRecording() {
    if (this.loadedEvent) void this.telemetry.select(this.loadedEvent.date);
  }

  retryRecording() {
    if (this.telemetry.live) void this.telemetry.select(londonDay(), true);
    else this.fetchLoadedRecording();
  }
  selectTrack(id: string) {
    if (id === 'more') this.lapConfig.loadMore();
    else this.lapConfig.choose(id);
  }
  async saveFinish(value: { line: FinishLine | null; revision: number; name: string }) {
    if (await this.lapConfig.save(value.line, value.revision, value.name)) this.map?.confirmSaved(value.line, this.lapConfig.revision, this.lapConfig.name);
  }
  selectEditor(kind: ViewKind) {
    this.editorPanel = 'view';
    this.drag.cancel();
    this.editorKind = kind; this.orderNotice = ''; this.refreshView();
    if (this.channelOptions) this.channelOptions.nativeElement.scrollTop = 0;
  }
  moveChannel(channel: GreenpowerChannel, direction: -1 | 1) {
    this.view.move(this.editorKind, channel.id, direction);
    this.orderNotice = channel.label + ', position ' + (this.available.findIndex(c => c.id === channel.id) + 1) + ' of ' + this.selectedCount;
  }
  startDrag(event: PointerEvent, channel: GreenpowerChannel, list: HTMLElement) {
    this.dragKind = this.editorKind;
    this.drag.start(event, list, channel.id, channel.label + (channel.unit ? ' · ' + channel.unit : ''), orderFor(this.view.draft, this.editorKind));
  }
  handleKey(event: KeyboardEvent, channel: GreenpowerChannel) {
    if (event.key === 'Escape') { event.preventDefault(); this.drag.cancel(); }
    else if (!this.drag.pending && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); this.moveChannel(channel, event.key === 'ArrowUp' ? -1 : 1);
    }
  }
  @HostListener('window:keydown.escape', ['$event']) escapeDrag(event: KeyboardEvent) {
    if (this.drag.pending) { event.preventDefault(); this.drag.cancel(); }
  }
  @HostListener('window:blur') cancelDrag() { this.drag.cancel(); }
  @HostListener('document:visibilitychange') visibilityChanged() { if (document.hidden) this.drag.cancel(); }
  private get liveStatus() {
    const data = this.telemetry;
    if (data.loading && !data.channels.length) return 'Loading';
    if (!data.connected) return navigator.onLine ? 'Reconnecting' : 'Offline';
    if (!data.latest) return 'Waiting for telemetry';
    return this.now - data.latest.receivedAt > 15000 ? 'Stale' : 'Live';
  }
  async history() {
    if (this.eventEdit.locked || this.view.saving || this.lapConfig.saving) return;
    this.drag.cancel();
    this.overlayOpen = false;
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen && !this.events.loadedEvents && !this.events.loadingEvents) await this.events.loadEvents();
  }
  live() { if (!this.eventEdit.locked) { this.overlay.clear(); this.overlayOpen = false; this.loadedEvent = undefined; this.eventEdit.cancel(); this.eventEdit.recordingEvent = undefined; this.clearSessions(); this.historyOpen = false; void this.telemetry.select(londonDay(), true); } }
  ngOnDestroy() { this.loadedEvent = undefined; this.clearSessions(); this.changes.unsubscribe(); this.drag.cancel(); clearInterval(this.clock); this.title.setTitle(this.previousTitle); }
}

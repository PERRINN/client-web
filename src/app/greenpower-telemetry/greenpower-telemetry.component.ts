import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { GreenpowerChannel, londonDay, londonTime } from './greenpowerData';
import { ChartWindow } from './greenpowerChart';
import { ViewKind } from './greenpowerView';
import { GreenpowerViewService } from './greenpowerView.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({
  selector: 'app-greenpower-telemetry', standalone: false,
  templateUrl: './greenpower-telemetry.component.html', styleUrls: ['./greenpower-telemetry.component.css'],
  providers: [GreenpowerTelemetryService, GreenpowerViewService]
})
export class GreenpowerTelemetryComponent implements OnDestroy {
  historyOpen = false;
  scalars: GreenpowerChannel[] = [];
  charts: GreenpowerChannel[] = [];
  available: GreenpowerChannel[] = [];
  editorKind: ViewKind = 'scalars';
  selectedCount = 0;
  orderNotice = '';
  @ViewChild('channelOptions') private channelOptions?: ElementRef<HTMLElement>;
  window?: ChartWindow;
  cursor?: number;
  private context = '';
  get start() { return this.window?.start ?? this.telemetry.start; }
  get end() { return this.window?.end ?? this.telemetry.end; }
  zoom(window?: ChartWindow) { this.window = window; this.cursor = undefined; }
  now = Date.now();
  time = londonTime;
  private readonly previousTitle: string;
  private readonly changes: Subscription;
  private readonly clock: ReturnType<typeof setInterval>;
  constructor(public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef, private title: Title, public view: GreenpowerViewService) {
    this.context = telemetry.day + ':' + telemetry.live + ':' + telemetry.access;
    this.previousTitle = title.getTitle(); title.setTitle('424 Greenpower Telemetry · PERRINN');
    this.changes = telemetry.changed.subscribe(() => {
      const context = telemetry.day + ':' + telemetry.live + ':' + telemetry.access;
      if (this.context !== context || !telemetry.channels.length) { this.zoom(); this.context = context; }
      this.refreshView(); change.markForCheck();
    });
    this.changes.add(view.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.refreshView();
    this.clock = setInterval(() => { this.now = Date.now(); telemetry.tick(); change.markForCheck(); }, 1000);
  }
  private refreshView() {
    if (!this.view.editing) this.orderNotice = '';
    this.selectedCount = Object.keys(this.view.draft[this.editorKind]).length;
    this.scalars = this.view.scalars(this.telemetry.channels);
    this.charts = this.view.charts(this.telemetry.channels);
    this.available = this.view.editing ? this.view.available(this.telemetry.channels, this.editorKind) : [];
  }
  selectEditor(kind: ViewKind) {
    this.editorKind = kind; this.orderNotice = ''; this.refreshView();
    if (this.channelOptions) this.channelOptions.nativeElement.scrollTop = 0;
  }
  moveChannel(channel: GreenpowerChannel, direction: -1 | 1) {
    this.view.move(this.editorKind, channel.id, direction);
    this.orderNotice = channel.label + ', position ' + (this.available.findIndex(c => c.id === channel.id) + 1) + ' of ' + this.selectedCount;
  }
  get status() {
    const data = this.telemetry;
    if (!data.live) return 'History · UK time';
    if (data.loading && !data.latest) return 'Loading';
    if (!data.connected) return navigator.onLine ? 'Reconnecting' : 'Offline';
    if (!data.latest) return 'Waiting for telemetry';
    return this.now - data.latest.receivedAt > 15000 ? 'Stale' : 'Live';
  }
  async history() {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen && !this.telemetry.dates.length) await this.telemetry.loadDates();
  }
  live() { this.historyOpen = false; void this.telemetry.select(londonDay(), true); }
  ngOnDestroy() { clearInterval(this.clock); this.changes.unsubscribe(); this.title.setTitle(this.previousTitle); }
}

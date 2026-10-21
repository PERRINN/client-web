import type { LegendHighlight } from './greenpowerChart';
import { ChangeDetectorRef, Component, Input, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChartWindow } from './greenpowerChart';
import { GreenpowerChannel, isVehicleSpeed, MOTOR_DERIVED_SPEED, VOLTAGE_LEFT, VOLTAGE_RIGHT } from './greenpowerData';
import { OverlayTrace } from './greenpowerOverlay';
import { GreenpowerOverlayService } from './greenpowerOverlay.service';
import { GreenpowerViewService } from './greenpowerView.service';

@Component({
  selector: 'app-greenpower-overlay', standalone: false,
  templateUrl: './greenpower-overlay.component.html', styleUrls: ['./greenpower-overlay.component.css']
})
export class GreenpowerOverlayComponent implements OnDestroy {
  @Input() panelOpen = false;
  charts: { channel: GreenpowerChannel; traces: OverlayTrace[]; heading: string }[] = [];
  window?: ChartWindow;
  cursor?: number;
  legendHighlight?: LegendHighlight;
  private membership = '';
  private changes = new Subscription();
  constructor(public overlay: GreenpowerOverlayService, public view: GreenpowerViewService, change: ChangeDetectorRef) {
    const update = () => { this.refresh(); change.markForCheck(); };
    this.changes.add(overlay.changed.subscribe(update));
    this.changes.add(view.changed.subscribe(update));
    this.refresh();
  }
  get allHidden() { return this.overlay.sessions.some(item => item.loaded) && !this.overlay.visibleSessions.length; }
  get hasVoltage() { return this.charts.some(chart => !!chart.heading); }
  get start() { return this.window?.start ?? 0; }
  get end() { return this.window?.end ?? this.overlay.end; }
  zoom(window?: ChartWindow) { this.window = window; this.cursor = undefined; }
  choose(value: string) {
    if (value === '2026-race') void this.overlay.load(true, 'race');
    else if (value === '2026-battery-dyno') void this.overlay.load(true, 'battery_dyno');
  }
  private refresh() {
    const membership = this.overlay.sessions.filter(item => item.loaded).map(item => item.id).join('|');
    if (membership !== this.membership) { this.membership = membership; this.zoom(); }
    // Keep trace models so excluding every session preserves chart frames and elapsed axes.
    this.charts = this.view.charts(this.overlay.channels).map(channel => ({ channel,
      heading: channel.id === VOLTAGE_LEFT ? 'Voltage left / right' : '',
      traces: this.overlay.sessions.filter(session => session.loaded).flatMap(session => session.channels.filter(item =>
        item.id === channel.id || channel.id === VOLTAGE_LEFT && item.id === VOLTAGE_RIGHT
          || isVehicleSpeed(channel.id) && item.id === MOTOR_DERIVED_SPEED).filter(item => item.points.length)
        .map(item => ({ id: session.id + ':' + item.id, label: session.label,
          sessionId: session.id, hidden: session.hidden || session.excluded, excluded: session.excluded, colour: session.colour, channel: item, dashed: item.id === VOLTAGE_RIGHT || item.id === MOTOR_DERIVED_SPEED,
          detail: isVehicleSpeed(channel.id) ? item.id === MOTOR_DERIVED_SPEED ? 'Motor-derived' : 'Recorded' : undefined })))
    })).filter(chart => chart.traces.length);
    if (!this.overlay.active || this.legendHighlight && !this.charts.some(chart => chart.traces.some(trace =>
      !trace.hidden && !trace.excluded && trace.sessionId === this.legendHighlight!.sessionId && trace.channel.id === this.legendHighlight!.channelId))) this.legendHighlight = undefined;
  }
  ngOnDestroy() { this.changes.unsubscribe(); }
}

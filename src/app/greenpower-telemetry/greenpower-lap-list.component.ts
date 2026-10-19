import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { GpsLap } from './greenpowerGps';
import { ChartWindow } from './greenpowerChart';

@Component({
  selector: 'app-greenpower-lap-list', standalone: false,
  templateUrl: './greenpower-lap-list.component.html', styleUrls: ['./greenpower-lap-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GreenpowerLapListComponent {
  @Input() laps: GpsLap[] = [];
  @Input() configured = false;
  @Input() loading = false;
  @Input() partial = false;
  @Output() lapSelect = new EventEmitter<ChartWindow>();
  duration(lap: GpsLap) {
    if (!lap.complete) return 'Incomplete';
    const ms = Math.round(lap.end - lap.time), minutes = Math.floor(ms / 60000);
    return `${minutes}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }
  reading(value?: number) { return value === undefined ? '—' : value.toFixed(1); }
}

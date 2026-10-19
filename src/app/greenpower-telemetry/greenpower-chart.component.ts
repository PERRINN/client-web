import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { chartTrace, GreenpowerChannel, londonTime } from './greenpowerData';

@Component({
  selector: 'app-greenpower-chart', standalone: false,
  templateUrl: './greenpower-chart.component.html', styleUrls: ['./greenpower-chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GreenpowerChartComponent implements OnChanges {
  @Input({ required: true }) channel!: GreenpowerChannel;
  @Input() start = 0;
  @Input() end = 0;
  trace = { path: '', min: 0, max: 0 };
  time = londonTime;
  number(value: number) { return value && (Math.abs(value) >= 10000 || Math.abs(value) < .001) ? value.toExponential(2) : value.toLocaleString('en-GB', { maximumFractionDigits: 3 }); }
  ngOnChanges() { this.trace = chartTrace(this.channel.points, this.start, this.end); }
}

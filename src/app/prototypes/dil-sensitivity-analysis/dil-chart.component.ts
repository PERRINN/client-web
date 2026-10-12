import { Component, Input } from '@angular/core';

export interface DilSeries { name: string; values: number[]; }
@Component({
  selector: 'app-dil-chart', standalone: false,
  templateUrl: './dil-chart.component.html', styleUrls: ['./dil-chart.component.css']
})
export class DilChartComponent {
  @Input() title = '';
  @Input() unit = '';
  @Input() xLabel = 'Distance (m)';
  @Input() xValues: number[] = [];
  @Input() series: DilSeries[] = [];
  @Input() cursor = 30;
  @Input() signed = false;
  get minimum() { return Math.min(...this.series.flatMap(series => series.values), 0); }
  get maximum() { return Math.max(...this.series.flatMap(series => series.values), .001); }
  get span() { return this.maximum - this.minimum || 1; }
  x(index: number) { return 52 + index / Math.max(1, this.xValues.length - 1) * 488; }
  y(value: number) { return 158 - (value - this.minimum) / this.span * 130; }
  points(series: DilSeries) { return series.values.map((value, index) => `${this.x(index)},${this.y(value)}`).join(' '); }
  format(value: number) { return `${this.signed && value > 0 ? '+' : ''}${value.toFixed(this.unit === 'km/h' ? 1 : 3)}`; }
}

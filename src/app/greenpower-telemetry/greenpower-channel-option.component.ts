import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { GreenpowerChannel } from './greenpowerData';
import { isVehicleSpeed } from './greenpowerData';
import type { ChartMarker } from './greenpowerMarkers';
import type { ViewKind } from './greenpowerView';

@Component({
  selector: 'app-greenpower-channel-option', standalone: false,
  templateUrl: './greenpower-channel-option.component.html',
  styleUrls: ['./greenpower-channel-option.component.css', './math-channel.css']
})
export class GreenpowerChannelOptionComponent {
  @Input({ required: true }) channel!: GreenpowerChannel;
  @Input() kind: ViewKind = 'scalars';
  @Input() selected = false;
  @Input() saving = false;
  @Input() reorderDisabled = false;
  @Input() marker?: ChartMarker;
  @Output() selectionChange = new EventEmitter<boolean>();
  @Output() markerChange = new EventEmitter<ChartMarker>();
  @Output() dragStart = new EventEmitter<PointerEvent>();
  @Output() reorderKey = new EventEmitter<KeyboardEvent>();
  get calculated() { return this.channel.id.startsWith('computed:') || this.kind === 'charts' && isVehicleSpeed(this.channel.id); }
  get validValue() { return !this.marker?.enabled || this.marker.value !== null && Number.isFinite(this.marker.value); }
  enableMarker(enabled: boolean) { if (this.marker) this.markerChange.emit({ ...this.marker, enabled }); }
  setMarkerValue(value: number | null) { if (this.marker) this.markerChange.emit({ ...this.marker, value }); }
}

import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { Engineering, EVENT_TYPES, MetadataDraft, METADATA_STATUSES } from './greenpowerEvents';

@Component({ selector: 'app-greenpower-metadata-fields', standalone: false,
  templateUrl: './greenpower-metadata-fields.component.html', styleUrls: ['./greenpower-metadata-fields.component.css'] })
export class GreenpowerMetadataFieldsComponent implements OnChanges {
  @Input() data: MetadataDraft = {};
  @Input() session = false;
  @Input() disabled = false;
  @ViewChild('nameInput') set nameInput(input: ElementRef<HTMLInputElement> | undefined) { input?.nativeElement.focus(); }
  readonly prefix = 'metadata-' + crypto.randomUUID();
  readonly types = EVENT_TYPES;
  readonly statuses = METADATA_STATUSES;
  readonly people = [{ key: 'driver', label: 'Driver' }, { key: 'operator', label: 'Operator' }, { key: 'result', label: 'Result' }];
  readonly measures = [
    { key: 'gearingRatio', label: 'Ratio', unit: '1' }, { key: 'carMass', label: 'Car mass', unit: 'kg' },
    { key: 'driverMass', label: 'Driver mass', unit: 'kg' }, { key: 'ambientTemperature', label: 'Ambient temperature', unit: '°C' },
    { key: 'batteryTemperature', label: 'Battery temperature', unit: '°C' }, { key: 'energy', label: 'Energy', unit: 'Wh' }
  ];
  readonly identifiers = [{ key: 'motorId', label: 'Motor' }, { key: 'generatorId', label: 'Generator' }, { key: 'gear', label: 'Gear' }, { key: 'wheel', label: 'Wheel' }, { key: 'purpose', label: 'Purpose' }, { key: 'outcome', label: 'Outcome' }];
  tagText = '';
  batteryText = '';
  ngOnChanges() { this.tagText = this.data.tags?.join(', ') || ''; this.batteryText = this.data.engineering?.batteryIds?.join(', ') || ''; }
  text(key: string, value: string) { this.data[key] = value; }
  tags(value: string) { this.tagText = value; this.data.tags = value.split(',').map(tag => tag.trim()).filter(Boolean); }
  batteries(value: string) { this.batteryText = value; this.engineering().batteryIds = value.split(',').map(id => id.trim()).filter(Boolean); }
  engineering(): Engineering { return this.data.engineering ||= {}; }
  engineeringText(key: string, value: string) { this.engineering()[key] = value; }
  measurement(key: string, unit: string, value: string) {
    if (!value) delete this.engineering()[key];
    else this.engineering()[key] = { value: Number(value), unit };
  }
}

import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import type { DayMetadata, DaySession, EventDefaults } from './greenpowerDay';
import { DAY_SESSION_TYPES } from './greenpowerDay';
import { GreenpowerEventsService } from './greenpowerEvents.service';

@Component({ selector: 'app-greenpower-metadata-fields', standalone: false,
  templateUrl: './greenpower-metadata-fields.component.html', styleUrls: ['./greenpower-metadata-fields.component.css'] })
export class GreenpowerMetadataFieldsComponent {
  @Input() data!: DayMetadata;
  @Input() session?: DaySession;
  @Input() disabled = false;
  @ViewChild('initialInput') set initialInput(input: ElementRef<HTMLElement> | undefined) { input?.nativeElement.focus(); }
  readonly prefix = 'metadata-' + crypto.randomUUID();
  readonly types = DAY_SESSION_TYPES;
  readonly fields: { key: string; label: string; numeric: boolean; options?: number[] }[] = [
    { key: 'driver', label: 'Driver', numeric: false },
    { key: 'motorGearTeeth', label: 'Motor gear · teeth', numeric: true, options: [15, 16, 17, 18, 19, 20, 21, 22] },
    { key: 'wheelGearTeeth', label: 'Wheel gear · teeth', numeric: true, options: [48, 57] },
    { key: 'motorId', label: 'Motor', numeric: false }, { key: 'generatorId', label: 'Generator', numeric: false },
    { key: 'carMassKg', label: 'Car mass · kg', numeric: true }, { key: 'driverMassKg', label: 'Driver mass · kg', numeric: true }
  ];
  addingTrack = false;
  trackName = '';
  constructor(public events: GreenpowerEventsService) {}
  get values(): EventDefaults { return this.session ? this.session.overrides : this.data.defaults; }
  value(key: string, value: string, numeric: boolean) {
    if (!value.trim()) delete this.values[key];
    else this.values[key] = numeric ? Number(value) : value.trim();
  }
  batteries(value: string) { if (this.session) this.session.batteryIds = value.split(',').map(id => id.trim()).filter(Boolean); }
  async addTrack() {
    const id = await this.events.addTrack(this.trackName);
    if (id && !this.disabled) { this.data.trackId = id; this.trackName = ''; this.addingTrack = false; }
  }
}

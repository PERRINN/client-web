import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type MapView = 'wiring' | 'data' | 'flows';

@Component({
  selector: 'prototype-app-map',
  templateUrl: './app-map.component.html',
  styleUrls: ['./app-map.component.css'],
  standalone: false
})
export class AppMapComponent implements OnInit {
  @ViewChild('frame') frame!: ElementRef<HTMLElement>;
  view: MapView = 'wiring';
  previewWidth: number | null = null;
  private resizeStart: { x: number; width: number } | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void { this.view = this.route.snapshot.data['mapView'] || 'wiring'; }

  startResize(event: PointerEvent): void {
    this.resizeStart = { x: event.clientX, width: this.frame.nativeElement.getBoundingClientRect().width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  resize(event: PointerEvent): void {
    if (this.resizeStart) this.previewWidth = Math.max(320, Math.min(1600, this.resizeStart.width + event.clientX - this.resizeStart.x));
  }
  endResize(): void { this.resizeStart = null; }
  resizeBy(amount: number): void {
    this.previewWidth = Math.max(320, Math.min(1600, (this.previewWidth ?? this.frame.nativeElement.clientWidth) + amount));
  }
  get title(): string {
    return this.view === 'data' ? 'Data model map' : this.view === 'flows' ? 'Workflow map' : 'Application wiring';
  }
}

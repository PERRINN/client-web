import { Component } from '@angular/core';

@Component({
  selector: 'prototype-team-assistant-workspace',
  templateUrl: './team-assistant-workspace.component.html',
  styleUrls: ['./team-assistant-workspace.component.css'],
  standalone: false
})
export class TeamAssistantWorkspaceComponent {
  previewWidth: number | null = null;
  private resizeStart: { x: number; width: number } | null = null;
  deviceLabel(width: number): string {
    if (width >= 1280) return 'Desktop';
    if (width >= 1024) return 'Laptop';
    if (width >= 768) return 'Tablet';
    if (width >= 430) return 'Large phone';
    if (width >= 390) return 'Phone';
    if (width >= 360) return 'Small phone';
    return 'Compact phone';
  }

  startResize(event: PointerEvent, frame: HTMLElement): void {
    event.preventDefault();
    this.resizeStart = { x: event.clientX, width: frame.getBoundingClientRect().width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  resize(event: PointerEvent): void {
    if (this.resizeStart) this.previewWidth = Math.max(320, Math.min(1600, this.resizeStart.width + event.clientX - this.resizeStart.x));
  }

  endResize(): void { this.resizeStart = null; }
  resizeBy(frame: HTMLElement, amount: number): void { this.previewWidth = Math.max(320, Math.min(1600, (this.previewWidth ?? frame.clientWidth) + amount)); }
}

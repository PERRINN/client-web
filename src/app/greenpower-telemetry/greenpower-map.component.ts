import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FinishLine, fixAt, GpsFix, GpsPoint, trackProjection, validLine } from './greenpowerGps';

@Component({
  selector: 'app-greenpower-map', standalone: false,
  templateUrl: './greenpower-map.component.html', styleUrls: ['./greenpower-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GreenpowerMapComponent implements OnChanges {
  @Input() fixes: GpsFix[] = [];
  @Input() line: FinishLine | null = null;
  @Input() editing = false;
  @Input() saving = false;
  @Input() ready = false;
  @Input() revision = 0;
  @Input() mismatch = false;
  @Input() name = '';
  @Input() context = '';
  @Input() cursor?: number;
  @Input() end = 0;
  @Output() lineChange = new EventEmitter<{ line: FinishLine | null; revision: number; name: string }>();
  @Output() cursorChange = new EventEmitter<number | undefined>();
  constructor(private change: ChangeDetectorRef) {}
  draft: FinishLine | null = null;
  placing = false;
  first?: GpsPoint;
  keyboard = { x: 250, y: 250 };
  dirty = false;
  draftName = '';
  baseRevision = 0;
  projection = trackProjection([]);
  private frozen?: ReturnType<typeof trackProjection>;
  get displayedLine() { return this.editing ? this.draft : this.line; }
  get car() {
    const fix = fixAt(this.fixes, this.cursor ?? this.end);
    return fix ? this.projection.project(fix) : undefined;
  }
  get endpoints() {
    const line = this.displayedLine;
    return line ? { a: this.projection.project(line.a), b: this.projection.project(line.b) } : undefined;
  }
  get directionPath() {
    const p = this.endpoints;
    if (!p || !this.displayedLine) return '';
    const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, length = Math.hypot(dx, dy);
    const x = (p.a.x + p.b.x) / 2, y = (p.a.y + p.b.y) / 2;
    const nx = dy / length * this.displayedLine.direction, ny = -dx / length * this.displayedLine.direction;
    return `M${x - nx * 16},${y - ny * 16} L${x + nx * 16},${y + ny * 16} M${x + nx * 16 - nx * 7 - ny * 5},${y + ny * 16 - ny * 7 + nx * 5} L${x + nx * 16},${y + ny * 16} L${x + nx * 16 - nx * 7 + ny * 5},${y + ny * 16 - ny * 7 - nx * 5}`;
  }
  get valid() { return !!this.draftName.trim() && this.draftName.trim().length <= 60 && (this.draft === null || validLine(this.draft)); }
  ngOnChanges(changes: SimpleChanges) {
    if (changes['context'] || changes['editing'] || !this.dirty && changes['line']) this.reset();
    if (this.editing && this.mismatch) this.dirty = true;
    if (changes['fixes'] || changes['line'] || changes['editing'] || changes['context']) this.project();
  }
  private reset() {
    this.draft = this.line ? { a: { ...this.line.a }, b: { ...this.line.b }, direction: this.line.direction } : null;
    this.draftName = this.name;
    this.dirty = this.placing = false; this.first = undefined; this.frozen = undefined; this.baseRevision = this.revision;
  }
  private project() { this.projection = this.frozen ?? trackProjection(this.fixes, this.displayedLine); }
  place() {
    this.placing = true; this.first = undefined; this.keyboard = { x: 250, y: 250 }; this.frozen = this.projection;
  }
  clear() { this.draft = null; this.dirty = true; this.placing = false; this.first = undefined; }
  reverse() {
    if (this.draft) { this.draft = { ...this.draft, direction: this.draft.direction === 1 ? -1 : 1 }; this.dirty = true; }
  }
  choose(p: GpsPoint) {
    if (!this.first) { this.first = p; return; }
    this.draft = { a: this.first, b: p, direction: 1 }; this.first = undefined; this.placing = false; this.dirty = true;
  }
  click(event: MouseEvent, svg: SVGSVGElement) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    if (this.editing && this.placing && !this.saving) this.choose(this.projection.unproject(point.x, point.y));
    else if (!this.editing && this.fixes.length) {
      let nearest = this.fixes[0], distance = Infinity;
      for (const fix of this.fixes) {
        const p = this.projection.project(fix), d = Math.hypot(point.x - p.x, point.y - p.y);
        if (d < distance) { nearest = fix; distance = d; }
      }
      this.cursorChange.emit(nearest.time);
    }
  }
  key(event: KeyboardEvent) {
    if (event.key === 'Escape') { this.placing = false; this.first = undefined; this.cursorChange.emit(undefined); return; }
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (this.editing && this.placing && !this.saving) {
      if (arrows.includes(event.key)) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1;
        this.keyboard.x = Math.max(0, Math.min(500, this.keyboard.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)));
        this.keyboard.y = Math.max(0, Math.min(500, this.keyboard.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)));
      } else if (event.key === 'Enter') { event.preventDefault(); this.choose(this.projection.unproject(this.keyboard.x, this.keyboard.y)); }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const index = this.fixes.findIndex(fix => fix.time >= (this.cursor ?? this.end));
      const next = Math.max(0, Math.min(this.fixes.length - 1, (index < 0 ? this.fixes.length - 1 : index) + (event.key === 'ArrowRight' ? 1 : -1)));
      this.cursorChange.emit(this.fixes[next]?.time);
    }
  }
  confirmSaved(line: FinishLine | null, revision: number, name: string) {
    this.draftName = name; this.draft = line; this.dirty = this.placing = false; this.first = undefined; this.baseRevision = revision;
    this.frozen = undefined; this.project(); this.change.markForCheck();
  }
  save() { if (this.valid && !this.saving) this.lineChange.emit({ line: this.draft, revision: this.baseRevision, name: this.draftName }); }
}

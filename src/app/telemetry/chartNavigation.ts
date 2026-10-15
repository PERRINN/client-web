interface WindowRange { start: number; end: number; origin: number; duration: number }
export class ChartNavigation {
  private drag?: { id: number; chart: SVGElement; mode: 'pan'|'left'|'right'; anchor: number; offset: number; range: WindowRange; change: (start:number,end:number)=>void };
  get resizing() { return !!this.drag && this.drag.mode !== 'pan'; }
  start(event: PointerEvent, range: WindowRange, change: (start:number,end:number)=>void) {
    if (event.button !== 0 || !event.isPrimary || this.drag) return false;
    const chart = event.currentTarget as SVGElement, box = chart.getBoundingClientRect();
    if (!box.width || range.duration <= range.origin) return false;
    const total = Math.max(.02,range.duration-range.origin), value = range.origin+(event.clientX-box.left)/box.width*total;
    const left = Math.abs(event.clientX-box.left-(range.start-range.origin)/total*box.width), right = Math.abs(event.clientX-box.left-(range.end-range.origin)/total*box.width);
    const mode = Math.min(left,right) <= (event.pointerType==='touch'?16:8) ? left<=right?'left':'right' : 'pan';
    // The background (or a full-session window) is available for range selection.
    const full = range.start <= range.origin && range.end >= range.duration;
    if (mode === 'pan' && (full || value < range.start || value > range.end)) return false;
    event.preventDefault(); chart.blur();
    this.drag={id:event.pointerId,chart,mode,range,change,anchor:mode==='left'?range.end:range.start,
      offset:mode==='pan'?value>=range.start&&value<=range.end?value-range.start:(range.end-range.start)/2:value-(mode==='left'?range.start:range.end)};
    chart.setPointerCapture(event.pointerId);this.move(event);return true;
  }
  move(event: PointerEvent) {
    const d=this.drag;if (!d || d.id!==event.pointerId) return;
    const box=d.chart.getBoundingClientRect();if (!box.width) return;
    const {origin,duration,start,end}=d.range, value=origin+(event.clientX-box.left)/box.width*(duration-origin)-d.offset, width=end-start, minimum=Math.min(.2,duration-origin);
    if(d.mode==='pan'){const from=Math.max(origin,Math.min(duration-width,value));d.change(from,from+width);}
    else if(d.mode==='left')d.change(Math.max(origin,Math.min(d.anchor-minimum,value)),d.anchor);
    else d.change(d.anchor,Math.min(duration,Math.max(d.anchor+minimum,value)));
  }
  end(event?: PointerEvent) {
    const d=this.drag;if(!d || event && event.pointerId!==d.id)return;
    this.drag=undefined;if(d.chart.hasPointerCapture(d.id))d.chart.releasePointerCapture(d.id);
  }
}

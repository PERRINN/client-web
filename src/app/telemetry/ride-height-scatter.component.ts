import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, Output, EventEmitter, SimpleChanges, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { SessionHistory, LiveSample, formatAxisValue } from './sessionHistory';
import { VerticalAxis } from './verticalAxis';
import { LapOverlay, LapReading } from './lapOverlay';
import { rideHeightScatter, nearestScatterRow, ScatterLayer } from './rideHeightScatter';
@Component({
  selector:'app-ride-height-scatter', standalone:true, imports:[CommonModule],
  template:`<section aria-labelledby="ride-height-scatter-heading"><h3 id="ride-height-scatter-heading">Ride height · front vs rear</h3><div class="scatter-readings" [style.--scatter-laps]="overlay?.tracks?.length || 1" aria-live="off"><span *ngFor="let reading of readings" [style.color]="reading.color"><span *ngIf="reading.lap">Lap {{ reading.lap }} · </span>Front {{ value(reading.sample, 'RideHeightFront') }} {{ unit('RideHeightFront') }} · Rear {{ value(reading.sample, 'RideHeightRear') }} {{ unit('RideHeightRear') }}</span></div><canvas #plot tabindex="0" (pointermove)="hover($event)" (pointerdown)="$event.preventDefault(); plot.blur(); hover($event)" (pointerleave)="inspected.emit(undefined)" (blur)="inspected.emit(undefined)" (focus)="focus()" (keydown.arrowleft)="step.emit(-1); $event.preventDefault()" (keydown.arrowright)="step.emit(1); $event.preventDefault()" (keydown.escape)="inspected.emit(undefined)" role="img" aria-label="Ride height scatter plot. Front ride height on X, rear ride height on Y. Hover dots to inspect paired samples in the selected window. Arrow keys step samples."></canvas><p *ngIf="!available">No paired ride-height data</p></section>`,
  styles:[`:host { display:block; margin-top:24px; } :host * { overflow:visible; line-height:1.45; } h3 { font-size:16px; font-weight:550; margin-bottom:8px; } canvas { display:block; width:100%; height:340px; touch-action:pan-y; } canvas:focus-visible { outline:2px solid var(--color-focus); outline-offset:3px; } .scatter-readings { display:flex; flex-wrap:wrap; gap:4px 16px; font-size:16px; min-height:24px; } .scatter-readings span { font:inherit; } @media(max-width:680px) { .scatter-readings { display:grid; min-height:calc(var(--scatter-laps) * 24px + (var(--scatter-laps) - 1) * 4px); } } p { font-size:15px; color:var(--color-text-muted); }`]
})
export class RideHeightScatterComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() history!: SessionHistory;
  @Input() channels: {id:string;unit:string}[] = [];
  @Input() version = 0;
  @Input() start = 0;
  @Input() end = 0;
  @Input() frontAxis?: VerticalAxis;
  @Input() rearAxis?: VerticalAxis;
  @Input() overlay?: LapOverlay;
  @Input() cursor?: LiveSample;
  @Input() lapReadings?: LapReading[];
  @Output() inspected = new EventEmitter<LiveSample | undefined>();
  @Output() step = new EventEmitter<number>();
  private layers: ScatterLayer[] = [];
  private bounds?: {left:number;right:number;top:number;bottom:number};
  get readings() { return this.lapReadings?.length ? this.lapReadings : this.cursor ? [{color:'var(--color-text-secondary)',sample:this.cursor,lap:undefined}] : []; }
  unit(id:string) { return this.channels.find(c=>c.id===id)?.unit || 'mm'; }
  value(sample:LiveSample | undefined,id:string) { const channel=this.channels.findIndex(c=>c.id===id);return this.history.formatValue(channel,sample?.values[channel]); }
  focus() { if (!this.cursor) this.inspected.emit(this.history.sampleAt(this.layers[0]?.points[0]?.row)); }
  hover(event:PointerEvent) {
    const b=this.bounds, a=this.frontAxis, z=this.rearAxis, canvas=this.plot?.nativeElement;
    if (!b || !a || !z || !canvas) return;
    const box=canvas.getBoundingClientRect(), px=(event.clientX-box.left)*canvas.clientWidth/box.width, py=(event.clientY-box.top)*canvas.clientHeight/box.height;
    if (px<b.left || px>b.right || py<b.top || py>b.bottom) { this.inspected.emit(undefined); return; }
    const scaleX=(b.right-b.left)/(a.max-a.min),scaleY=(b.bottom-b.top)/(z.max-z.min);
    const row=nearestScatterRow(this.layers,a.min+(px-b.left)/scaleX,z.max-(py-b.top)/scaleY,scaleX,scaleY);
    this.inspected.emit(row===undefined ? undefined : this.history.sampleAt(row));
  }
  @ViewChild('plot') plot?: ElementRef<HTMLCanvasElement>;
  available = false;
  private resize?: ResizeObserver;
  private background?: HTMLCanvasElement;
  ngOnChanges(changes:SimpleChanges) {
    if (Object.keys(changes).some(key=>key!=='cursor' && key!=='lapReadings')) {
      this.background = undefined;
      this.layers = this.history ? rideHeightScatter(this.history,this.channels.findIndex(c=>c.id==='RideHeightFront'),this.channels.findIndex(c=>c.id==='RideHeightRear'),this.start,this.end,this.overlay) : [];
      this.available = this.layers.some(layer=>layer.points.length);
    }
    this.draw();
  }
  ngAfterViewInit() { this.resize = new ResizeObserver(() => { this.background=undefined; this.draw(); }); this.resize.observe(this.plot!.nativeElement); this.draw(); }
  ngOnDestroy() { this.resize?.disconnect(); }
  private draw() {
    const front = this.channels.findIndex(c=>c.id==='RideHeightFront'), rear = this.channels.findIndex(c=>c.id==='RideHeightRear');
    const canvas = this.plot?.nativeElement, xAxis = this.frontAxis, yAxis = this.rearAxis;
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
    const ctx = canvas.getContext('2d'); if (!ctx || !xAxis || !yAxis || !width) return;
    ctx.scale(ratio,ratio);
    const style = getComputedStyle(canvas), color = (token:string) => style.getPropertyValue(token).trim();
    ctx.font = `14px ${style.fontFamily}`;
    const left = Math.max(68,...yAxis.ticks.map(t=>ctx.measureText(formatAxisValue(t.value,yAxis.step)).width+38));
    const right = width-20, top = 16, bottom = height-58;
    this.bounds={left,right,top,bottom};
    const x = (value:number) => left+(value-xAxis.min)/(xAxis.max-xAxis.min)*(right-left);
    const y = (value:number) => bottom-(value-yAxis.min)/(yAxis.max-yAxis.min)*(bottom-top);
    if (this.background && (this.background.width!==canvas.width || this.background.height!==canvas.height)) this.background=undefined;
    if (this.background) ctx.drawImage(this.background,0,0,width,height);
    else {
    ctx.strokeStyle=color('--color-text-muted');ctx.fillStyle=color('--color-text-muted');ctx.lineWidth=1;
    for (const tick of xAxis.ticks) {
      const px=x(tick.value);ctx.globalAlpha=.18;ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();
      ctx.globalAlpha=1;ctx.textAlign='center';ctx.fillText(formatAxisValue(tick.value,xAxis.step),px,bottom+21);
    }
    for (const tick of yAxis.ticks) {
      const py=y(tick.value);ctx.globalAlpha=.18;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();
      ctx.globalAlpha=1;ctx.textAlign='right';ctx.fillText(formatAxisValue(tick.value,yAxis.step),left-9,py+5);
    }
    ctx.textAlign='center';ctx.fillText(`Front ride height (${this.channels[front]?.unit || 'mm'})`,(left+right)/2,height-9);
    ctx.save();ctx.translate(15,(top+bottom)/2);ctx.rotate(-Math.PI/2);ctx.fillText(`Rear ride height (${this.channels[rear]?.unit || 'mm'})`,0,0);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    for (const layer of this.layers) {
      ctx.fillStyle=color(layer.color.slice(4,-1));ctx.globalAlpha=.5;ctx.beginPath();
      for (const p of layer.points) { const px=x(p.x),py=y(p.y);ctx.moveTo(px+1.15,py);ctx.arc(px,py,1.15,0,Math.PI*2); }
      ctx.fill();
    }
    ctx.restore();
    this.background=document.createElement('canvas');this.background.width=canvas.width;this.background.height=canvas.height;
    this.background.getContext('2d')?.drawImage(canvas,0,0);
    }
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    ctx.globalAlpha=1;ctx.lineWidth=1.5;
    for (const reading of this.readings) {
      const sample=reading.sample, frontValue=sample?.values[front], rearValue=sample?.values[rear];
      if (frontValue==null || rearValue==null || !Number.isFinite(frontValue) || !Number.isFinite(rearValue)) continue;
      const px=x(frontValue),py=y(rearValue);
      ctx.strokeStyle=color(reading.color.slice(4,-1));ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
  }
}

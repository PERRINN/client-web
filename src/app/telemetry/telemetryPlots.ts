import { LiveChannel } from './telemetry.service';
import { SessionHistory } from './sessionHistory';
import { fixedChartRange } from './chartChannels';
import { GapBand, recordingGapBands } from './recordingGaps';
import { VerticalAxis, verticalAxis } from './verticalAxis';
import { LapOverlay, LapTrace } from './lapOverlay';
export interface TelemetryTrace { path:string; above:string; below:string; min:number; max:number; axis:VerticalAxis; gaps:GapBand[]; ticks:{value:number;y:number}[]; layers:LapTrace[] }
export function telemetryPlots(history:SessionHistory, channels:LiveChannel[], start:number, end:number, resolution:number, overlay?:LapOverlay):TelemetryTrace[] {
  return channels.map((channel,i)=>{
    const range=fixedChartRange(channel.id), learned=history.range(i);
    if(overlay){
      const axis=verticalAxis(range?.min??learned.min,range?.max??learned.max);
      return {path:'',above:'',below:'',...learned,axis,gaps:[],ticks:range||history.hasRange(i)?axis.ticks:[],layers:overlay.trace(i,axis,start,end,resolution)};
    }
    const trace=history.trace(i,start,end,resolution,range);
    return {...trace,gaps:recordingGapBands(history,i,trace.axis,start,end,t=>t),ticks:range||history.hasRange(i)?trace.axis.ticks:[],layers:[]};
  });
}

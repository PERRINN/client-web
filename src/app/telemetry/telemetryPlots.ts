import { chartRangeLimits } from './chartChannels';
import { LiveChannel } from './telemetry.service';
import { SessionHistory } from './sessionHistory';
import { GapBand, recordingGapBands } from './recordingGaps';
import { VerticalAxis, verticalAxis } from './verticalAxis';
import { LapOverlay, LapTrace } from './lapOverlay';
export interface TelemetryTrace { path:string; above:string; below:string; min:number; max:number; axis:VerticalAxis; gaps:GapBand[]; ticks:{value:number;y:number}[]; layers:LapTrace[] }
export function telemetryPlots(history:SessionHistory, channels:LiveChannel[], start:number, end:number, resolution:number, overlay?:LapOverlay):TelemetryTrace[] {
  return channels.map((channel,i)=>{
    const range=overlay ? overlay.windowRange(i,start,end) : history.windowRange(i,start,end);
    const axis=verticalAxis(range.min,range.max,chartRangeLimits(channel.id)), ticks=range.hasValues ? axis.ticks : [];
    if(overlay){
      return {path:'',above:'',below:'',min:range.min,max:range.max,axis,gaps:[],ticks,layers:overlay.trace(i,axis,start,end,resolution)};
    }
    const trace=history.trace(i,start,end,resolution,axis);
    return {...trace,min:range.min,max:range.max,gaps:recordingGapBands(history,i,trace.axis,start,end,t=>t),ticks,layers:[]};
  });
}

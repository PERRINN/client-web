import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, dayData, gps, load } from './load.mjs';
const decorate = () => () => {};
class Emitter {
  values = [];
  emit(value) { this.values.push(value); }
}
const taps = load('../../src/app/telemetry/chartDoubleTap.ts');
const vertical = load('../../src/app/telemetry/verticalAxis.ts');
const history = load('../../src/app/telemetry/sessionHistory.ts', { './verticalAxis': vertical });
const chart = load('../../src/app/greenpower-telemetry/greenpowerChart.ts', {
  './greenpowerData': data, '../telemetry/verticalAxis': vertical, '../telemetry/sessionHistory': history
});
const { GreenpowerChartComponent } = load('../../src/app/greenpower-telemetry/greenpower-chart.component.ts', {
  '@angular/core': { Component: decorate, Input: decorate, Output: decorate, ViewChild: decorate, EventEmitter: Emitter, ChangeDetectionStrategy: {} },
  './greenpowerSessions': load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', { './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps }),
  './greenpowerData': data, './greenpowerChart': chart, '../telemetry/chartDoubleTap': taps,
  './greenpowerLaps': load('../../src/app/greenpower-telemetry/greenpowerLaps.ts', { './greenpowerData': data })
});
function fixture() {
  const component = new GreenpowerChartComponent({ markForCheck() {} }, { run(fn) { fn(); } });
  let captured = false;
  const svg = { removeEventListener() {}, getBoundingClientRect: () => ({left:0,width:200}), setPointerCapture() { captured=true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured=false; } };
  component.plot = {nativeElement:svg};
  component.start=0; component.end=1000;
  component.channel={id:'a', label:'Current',unit:'A',value:'5',points:[{time:0,value:1},{time:1000,value:5}]};
  const pointer=(x,type='touch') => ({pointerId:1,pointerType:type,button:0,isPrimary:true,clientX:x,clientY:0,currentTarget:svg,timeStamp:Date.now()});
  return {component,pointer};
}
test('current chart updates measured values and keeps its limit through zoom and channel changes', () => {
  const {component:c} = fixture();
  c.channel = {id:'["A"]:A',label:'Current',unit:'A',value:'20',points:[{time:0,value:100},{time:150,value:20},{time:159,value:20}]};
  c.start = 150; c.end = 159;
  c.ngOnChanges({channel:{}});
  assert.equal(c.hasCurrentLimit, true);
  assert.equal(c.model.trace.max, 20);
  assert.ok(c.model.axis.max >= 24 && c.model.axis.max < 100);
  c.cursor = 159;
  assert.match(c.cursorLabel, /20.* A/);
  c.channel = {...c.channel,points:c.channel.points.map(p=>({...p,value:28}))};
  c.ngOnChanges({channel:{}});
  assert.equal(c.model.trace.max, 28);
  assert.ok(c.limitY >= 10 && c.limitY <= 110);
  c.channel = {...c.channel,id:'["Vt"]:V'};
  c.ngOnChanges({channel:{}});
  assert.equal(c.hasCurrentLimit, false);
  c.ngOnDestroy();
});
test('zoom stays locked through a held drag and live updates for touch and mouse', async () => {
  for (const type of ['touch','mouse']) {
    const {component:c,pointer:p}=fixture();
    try {
      c.down(p(20,type)); c.move(p(80,type));
      assert.ok(c.band);
      c.end=1100;
      c.ngOnChanges({channel:{},end:{}});
      await new Promise(resolve=>setTimeout(resolve,550));
      c.move(p(160,type));
      assert.ok(c.band,'live updates must not discard selection');
      assert.ok(c.cursorChange.values.every(value=>value===undefined),'no cursor activation during a zoom');
      c.up(p(160,type));
      assert.deepEqual(c.windowChange.values,[{start:100,end:800}],'release uses the gesture original domain');
    } finally { c.ngOnDestroy(); }
  }
});
test('stationary touch hold still enters cursor mode and never zooms on release', async () => {
  const {component:c,pointer:p}=fixture();
  try {
    c.down(p(20)); await new Promise(resolve=>setTimeout(resolve,550));
    c.move(p(160)); c.up(p(160));
    assert.equal(c.band,undefined);
    assert.equal(c.cursorChange.values.at(-1),1000);
    assert.deepEqual(c.windowChange.values,[]);
  } finally { c.ngOnDestroy(); }
});
test('changing chart context cancels an in-progress gesture and its hold timer', async () => {
  const {component:c,pointer:p}=fixture();
  try {
    c.down(p(20)); c.ngOnChanges({context:{}});
    await new Promise(resolve=>setTimeout(resolve,550));
    assert.equal(c.band,undefined);
    assert.ok(c.cursorChange.values.every(value=>value===undefined));
  } finally { c.ngOnDestroy(); }
});

test('touch scroll is blocked only after cursor or zoom owns a single-finger gesture', async () => {
  const {component:c,pointer:p}=fixture();
  let prevented=0;
  const touch=(count=1,cancelable=true)=>({touches:Array(count),cancelable,preventDefault(){prevented++;}});
  try {
    c.touchMove(touch()); assert.equal(prevented,0);
    c.down(p(20)); c.touchMove(touch()); assert.equal(prevented,0,'pending hold allows native scrolling');
    await new Promise(resolve=>setTimeout(resolve,550));
    c.touchMove(touch()); assert.equal(prevented,1,'active cursor retains the gesture');
    c.touchMove(touch(2)); c.touchMove(touch(1,false)); assert.equal(prevented,1);
    c.move({...p(80),clientY:100});
    assert.equal(c.cursorChange.values.at(-1),0,'vertical movement keeps cursor control');
    c.up(p(80)); c.touchMove(touch()); assert.equal(prevented,1,'lifting restores ordinary scroll');
    c.down(p(20)); c.move(p(80)); c.touchMove(touch()); assert.equal(prevented,2,'zoom stays locked too');
  } finally {c.ngOnDestroy();}
});

test('cursor snaps line and marker to original samples, including synchronized cursor times', () => {
  const {component:c,pointer:p}=fixture();
  c.ngOnChanges({channel:{}});
  for (const x of [101,120,180,200]) {
    c.inspect(x/200);
    assert.equal(c.cursorChange.values.at(-1),1000);
  }
  c.cursor=800; // Another channel can have a different sample cadence.
  assert.equal(c.reading,c.channel.points[1]);
  assert.equal(c.cursorPosition,800);
  assert.ok(Math.abs(c.markerY-(110-(5-c.model.axis.min)/(c.model.axis.max-c.model.axis.min)*100))<1e-10);
  c.cursor=100;
  assert.equal(c.cursorPosition,0);
  c.start=200;c.end=800;
  assert.equal(c.cursorPosition,undefined);
  assert.equal(c.markerY,undefined);
  c.inspect(.5);
  assert.equal(c.cursorChange.values.at(-1),undefined,'empty window has no invented sample');
  c.ngOnDestroy();
});

test('lap activation selects the full recorded interval and clears cursor and pending gestures', () => {
  const {component:c,pointer:p}=fixture();
  try {
    c.start=200;c.end=800;
    c.down(p(20));c.move(p(80));
    c.zoomLap({time:100,end:900,lap:3,alternate:false});
    assert.equal(c.band,undefined);
    assert.equal(c.cursorChange.values.at(-1),undefined);
    assert.deepEqual(c.windowChange.values,[{start:100,end:900}]);
    c.zoomLap({time:900,end:900,lap:4,alternate:true});
    assert.equal(c.windowChange.values.length,1);
  } finally {c.ngOnDestroy();}
});

test('keyboard visits distinct sample timestamps across irregular gaps and stops at window edges', () => {
  const {component:c}=fixture();
  c.channel.points=[{time:0,value:1},{time:10,value:2},{time:10,value:3},{time:900,value:4},{time:1000,value:5}];
  const key=key=>{c.key({key,preventDefault(){}});c.cursor=c.cursorChange.values.at(-1);return c.cursor;};
  c.cursor=0;
  assert.equal(key('ArrowRight'),10);
  assert.equal(key('ArrowRight'),900);
  assert.equal(key('ArrowLeft'),10);
  assert.equal(key('ArrowLeft'),0);
  assert.equal(key('ArrowLeft'),0);
  c.start=10;c.end=900;c.cursor=900;
  assert.equal(key('ArrowRight'),900);
  assert.equal(key('ArrowLeft'),10);
  assert.equal(key('ArrowLeft'),10);
  c.cursor=undefined;
  assert.equal(key('ArrowRight'),10,'midpoint ties select the earlier sample');
  c.start=20;c.end=800;
  assert.equal(key('ArrowRight'),undefined);
  c.ngOnDestroy();
});

test('long press selects a sticky cursor on mouse and touch', async () => {
  for (const type of ['mouse', 'touch']) {
    const {component:c,pointer:p}=fixture();
    c.down(p(20,type));
    assert.equal(c.cursorChange.values.length,0,'short presses do not activate the cursor');
    await new Promise(resolve=>setTimeout(resolve,550));
    assert.equal(c.cursorChange.values.at(-1),0);
    c.move(p(180,type));
    assert.equal(c.band,undefined,'movement after the hold stays in cursor mode');
    c.up(p(180,type));
    assert.equal(c.cursorChange.values.at(-1),1000);
    const count=c.cursorChange.values.length;
    c.doubleClick();
    assert.equal(c.cursorChange.values.length,count,'native double click after a held press must not reset the cursor');
    c.move(p(0,'mouse')); c.cancel();
    c.down(p(0,type)); c.up(p(0,type));
    c.cancel({...p(180,type),type:'lostpointercapture'});
    c.end=1100; c.ngOnChanges({end:{},channel:{}});
    assert.equal(c.cursorChange.values.length,count);
    c.key({key:'Escape'});
    assert.equal(c.cursorChange.values.at(-1),undefined);
    c.ngOnDestroy();
  }
});

test('short mouse clicks and touch taps do not activate cursor mode', () => {
  for (const type of ['mouse','touch']) {
    const {component:c,pointer:p}=fixture();
    c.down(p(180,type)); c.up(p(180,type));
    assert.equal(c.cursorChange.values.length,0);
    assert.equal(c.windowChange.values.length,0);
    c.ngOnDestroy();
  }
});

test('ordinary double click still resets zoom and cursor', () => {
  const {component:c,pointer:p}=fixture();
  c.down(p(20,'mouse')); c.up(p(20,'mouse')); c.doubleClick();
  assert.deepEqual(c.windowChange.values,[undefined]);
  assert.deepEqual(c.cursorChange.values,[undefined]);
  c.ngOnDestroy();
});

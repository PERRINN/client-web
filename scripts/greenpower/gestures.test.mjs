import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
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
  './greenpowerData': data, './greenpowerChart': chart, '../telemetry/chartDoubleTap': taps
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
    assert.equal(c.cursorChange.values.at(-1),800);
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
    assert.equal(c.cursorChange.values.at(-1),400,'vertical movement keeps cursor control');
    c.up(p(80)); c.touchMove(touch()); assert.equal(prevented,1,'lifting restores ordinary scroll');
    c.down(p(20)); c.move(p(80)); c.touchMove(touch()); assert.equal(prevented,2,'zoom stays locked too');
  } finally {c.ngOnDestroy();}
});

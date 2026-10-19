import assert from 'node:assert/strict';
import {test} from 'node:test';
import {load} from './load.mjs';
const {ChannelDrag}=load('../../src/app/greenpower-telemetry/channelDrag.ts');
function fixture() {
  let order=['a','b','c','d'], valid=true, offset=0, frameId=0;
  const frames=new Map(),capture=new Set(),messages=[];
  const originalRequest=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const rect=id=>({top:order.indexOf(id)*44-offset,bottom:(order.indexOf(id)+1)*44-offset,left:0,width:200});
  const list={get scrollTop(){return offset;},set scrollTop(value){offset=Math.max(0,Math.min(44,value));},getBoundingClientRect:()=>({top:0,bottom:132,height:132}),
    querySelectorAll:()=>order.map(id=>({dataset:{channel:id},getBoundingClientRect:()=>rect(id)})),
    setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)};
  const drag=new ChannelDrag({valid:()=>valid,reorder:(id,index)=>{order.splice(order.indexOf(id),1);order.splice(index,0,id);},restore:ids=>order=ids.slice(),changed(){},announce:message=>messages.push(message)});
  const pointer=(y,id=1)=>({pointerId:id,isPrimary:true,button:0,clientX:100,clientY:y,preventDefault(){},currentTarget:{closest:()=>({getBoundingClientRect:()=>rect('b')})}});
  return {drag,list,pointer,messages,frames,capture,get order(){return order;},invalidate(){valid=false;},
    tick(time){const next=frames.entries().next().value;if(next){frames.delete(next[0]);next[1](time);}},
    close(){drag.cancel();globalThis.requestAnimationFrame=originalRequest;globalThis.cancelAnimationFrame=originalCancel;}};
}
test('handle drag moves across multiple rows and releases capture without cancelling the drop',()=>{
  const h=fixture();try {
    h.drag.start(h.pointer(66),h.list,'b','B',h.order);assert.equal(h.drag.active,false);
    h.drag.move(h.pointer(69));assert.deepEqual(h.order,['a','b','c','d']);
    h.drag.move(h.pointer(112));assert.deepEqual(h.order,['a','c','b','d']);assert.equal(h.drag.preview.label,'B');
    h.drag.move(h.pointer(12));assert.deepEqual(h.order,['b','a','c','d']);
    h.drag.finish(h.pointer(12));h.drag.cancel(h.pointer(12));
    assert.deepEqual(h.order,['b','a','c','d']);assert.equal(h.drag.pending,false);assert.equal(h.capture.size,0);assert.equal(h.frames.size,0);
  }finally{h.close();}
});
test('cancel, lost context and multi-touch restore the original draft, while other pointer IDs are ignored',()=>{
  const h=fixture();try {
    h.drag.start(h.pointer(66),h.list,'b','B',h.order);h.drag.move(h.pointer(112,2));assert.equal(h.drag.active,false);
    h.drag.move(h.pointer(112));h.drag.cancel(h.pointer(112,2));assert.equal(h.drag.active,true);
    h.drag.cancel(h.pointer(112));assert.deepEqual(h.order,['a','b','c','d']);
    h.drag.start(h.pointer(66),h.list,'b','B',h.order);h.drag.move(h.pointer(112));
    h.drag.start({...h.pointer(112,2),isPrimary:false},h.list,'c','C',h.order);assert.deepEqual(h.order,['a','b','c','d']);
    h.drag.start(h.pointer(66),h.list,'b','B',h.order);h.drag.move(h.pointer(112));h.invalidate();h.drag.move(h.pointer(120));
    assert.equal(h.drag.pending,false);assert.equal(h.frames.size,0);assert.deepEqual(h.order,['a','b','c','d']);
  }finally{h.close();}
});
test('dragging near an edge scrolls the list and stops frames at the boundary or on release',()=>{
  const h=fixture();try {
    h.drag.start(h.pointer(66),h.list,'b','B',h.order);h.drag.move(h.pointer(130));
    for(let i=0;i<20;i++)h.tick(16*(i+1));
    assert.equal(h.list.scrollTop,44);assert.equal(h.frames.size,0);assert.equal(h.order.at(-1),'b');
    h.drag.finish(h.pointer(130));assert.equal(h.frames.size,0);
  }finally{h.close();}
});

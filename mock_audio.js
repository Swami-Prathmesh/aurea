// Minimal Web Audio API mock to exercise synth.js in Node
class Param {
  constructor(v){ this._v = v; }
  get value(){ return this._v; }
  set value(v){ if(!isFinite(v)) throw new Error('AudioParam value not finite: '+v); this._v = v; }
  setValueAtTime(v,t){ this._chk(v,t); return this; }
  linearRampToValueAtTime(v,t){ this._chk(v,t); return this; }
  exponentialRampToValueAtTime(v,t){ this._chk(v,t); if(v<=0) throw new Error('exponentialRamp to non-positive '+v); return this; }
  setTargetAtTime(v,t,c){ this._chk(v,t); if(!(c>0)) throw new Error('bad time constant'); return this; }
  cancelScheduledValues(){ return this; }
  _chk(v,t){ if(!isFinite(v)) throw new Error('param target not finite'); if(!isFinite(t)) throw new Error('param time not finite'); }
}
class Node {
  constructor(ctx,type){ this.ctx=ctx; this.type_=type; this._conn=[]; }
  connect(n){ if(!n) throw new Error('connect to undefined'); this._conn.push(n); return n; }
  disconnect(){ this._conn=[]; }
}
class Gain extends Node { constructor(c){ super(c,'gain'); this.gain=new Param(1);} }
class Osc extends Node {
  constructor(c){ super(c,'osc'); this.frequency=new Param(440); this.detune=new Param(0); this.type='sine'; this._started=false;}
  start(t){ if(this._started) throw new Error('osc started twice'); if(!isFinite(t)) throw new Error('bad start time'); this._started=true; this.ctx._nodes.push(this);}
  stop(t){ if(!isFinite(t)) throw new Error('bad stop time'); }
}
class Biquad extends Node { constructor(c){ super(c,'biquad'); this.frequency=new Param(350); this.Q=new Param(1); this.gain=new Param(0); this.type='lowpass'; } }
class BufSrc extends Node { constructor(c){ super(c,'bufsrc'); this.playbackRate=new Param(1); this.buffer=null; } start(){} stop(){} }
class Conv extends Node { constructor(c){ super(c,'conv'); this.buffer=null; } }
class Comp extends Node { constructor(c){ super(c,'comp'); this.threshold=new Param(-24); this.knee=new Param(30); this.ratio=new Param(12); this.attack=new Param(0.003); this.release=new Param(0.25); } }
class Panner extends Node { constructor(c){ super(c,'pan'); this.pan=new Param(0); } }
class Buffer {
  constructor(ch,len,rate){ this.numberOfChannels=ch; this.length=len; this.sampleRate=rate; this._d=[]; for(let i=0;i<ch;i++) this._d.push(new Float32Array(len)); }
  getChannelData(i){ return this._d[i]; }
}
class BaseCtx {
  constructor(rate){ this.sampleRate=rate; this.currentTime=0; this.destination=new Node(this,'dest'); this._nodes=[]; this.state='running'; }
  createGain(){ return new Gain(this); }
  createOscillator(){ return new Osc(this); }
  createBiquadFilter(){ return new Biquad(this); }
  createBufferSource(){ return new BufSrc(this); }
  createConvolver(){ return new Conv(this); }
  createDynamicsCompressor(){ return new Comp(this); }
  createStereoPanner(){ return new Panner(this); }
  createBuffer(ch,len,rate){ return new Buffer(ch,len,rate); }
  resume(){ return Promise.resolve(); }
}
class AudioContext extends BaseCtx { constructor(){ super(44100); } }
class OfflineAudioContext extends BaseCtx {
  constructor(ch,len,rate){ super(rate); this.length=len; this.numberOfChannels=ch; }
  startRendering(){ const b=new Buffer(this.numberOfChannels,this.length,this.sampleRate);
    // fill with something so we can check
    for(let c=0;c<this.numberOfChannels;c++){ const d=b.getChannelData(c); for(let i=0;i<d.length;i++) d[i]=Math.sin(i*0.01)*0.1; }
    return Promise.resolve(b); }
}
global.window = { AudioContext, OfflineAudioContext };
global.AudioContext = AudioContext;
global.OfflineAudioContext = OfflineAudioContext;
module.exports = { AudioContext, OfflineAudioContext };

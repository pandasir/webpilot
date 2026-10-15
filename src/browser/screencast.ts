import type {Page,CDPSession} from 'playwright';
import type {FrameHeader} from '../dashboard/protocol.js';

export class Screencast {
  private current?:CDPSession;
  private generation=0;
  private stopped=true;
  private lastFrame=0;
  private sequence=0;
  constructor(readonly send:(header:FrameHeader,jpeg:Buffer)=>void,readonly status:(message:string)=>void,readonly identity:()=>Omit<FrameHeader,'pageId'|'frameSeq'|'capturedAt'|'streamEpoch'>,readonly epoch:()=>number){}
  async start(page:Page,pageId:string){
    this.stopped=false;const generation=++this.generation;const previous=this.current;this.current=undefined;
    if(previous)await previous.detach().catch(()=>{});
    const streamEpoch=this.epoch();this.lastFrame=0;this.sequence=0;
    try{
      const cdp=await page.context().newCDPSession(page);if(this.stopped||generation!==this.generation){await cdp.detach().catch(()=>{});return;}this.current=cdp;
      const deliver=(jpeg:Buffer)=>{
        if(this.stopped||generation!==this.generation||Date.now()-this.lastFrame<125)return;
        this.lastFrame=Date.now();this.send({...this.identity(),pageId,streamEpoch,frameSeq:++this.sequence,capturedAt:Date.now()},jpeg);
      };
      cdp.on('Page.screencastFrame',(frame:any)=>{void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});deliver(Buffer.from(frame.data,'base64'));});
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:65,maxWidth:1280,maxHeight:720,everyNthFrame:1});
      this.status('直播已连接');
      // Chromium may not emit a new screencast frame for an unchanged page.
      void cdp.send('Page.getLayoutMetrics').then(async metrics=>{
        const viewport=metrics.cssVisualViewport;
        const {data}=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:65,captureBeyondViewport:false,clip:{x:viewport.pageX,y:viewport.pageY,width:viewport.clientWidth,height:viewport.clientHeight,scale:Math.min(1,1280/viewport.clientWidth,720/viewport.clientHeight)}});
        deliver(Buffer.from(data,'base64'));
      }).catch(()=>{});
    }catch{if(generation===this.generation){const current=this.current;this.current=undefined;await current?.detach().catch(()=>{});this.status('实时画面暂不可用，测试继续执行');}}
  }
  async stop(){this.stopped=true;++this.generation;const current=this.current;this.current=undefined;if(current){await current.send('Page.stopScreencast').catch(()=>{});await current.detach().catch(()=>{});}}
}

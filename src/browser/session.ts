import { chromium,type Browser,type BrowserContext,type Page,type Locator,type FrameLocator } from 'playwright';
import { expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';
import { access,readFile,mkdir,chmod,stat } from 'node:fs/promises';
import type {Bindings,LocatorSpec,Step,Target,Recording} from '../core/schema.js';
import {isAssertion} from '../core/schema.js';
import {Budget} from '../core/budget.js';
import {PilotError} from '../core/errors.js';
import {configuredMasks,Redactor,resolveValue} from '../artifacts/redaction.js';

type Root=Page|FrameLocator|Locator;
export function locate(root:Root,spec:LocatorSpec):Locator {
  for(const scope of spec.scope)root=root.locator(scope);
  switch(spec.kind){
    case 'role':return root.getByRole(spec.value as Parameters<Page['getByRole']>[0],{name:spec.name,exact:spec.exact});
    case 'label':return root.getByLabel(spec.value,{exact:spec.exact});
    case 'text':return root.getByText(spec.value,{exact:spec.exact});
    case 'testId':return root.getByTestId(spec.value);
    case 'selector':return root.locator(spec.value);
  }
}

export class BrowserSession {
  readonly id=`session-${randomUUID()}`;
  browser!:Browser;
  context!:BrowserContext;
  private currentPage!:Page;
  private pageListeners=new Set<()=>void>();
  private pageIds=new WeakMap<Page,string>();
  private pageSequence=0;
  get page(){return this.currentPage;}
  set page(page:Page){this.currentPage=page;for(const listener of this.pageListeners)listener();}
  onPage(listener:()=>void){this.pageListeners.add(listener);return ()=>{this.pageListeners.delete(listener);};}
  pageIdentity(){let id=this.pageIds.get(this.page);if(!id){id=`page-${++this.pageSequence}`;this.pageIds.set(this.page,id);}return id;}
  private frame?:FrameLocator;
  private pages=new Map<string,Page>();
  private closed=false;
  private closing?:Promise<void>;
  private recordedPages=new Map<Page,{pageId:string;pageName:string}>();
  private recordingDir?:string;
  readonly recordings:Recording[]=[];
  private scopeViolation?:string;
  private abortHandler?:()=>void;
  private scopeGuard:(url:string)=>boolean;
  readonly events:{type:'console'|'network';timestamp:string;message:string}[]=[];
  constructor(readonly target:Target,readonly budget:Budget,readonly bindings:Bindings={},readonly redactor=new Redactor(bindings)) {
    const allowed=new Set([new URL(target.url!).origin,...target.allowedOrigins.map(u=>new URL(u).origin)]);
    this.scopeGuard=url=>{try{return allowed.has(new URL(url).origin);}catch{return false;}};
  }
  async open(options:{role?:string;headful?:boolean;recordingDir?:string}={}) {
    this.budget.check();
    let storageState:string|undefined;
    const role=options.role && Object.hasOwn(this.target.roles,options.role)?this.target.roles[options.role]:undefined;
    if(options.role && !role)throw new PilotError('ROLE_MISSING',`Role not configured: ${options.role}`);
    if(role?.required && !role.storageStateRef && !role.login.length)throw new PilotError('AUTH_MISSING','Role requires a login state or login flow');
    if(role?.required && !role.verify.some(s=>isAssertion(s) && !s.candidate && s.source.type!=='inferred'))throw new PilotError('AUTH_VERIFICATION_MISSING','Configure a formal observable assertion to verify the role/login state');
    if(role?.storageStateRef){storageState=resolveValue({ref:role.storageStateRef},this.bindings);await access(storageState).catch(()=>{throw new PilotError('AUTH_MISSING',`Login state reference is unavailable: ${role.storageStateRef}`);});}
    try{
      if(this.target.evidence.video && options.recordingDir){
        try{await mkdir(options.recordingDir,{recursive:true,mode:0o700});await chmod(options.recordingDir,0o700);this.recordingDir=options.recordingDir;}
        catch(error){this.recordings.push({status:'omitted',reason:this.redactor.text(`录像目录不可用：${String(error)}`)});}
      }
      this.browser=await chromium.launch({headless:!options.headful});
      const createContext=async()=>{
        this.context=await this.browser.newContext({viewport:this.target.viewport,storageState,...(this.recordingDir?{recordVideo:{dir:this.recordingDir,size:this.target.viewport}}:{})});
        this.context.on('page',page=>this.attach(page));
        this.page=await this.context.newPage();
      };
      try{await createContext();}
      catch(error){
        if(!this.recordingDir)throw error;
        await this.context?.close().catch(()=>{});
        this.recordingDir=undefined;this.recordedPages.clear();
        this.recordings.push({status:'omitted',reason:this.redactor.text(`录像初始化失败，继续使用无录像上下文：${String(error)}`)});
        await createContext();
      }
      this.abortHandler=()=>{void this.context.close().catch(()=>{});};
      this.budget.signal?.addEventListener('abort',this.abortHandler,{once:true});
      await this.context.route('**/*',async route=>{
        const request=route.request();
        if(request.isNavigationRequest() && !this.scopeGuard(request.url())){this.scopeViolation=this.redactor.text(request.url());await route.abort('blockedbyclient');}
        else await route.continue();
      });
      if(this.target.evidence.rawTrace)await this.context.tracing.start({screenshots:true,snapshots:true,sources:false});
      this.pages.set('main',this.page);
      const main=this.recordedPages.get(this.page);if(main)main.pageName='main';
      await this.page.goto(this.target.url!,{waitUntil:'domcontentloaded',timeout:this.budget.timeout()});
      for(const step of role?.login ?? [])await this.perform(step);
      for(const step of role?.verify ?? [])await this.perform(step);
    } catch(error){await this.close();if(role && (!(error instanceof PilotError) || error.code==='ASSERTION_FAILED'))throw new PilotError('AUTH_INVALID',this.redactor.text(error instanceof Error?error.message:String(error)));throw error;}
  }
  private attach(page:Page) {
    if(this.recordingDir)this.recordedPages.set(page,{pageId:`page-${this.recordedPages.size+1}`,pageName:`page-${this.recordedPages.size+1}`});
    page.on('console',message=>{if(['error','warning'].includes(message.type()))this.event('console',message.text());});
    page.on('pageerror',error=>this.event('console',error.message));
    page.on('requestfailed',request=>this.event('network',`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    page.on('response',response=>{if(response.status()>=400)this.event('network',`${response.status()} ${response.request().method()} ${response.url()}`);});
  }
  private event(type:'console'|'network',message:string){this.events.push({type,timestamp:new Date().toISOString(),message:this.redactor.text(message).slice(0,4000)});if(this.events.length>200)this.events.shift();}
  private check() {
    if(this.closed)throw new PilotError('SESSION_EXPIRED','Browser session has closed');
    this.budget.check();
    if(this.scopeViolation)throw new PilotError('TARGET_OUT_OF_SCOPE',`Unexpected navigation: ${this.scopeViolation}`,'inconclusive');
  }
  private async unique(spec:LocatorSpec,timeout:number) {
    const locator=locate(this.frame ?? this.page,spec);
    await locator.first().waitFor({state:'attached',timeout});
    const count=await locator.count();
    if(count!==1)throw new PilotError('LOCATOR_AMBIGUOUS',`Locator matched ${count} elements. Narrow its scope.`,'inconclusive');
    return locator;
  }
  async observe() {
    this.check();await this.collectMaskValues();
    return {sessionId:this.id,url:this.redactor.text(this.page.url()),title:this.redactor.text(await this.page.title()),snapshot:this.redactor.text(await this.page.locator('body').ariaSnapshot({timeout:this.budget.timeout()})),events:structuredClone(this.events)};
  }
  async collectMaskValues() {
    for(const selector of configuredMasks(this.target)) {
      for(const frame of this.page.frames()) {
        const values=await frame.locator(selector).evaluateAll(nodes=>nodes.map(n=>('value' in n?String(n.value):n.textContent ?? '')));
        for(const value of values)this.redactor.add(value);
      }
    }
  }
  async screenshot() {
    this.check();await this.collectMaskValues();
    const masks:Locator[]=[];
    for(const selector of configuredMasks(this.target)){
      let count=0;
      for(const frame of this.page.frames()) {
        const locator=frame.locator(selector);count+=await locator.count();masks.push(locator);
      }
      if(this.target.evidence.masks.includes(selector) && count===0)throw new PilotError('MASK_UNAVAILABLE',`Sensitive mask unavailable: ${selector}`,'inconclusive');
    }
    // Literal runtime values can also appear in text outside configured fields.
    for(const frame of this.page.frames())for(const secret of Object.values(this.bindings))if(secret)masks.push(frame.getByText(secret,{exact:false}));
    return this.page.screenshot({mask:masks,fullPage:false,timeout:this.budget.timeout()});
  }
  async perform(step:Step) {
    this.check();this.budget.consume();
    const timeout=this.budget.timeout(step.timeoutMs);
    const value=(v:string|{ref:string})=>resolveValue(v,this.bindings);
    let actual:unknown;
    try {
      switch(step.op){
        case 'navigate':{const url=new URL(value(step.path),this.target.url).href;if(!this.scopeGuard(url))throw new PilotError('TARGET_OUT_OF_SCOPE','Requested navigation is outside configured origins','inconclusive');await this.page.goto(url,{waitUntil:'domcontentloaded',timeout});this.frame=undefined;break;}
        case 'click':await (await this.unique(step.locator,timeout)).click({timeout});break;
        case 'fill':await (await this.unique(step.locator,timeout)).fill(value(step.value),{timeout});break;
        case 'select':await (await this.unique(step.locator,timeout)).selectOption(value(step.value),{timeout});break;
        case 'check':await (await this.unique(step.locator,timeout)).setChecked(step.checked,{timeout});break;
        case 'press':await (await this.unique(step.locator,timeout)).press(step.key,{timeout});break;
        case 'scroll':await this.page.evaluate(({x,y})=>window.scrollBy(x,y),{x:step.x,y:step.y});break;
        case 'frame':if(step.selector===null)this.frame=undefined;else{await this.unique({kind:'selector',value:step.selector,exact:true,scope:[]},timeout);this.frame=this.page.frameLocator(step.selector);}break;
        case 'openPage':{const locator=await this.unique(step.locator,timeout);const [page]=await Promise.all([this.page.waitForEvent('popup',{timeout}),locator.click({timeout})]);const recording=this.recordedPages.get(page);if(recording)recording.pageName=step.name;await page.waitForLoadState('domcontentloaded',{timeout});this.page=page;this.pages.set(step.name,page);this.frame=undefined;break;}
        case 'switchPage':{const page=this.pages.get(step.name);if(!page || page.isClosed())throw new PilotError('PAGE_MISSING',`Page unavailable: ${step.name}`);this.page=page;this.frame=undefined;break;}
        case 'upload':{const path=value(step.file);await access(path).catch(()=>{throw new PilotError('FILE_MISSING',`Test file unavailable: ${step.file.ref}`);});await (await this.unique(step.locator,timeout)).setInputFiles(path,{timeout});break;}
        case 'download':{const locator=await this.unique(step.locator,timeout);const [download]=await Promise.all([this.page.waitForEvent('download',{timeout}),locator.click({timeout})]);const failure=await download.failure();if(failure)throw new PilotError('DOWNLOAD_FAILED',failure,'failed');actual=download.suggestedFilename();expect(actual).toBe(step.filename);break;}
        case 'expectURL':await expect(this.page).toHaveURL(new URL(value(step.expected),this.target.url).href,{timeout});actual=this.page.url();break;
        case 'expectCount':{const locator=locate(this.frame ?? this.page,step.locator);await expect(locator).toHaveCount(step.expected,{timeout});actual=await locator.count();break;}
        case 'expectVisible':{const locator=locate(this.frame ?? this.page,step.locator);const count=await locator.count();if(count>1)throw new PilotError('LOCATOR_AMBIGUOUS',`Visibility locator matched ${count} elements`,'inconclusive');if(step.expected)await expect(locator).toBeVisible({timeout});else await expect(locator).toBeHidden({timeout});actual=await locator.isVisible();break;}
        case 'expectText':{const locator=await this.unique(step.locator,timeout);if(step.contains)await expect(locator).toContainText(value(step.expected),{timeout});else await expect(locator).toHaveText(value(step.expected),{timeout});actual=await locator.innerText({timeout});break;}
        case 'expectValue':{const locator=await this.unique(step.locator,timeout);await expect(locator).toHaveValue(value(step.expected),{timeout});actual=await locator.inputValue({timeout});break;}
        case 'expectEnabled':{const locator=await this.unique(step.locator,timeout);if(step.expected)await expect(locator).toBeEnabled({timeout});else await expect(locator).toBeDisabled({timeout});actual=await locator.isEnabled({timeout});break;}
        case 'unsupported':throw new PilotError('CAPABILITY_UNAVAILABLE',`Unsupported interaction: ${step.capability}`,'inconclusive');
      }
      this.check();return {actual:this.redactor.object(actual ?? null)};
    } catch(error) {
      if(this.scopeViolation)throw new PilotError('TARGET_OUT_OF_SCOPE',`Unexpected navigation: ${this.scopeViolation}`,'inconclusive');
      if(error instanceof PilotError)throw error;
      if(this.budget.signal?.aborted)throw new PilotError('CANCELLED','Run cancelled','inconclusive');
      if(Date.now()>=this.budget.deadline)throw new PilotError('BUDGET_EXHAUSTED','Run time budget exhausted','inconclusive');
      throw new PilotError(isAssertion(step)?'ASSERTION_FAILED':'INTERACTION_FAILED',this.redactor.text(error instanceof Error?error.message:String(error)),isAssertion(step) && !step.candidate?'failed':'inconclusive');
    }
  }
  async close(tracePath?:string) {
    if(!this.closing)this.closing=this.finishClose(tracePath);
    return this.closing;
  }
  private async finishClose(tracePath?:string) {
    this.closed=true;
    if(this.abortHandler)this.budget.signal?.removeEventListener('abort',this.abortHandler);
    const errors:string[]=[];
    if(this.context && this.target.evidence.rawTrace)try{await this.context.tracing.stop(tracePath?{path:tracePath}:undefined);}catch(error){errors.push(String(error));}
    try{await this.context?.close();}catch(error){errors.push(String(error));}
    for(const [page,identity] of this.recordedPages){
      try{
        const video=page.video();if(!video)throw new Error('页面未提供录像');
        const path=await video.path();await chmod(path,0o600);
        if(!(await stat(path)).size)throw new Error('录像文件为空');
        this.recordings.push({...identity,status:'available',path,sensitive:true,redacted:false});
      }catch(error){this.recordings.push({...identity,status:'omitted',reason:this.redactor.text(`录像不可用：${String(error)}`)});}
    }
    if(this.recordingDir && !this.recordedPages.size)this.recordings.push({status:'omitted',reason:'浏览器未创建可录制页面。'});
    try{await this.browser?.close();}catch(error){errors.push(String(error));}
    if(errors.length)throw new PilotError('BROWSER_CLEANUP_FAILED',this.redactor.text(errors.join('\n')));
  }
}

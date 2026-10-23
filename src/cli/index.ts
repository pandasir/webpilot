#!/usr/bin/env node
import { errorInfo } from '../core/errors.js';
import { doctor, setup } from '../core/runtime.js';
import { parseArgs } from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectProject,collectContext} from '../project/index.js';
import {runPlan,saveCase,type RunOptions} from '../core/runner.js';
import {Store} from '../artifacts/store.js';
import {exportPlan,verifyExport} from '../artifacts/export.js';
import {BindingsSchema} from '../core/schema.js';
import {PilotError} from '../core/errors.js';
import {openDashboard,dashboardStatus,stopDashboard,ensureDashboard,internal,endpointAt,requireCoverageDashboard} from '../dashboard/lifecycle.js';
import {CoverageStore} from '../artifacts/coverage.js';
import {coverageFromPlan,CoverageRefSchema} from '../core/coverage.js';
import {PlanSchema} from '../core/schema.js';
import {dashboardRoot} from '../dashboard/files.js';

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help') {
    console.log('WebPilot: doctor | setup | inspect | context | run | replay | save | report | export | export-verify | prune | dashboard open/status/stop/import\nSee docs/interfaces.md for plan schema and CLI examples.');
    return;
  }
  const action=command==='dashboard'?process.argv[3]:undefined;
  const {values} = parseArgs({args:process.argv.slice(command==='dashboard'?4:3),options:{'data-dir':{type:'string'},'dashboard-dir':{type:'string'},'no-open':{type:'boolean'},force:{type:'boolean'},'no-dashboard':{type:'boolean'},json:{type:'boolean'},url:{type:'string'},project:{type:'string'},config:{type:'string'},application:{type:'string'},plan:{type:'string'},coverage:{type:'string'},'preview-only':{type:'boolean'},'case-file':{type:'string'},case:{type:'string'},version:{type:'string'},run:{type:'string'},bindings:{type:'string'},out:{type:'string'},promote:{type:'boolean'},headful:{type:'boolean'},directory:{type:'string'},'target-config':{type:'string'},days:{type:'string'},requirements:{type:'string'},'diff-ref':{type:'string'}},strict:true});
  if(command==='dashboard'){
    const root=dashboardRoot(values['dashboard-dir']);let result:unknown;
    if(action==='open')result=await openDashboard({root,open:!values['no-open'],force:values.force,runId:values.run});
    else if(action==='status'){const status=await dashboardStatus(root);result={running:!!status,dashboardUrl:status?.url};}
    else if(action==='stop')result=await stopDashboard(root);
    else if(action==='import'){if(!values['data-dir'])throw new PilotError('MISSING_DATA_DIR','Provide --data-dir');const e=await ensureDashboard(root);result=await internal(e,'/internal/import',{dataDir:values['data-dir']});}
    else throw new PilotError('INVALID_DASHBOARD_ACTION','Use dashboard open/status/stop/import');
    console.log(JSON.stringify(result,null,2));return;
  }
  if(command==='doctor' || command==='setup') {
    const result=command==='doctor' ? await doctor({dataDir:values['data-dir']}) : await setup({dataDir:values['data-dir']});
    console.log(JSON.stringify(result,null,2));process.exitCode=result.ready?0:2;return;
  }
  const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
  const bindings=BindingsSchema.parse(values.bindings?await json(values.bindings):{});
  const store=new Store(values['data-dir']);const coverageStore=new CoverageStore(store.root);
  const targetOverrides={...(values.url?{url:values.url}:{}),...(values.project?{projectPath:values.project}:{}),...(values.config?{configPath:values.config}:{}),...(values.application?{application:values.application}:{})};
  const controller=new AbortController();
  const options:RunOptions={dataDir:values['data-dir'],bindings,headful:values.headful,signal:controller.signal,dashboard:values['no-dashboard']?false:undefined,dashboardRoot:values['dashboard-dir']};
  if(values.coverage)options.coverage=CoverageRefSchema.parse(await json(values.coverage));
  const showDashboard=async()=>{if(options.dashboard===false||process.env.WEBPILOT_DASHBOARD==='0')return;try{const link=await openDashboard({root:values['dashboard-dir'],auto:!values['no-open'],open:!values['no-open']});console.error(`WebPilot 测试中心：${link.dashboardUrl}`);}catch{console.error('WebPilot：看板暂不可用，继续执行测试。');}};
  const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const loadPlan=async()=>{
    if(values.plan){const p=await json(values.plan);return {...p,target:{...p.target,...targetOverrides}};}
    if(values.run){const p=await json(join(store.runDir(values.run),'plan.json'));return {...p,target:{...p.target,...targetOverrides}};}
    const c=values['case-file']?await json(values['case-file']):values.case?await store.readCase(values.case,Number(values.version ?? 1)):undefined;
    if(c)return {schemaVersion:1,id:`replay-${c.id}`,target:targetOverrides,scope:[c.title],cases:[c]};
    throw new Error('Provide --plan FILE, --run ID, --case-file FILE or --case ID --version N');
  };
  let result:unknown;
  try{
    switch(command){
      case 'inspect':result=await inspectProject(targetOverrides);break;
      case 'context':result=await collectContext({projectPath:values.project,requirements:values.requirements?[values.requirements]:[],diffRef:values['diff-ref']});break;
      case 'run':case 'replay':{const plan=await loadPlan();if(values['preview-only']){await showDashboard();result=await coverageStore.create(coverageFromPlan(PlanSchema.parse(plan),'generate-only'),bindings);if(options.dashboard!==false&&process.env.WEBPILOT_DASHBOARD!=='0'){const endpoint=await endpointAt(values['dashboard-dir']);if(endpoint)try{await requireCoverageDashboard(endpoint);await internal(endpoint,'/internal/import',{dataDir:store.root});console.error(`WebPilot 覆盖计划：${endpoint.url}/plans/${(result as any).manifest.id}`);}catch(error){console.error(`WebPilot：${(error as Error).message}`);}}break;}await showDashboard();const run=await runPlan(plan,options);result=run;process.exitCode=run.exitCode;break;}
      case 'save':{const p=await loadPlan();const c=values.case?p.cases.find((c:{id:string})=>c.id===values.case):p.cases[0];if(!c)throw new Error('Selected case is unavailable');if(values.promote)await showDashboard();result=await saveCase(c,p.target,{...options,promote:values.promote});break;}
      case 'report':if(!values.run)throw new Error('--run ID is required');result=await store.readRun(values.run);break;
      case 'export':if(!values.out)throw new Error('--out DIRECTORY is required');result=await exportPlan(await loadPlan(),values.out,bindings);break;
      case 'export-verify':if(!values.directory || !values.url)throw new Error('--directory and --url are required');result=await verifyExport(values.directory,{url:values.url,bindingsFile:values.bindings,targetConfig:values['target-config'],signal:controller.signal});process.exitCode=(result as {exitCode:number}).exitCode===0?0:2;break;
      case 'prune':result={removed:await store.prune(Number(values.days ?? 7)),plansRemoved:await coverageStore.prune()};break;
      default:throw new Error(`Unknown command: ${command}`);
    }
    console.log(JSON.stringify(result,null,2));
  }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
main().catch(error => { console.error(JSON.stringify(errorInfo(error))); process.exitCode = error instanceof PilotError?2:3; });

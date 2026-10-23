import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebPilotService,ToolInputs,dispatch } from '../core/service.js';
import { Redactor } from '../artifacts/redaction.js';
import {errorInfo} from '../core/errors.js';
import {endpointAt,internal,requireCoverageDashboard} from '../dashboard/lifecycle.js';

const server = new McpServer({ name: 'webpilot', version: '0.1.0' });
const service=new WebPilotService(process.env.WEBPILOT_DATA_DIR);
const dashboardDisabledSessions=new Set<string>();
const descriptions:Record<string,string>={
  dashboard_open:'Start or reuse the shared local test dashboard. Opens once across chats; when shouldOpen is false, reuse the existing page without opening the returned URL again. Set force:true only when explicitly asked to reopen. Returns a local access link; never returns browser media.',
  coverage_create:'Save a pretest coverage inventory without opening a browser. Publish its summary before adopting and executing.',
  coverage_read:'Read a saved coverage revision, readiness, adoption and linked runs.',
  coverage_update:'Append a coverage revision using expectedRevision and a unique requestId. Record the change reason; inferred checks remain candidates.',
  coverage_adopt:'Adopt the exact published coverage revision after showing its summary. In review mode userConfirmed requires explicit human adoption, never inferred consent.',
  session_case_begin:'Begin one selected case in the adopted coverage plan within the existing session and run; isolate its role and data preparation.',
  session_case_end:'End the current case, verify all planned steps were executed, finalize evidence and clean up its data.',
  session_case_sync:'Persist and apply an adopted coverage revision within this session. Preserve executed steps; refine pending locators or publish unselected suggestions before continuing.',
  runtime_info:'Read WebPilot version and API version.',runtime_doctor:'Check Node, Chromium and writable WebPilot storage.',
  project_inspect:'Inspect a project or URL without starting commands; show ambiguous targets and configuration sources.',
  context_collect:'Read requirements, OpenSpec/test documents and optional Git diff as planning context.',
  run_prepare:'Check runtime and inspect target. Actual service preparation happens during session_open or suite_run.',
  session_open:'Prepare target service and open an isolated Chromium context with a shared session budget. Requires an adopted coverage ref; pass exploratory:true only for an explicitly exploratory check without formal acceptance. Supply a concise title describing the user-requested verification task so runs can be distinguished in the Dashboard.',
  session_observe:'Read a fresh redacted accessibility snapshot, URL, title and recent errors.',
  session_act:'Execute one supported browser action with an unambiguous locator.',
  session_check:'Execute one explicit source-aware assertion; inferred expectations must be candidates.',
  session_close:'Close a session and owned service; finalize default local video recordings and return playback paths. Include metadata.runUrl as a clickable current-test link in the final user response, even for failed or incomplete tests. Raw trace requires explicit configuration.',
  suite_run:'Execute a versioned acceptance plan with formal assertions, evidence and honest outcome classification. Include metadata.runUrl as a clickable current-test link in the final user response, even for failed or incomplete tests.',
  report_read:'Read a saved redacted run report and local video playback paths by id. Sensitive raw traces and video contents are never returned.',
  case_save:'Save an immutable case version; optionally clean-replay it before regression promotion.',
  case_export:'Export a plan to a new independent Playwright test package without overwriting files.',
  export_verify:'Run an exported package after its dependencies and equivalent target/data are ready.'
};
for(const [name,schema] of Object.entries(ToolInputs)) {
  const readOnly=['runtime_info','runtime_doctor','project_inspect','context_collect','session_observe','coverage_read','report_read','run_prepare'].includes(name);
  server.registerTool(name,{description:descriptions[name],inputSchema:schema.shape,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:!readOnly}},async(args:Record<string,unknown>,extra:{signal:AbortSignal})=>{
    const bindings='bindings' in args?args.bindings as Record<string,string>:{};
    const redactor=new Redactor(bindings);
    try{
      const data=redactor.object(await dispatch(service,name,args,extra.signal));
      const runId=typeof data==='object'&&data!==null?('runId'in data?data.runId:'id'in data?data.id:undefined):undefined;
      if(name==='session_open'&&args.dashboard===false&&typeof data==='object'&&data!==null&&'sessionId'in data&&typeof data.sessionId==='string')dashboardDisabledSessions.add(data.sessionId);
      const enabled=process.env.WEBPILOT_DASHBOARD!=='0'&&args.dashboard!==false&&!(typeof args.sessionId==='string'&&dashboardDisabledSessions.has(args.sessionId));
      const endpoint=enabled&&typeof runId==='string'&&runId.startsWith('run-')?await endpointAt():undefined;
      const manifest=typeof data==='object'&&data!==null&&'manifest'in data?data.manifest as {id:string}:undefined;
      let planEndpoint=enabled&&manifest?await endpointAt():undefined;let dashboardWarning:string|undefined;
      if(manifest&&planEndpoint)try{await requireCoverageDashboard(planEndpoint);await internal(planEndpoint,'/internal/import',{dataDir:service.store.root});}catch(error){dashboardWarning=(error as Error).message;planEndpoint=undefined;}
      const metadata=endpoint?{dashboardUrl:endpoint.url,runUrl:`${endpoint.url}/runs/${runId}`} : planEndpoint&&manifest?{dashboardUrl:planEndpoint.url,planUrl:`${planEndpoint.url}/plans/${manifest.id}`} : dashboardWarning?{dashboardWarning}:undefined;
      return {content:[{type:'text' as const,text:JSON.stringify({apiVersion:1,data,...(metadata?{metadata}:{})})}],structuredContent:{apiVersion:1,data,...(metadata?{metadata}:{})}};
    }catch(error){const info=redactor.object(errorInfo(error));return {isError:true,content:[{type:'text' as const,text:JSON.stringify({apiVersion:1,error:info})}],structuredContent:{apiVersion:1,error:info}};}
  });
}
const shutdown=async()=>{await service.closeAll();await server.close();};
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});process.stdin.once('end',()=>{void shutdown();});
await server.connect(new StdioServerTransport());

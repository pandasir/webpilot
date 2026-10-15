import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebPilotService,ToolInputs,dispatch } from '../core/service.js';
import { Redactor } from '../artifacts/redaction.js';
import {errorInfo} from '../core/errors.js';
import {endpointAt} from '../dashboard/lifecycle.js';

const server = new McpServer({ name: 'webpilot', version: '0.1.0' });
const service=new WebPilotService(process.env.WEBPILOT_DATA_DIR);
const descriptions:Record<string,string>={
  dashboard_open:'Start or reuse the shared local test dashboard. Opens once across chats; when shouldOpen is false, reuse the existing page without opening the returned URL again. Set force:true only when explicitly asked to reopen. Returns a local access link; never returns browser media.',
  runtime_info:'Read WebPilot version and API version.',runtime_doctor:'Check Node, Chromium and writable WebPilot storage.',
  project_inspect:'Inspect a project or URL without starting commands; show ambiguous targets and configuration sources.',
  context_collect:'Read requirements, OpenSpec/test documents and optional Git diff as planning context.',
  run_prepare:'Check runtime and inspect target. Actual service preparation happens during session_open or suite_run.',
  session_open:'Prepare target service and open an isolated Chromium context with a shared session budget. Supply a concise title describing the user-requested verification task so runs can be distinguished in the Dashboard.',
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
  const readOnly=['runtime_info','runtime_doctor','project_inspect','context_collect','session_observe','report_read','run_prepare'].includes(name);
  server.registerTool(name,{description:descriptions[name],inputSchema:schema.shape,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:!readOnly}},async(args:Record<string,unknown>,extra:{signal:AbortSignal})=>{
    const bindings='bindings' in args?args.bindings as Record<string,string>:{};
    const redactor=new Redactor(bindings);
    try{
      const data=redactor.object(await dispatch(service,name,args,extra.signal));
      const runId=typeof data==='object'&&data!==null?('runId'in data?data.runId:'id'in data?data.id:undefined):undefined;
      const endpoint=typeof runId==='string'&&runId.startsWith('run-')?await endpointAt():undefined;
      const metadata=endpoint?{dashboardUrl:endpoint.url,runUrl:`${endpoint.url}/runs/${runId}`} : undefined;
      return {content:[{type:'text' as const,text:JSON.stringify({apiVersion:1,data,...(metadata?{metadata}:{})})}],structuredContent:{apiVersion:1,data,...(metadata?{metadata}:{})}};
    }catch(error){const info=redactor.object(errorInfo(error));return {isError:true,content:[{type:'text' as const,text:JSON.stringify({apiVersion:1,error:info})}],structuredContent:{apiVersion:1,error:info}};}
  });
}
const shutdown=async()=>{await service.closeAll();await server.close();};
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});process.stdin.once('end',()=>{void shutdown();});
await server.connect(new StdioServerTransport());

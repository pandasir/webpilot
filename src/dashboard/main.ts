import {parseArgs} from 'node:util';
import {startDashboard} from './server.js';
import {dashboardRoot} from './files.js';

const {values}=parseArgs({options:{root:{type:'string'}}});
try{
  const service=await startDashboard({root:dashboardRoot(values.root)});
  const shutdown=()=>{void service.close().finally(()=>process.exit(0));};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}catch(error){console.error(error instanceof Error?error.message:'Dashboard startup failed');process.exitCode=1;}

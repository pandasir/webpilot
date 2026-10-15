import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(process.argv[2] ?? '.webpilot/marketplace');
const plugin=join(destination,'plugins','webpilot');
await access(join(root,'dist/mcp/index.js'));
await mkdir(plugin,{recursive:true});
for(const entry of ['plugin.json','mcp.json','package.json','package-lock.json','README.md','dist','node_modules','skills','docs']) {
  await cp(join(root,entry),join(plugin,entry),{recursive:true});
}
await mkdir(join(plugin,'.codex-plugin'),{recursive:true});
await cp(join(root,'plugin-compat.json'),join(plugin,'.codex-plugin','plugin.json'));
const mcp=JSON.parse(await readFile(join(root,'mcp.json'),'utf8'));
for(const server of Object.values(mcp.mcpServers)) delete server.type;
delete mcp.$schema;
await writeFile(join(plugin,'.mcp.json'),JSON.stringify(mcp,null,2)+'\n');
await mkdir(join(destination,'.agents','plugins'),{recursive:true});
await writeFile(join(destination,'.agents','plugins','marketplace.json'),JSON.stringify({
  name:'webpilot-local',interface:{displayName:'WebPilot Local'},plugins:[{
    name:'webpilot',source:{source:'local',path:'./plugins/webpilot'},
    policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Developer Tools'
  }]
},null,2)+'\n');
console.log(JSON.stringify({marketplace:destination,plugin}));

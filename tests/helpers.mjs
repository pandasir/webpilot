import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function fixture(){
  const dataDir=await mkdtemp(join(tmpdir(),'webpilot-test-'));
  let retry=0;
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/fail'){res.writeHead(500);res.end('Failed');return;}
    if(url.pathname==='/download'){res.setHeader('Content-Disposition','attachment; filename="sample.txt"');res.end('example');return;}
    if(url.pathname==='/frame'){res.setHeader('Content-Type','text/html');res.end('<label>Frame input<input></label><button onclick="document.querySelector(\'output\').textContent=\'Frame done\'">Submit</button><output></output>');return;}
    res.setHeader('Content-Type','text/html');
    const role=(req.headers.cookie ?? '').match(/role=([a-z]+)/)?.[1] ?? 'guest';
    res.end(`<!doctype html><html><head><title>Acceptance fixture</title></head><body>
      <h1>${url.pathname==='/retry' && ++retry===1?'First attempt':'Test frontend'}</h1><p id="role">Role: ${role}</p>
      <form id="login"><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><button>Log in</button><p role="alert"></p></form>
      <label>Search<input id="search"></label><ul><li>Apple</li><li>Orange</li></ul>
      <label for="choice">Choice</label><select id="choice"><option value="one">One</option><option value="two">Two</option></select>
      <label>Agree<input type="checkbox"></label>
      <section aria-label="First"><button onclick="this.textContent='Clicked'">Same</button></section><section aria-label="Second"><button>Same</button></section>
      <iframe title="embedded" src="/frame"></iframe><a href="/extra" target="_blank">Open page</a><a href="/download">Download</a>
      <label>Test file<input id="upload" type="file"></label><output id="file-result"></output>
      <button id="network">Request</button><output id="network-result"></output>
      <p id="delay"></p><p id="sensitive">sample-sensitive-value</p><canvas></canvas>
      <button id="prime" onclick="localStorage.setItem('primed','yes');document.querySelector('#primed').textContent='Primed'">Prime state</button><output id="primed"></output>
      <script>
        const defect=new URL(location.href).searchParams.get('defect');
        document.querySelector('#primed').textContent=localStorage.getItem('primed')==='yes'?'Primed':'Empty';
        document.querySelector('#login').onsubmit=event=>{event.preventDefault();if(defect==='button')return;const password=event.target.password.value;if(defect==='message')return;document.querySelector('[role=alert]').textContent=password==='correct'?'Welcome':'Invalid password';};
        document.querySelector('#search').oninput=event=>{document.querySelectorAll('li').forEach(li=>li.hidden=!li.textContent.toLowerCase().includes(event.target.value.toLowerCase()));};
        document.querySelector('#upload').onchange=event=>document.querySelector('#file-result').textContent='Uploaded '+event.target.files[0].name;
        document.querySelector('#network').onclick=async()=>{await fetch('/api/fail');console.error('Bearer test-secret-123');document.querySelector('#network-result').textContent='Request failed';};
        setTimeout(()=>document.querySelector('#delay').textContent='Ready',${Math.min(20000,Math.max(0,Number(url.searchParams.get('delay')??250)))});
      </script></body></html>`);
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const url=`http://127.0.0.1:${server.address().port}`;
  return {url,dataDir,close:async()=>{server.closeAllConnections();await new Promise(ok=>server.close(ok));await rm(dataDir,{recursive:true,force:true});}};
}
export const source={type:'user',reference:'Fixture business requirement'};
export const label=value=>({kind:'label',value});
export const role=(value,name)=>({kind:'role',value,name});
export const selector=value=>({kind:'selector',value});
export const text=value=>({kind:'text',value});
export function plan(url,steps,extra={}){return {schemaVersion:1,id:'test-plan',target:{url,budget:{assertionMs:700,...extra.budget},...extra.target},scope:['Fixture feature'],gaps:[],cases:[{schemaVersion:1,id:'feature',version:1,title:'Feature',steps,...extra.case}]};}
export function loginSteps(expected='Invalid password'){return [
  {id:'email',op:'fill',locator:label('Email'),value:'test@example.test'},
  {id:'password',op:'fill',locator:label('Password'),value:'wrong'},
  {id:'submit',op:'click',locator:role('button','Log in')},
  {id:'result',op:'expectText',locator:role('alert'),expected,source}
];}

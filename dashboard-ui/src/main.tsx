import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {publicRun} from '../../src/dashboard/projection';
import './style.css';
import {useManagement,ManagementMenu} from './management';
import {Screenshot} from './screenshot';

type Run=ReturnType<typeof publicRun>;
type Asset=Run['artifacts'][number];
const labels:Record<string,string>={preparing:'准备中',running:'执行中',collecting:'采集证据',cleaning:'清理中',finished:'已结束',historical:'历史记录',interrupted:'已中断',passed:'通过',failed:'失败',blocked:'阻塞',inconclusive:'无法确定',connected:'已连接',disconnected:'连接中断',unknown:'状态待确认'};
const ops:Record<string,string>={navigate:'打开页面',fill:'输入内容',click:'点击',select:'选择选项',check:'勾选',press:'按键',scroll:'滚动',expectText:'验证文本',expectVisible:'验证可见性',expectURL:'验证地址',expectValue:'验证输入值',expectCount:'验证数量',expectEnabled:'验证可用状态',openPage:'打开新页面',switchPage:'切换页面',frame:'切换框架',upload:'上传文件',download:'检查下载'};
const assetUrl=(run:Run,a:Asset)=>`/api/runs/${run.id}/artifacts/${a.id}`;
const active=(r:Run)=>!['finished','interrupted','historical'].includes(r.lifecycle);
const result=(r:Run)=>r.outcome??r.lifecycle;
const duration=(r:Run)=>{const start=Date.parse(r.meta.startedAt),end=r.finishedAt?Date.parse(r.finishedAt):active(r)?Date.now():NaN;if(!Number.isFinite(start)||!Number.isFinite(end))return '时长未知';const sec=Math.max(0,Math.floor((end-start)/1000));return `${Math.floor(sec/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;};
const startedAt=(r:Run,compact=false)=>Number.isFinite(Date.parse(r.meta.startedAt))?new Date(r.meta.startedAt).toLocaleString('zh-CN',compact?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:undefined):'时间未知';
function navigate(path:string){history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));window.scrollTo(0,0);}
function Link({to,children,...props}:{to:string}&Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>,'href'>){return <a href={to} {...props} onClick={e=>{if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate(to);}}}>{children}</a>;}
async function api<T>(url:string):Promise<T>{const r=await fetch(url);if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body.error??'数据暂时无法读取');}return r.json();}
function Badge({status}:{status:string}){return <span className={`badge ${status}`}><i/>{labels[status]??status}</span>;}
type IconName='overview'|'activity'|'alert'|'archive'|'search'|'browser'|'clock'|'folder'|'arrow'|'layers'|'chevron';
function Icon({name,className=''}:{name:IconName;className?:string}){
  const paths:Record<IconName,React.ReactNode>={
    overview:<><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="13" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="13" width="6" height="6" rx="1.5"/><rect x="13" y="13" width="6" height="6" rx="1.5"/></>,
    activity:<><path d="M2 11h4l3-7 4 14 3-7h4"/></>,
    alert:<><circle cx="11" cy="11" r="8"/><path d="M11 7v5m0 3h.01"/></>,
    archive:<><rect x="3" y="3" width="16" height="4" rx="1"/><path d="M4.5 7v11h13V7M8 11h6"/></>,
    search:<><circle cx="9.5" cy="9.5" r="6"/><path d="m14 14 5 5"/></>,
    browser:<><rect x="2" y="3" width="18" height="16" rx="3"/><path d="M2 8h18M6 5.5h.01M9 5.5h.01m-1 7 2 2 4-4"/></>,
    clock:<><circle cx="11" cy="11" r="8"/><path d="M11 6v5l3 2"/></>,
    folder:<path d="M2 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/>,
    arrow:<path d="M6 16 16 6M6 6h10v10"/>,
    layers:<><path d="m11 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M2 16l9 5 9-5"/></>,
    chevron:<path d="m8 5 6 6-6 6"/>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Empty({children}:{children:React.ReactNode}){return <div className="empty"><span className="empty-symbol"><Icon name="browser"/></span>{children}</div>;}
function Sidebar({path}:{path:string}){
  const params=new URLSearchParams(path.split('?')[1]),isOverview=path.split('?')[0]==='/',archived=params.get('scope')==='archived',status=params.get('status');
  const items:[string,string,IconName,boolean][]=[['/','所有运行','layers',isOverview&&!archived&&status!=='active'&&status!=='failed'],['/?status=active','正在执行','activity',isOverview&&!archived&&status==='active'],['/?status=failed','失败记录','alert',isOverview&&!archived&&status==='failed'],['/?scope=archived','已归档','archive',isOverview&&archived]];
  return <aside className="sidebar"><Link to="/" className="brand"><span className="brand-mark"><Icon name="browser"/></span><span>WebPilot<small>本地测试工作台</small></span></Link><div className="sidebar-section-label">工作空间</div><nav className="sidebar-nav" aria-label="工作空间导航">{items.map(([to,label,icon,chosen])=><Link key={to} to={to} className={`sidebar-link ${chosen?'selected':''}`} aria-current={chosen?'page':undefined}><Icon name={icon}/><span>{label}</span>{chosen&&<span className="nav-indicator"/>}</Link>)}</nav><div className="sidebar-note"><Icon name="browser"/><span>从运行到结果<small>每一步，都有据可查。</small></span></div><div className="sidebar-bottom"><span className="local-avatar">W</span><span>本机工作空间<small><i className="dot"/>数据仅保存在本机</small></span></div></aside>;
}
function Header({detail,compare}:{detail:boolean;compare:boolean}){return <header className="header"><div className="breadcrumb"><Icon name="overview"/><Link to="/">测试中心</Link><Icon name="chevron"/><span>{compare?'并排观看':detail?'运行详情':'运行总览'}</span></div><span className="local"><i className="dot"/>本地工作台</span></header>;}
function useRun(id:string){
  const [run,setRun]=useState<Run>(),[error,setError]=useState(''),[online,setOnline]=useState(true);
  useEffect(()=>{let disposed=false,streaming=false;setRun(undefined);setError('');
    const update=(value:Run)=>{if(!disposed){setRun(value);setError('');}};
    void api<Run>(`/api/runs/${id}`).then(value=>{if(!streaming)update(value);}).catch(e=>!disposed&&!streaming&&setError(e.message));
    const es=new EventSource(`/api/runs/${id}/events`);es.addEventListener('state',e=>{streaming=true;update(JSON.parse((e as MessageEvent).data));});
    es.addEventListener('deleted',e=>{streaming=true;const status=JSON.parse((e as MessageEvent).data).status;if(status==='deleted')es.close();setRun(undefined);setError(status==='pending'?'删除待完成，请稍后重试清理':'该运行已被删除');});
    es.onopen=()=>!disposed&&setOnline(true);es.onerror=()=>!disposed&&setOnline(false);
    return ()=>{disposed=true;es.close();};
  },[id]);return {run,error,online};
}
function Overview({path}:{path:string}){
  const params=new URLSearchParams(location.search);
  const [scope,setScope]=useState(params.get('scope')==='archived'?'archived':'current'),[managing,setManaging]=useState(false),[checked,setChecked]=useState<string[]>([]);
  const manager=useManagement(results=>setChecked(ids=>ids.filter(id=>!results.some(r=>r.id===id&&['archived','restored','deleted'].includes(r.status)))));
  const [data,setData]=useState<{runs:Run[];total:number;summary?:Record<string,number>}>({runs:[],total:0});
  const [status,setStatus]=useState(params.get('status')??''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[error,setError]=useState(''),[online,setOnline]=useState(true),[selected,setSelected]=useState<string[]>([]);
  useEffect(()=>{const params=new URLSearchParams(path.split('?')[1]);setScope(params.get('scope')==='archived'?'archived':'current');setStatus(params.get('status')??'');setQuery('');setPage(1);},[path]);
  useEffect(()=>{setChecked([]);},[scope,status,query,page,managing]);
  const previousRuns=useRef<string[]>([]);
  useEffect(()=>{const current=new Set(data.runs.map(r=>r.id));const lost=previousRuns.current.filter(id=>!current.has(id));setSelected(ids=>ids.filter(id=>!lost.includes(id)));setChecked(ids=>ids.filter(id=>!lost.includes(id)));previousRuns.current=[...current];},[data.runs]);
  useEffect(()=>{let disposed=false,sequence=0;let timer:ReturnType<typeof setTimeout>|undefined;
    const load=()=>{const request=++sequence;void api<typeof data>(`/api/runs?scope=${scope}&status=${encodeURIComponent(status)}&project=${encodeURIComponent(query)}&page=${page}`).then(v=>{if(!disposed&&request===sequence){setData(v);if(v.total>0&&page>Math.ceil(v.total/20))setPage(Math.ceil(v.total/20));else if(v.total===0&&page>1)setPage(1);setError('');}}).catch(e=>!disposed&&setError(e.message));};
    load();const es=new EventSource('/api/events');const update=()=>{if(timer)clearTimeout(timer);timer=setTimeout(load,80);};
    addEventListener('run-management',update);es.addEventListener('changed',update);es.addEventListener('reset',update);es.onopen=()=>!disposed&&setOnline(true);es.onerror=()=>!disposed&&setOnline(false);
    return ()=>{disposed=true;es.close();removeEventListener('run-management',update);if(timer)clearTimeout(timer);};
  },[scope,status,query,page]);
  const summary=data.summary??{active:data.runs.filter(active).length,passed:data.runs.filter(r=>r.outcome==='passed').length,failed:data.runs.filter(r=>r.outcome==='failed').length,other:data.runs.filter(r=>['blocked','inconclusive'].includes(r.outcome??'')||['interrupted','historical'].includes(r.lifecycle)).length};
  return <main className="main"><div className="page-heading"><div><div className="eyebrow">你的测试工作空间</div><h1>{scope==='archived'?'归档记录':'运行总览'}</h1><p>查看测试进展，回到每一次执行的现场。</p></div><span className={`connection ${online?'':'offline'}`}><i/>{online?'实时同步中':'连接中断，正在重连'}</span></div>
    <div className="stats" aria-label="运行统计">{[['active','正在执行'],['passed','已通过'],['failed','有失败'],['other','需要关注']].map(([key,label])=><div className={`stat ${key}`} key={key}><span className="stat-dot"/><span>{label}</span><strong>{summary[key]??0}</strong></div>)}</div>
    <section className="runs-section" aria-label="测试运行"><div className="section-heading"><div className="section-title"><h2>测试运行</h2><span className="count">{data.total}</span></div><div className="section-actions"><select aria-label="记录范围" value={scope} onChange={e=>{navigate(e.target.value==='archived'?'/?scope=archived':'/');}}><option value="current">当前记录</option><option value="archived">已归档</option></select><button className="button secondary" onClick={()=>setManaging(v=>!v)}>{managing?'完成管理':'批量管理'}</button><button className="button secondary" disabled={selected.length!==2||managing} onClick={()=>navigate(`/compare?runs=${selected.join(',')}`)}>并排观看 {selected.length}/2 <Icon name="arrow"/></button></div></div>
    {manager.notices}
    {managing&&<div className="batch-toolbar"><label><input type="checkbox" aria-label="全选当前页" checked={data.runs.some(r=>r.management?.allowed)&&data.runs.filter(r=>r.management?.allowed).every(r=>checked.includes(r.id))} onChange={e=>setChecked(e.target.checked?data.runs.filter(r=>r.management?.allowed).map(r=>r.id):[])}/> 全选当前页</label><span>已选 {checked.length} 条</span><button className="button secondary" disabled={!checked.length||manager.busy} onClick={()=>manager.act(scope==='archived'?'restore':'archive',data.runs.filter(r=>checked.includes(r.id)))}>{scope==='archived'?'批量恢复':'批量归档'}</button><button className="button secondary danger-text" disabled={!checked.length||manager.busy} onClick={()=>manager.act('delete',data.runs.filter(r=>checked.includes(r.id)))}>批量删除…</button></div>}
    <div className="toolbar"><div className="filter-tabs" aria-label="运行状态筛选">{[['','全部'],['active','执行中'],['passed','通过'],['failed','失败'],['interrupted','已中断']].map(([value,label])=><button key={value} className={status===value?'selected':''} aria-pressed={status===value} onClick={()=>{const params=new URLSearchParams();if(scope==='archived')params.set('scope','archived');if(value)params.set('status',value);navigate(params.size?`/?${params}`:'/');}}>{label}</button>)}</div><label className="search-field"><Icon name="search"/><input aria-label="搜索项目或测试" placeholder="搜索运行、项目或目标…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label></div>
    {error&&<div role="alert" className="notice error">{error}</div>}
    {!data.runs.length&&!error?<Empty><h3>{scope==='archived'?'暂无归档记录':'暂无匹配的运行'}</h3><p>{scope==='archived'?'在运行菜单中选择归档，即可永久保存报告和证据。':'在任意聊天中启动 WebPilot，或调整筛选条件查看历史运行。'}</p></Empty>:<div className="run-grid"><div className="list-heading" aria-hidden="true"><span className="list-run-label">运行名称</span><span>状态</span><span>执行进度</span><span>用时</span><span className="run-date">开始时间</span><span/></div>{data.runs.map(run=>{const screenshot=run.artifacts.filter(a=>a.type==='screenshot').at(-1);const done=run.cases.filter(c=>c.outcome).length;return <article className={`run-card ${selected.includes(run.id)||checked.includes(run.id)?'is-selected':''}`} key={run.id} data-run-id={run.id}>
      {screenshot?<Screenshot className={`run-preview ${active(run)?'is-active':''}`} src={assetUrl(run,screenshot)} alt={`${run.meta.title} 最近步骤截图`} loading="lazy"/>:<Link to={`/runs/${run.id}`} className={`run-preview ${active(run)?'is-active':''}`} aria-label={`查看运行 ${run.meta.title}`}><Icon name="browser"/></Link>}
      <div className="card-body"><Link to={`/runs/${run.id}`}><h3 title={run.meta.title}>{run.meta.title}</h3></Link><p className="target" title={run.meta.target}><Icon name={run.meta.project?'folder':'browser'}/><span>{run.meta.project?.split(/[\\/]/).at(-1)??run.meta.target}</span>{run.unstable&&<span className="small-tag">不稳定</span>}</p><time className="run-inline-date">{startedAt(run,true)}<span className="inline-duration"> · {duration(run)}</span></time>{run.management?.keepForever&&<span className="permanent-tag">{run.management.archivedAt?'已归档 · ':''}永久保存</span>}</div>
      <div className="run-state"><Badge status={result(run)}/></div><div className="run-progress"><span>{run.meta.totalCases!==undefined?`${done} / ${run.meta.totalCases} 用例`:`${run.cases.flatMap(c=>c.attempts).flatMap(a=>a.steps).length} 个步骤`}</span>{run.meta.totalCases!==undefined&&<progress aria-label={`${run.meta.title} 用例进度`} max={Math.max(1,run.meta.totalCases)} value={done}/>}</div><span className="run-duration">{duration(run)}</span><time className="run-date">{startedAt(run,true)}</time>
      <div className="card-top"><div className="card-actions">{managing?<label className="compare-check"><input type="checkbox" aria-label={`管理选择 ${run.meta.title}`} disabled={!run.management?.allowed||manager.busy} title={run.management?.reason} checked={checked.includes(run.id)} onChange={e=>setChecked(ids=>e.target.checked?[...ids,run.id]:ids.filter(id=>id!==run.id))}/><span>选择</span></label>:<label className="compare-check"><input type="checkbox" aria-label={`并排选择 ${run.meta.title}`} checked={selected.includes(run.id)} disabled={selected.length===2&&!selected.includes(run.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,run.id]:ids.filter(id=>id!==run.id))}/><span>并排</span></label>}<ManagementMenu run={run} manager={manager}/></div></div></article>;})}</div>}
    {data.total>20&&<div className="pagination"><button className="button secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page} / {Math.ceil(data.total/20)}</span><button className="button secondary" disabled={page*20>=data.total} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
    </section><div className="overview-note"><Icon name="clock"/><span>所有聊天与项目的运行，汇集于此。</span></div></main>;
}
function LiveView({run}:{run:Run}){
  const [image,setImage]=useState(''),[message,setMessage]=useState('等待实时画面'),[frames,setFrames]=useState(0),[captured,setCaptured]=useState(0),[pageName,setPageName]=useState('');
  const current=useRef('');
  const still=run.artifacts.filter(a=>a.type==='screenshot').at(-1);
  useEffect(()=>{
    if(!active(run)||!run.meta.live){setMessage(run.meta.live?'直播已结束，可查看下方录像':'本次运行已关闭直播');return;}
    let disposed=false,ws:WebSocket|undefined,retry:ReturnType<typeof setTimeout>|undefined;let epoch=-1,seq=-1;
    const connect=()=>{if(disposed)return;ws=new WebSocket(`${location.origin.replace('http:','ws:')}/api/runs/${run.id}/live`);ws.binaryType='arraybuffer';
      ws.onmessage=e=>{if(disposed)return;if(typeof e.data==='string'){try{setMessage(JSON.parse(e.data).message);}catch{}return;}
        const bytes=new Uint8Array(e.data);if(bytes.length<6)return;const n=new DataView(e.data).getUint32(0);if(n>4096||n+6>bytes.length)return;
        try{const header=JSON.parse(new TextDecoder().decode(bytes.slice(4,4+n)));if(header.runId!==run.id||header.streamEpoch<epoch||header.streamEpoch===epoch&&header.frameSeq<=seq)return;epoch=header.streamEpoch;seq=header.frameSeq;
          const next=URL.createObjectURL(new Blob([bytes.slice(4+n)],{type:'image/jpeg'}));const previous=current.current;current.current=next;setImage(next);if(previous)URL.revokeObjectURL(previous);setFrames(v=>v+1);setCaptured(header.capturedAt);setPageName(`${header.pageId} · 第 ${header.attempt??1} 次尝试`);setMessage('实时画面');
        }catch{}
      };ws.onclose=()=>{if(!disposed){setMessage('画面连接中断，正在重连');retry=setTimeout(connect,1500);}};ws.onerror=()=>ws?.close();
    };connect();return ()=>{disposed=true;if(retry)clearTimeout(retry);ws?.close();if(current.current){URL.revokeObjectURL(current.current);current.current='';}};
  },[run.id,active(run),run.meta.live]);
  const ended=!active(run);
  return <div className="live-container" data-frames={frames}><div className="browser-bar"><span className="traffic"><i/><i/><i/></span><span className="browser-address">{run.meta.target}</span><span className={`live-indicator ${active(run)?'on':''}`}>{active(run)?'LIVE':'ENDED'}</span></div><div className={`live-stage ${ended?'ended':''}`}>{image?<img src={image} alt="浏览器实时画面"/>:ended&&still?<figure className="live-still"><Screenshot src={assetUrl(run,still)} alt={`${run.meta.title} 结束时的页面截图`} loading="lazy"/><figcaption>运行已结束 · 最近一张步骤截图</figcaption></figure>:<Empty><span>{message}</span></Empty>}</div><div className="live-footer"><span><i className={active(run)?'dot live':'dot muted'}/>{message}</span><span>{pageName}{captured?` · 最近画面 ${new Date(captured).toLocaleTimeString('zh-CN')}`:''}</span></div></div>;
}
function Recordings({run}:{run:Run}){const videos=run.artifacts.filter(a=>a.type==='video');return <div className="media-list">{videos.map(v=><section className="media-item" key={v.id}><h3>{run.cases.find(c=>c.id===v.caseId)?.title??'浏览器探索'} · 第 {v.attempt??1} 次尝试 · {v.pageName??v.pageId}</h3><video controls preload="metadata" src={assetUrl(run,v)}/></section>)}{run.recordingGaps.map((gap,i)=><p className="notice" key={i}>录像证据缺口：{gap}</p>)}{!videos.length&&!run.recordingGaps.length&&<Empty><p>{active(run)?'录像将在浏览器上下文关闭后定稿。':'没有可用录像，可能未启用或已过期。'}</p></Empty>}</div>;}
function Detail({id,compact=false}:{id:string;compact?:boolean}){
  const manager=useManagement();
  const {run,error,online}=useRun(id);const [tab,setTab]=useState('live'),[step,setStep]=useState('');
  const [report,setReport]=useState<unknown>(),[reportError,setReportError]=useState('');
  useEffect(()=>{if(tab!=='report')return;let disposed=false;void api(`/api/runs/${id}/report`).then(v=>{if(!disposed){setReport(v);setReportError('');}}).catch(e=>!disposed&&setReportError(e.message));return ()=>{disposed=true;};},[id,tab,run?.lifecycle]);
  if(error)return <>{manager.notices}<div className="notice error" role="alert">{error}{error.startsWith('删除待完成')&&<button className="text-button" disabled={manager.busy} onClick={()=>manager.retryDelete(id)}>重试清理</button>}</div></>;
  if(!run)return <Empty>正在加载运行…</Empty>;
  const all=run.cases.flatMap(c=>c.attempts.flatMap(a=>a.steps.map(s=>({c,a,s,key:`${c.id}/${a.number}/${s.id}`}))));const selected=all.find(s=>s.key===step)??all.at(-1);
  const screenshots=run.artifacts.filter(a=>a.type==='screenshot');
  return <div className={compact?'detail compact':'detail'} data-detail-id={id}>
    {!compact&&<Link to="/" className="back-link">← 所有测试</Link>}
    <div className="detail-heading"><div><div className="eyebrow">{run.meta.mode==='suite'?'验收测试':'浏览器探索'}</div><h1>{run.meta.title}</h1><p className="target">{run.meta.project??run.meta.target}</p></div><div className="card-actions"><Badge status={result(run)}/><ManagementMenu run={run} manager={manager}/></div></div>
    {manager.notices}{run.management?.keepForever&&<p className="permanent-tag">{run.management.archivedAt?'已归档 · ':''}永久保存</p>}
    <div className="run-meta"><span>◷ {duration(run)}</span><span>{startedAt(run)}</span><span className="mono">{id}</span><span>{online?labels[run.connection]:'看板连接中断，正在重连'}</span></div>
    {run.logGap&&<p className="notice">{run.logGap}</p>}{run.lifecycle==='interrupted'&&<p className="notice error">{run.message}</p>}
    <div className="detail-layout"><aside className="timeline"><div className="panel-heading"><h2>执行时间线</h2><span>{labels[run.lifecycle]}</span></div>{!run.cases.length&&<p className="timeline-empty">{run.message??'准备目标和浏览器…'}</p>}{run.cases.map(c=><section className="case" key={c.id}><div className="case-title"><span className={`case-dot ${c.outcome??''}`}>{c.outcome==='passed'?'✓':c.outcome==='failed'?'×':'·'}</span><h3>{c.title}</h3>{c.unstable&&<span className="small-tag">不稳定</span>}</div>{c.attempts.map(a=><div className="attempt" key={a.number}><div className="attempt-label">第 {a.number} 次尝试</div>{a.steps.map(s=>{const key=`${c.id}/${a.number}/${s.id}`;return <button className={`step ${selected?.key===key?'chosen':''}`} key={s.id} onClick={()=>{setStep(key);setTab('step');}}><span className={`step-symbol ${s.outcome}`}>{s.outcome==='passed'?'✓':s.outcome==='failed'?'×':'!'}</span><span><strong>{ops[s.op]??s.op}</strong><small>{s.id}{s.candidate?' · 候选检查':''}</small></span><time>{s.durationMs} ms</time></button>;})}{a.reason&&<p className="attempt-reason">{a.reason}</p>}{a.cleanupError&&<p className="attempt-reason">清理：{a.cleanupError}</p>}</div>)}{c.activeStep&&<div className="active-step"><i className="spinner"/><div>{ops[c.activeStep.op]??c.activeStep.op}<small>{c.activeStep.id} · 等待 {Math.max(0,Math.floor((Date.now()-Date.parse(c.activeStep.timestamp))/1000))} 秒</small></div></div>}</section>)}<div className="phase-note"><i className={active(run)?'dot':'dot muted'}/>{run.message??labels[run.lifecycle]}</div></aside>
    <section className="workspace"><nav className="detail-tabs">{[['live','实时画面'],['step','步骤详情'],['screenshots',`截图 ${screenshots.length}`],['report','报告'],['video','录像']].map(([value,label])=><button key={value} className={tab===value?'selected':''} onClick={()=>setTab(value)}>{label}</button>)}</nav>
      {tab==='live'&&<><LiveView run={run}/><p className="privacy-note">本机实时画面可能包含敏感内容，沿用录像的本地访问规则；步骤截图单独脱敏。</p>{!active(run)&&<div className="ended-action"><p>{run.lifecycle==='historical'?run.message:'本次运行已结束，执行记录和证据已保留。'}</p><button className="button" onClick={()=>setTab('video')}>查看录像 →</button></div>}</>}
      {tab==='step'&&(selected?<div className="step-detail"><div className="step-detail-heading"><h2>{ops[selected.s.op]??selected.s.op} <small>{selected.s.id}</small></h2><Badge status={selected.s.outcome}/></div>{selected.s.candidate&&<p className="notice">候选检查，不构成正式业务验收依据。</p>}{selected.s.expected!==undefined&&<div className="value-box"><span>预期结果</span><pre>{JSON.stringify(selected.s.expected,null,2)}</pre></div>}{selected.s.actual!==undefined&&<div className="value-box"><span>实际结果</span><pre>{JSON.stringify(selected.s.actual,null,2)}</pre></div>}{selected.s.error&&<div className="value-box error-box"><span>{selected.s.error.code}</span><pre>{selected.s.error.message}</pre></div>}{run.artifacts.filter(a=>a.caseId===selected.c.id&&a.attempt===selected.a.number&&a.stepId===selected.s.id).map(a=>a.type==='screenshot'?<Screenshot className="evidence-image" key={a.id} src={assetUrl(run,a)} alt={`步骤 ${selected.s.id} 截图`}/>:<a className="evidence-link" key={a.id} href={assetUrl(run,a)} target="_blank" rel="noreferrer">查看 {a.type} 证据 ↗</a>)}{selected.s.evidence.filter(e=>e.type==='omitted').map(e=><p key={e.id} className="notice">证据缺口：{e.reason}</p>)}</div>:<Empty>还没有已完成步骤。</Empty>)}
      {tab==='screenshots'&&<div className="screenshots">{screenshots.length?screenshots.map(a=><figure key={a.id}><Screenshot src={assetUrl(run,a)} alt={`步骤 ${a.stepId} 截图`} loading="lazy"/><figcaption>{a.stepId} · 第 {a.attempt} 次尝试</figcaption></figure>):<Empty>暂无可用步骤截图。</Empty>}</div>}
      {tab==='video'&&<><p className="privacy-note">{run.management?.keepForever?'录像未经脱敏，仅在本机访问，本次运行永久保存。':'录像未经脱敏，仅在本机访问，并按运行保留期清理。'}</p><Recordings run={run}/></>}
      {tab==='report'&&<div className="report"><h2>运行报告</h2>{run.outcome&&<div className="report-result"><Badge status={run.outcome}/>{run.unstable&&<strong>重试后通过，存在不稳定性</strong>}</div>}<h3>未验证范围与限制</h3>{run.gaps.length?<ul>{run.gaps.map((g,i)=><li key={i}>{g}</li>)}</ul>:<p>{active(run)?'运行尚未结束，最终覆盖情况待确认。':run.meta.mode==='exploration'?'探索步骤记录不等同于完整正式验收。':'未记录额外覆盖缺口。'}</p>}{run.cleanupErrors.length>0&&<><h3>清理问题</h3><ul>{run.cleanupErrors.map((e,i)=><li key={i}>{e}</li>)}</ul></>}{reportError&&<p className="notice">{reportError}</p>}{report!==undefined&&<details><summary>结构化原始报告</summary><pre>{JSON.stringify(report,null,2)}</pre></details>}</div>}
    </section></div>
  </div>;
}
function App(){const [path,setPath]=useState(location.pathname+location.search),[ready,setReady]=useState(false),[error,setError]=useState('');const [,tick]=useState(0);
  useEffect(()=>{const listener=()=>setPath(location.pathname+location.search);addEventListener('popstate',listener);const timer=setInterval(()=>tick(v=>v+1),1000);return ()=>{removeEventListener('popstate',listener);clearInterval(timer);};},[]);
  useEffect(()=>{let disposed=false;const params=new URLSearchParams(location.hash.slice(1)),token=params.get('access');if(token)history.replaceState({},'',location.pathname+location.search);
    const initialize=async()=>{if(token){const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw new Error('打开凭证已失效，请通过 WebPilot 重新打开看板。');}await api('/api/runs');if(!disposed)setReady(true);};void initialize().catch(e=>!disposed&&setError(e.message));return ()=>{disposed=true;};},[]);
  const id=path.match(/^\/runs\/([a-zA-Z0-9._-]+)/)?.[1];const compare=path.startsWith('/compare')?new URLSearchParams(path.split('?')[1]).get('runs')?.split(',').filter(id=>/^[a-zA-Z0-9._-]+$/.test(id)).slice(0,2):undefined;
  return <div className="app-shell"><Sidebar path={path}/><div className="app-body"><Header detail={!!id} compare={!!compare}/>{error?<main className="main"><Empty><h2>需要重新建立本机会话</h2><p role="alert">{error}</p><p>在聊天中调用 dashboard_open，或运行 webpilot dashboard open。</p></Empty></main>:!ready?<main className="main"><Empty>正在连接测试中心…</Empty></main>:compare?<main className="compare-main"><div className="compare-heading"><Link to="/" className="back-link">← 所有测试</Link><span>并排观看 · 两路独立运行</span></div><div className="compare-grid">{compare.map(id=><Detail id={id} compact key={id}/>)}</div></main>:id?<main className="main detail-main"><Detail id={id} key={id}/></main>:<Overview path={path}/>}<footer className="footer"><span>WebPilot</span><span>本地执行，安心回看。</span></footer></div></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

import React,{useEffect,useRef,useState} from 'react';
import type {publicRun} from '../../src/dashboard/projection';

type Run=ReturnType<typeof publicRun>;
type Action='archive'|'restore'|'delete';
type Result={id:string;status:string;error?:string};
export function useManagement(onComplete?:(results:Result[])=>void){
  const [renaming,setRenaming]=useState<Run>();
  const [pending,setPending]=useState<Run[]>(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[errors,setErrors]=useState<string[]>([]),[undo,setUndo]=useState<string[]>([]);
  const submitting=useRef(false);
  const [cleanup,setCleanup]=useState<string[]>([]);
  const saveTitle=async(title:string)=>{
    if(!renaming||submitting.current)return;submitting.current=true;setBusy(true);
    try{
      const response=await fetch(`/api/runs/${renaming.id}/title`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'名称保存失败，请重试');
      setMessage('名称已更新');setUndo([]);setErrors([]);setRenaming(undefined);
      dispatchEvent(new CustomEvent('run-management',{detail:{action:'rename',results:[result]}}));
    }finally{submitting.current=false;setBusy(false);}
  };
  const execute=async(action:Action,ids:string[])=>{
    if(submitting.current)return;submitting.current=true;setBusy(true);setErrors([]);setUndo([]);setCleanup([]);
    try{
      const single=ids.length===1;
      const response=await fetch(single?`/api/runs/${ids[0]}${action==='delete'?'':`/${action}`}`:'/api/runs/manage',{method:single&&action==='delete'?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(single?{...(action==='delete'?{confirmPermanent:true}:{})}:{action,ids,...(action==='delete'?{confirmPermanent:true}:{})})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??'操作失败');
      const results:Result[]=data.results,successful=results.filter(r=>['archived','restored','deleted'].includes(r.status));
      setMessage(successful.length?`${successful.length} 条运行${action==='archive'?'已归档，永久保存':action==='restore'?'已恢复，仍永久保存':'已永久删除'}`:'操作未完成');
      setErrors(results.filter(r=>!successful.includes(r)).map(r=>`${ids.length>1?`${r.id}：`:''}${r.error??'操作失败，请重试'}`));
      if(action==='archive')setUndo(successful.map(r=>r.id));
      if(action==='delete')setCleanup(results.filter(r=>r.status==='cleanup_pending').map(r=>r.id));
      onComplete?.(results);dispatchEvent(new CustomEvent('run-management',{detail:{action,results}}));setPending(undefined);
    }catch(e){setErrors([e instanceof Error?e.message:'操作失败']);}finally{submitting.current=false;setBusy(false);}
  };
  const act=(action:Action,runs:Run[])=>{if(!runs.length||submitting.current)return;if(action==='delete'){setPending([...runs]);return;}void execute(action,runs.map(r=>r.id));};
  const notices=<>{message&&<div className="notice management-notice" role="status">{message}{undo.length>0&&<button className="text-button" disabled={busy} onClick={()=>void execute('restore',undo)}>撤销</button>}<button className="text-button" aria-label="关闭提示" onClick={()=>{setMessage('');setUndo([]);}}>×</button></div>}{errors.length>0&&<div className="notice error" role="alert">{errors.map((error,i)=><p key={i}>{error}</p>)}{cleanup.length>0&&<button className="text-button" disabled={busy} onClick={()=>void execute('delete',cleanup)}>重试清理</button>}</div>}{pending&&<DeleteDialog runs={pending} busy={busy} onCancel={()=>{if(!submitting.current)setPending(undefined);}} onConfirm={()=>void execute('delete',pending.map(r=>r.id))}/>}</>;
  return {act,busy,notices:<>{notices}{renaming&&<RenameDialog run={renaming} busy={busy} onCancel={()=>{if(!submitting.current)setRenaming(undefined);}} onSave={saveTitle}/>}</>,rename:(run:Run)=>{if(!submitting.current)setRenaming(run);},retryDelete:(id:string)=>void execute('delete',[id])};
}
export function ManagementMenu({run,manager}:{run:Run;manager:ReturnType<typeof useManagement>}){
  const allowed=run.management?.allowed===true;
  return <details className="management-menu" onMouseLeave={e=>{e.currentTarget.open=false;}}><summary aria-label={`管理运行 ${run.meta.title}`} title="管理运行">⋯</summary><div className="management-menu-items"><button disabled={manager.busy} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');manager.rename(run);}}>重命名</button><button disabled={!allowed||manager.busy} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');manager.act(run.management?.archivedAt?'restore':'archive',[run]);}}>{run.management?.archivedAt?'恢复到当前记录':'归档并永久保存'}</button><button className="danger-text" disabled={!allowed||manager.busy} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');manager.act('delete',[run]);}}>删除…</button>{!allowed&&<small>{run.management?.reason??'运行尚未结束'}</small>}</div></details>;
}
function RenameDialog({run,busy,onCancel,onSave}:{run:Run;busy:boolean;onCancel:()=>void;onSave:(title:string)=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
  const [title,setTitle]=useState(run.meta.title),[error,setError]=useState('');const value=title.trim();
  const invalid=!value?'请输入标题':value.length>120?'标题最多 120 个字符':/[\p{Cc}\p{Cf}]/u.test(value)?'标题不能包含控制字符':'';
  useEffect(()=>{const element=dialog.current!;element.showModal();input.current?.focus();input.current?.select();return ()=>element.close();},[]);
  return <dialog ref={dialog} className="delete-dialog rename-dialog" aria-labelledby="rename-title" onCancel={e=>{e.preventDefault();onCancel();}}><form onSubmit={e=>{e.preventDefault();if(!busy&&!invalid)void onSave(value).catch(e=>setError(e instanceof Error?e.message:'名称保存失败，请重试'));}}><div className="dialog-heading"><h2 id="rename-title">重命名运行</h2><button type="button" className="text-button" aria-label="关闭重命名弹窗" disabled={busy} onClick={onCancel}>×</button></div><label className="rename-label" htmlFor="run-title-input">运行标题</label><input ref={input} id="run-title-input" value={title} maxLength={120} disabled={busy} aria-invalid={!!invalid} aria-describedby="rename-description" onChange={e=>{setTitle(e.target.value);setError('');}}/><p id="rename-description">{invalid||`${value.length} / 120 · 仅修改显示名称，执行记录与证据保留。`}</p>{error&&<p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="button" disabled={busy||!!invalid}>{busy?'正在保存…':'保存名称'}</button></div></form></dialog>;
}
function DeleteDialog({runs,busy,onCancel,onConfirm}:{runs:Run[];busy:boolean;onCancel:()=>void;onConfirm:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const element=dialog.current!;element.showModal();cancel.current?.focus();return ()=>element.close();},[]);
  return <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={e=>{e.preventDefault();onCancel();}}><div className="dialog-heading"><h2 id="delete-title">{runs.length===1?'删除这次运行？':`永久删除 ${runs.length} 条运行？`}</h2><button className="text-button" aria-label="关闭删除弹窗" disabled={busy} onClick={onCancel}>×</button></div><ul className="delete-titles">{runs.map(run=><li key={run.id}>{run.meta.title}</li>)}</ul><p id="delete-description">将永久删除本次报告、截图、录像和执行记录。已保存的回归用例保留。此操作无法恢复。</p><div className="dialog-actions"><button ref={cancel} className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy?'正在删除…':'永久删除'}</button></div></dialog>;
}

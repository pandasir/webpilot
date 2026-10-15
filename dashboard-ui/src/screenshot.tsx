import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function Screenshot({src,alt,className='',loading}:{src:string;alt:string;className?:string;loading?:'lazy'|'eager'}){
  const trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  return <><button ref={trigger} type="button" className={`screenshot-trigger ${className}`} aria-label={`放大查看 ${alt}`} title="点击放大查看" onClick={()=>setOpen(true)}><img src={src} alt={alt} loading={loading}/></button>{open&&createPortal(<ScreenshotPreview src={src} alt={alt} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}/>,document.body)}</>;
}

function ScreenshotPreview({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),stage=useRef<HTMLDivElement>(null);
  const [original,setOriginal]=useState(false),[failed,setFailed]=useState(false);
  const close=()=>{dialog.current?.close();onClose();};
  useEffect(()=>{
    const element=dialog.current!,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';element.showModal();
    return ()=>{element.close();document.body.style.overflow=overflow;};
  },[]);
  return <dialog ref={dialog} className="screenshot-preview" aria-label="截图预览" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="screenshot-preview-content">
      <header className="screenshot-preview-toolbar"><span title={alt}>{alt}</span><div><button type="button" className="button secondary" aria-pressed={original} onClick={()=>{setOriginal(value=>!value);stage.current?.scrollTo(0,0);}}>{original?'适应窗口':'原始尺寸'}</button><a className="button secondary" href={src} target="_blank" rel="noreferrer">打开原图 ↗</a><button type="button" className="button secondary" aria-label="关闭截图预览" onClick={close}>关闭 ×</button></div></header>
      <div ref={stage} className={`screenshot-preview-stage ${original?'original':''}`} tabIndex={0} aria-label="截图画布，可滚动查看原图">{failed?<p role="alert">截图加载失败，请尝试打开原图或刷新后重试。</p>:<img src={src} alt={alt} onError={()=>setFailed(true)}/>}</div>
    </div>
  </dialog>;
}

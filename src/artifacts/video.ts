import {relative} from 'node:path';
import type {Recording} from '../core/schema.js';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function recordingPlayer(title:string,root:string,groups:{title:string;recordings:Recording[]}[]){
  const sections=groups.map(group=>`<section><h2>${escapeHtml(group.title)}</h2>${group.recordings.length?group.recordings.map(recording=>{
    if(recording.status==='omitted')return `<p>录像证据缺口：${escapeHtml(recording.reason)}</p>`;
    const src=relative(root,recording.path).split(/[\\/]/).map(encodeURIComponent).join('/');
    return `<article><h3>页面：${escapeHtml(recording.pageName)}（${escapeHtml(recording.pageId)}）</h3><video controls preload="metadata" src="${escapeHtml(src)}"></video><p><a href="${escapeHtml(src)}">打开 WebM 录像</a></p></article>`;
  }).join(''):'<p>没有可用录像（未启动浏览器或录像已关闭）。</p>'}</section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;background:#f5f6f8;color:#202632}section{background:white;padding:24px;margin:24px 0;border-radius:12px}video{display:block;width:100%;max-height:720px;background:#111}a{color:#245bd5}h3{font-size:16px}</style></head><body><h1>${escapeHtml(title)}</h1><p>本地流程录像：可播放、暂停和拖动进度。多页面分别录制，重试分别保留。</p><p>录像未经脱敏，可能包含页面敏感信息；按运行保留期清理。</p>${sections}</body></html>`;
}

import {z} from 'zod';

export const DEFAULT_EXPLORATION_TITLE='浏览器探索会话';
export const TitleSchema=z.string().trim().min(1,'请输入标题').max(120,'标题最多 120 个字符').refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'标题不能包含控制字符');
export const TitleRecordSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative(),title:TitleSchema}).strict();
export function explorationTitle(target:{projectPath?:string;url?:string}){
  const project=target.projectPath?.split(/[\\/]/).filter(Boolean).at(-1);
  let host:string|undefined;try{const url=new URL(target.url??'');if(['http:','https:'].includes(url.protocol))host=url.host;}catch{}
  const name=project??host;
  return name?TitleSchema.parse(`${name.slice(0,100)} · 浏览器探索`):DEFAULT_EXPLORATION_TITLE;
}

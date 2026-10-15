import type {Outcome} from '../core/errors.js';
import type {Evidence,StepResult} from '../core/schema.js';

export const outcomeLabels:Record<Outcome,string>={
  passed:'通过',failed:'失败',blocked:'受阻',inconclusive:'无法确定'
};
export const evidenceLabels:Record<Evidence['type'],string>={
  snapshot:'页面快照',screenshot:'截图',console:'控制台记录',network:'网络记录',omitted:'证据未采集'
};
const operationLabels:Record<string,string>={
  navigate:'页面导航',click:'点击',fill:'输入',select:'选择选项',check:'勾选状态',press:'按键',
  scroll:'滚动',frame:'切换内嵌页面',openPage:'打开新页面',switchPage:'切换页面',upload:'上传文件',
  download:'检查下载',expectVisible:'检查可见性',expectText:'检查文本',expectURL:'检查地址',
  expectCount:'检查数量',expectValue:'检查输入值',expectEnabled:'检查启用状态',unsupported:'不支持的交互'
};
const diagnosticLabels:Record<string,string>={
  ASSERTION_FAILED:'实际结果不满足预期断言。',INTERACTION_FAILED:'页面交互未能完成。',
  LOCATOR_AMBIGUOUS:'定位匹配多个元素，需要缩小定位范围。',
  CAPABILITY_UNAVAILABLE:'当前运行器不支持所需交互。',
  BUDGET_EXHAUSTED:'执行预算已耗尽，剩余内容未验证。',CANCELLED:'运行已取消，剩余内容未验证。',
  AUTH_INVALID:'登录态或身份验证失败。',AUTH_MISSING:'缺少可用登录态或登录流程。',
  AUTH_VERIFICATION_MISSING:'缺少正式的登录状态检查。',ROLE_MISSING:'所需角色未配置。',
  MISSING_REFERENCE:'缺少必要的运行参数引用。',PRECONDITION_MISSING:'缺少必要的前置条件。',
  FILE_MISSING:'测试文件不可用。',SOURCE_CONFLICT:'断言依据存在未解决的冲突。',
  TARGET_OUT_OF_SCOPE:'页面导航超出本次测试允许的来源范围。',
  SESSION_EXPIRED:'浏览器会话已关闭或失效。',PAGE_MISSING:'指定页面不可用。',
  DOWNLOAD_FAILED:'下载未成功完成。',MASK_UNAVAILABLE:'无法定位敏感区域，已省略截图。',
  COMMAND_FAILED:'环境或数据准备命令执行失败。',COMMAND_TIMEOUT:'环境或数据准备命令超时。',
  SERVICE_UNAVAILABLE:'目标服务尚未就绪，且未提供可用启动方式。',
  STARTUP_FAILED:'目标服务启动失败。',STARTUP_TIMEOUT:'目标服务未在时限内就绪。',
  TARGET_AMBIGUOUS:'无法唯一确定测试目标，需要选择应用或提供地址。',
  BROWSER_CLEANUP_FAILED:'浏览器资源清理失败。',INTERNAL_ERROR:'运行器发生内部错误。',
  INVALID_INPUT:'输入参数或结构版本无效。'
};
const knownText:Record<string,string>={
  'Source and Git impact analysis unavailable for URL-only target.':'仅提供网址，无法分析源码及 Git 改动影响。',
  'Source, routes and Git analysis unavailable.':'源码、路由及 Git 分析不可用。',
  'Git revision/diff unavailable.':'无法获取 Git 版本及差异。',
  'Select an application/startup candidate, or supply an explicit URL.':'请选择应用或启动候选，或提供明确的网址。',
  'Provide a URL and startup command, or a staticDir.':'请提供网址和启动命令，或指定静态文件目录。',
  'No formal business assertions. Candidate checks do not establish acceptance.':'没有正式业务断言，候选检查不能证明验收通过。'
};

export function operationLabel(op:string){return operationLabels[op] ?? '未知操作';}
export function diagnosticLabel(code:string){return diagnosticLabels[code] ?? '执行未能完成，请查看原始诊断。';}
export function reportText(text:string):string{
  if(knownText[text])return knownText[text];
  if(text.startsWith('Snapshot unavailable: '))return `页面快照不可用：${reportText(text.slice(22))}`;
  if(text.startsWith('Screenshot unavailable: '))return `截图不可用：${reportText(text.slice(24))}`;
  return text;
}
export function attemptReason(reason:string,steps:StepResult[]){
  const failed=steps.find(step=>step.outcome!=='passed');
  if(failed?.error)return `步骤 ${failed.id}：${diagnosticLabel(failed.error.code)}`;
  const localized=reportText(reason);
  return /[\u4e00-\u9fff]/.test(localized)?localized:'本次尝试未能完成，原因见原始诊断。';
}

import {readFileSync} from 'node:fs';

const identifier='(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const semver=new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const releaseUrl=new URL('./release.json',import.meta.url);

export function readBuildVersion(url:URL=releaseUrl):string {
  try{
    const metadata=JSON.parse(readFileSync(url,'utf8'));
    if(metadata?.schemaVersion!==1||typeof metadata.version!=='string'||metadata.version.trim()!==metadata.version||!semver.test(metadata.version))throw new Error('Invalid release metadata');
    return metadata.version;
  }catch(error){throw new Error(`WebPilot build version metadata is missing or invalid (${url.pathname}). Run npm run build or reinstall a complete WebPilot package.`,{cause:error});}
}

// Capture once per process. The outer package and working directory may belong
// to a standalone exported test package rather than to WebPilot.
export const VERSION=readBuildVersion();
export function assertVersionSnapshot(){
  if(readBuildVersion()!==VERSION)throw new Error('WebPilot build version changed while this executor was running. Rebuild/reinstall and restart before exporting.');
}

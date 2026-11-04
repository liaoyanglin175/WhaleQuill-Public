import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPublicService} from '../server/publications.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const launch=(file,args,env=process.env)=>spawn(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
const origin=process.env.E2E_ORIGIN??'http://127.0.0.1:1422';
const ready=async()=>{try{return (await fetch(origin,{signal:AbortSignal.timeout(750)})).ok;}catch{return false;}};
let preview,community,runner;
const stop=()=>{runner?.kill();preview?.kill();community?.close();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
  if(await ready())throw Error('The isolated test port is occupied; choose E2E_ORIGIN.');
  community=createPublicService({databasePath:`.native-smoke/community-${randomUUID()}/publications.db`,allowedOrigins:[origin]});
  await new Promise((resolve,reject)=>{community.once('error',reject);community.listen(0,'127.0.0.1',resolve);});
  const serviceUrl=`http://127.0.0.1:${community.address().port}`;
  const environment={...process.env,E2E_ORIGIN:origin,E2E_MANAGED_PREVIEW:'1',TEST_PUBLIC_SERVICE_URL:serviceUrl,VITE_PUBLIC_SERVICE_URL:serviceUrl};
  {
    preview=launch('node_modules/vite/bin/vite.js',['--host','127.0.0.1','--port',new URL(origin).port,'--strictPort'],environment);
    const deadline=Date.now()+30_000;
    while(!await ready()){
      if(preview.exitCode!==null)throw Error('Preview exited before becoming ready.');
      if(Date.now()>deadline)throw Error('Preview did not become ready.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  runner=launch('node_modules/@playwright/test/cli.js',['test',...process.argv.slice(2)],environment);
  const [code]=await once(runner,'exit');process.exitCode=code??1;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  // A direct child can be stopped through its owned handle on Windows; avoid npm shell trees.
  if(preview&&preview.exitCode===null){const closed=once(preview,'exit');preview.kill();await closed;}
  if(community?.listening)await new Promise(resolve=>community.close(resolve));
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}

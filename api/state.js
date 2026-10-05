const GMAIL_ACCOUNT=process.env.COMPOSIO_GMAIL_ACCOUNT_ID||'gmail_atlas-mare';
const DRIVE_ACCOUNT=process.env.COMPOSIO_DRIVE_ACCOUNT_ID||'googledrive_viola-waco';
const KEY=process.env.COMPOSIO_API_KEY;
const BASE='https://backend.composio.dev/api/v3.1/tools/execute/';
const ACCOUNTS='https://backend.composio.dev/api/v3.1/connected_accounts';
const userCache=new Map();

function asError(value,fallback){
  if(typeof value==='string') return value;
  if(value&&typeof value==='object'){
    const m=value.message||value.error||value.code;
    if(typeof m==='string') return m;
    try{return JSON.stringify(value)}catch{}
  }
  return fallback;
}

async function getUserId(account){
  if(userCache.has(account)) return userCache.get(account);
  const url=ACCOUNTS+'?limit=100';
  const r=await fetch(url,{headers:{'x-api-key':KEY,'accept':'application/json'}});
  const raw=await r.text();
  let j={};
  try{j=raw?JSON.parse(raw):{}}catch{j={message:raw||'Réponse non JSON'};}
  if(!r.ok) throw new Error(asError(j.error||j,'Composio connected accounts HTTP '+r.status));
  const item=(j.items||[]).find(x=>x&&x.id===account);
  if(!item?.user_id) throw new Error('Composio connected account: user_id introuvable');
  userCache.set(account,item.user_id);
  return item.user_id;
}

async function run(slug,account,arguments_){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const user_id=await getUserId(account);
    const r=await fetch(BASE+slug,{
      method:'POST',
      headers:{'x-api-key':KEY,'accept':'application/json','content-type':'application/json'},
      body:JSON.stringify({connected_account_id:account,user_id,version:'latest',arguments:arguments_}),
      signal:controller.signal
    });
    const raw=await r.text();
    let j={};
    try{j=raw?JSON.parse(raw):{}}catch{j={message:raw||'Réponse non JSON'};}
    if(!r.ok||j.success===false) throw new Error(asError(j.error||j.errors||j.message,'Composio HTTP '+r.status));
    return j.data?.data??j.data??j;
  }catch(e){
    if(e?.name==='AbortError') throw new Error('Composio a dépassé le délai de 20 s');
    throw e;
  }finally{clearTimeout(timer)}
}

function unwrap(x){return x?.data?.data??x?.data??x??{}}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  if(!KEY) return res.status(503).json({configured:false,error:'COMPOSIO_API_KEY is not configured'});
  const out={configured:true,unread:null,drive:null,calendar:0,mails:[],driveFiles:[],updatedAt:new Date().toISOString(),errors:{}};
  try{
    const mail=await run('GMAIL_FETCH_EMAILS',GMAIL_ACCOUNT,{user_id:'me',query:'in:inbox',max_results:8,include_payload:false,verbose:false});
    const messages=unwrap(mail).messages||[];
    out.unread=messages.filter(m=>(m.labelIds||[]).includes('UNREAD')).length;
    out.mails=messages.slice().sort((a,b)=>Number(b.messageTimestamp||b.internalDate||b.messageTimestampMs||0)-Number(a.messageTimestamp||a.internalDate||a.messageTimestampMs||0)).slice(0,6).map(m=>({subject:m.subject||m.preview?.subject||'(Sans objet)',from:m.sender||m.from||'',label:(m.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL'}));
  }catch(e){out.errors.gmail=asError(e,'Erreur Gmail')}
  try{
    const drive=await run('GOOGLEDRIVE_FIND_FILE',DRIVE_ACCOUNT,{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:8,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'});
    const files=unwrap(drive).files||[];
    out.drive=files.length;
    out.driveFiles=files.slice(0,6).map(f=>({name:f.name,modified:f.modifiedTime||'',url:f.webViewLink||f.display_url||''}));
  }catch(e){out.errors.drive=asError(e,'Erreur Drive')}
  const failed=Object.keys(out.errors).length;
  if(failed===2) return res.status(502).setHeader('Cache-Control','no-store').json({...out,error:'Les connexions externes sont indisponibles.',status:'integration_error'});
  out.status=failed?'partial':'ok';
  return res.status(200).setHeader('Cache-Control','no-store').json(out);
}

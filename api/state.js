const GMAIL_ACCOUNT=process.env.COMPOSIO_GMAIL_ACCOUNT_ID||'gmail_atlas-mare';
const DRIVE_ACCOUNT=process.env.COMPOSIO_DRIVE_ACCOUNT_ID||'googledrive_viola-waco';
const KEY=process.env.COMPOSIO_API_KEY;
const BASE='https://backend.composio.dev/api/v3.1/tools/execute/';

function asError(value,fallback){
  if(typeof value==='string') return value;
  if(value && typeof value==='object'){
    try{return JSON.stringify(value)}catch{}
  }
  return fallback;
}
async function run(slug,account,arguments_){
  const r=await fetch(BASE+slug,{
    method:'POST',
    headers:{'x-api-key':KEY,'content-type':'application/json'},
    body:JSON.stringify({connected_account_id:account,version:'latest',arguments:arguments_})
  });
  const j=await r.json();
  if(!r.ok || j.success===false){
    throw new Error(asError(j.error||j.errors||j.message,'Composio HTTP '+r.status));
  }
  return j.data?.data ?? j.data ?? j;
}
function unwrap(x){return x?.data?.data ?? x?.data ?? x ?? {}}

export default async function handler(req,res){
 if(req.method!=='GET') return res.status(405).json({error:'GET only'});
 if(!KEY) return res.status(503).json({configured:false,error:'COMPOSIO_API_KEY is not configured'});
 try{
  const [mail,drive]=await Promise.all([
   run('GMAIL_FETCH_EMAILS',GMAIL_ACCOUNT,{user_id:'me',query:'in:inbox',max_results:8,include_payload:false,verbose:false}),
   run('GOOGLEDRIVE_FIND_FILE',DRIVE_ACCOUNT,{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:8,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'})
  ]);
  const messages=unwrap(mail).messages||[];
  const files=unwrap(drive).files||[];
  const unread=messages.filter(m=>(m.labelIds||m.labelIds||[]).includes('UNREAD')).length;
  const rows=messages.slice().sort((a,b)=>Number(b.messageTimestamp||b.internalDate||0)-Number(a.messageTimestamp||a.internalDate||0)).slice(0,6).map(m=>({
    subject:m.subject||m.preview?.subject||'(Sans objet)',
    from:m.sender||m.from||'',
    label:(m.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL'
  }));
  return res.status(200).setHeader('Cache-Control','no-store').json({
    configured:true,unread,drive:files.length,calendar:0,mails:rows,
    driveFiles:files.slice(0,6).map(f=>({name:f.name,modified:f.modifiedTime||'',url:f.webViewLink||f.display_url||''})),
    updatedAt:new Date().toISOString()
  });
 }catch(e){
  return res.status(502).json({configured:true,error:asError(e?.message||e,'Erreur Composio')});
 }
}
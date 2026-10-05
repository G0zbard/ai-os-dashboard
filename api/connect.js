const KEY=process.env.COMPOSIO_API_KEY;
const APP_USER_ID=process.env.COMPOSIO_APP_USER_ID||'default';
const ACCOUNTS='https://backend.composio.dev/api/v3.1/connected_accounts';
const LINKS='https://backend.composio.dev/api/v3.1/connected_accounts/link';

const TOOLKIT_BY_PROVIDER={gmail:'gmail',drive:'googledrive'};

function err(value,fallback){
  if(typeof value==='string') return value;
  if(value&&typeof value==='object') return value.message||value.error||fallback;
  return fallback;
}

async function jsonFetch(url,options={}){
  const r=await fetch(url,{...options,headers:{'x-api-key':KEY,'accept':'application/json','content-type':'application/json',...(options.headers||{})}});
  const raw=await r.text();
  let j={};
  try{j=raw?JSON.parse(raw):{}}catch{j={message:raw||'Réponse non JSON'};}
  if(!r.ok) throw new Error(err(j.error||j,'Composio HTTP '+r.status));
  return j;
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  if(!KEY) return res.status(503).json({configured:false,error:'COMPOSIO_API_KEY is not configured'});
  const provider=String(req.query?.provider||'').toLowerCase();
  const toolkit=TOOLKIT_BY_PROVIDER[provider];
  if(!toolkit) return res.status(400).json({error:'provider doit être gmail ou drive'});

  try{
    const accounts=await jsonFetch(ACCOUNTS+'?limit=100');
    const existing=(accounts.items||[]).find(a=>a?.toolkit?.slug===toolkit&&a?.auth_config?.id);
    if(!existing?.auth_config?.id) throw new Error('Auth config introuvable pour '+toolkit);
    const link=await jsonFetch(LINKS,{method:'POST',body:JSON.stringify({
      auth_config_id:existing.auth_config.id,
      user_id:APP_USER_ID,
      alias:'ai-os-'+provider
    })});
    return res.status(200).json({provider,user_id:APP_USER_ID,redirect_url:link.redirect_url,connected_account_id:link.connected_account_id,expires_at:link.expires_at});
  }catch(e){
    return res.status(502).json({error:err(e,'Impossible de créer le lien Composio')});
  }
}

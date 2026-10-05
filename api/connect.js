const KEY=process.env.COMPOSIO_API_KEY;
const APP_USER_ID=process.env.COMPOSIO_APP_USER_ID||'default';
const AUTH_CONFIGS='https://backend.composio.dev/api/v3.1/auth_configs';
const LINKS='https://backend.composio.dev/api/v3.1/connected_accounts/link';
const TOOLKIT_BY_PROVIDER={gmail:'gmail',drive:'googledrive',calendar:'googlecalendar',tasks:'googletasks'};

function err(value,fallback){
  if(typeof value==='string') return value;
  if(value&&typeof value==='object') return value.message||value.error||fallback;
  return fallback;
}
async function jsonFetch(url,options={}){
  const r=await fetch(url,{...options,headers:{'x-api-key':KEY,'accept':'application/json','content-type':'application/json',...(options.headers||{})}});
  const raw=await r.text();
  let j={}; try{j=raw?JSON.parse(raw):{}}catch{j={message:raw||'Réponse non JSON'};}
  if(!r.ok) throw new Error(err(j.error||j,'Composio HTTP '+r.status));
  return j;
}
async function getOrCreateAuthConfig(toolkit){
  const configs=await jsonFetch(AUTH_CONFIGS+'?toolkit='+encodeURIComponent(toolkit)+'&show_disabled=false&limit=200');
  const existing=(configs.items||[]).find(a=>a?.id&&a?.status!=='DISABLED');
  if(existing?.id) return existing.id;
  const created=await jsonFetch(AUTH_CONFIGS,{method:'POST',body:JSON.stringify({toolkit:{slug:toolkit},auth_config:{type:'use_composio_managed_auth',credentials:{},restrict_to_following_tools:[]}})});
  return created?.auth_config?.id||created?.id;
}
export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  if(!KEY) return res.status(503).json({configured:false,error:'COMPOSIO_API_KEY is not configured'});
  const provider=String(req.query?.provider||'').toLowerCase();
  const toolkit=TOOLKIT_BY_PROVIDER[provider];
  if(!toolkit) return res.status(400).json({error:'provider invalide'});
  try{
    const authConfigId=await getOrCreateAuthConfig(toolkit);
    const alias='ai-os-'+provider+'-'+Date.now().toString(36);
    const link=await jsonFetch(LINKS,{method:'POST',body:JSON.stringify({auth_config_id:authConfigId,user_id:APP_USER_ID,alias})});
    return res.status(200).json({provider,user_id:APP_USER_ID,redirect_url:link.redirect_url,connected_account_id:link.connected_account_id,expires_at:link.expires_at});
  }catch(e){return res.status(502).json({error:err(e,'Impossible de créer le lien Composio')})}
}

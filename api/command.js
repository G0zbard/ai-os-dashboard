const GMAIL_ACCOUNT=process.env.COMPOSIO_GMAIL_ACCOUNT_ID||'gmail_atlas-mare';
const DRIVE_ACCOUNT=process.env.COMPOSIO_DRIVE_ACCOUNT_ID||'googledrive_viola-waco';
const KEY=process.env.COMPOSIO_API_KEY;
const BASE='https://backend.composio.dev/api/v3.1/tools/execute/';

async function run(slug,account,args){
  const r=await fetch(BASE+slug,{method:'POST',headers:{'x-api-key':KEY,'content-type':'application/json'},body:JSON.stringify({connected_account_id:account,arguments:args})});
  const j=await r.json();
  if(!r.ok||j.success===false) throw new Error(j.error||('Composio '+r.status));
  return j.data?.data||j.data||j;
}
const unwrap=x=>x?.data?.data||x?.data||x||{};
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST uniquement'});
  if(!KEY) return res.status(503).json({error:'COMPOSIO_API_KEY non configurée'});
  let body={};try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{}}catch{return res.status(400).json({error:'JSON invalide'})}
  const command=String(body.command||'').trim();
  if(!command) return res.status(400).json({error:'Commande vide'});
  const q=norm(command);
  try{
    if(q.includes('aide')||q==='help'){
      return res.status(200).json({message:'Je peux exécuter : « résume mes mails », « mes mails non lus », « cherche facture dans mes mails », « montre mes fichiers récents » et « synchronise ».',data:{}});
    }
    if(q.includes('synchron')){
      const [m,d]=await Promise.all([
        run('GMAIL_FETCH_EMAILS',GMAIL_ACCOUNT,{user_id:'me',query:'in:inbox',max_results:8,include_payload:false,verbose:false}),
        run('GOOGLEDRIVE_FIND_FILE',DRIVE_ACCOUNT,{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:8,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'})
      ]);
      const md=unwrap(m),dd=unwrap(d),msgs=md.messages||[],files=dd.files||[];
      const unread=msgs.filter(x=>(x.labelIds||x.labelIds||[]).includes('UNREAD')).length;
      return res.status(200).json({message:'Synchronisation terminée : '+unread+' mail(s) non lu(s) et '+files.length+' fichier(s) récent(s).',data:{unread,driveCount:files.length,mails:msgs.slice(0,6).map(x=>({subject:x.subject||'(Sans objet)',from:x.from||'',label:(x.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL'})),files:files.slice(0,6).map(x=>({name:x.name,modified:x.modifiedTime,url:x.webViewLink||''}))}});
    }
    if(q.includes('fichier')||q.includes('drive')){
      const d=await run('GOOGLEDRIVE_FIND_FILE',DRIVE_ACCOUNT,{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:8,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'});
      const files=unwrap(d).files||[];
      return res.status(200).json({message:files.length+' fichier(s) récent(s) trouvé(s) dans Drive.',data:{driveCount:files.length,files:files.map(x=>({name:x.name,modified:x.modifiedTime,url:x.webViewLink||''}))}});
    }
    if(q.includes('mail')||q.includes('email')||q.includes('gmail')){
      let query='in:inbox';
      const m=command.match(/(?:cherche|recherche|contenant|avec)\s+(.+)/i);
      if(m&&m[1]) query+=' '+m[1].replace(/^les\s+/i,'').trim();
      if(q.includes('non lu')||q.includes('non-lu')) query+=' is:unread';
      const d=await run('GMAIL_FETCH_EMAILS',GMAIL_ACCOUNT,{user_id:'me',query,max_results:8,include_payload:false,verbose:false});
      const msgs=unwrap(d).messages||[];
      const rows=msgs.map(x=>({subject:x.subject||'(Sans objet)',from:x.from||'',label:(x.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL'}));
      const unread=rows.filter(x=>x.label==='NON LU').length;
      const label=q.includes('non lu')?'non lu(s)':'récent(s)';
      return res.status(200).json({message:'J’ai trouvé '+rows.length+' mail(s) '+label+', dont '+unread+' non lu(s).',data:{unread,mails:rows}});
    }
    return res.status(200).json({message:'Commande comprise partiellement. Essaie : « résume mes mails », « montre mes fichiers », « cherche facture dans mes mails » ou « synchronise ».',data:{}});
  }catch(e){return res.status(502).json({error:String(e.message||e)})}
}

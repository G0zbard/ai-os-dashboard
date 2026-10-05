const APP_USER_ID=process.env.COMPOSIO_APP_USER_ID||'default';
const KEY=process.env.COMPOSIO_API_KEY;
const BASE='https://backend.composio.dev/api/v3.1/tools/execute/';
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const escText=s=>String(s??'').replace(/\s+/g,' ').trim();

function errText(value,fallback){
  if(typeof value==='string') return value;
  if(value&&typeof value==='object'){
    const m=value.message||value.error||value.code;
    if(typeof m==='string') return m;
    try{return JSON.stringify(value)}catch{}
  }
  return fallback;
}
function unwrap(x){return x?.data?.data??x?.data??x??{}}
function fmtDate(v){
  if(!v) return '';
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
async function run(slug,args){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch(BASE+slug,{
      method:'POST',
      headers:{'x-api-key':KEY,'accept':'application/json','content-type':'application/json'},
      body:JSON.stringify({user_id:APP_USER_ID,version:'latest',arguments:args}),
      signal:controller.signal
    });
    const raw=await r.text();
    let j={};
    try{j=raw?JSON.parse(raw):{}}catch{j={message:raw||'Réponse non JSON'};}
    if(!r.ok||j.success===false) throw new Error(errText(j.error||j.errors||j.message,'Composio HTTP '+r.status));
    return j.data?.data??j.data??j;
  }catch(e){
    if(e?.name==='AbortError') throw new Error('Composio a dépassé 20 secondes');
    throw e;
  }finally{clearTimeout(timer)}
}
async function connectInfo(provider){
  return {provider,connectProvider:provider,connectLabel:'Connecter '+({drive:'Google Drive',calendar:'Google Calendar',tasks:'Google Tasks',gmail:'Gmail'}[provider]||provider)};
}
function topMessages(messages){
  return (messages||[]).slice(0,6).map(m=>({
    subject:m.subject||m.preview?.subject||'(Sans objet)',
    from:m.sender||m.from||'',
    label:(m.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL',
    preview:escText(m.snippet||m.preview?.text||m.messageText||m.body||'').slice(0,240)
  }));
}
function stripPrefix(command){
  return command
    .replace(/^\s*(ajoute|ajouter|cr[ée]e|planifie|programme|mets|met|bloque|reserve|réserve|reserves|calendrier|agenda)\s+(un|une|dans|pour|sur)?/i,'')
    .trim();
}
function taskTitle(command){
  return command
    .replace(/^\s*(ajoute|ajouter|cr[ée]e|creer|fais|fait|mets|met|rappelle[- ]moi de|t[âa]che)\s*/i,'')
    .replace(/^\s*(une|un)\s*/i,'')
    .trim()
    .replace(/[.!?]+$/,'');
}
function completeTarget(command){
  return command
    .replace(/^\s*(termine|finis|complete|compl[eè]te|marque|check)\s*/i,'')
    .replace(/^(la|le|les|ma|mon|mes)\s+(t[âa]che|taches?)\s*/i,'')
    .replace(/\s+(comme|en)\s+(terminee?|termine|faite?|fait)$/i,'')
    .trim();
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST uniquement'});
  if(!KEY) return res.status(503).json({error:'COMPOSIO_API_KEY non configurée'});
  let body={};
  try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{}}catch{return res.status(400).json({error:'JSON invalide'})}
  const command=String(body.command||'').trim();
  if(!command) return res.status(400).json({error:'Commande vide'});
  const q=norm(command);

  try{
    if(/^(aide|help|que peux-tu faire|commandes? disponibles)$/.test(q)){
      return res.status(200).json({message:'Je peux piloter Gmail, Drive, Agenda et Tâches : résumer ou chercher des mails, retrouver des fichiers, voir l’agenda, créer un rendez-vous, créer/terminer une tâche et faire un brief de journée.',data:{capabilities:true}});
    }

    if(q.includes('synchron')){
      const [m,d]=await Promise.all([
        run('GMAIL_FETCH_EMAILS',{user_id:'me',query:'in:inbox',max_results:8,include_payload:true,verbose:false}),
        run('GOOGLEDRIVE_FIND_FILE',{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:8,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'})
      ]);
      const msgs=unwrap(m).messages||[],files=unwrap(d).files||[];
      return res.status(200).json({
        message:'Synchronisation terminée : '+msgs.filter(x=>(x.labelIds||[]).includes('UNREAD')).length+' mail(s) non lu(s) et '+files.length+' fichier(s) récent(s).',
        data:{unread:msgs.filter(x=>(x.labelIds||[]).includes('UNREAD')).length,driveCount:files.length,mails:topMessages(msgs),files:files.map(f=>({name:f.name,modified:f.modifiedTime||'',url:f.webViewLink||''}))}
      });
    }

    if(/(brief|r[eé]sum[eé]|que dois-je faire|qu'est-ce que j'ai|quoi de prevu|journee|journ[eé]e)/.test(q) && !q.includes('mail')){
      const now=new Date(),week=new Date(now.getTime()+24*60*60*1000);
      const [t,c,m]=await Promise.all([
        run('GOOGLETASKS_LIST_ALL_TASKS',{showCompleted:false,max_tasks_total:12}),
        run('GOOGLECALENDAR_EVENTS_LIST',{calendarId:'primary',timeMin:now.toISOString(),timeMax:week.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:8,fields:'items(id,summary,start,end,htmlLink)'}),
        run('GMAIL_FETCH_EMAILS',{user_id:'me',query:'in:inbox is:unread',max_results:5,include_payload:true,verbose:false})
      ]);
      const tasks=unwrap(t).tasks||[],events=unwrap(c).items||[],mails=unwrap(m).messages||[];
      const lines=[];
      lines.push('Brief du jour');
      lines.push('• '+tasks.length+' tâche(s) en attente');
      if(tasks[0]) lines.push('  → '+tasks.slice(0,3).map(x=>x.title).join(' · '));
      lines.push('• '+events.length+' événement(s) dans les prochaines 24 h');
      if(events[0]) lines.push('  → '+events.slice(0,3).map(x=>fmtDate(x.start?.dateTime||x.start?.date)+' — '+(x.summary||'Sans titre')).join(' · '));
      lines.push('• '+mails.length+' mail(s) non lu(s) récent(s)');
      if(mails[0]) lines.push('  → '+mails.slice(0,3).map(x=>x.subject||'(Sans objet)').join(' · '));
      return res.status(200).json({message:lines.join('\n'),data:{tasks:tasks.map(x=>({id:x.id,title:x.title,due:x.due||'',listId:x.tasklist_id||'@default'})),events:events.map(x=>({id:x.id,title:x.summary||'Sans titre',start:x.start?.dateTime||x.start?.date||'',end:x.end?.dateTime||x.end?.date||'',url:x.htmlLink||''})),unread:mails.length}});
    }

    if(q.includes('mail')||q.includes('email')||q.includes('gmail')){
      let query='in:inbox';
      if(/non lu|non-lu|unread/.test(q)) query+=' is:unread';
      const search=command.match(/(?:cherche|recherche|trouve|contenant|avec)\s+(.+)/i);
      if(search?.[1] && !/non lu/i.test(search[1])) query+=' '+search[1].trim();
      const x=unwrap(await run('GMAIL_FETCH_EMAILS',{user_id:'me',query,max_results:8,include_payload:true,verbose:false}));
      const rows=topMessages(x.messages||[]);
      const unread=rows.filter(x=>x.label==='NON LU').length;
      const lead=/(resume|resum|r[eé]sum)/.test(q)?'Voici les points principaux de tes mails récents :':'Voici les mails correspondants :';
      const bullets=rows.slice(0,5).map(x=>'• '+x.subject+(x.preview?' — '+x.preview:'')); 
      return res.status(200).json({message:lead+'\n'+(bullets.join('\n')||'Aucun résultat.')+'\n\n'+unread+' non lu(s) dans cette sélection.',data:{unread,mails:rows}});
    }

    if(q.includes('drive')||q.includes('fichier')||q.includes('document')){
      const x=unwrap(await run('GOOGLEDRIVE_FIND_FILE',{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:10,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'}));
      const files=x.files||[];
      return res.status(200).json({message:'J’ai trouvé '+files.length+' fichier(s) récent(s) dans Drive.',data:{driveCount:files.length,files:files.map(f=>({id:f.id,name:f.name,modified:f.modifiedTime||'',url:f.webViewLink||''}))}});
    }

    if(/(agenda|calendrier|calendar|rdv|rendez-vous|evenement|évènement|evenements|réunion|reunion)/.test(q)){
      const create=/\b(ajoute|ajouter|cree|crée|planifie|programme|mets|met|bloque|reserve|réserve)\b/.test(q);
      if(create){
        const text=stripPrefix(command);
        const x=unwrap(await run('GOOGLECALENDAR_QUICK_ADD',{text,calendar_id:'primary',send_updates:'none'}));
        const e=x.event||x;
        return res.status(200).json({message:'Événement ajouté à ton agenda : '+(e.summary||text)+(e.start?.dateTime?' à '+fmtDate(e.start.dateTime):'.'),data:{createdEvent:{id:e.id||'',title:e.summary||text,start:e.start?.dateTime||e.start?.date||'',end:e.end?.dateTime||e.end?.date||'',url:e.htmlLink||''}}});
      }
      const now=new Date(),week=new Date(now.getTime()+7*24*60*60*1000);
      const x=unwrap(await run('GOOGLECALENDAR_EVENTS_LIST',{calendarId:'primary',timeMin:now.toISOString(),timeMax:week.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:12,fields:'items(id,summary,start,end,htmlLink,location,status)'}));
      const events=x.items||[];
      const rows=events.map(e=>({id:e.id,title:e.summary||'Sans titre',start:e.start?.dateTime||e.start?.date||'',end:e.end?.dateTime||e.end?.date||'',url:e.htmlLink||'',location:e.location||''}));
      return res.status(200).json({message:events.length?('Voici tes '+events.length+' prochains événements :\n'+events.slice(0,8).map(e=>'• '+fmtDate(e.start?.dateTime||e.start?.date)+' — '+(e.summary||'Sans titre')).join('\n')):'Aucun événement dans les 7 prochains jours.',data:{calendar:events.length,events:rows}});
    }

    if(/(t[âa]che|todo|to-do|a faire|à faire|rappel)/.test(q)){
      if(/(termine|finis|complete|compl[eè]te|marque)/.test(q)){
        const target=norm(completeTarget(command));
        const x=unwrap(await run('GOOGLETASKS_LIST_ALL_TASKS',{showCompleted:false,max_tasks_total:50}));
        const tasks=x.tasks||[];
        const match=tasks.find(t=>norm(t.title).includes(target)||target.includes(norm(t.title)));
        if(!match) return res.status(200).json({message:'Je ne trouve pas de tâche correspondant à « '+completeTarget(command)+' ».',data:{tasks:tasks.map(t=>({id:t.id,title:t.title,due:t.due||'',listId:t.tasklist_id||'@default'}))}});
        await run('GOOGLETASKS_PATCH_TASK',{tasklist_id:match.tasklist_id||'@default',task_id:match.id,status:'completed',completed:new Date().toISOString()});
        return res.status(200).json({message:'Tâche terminée : '+match.title,data:{completedTask:{id:match.id,title:match.title}}});
      }
      if(/(ajoute|ajouter|cr[ée]e|creer|rappelle|rappel)/.test(q)){
        const title=taskTitle(command);
        if(!title) return res.status(400).json({error:'Donne-moi le titre de la tâche.'});
        const x=unwrap(await run('GOOGLETASKS_INSERT_TASK',{tasklist_id:'@default',title,status:'needsAction'}));
        return res.status(200).json({message:'Tâche créée : '+(x.title||title),data:{createdTask:{id:x.id||'',title:x.title||title,due:x.due||'',listId:'@default'}}});
      }
      const x=unwrap(await run('GOOGLETASKS_LIST_ALL_TASKS',{showCompleted:false,max_tasks_total:30}));
      const tasks=x.tasks||[];
      return res.status(200).json({message:tasks.length?('Tu as '+tasks.length+' tâche(s) en cours.\n'+tasks.slice(0,12).map(t=>'• '+t.title+(t.due?' — échéance '+fmtDate(t.due):'')).join('\n')):'Aucune tâche en cours.',data:{tasks:tasks.map(t=>({id:t.id,title:t.title,due:t.due||'',notes:t.notes||'',listId:t.tasklist_id||'@default'}))}});
    }

    return res.status(200).json({message:'Je n’ai pas compris cette commande. Essaie « brief du jour », « résume mes mails », « agenda », « ajoute réunion demain 14h », « mes tâches » ou « ajoute une tâche réviser maths ».',data:{help:true}});
  }catch(e){
    const message=errText(e?.message||e,'Erreur Composio');
    const s=norm(message);
    let connectProvider=null;
    if(s.includes('googledrive')) connectProvider='drive';
    else if(s.includes('googlecalendar')) connectProvider='calendar';
    else if(s.includes('googletasks')) connectProvider='tasks';
    else if(s.includes('gmail')) connectProvider='gmail';
    return res.status(502).json({error:message,connectProvider});
  }
}

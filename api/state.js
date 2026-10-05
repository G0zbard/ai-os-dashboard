const APP_USER_ID=process.env.COMPOSIO_APP_USER_ID||'default';
const KEY=process.env.COMPOSIO_API_KEY;
const BASE='https://backend.composio.dev/api/v3.1/tools/execute/';
const TIMEZONE='Europe/Paris';

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

async function run(slug,args){
  if(!KEY) throw new Error('COMPOSIO_API_KEY non configurée');
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

function connectionKind(message){
  const s=String(message||'').toLowerCase();
  if(s.includes('connected account')||s.includes('no connected account')||s.includes('authorization')||s.includes('auth')) return 'connect';
  return 'error';
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const now=new Date();
  const week=new Date(now.getTime()+7*24*60*60*1000);
  const out={
    configured:!!KEY,
    updatedAt:now.toISOString(),
    timezone:TIMEZONE,
    unread:null,
    drive:null,
    calendar:null,
    tasks:null,
    mails:[],
    driveFiles:[],
    events:[],
    taskItems:[],
    errors:{},
    needsConnect:[]
  };
  if(!KEY) return res.status(503).json({...out,error:'COMPOSIO_API_KEY is not configured',status:'integration_error'});

  const jobs=[
    ['gmail',async()=>{
      const x=unwrap(await run('GMAIL_FETCH_EMAILS',{user_id:'me',query:'in:inbox',max_results:8,include_payload:true,verbose:false}));
      const messages=x.messages||[];
      out.unread=messages.filter(m=>(m.labelIds||[]).includes('UNREAD')).length;
      out.mails=messages.slice(0,8).map(m=>({
        id:m.id||m.messageId||'',
        subject:m.subject||m.preview?.subject||'(Sans objet)',
        from:m.sender||m.from||'',
        label:(m.labelIds||[]).includes('UNREAD')?'NON LU':'MAIL',
        preview:String(m.snippet||m.preview?.text||m.messageText||m.body||'').replace(/\s+/g,' ').trim().slice(0,220)
      }));
    }],
    ['drive',async()=>{
      const x=unwrap(await run('GOOGLEDRIVE_FIND_FILE',{q:'trashed = false',orderBy:'modifiedTime desc',pageSize:10,fields:'files(id,name,mimeType,modifiedTime,webViewLink)'}));
      const files=x.files||[];
      out.drive=files.length;
      out.driveFiles=files.slice(0,8).map(f=>({id:f.id,name:f.name,modified:f.modifiedTime||'',url:f.webViewLink||f.display_url||'',mimeType:f.mimeType||''}));
    }],
    ['calendar',async()=>{
      const x=unwrap(await run('GOOGLECALENDAR_EVENTS_LIST',{
        calendarId:'primary',
        timeMin:now.toISOString(),
        timeMax:week.toISOString(),
        singleEvents:true,
        orderBy:'startTime',
        maxResults:12,
        fields:'items(id,summary,start,end,htmlLink,location,status),nextPageToken'
      }));
      const items=x.items||[];
      out.calendar=items.length;
      out.events=items.map(e=>({
        id:e.id||'',
        title:e.summary||'(Sans titre)',
        start:e.start?.dateTime||e.start?.date||'',
        end:e.end?.dateTime||e.end?.date||'',
        url:e.htmlLink||'',
        location:e.location||'',
        status:e.status||'confirmed'
      }));
    }],
    ['tasks',async()=>{
      const x=unwrap(await run('GOOGLETASKS_LIST_ALL_TASKS',{showCompleted:false,max_tasks_total:30}));
      const items=x.tasks||[];
      out.tasks=items.length;
      out.taskItems=items.slice(0,20).map(t=>({
        id:t.id||'',
        listId:t.tasklist_id||t.tasklistId||'@default',
        title:t.title||'(Sans titre)',
        notes:t.notes||'',
        due:t.due||'',
        status:t.status||'needsAction'
      }));
    }]
  ];

  for(const [name,job] of jobs){
    try{await job();}
    catch(e){
      const message=errText(e?.message||e,'Erreur '+name);
      out.errors[name]=message;
      if(connectionKind(message)==='connect') out.needsConnect.push(name);
    }
  }

  out.needsConnect=[...new Set(out.needsConnect)];
  const failed=Object.keys(out.errors).length;
  out.status=failed===0?'ok':failed<4?'partial':'integration_error';
  if(failed===4) return res.status(502).setHeader('Cache-Control','no-store').json(out);
  return res.status(200).setHeader('Cache-Control','no-store').json(out);
}

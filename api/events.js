export default async function handler(req,res){
 res.setHeader('Content-Type','text/event-stream; charset=utf-8');
 res.setHeader('Cache-Control','no-cache, no-transform');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 const send=(type,message)=>res.write('data: '+JSON.stringify({type,message,at:new Date().toISOString()})+'\n\n');
 send('connected','Canal temps réel actif');
 const timer=setInterval(()=>send('state','actualisation'),10000);
 req.on('close',()=>{clearInterval(timer);res.end()});
 setTimeout(()=>{clearInterval(timer);res.end()},25000);
}
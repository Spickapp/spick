// SPICK – Push Notifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const SUPA_URL="https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,apikey"};
serve(async(req)=>{
if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
try{
const{type,data}=await req.json();
const subsRes=await fetch(SUPA_URL+"/rest/v1/push_subscriptions?select=*",{headers:{"apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY}});
const subs=await subsRes.json();
if(!subs?.length)return new Response(JSON.stringify({ok:true,sent:0}),{headers:{"Content-Type":"application/json",...CORS}});
let notification={title:"HSpick",body:"Nytt meddelande",url:"/"};
if(type==="new_booking")notification={title:"\uD83D\uDD14 Ny bokning!",body:data.name+" bokade st\u00e4dning den "+data.date,url:"/admin.html"};
else if(type==="cleaner_job")notification={title:"\uD83E\uDDB9 Nytt uppdrag!",body:data.service+" i "+data.city+" - "+data.pay+" kr",url:"/stadare-dashboard.html"};
let sent=0;
for(const sub of subs){try{await fetch(sub.endpoint,{method:"POST",headers:{"Content-Type":"application/json","TTL":"86400"},body:JSON.stringify(notification)});sent++;}catch(e){}}
return new Response(JSON.stringify({ok:true,sent}),{headers:{"Content-Type":"application/json",...CORS}});
}catch(e){return new Response(JSON.stringify({error:e.message}),{status:500,headers:{"Content-Type":"application/json",...CORS}});}
});
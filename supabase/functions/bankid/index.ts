// SPICK – BankID Edge Function (DEMO-läge)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const SUPA_URL="https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRANDID_KEY=Deno.env.get("GRANDID_API_KEY")||"DEMO";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,apikey"};
serve(async(req)=>{
if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
const{action,sessionId}=await req.json().catch(()=>({}));
if(action==="start"){
if(GRANDID_KEY==="DEMO")return new Response(JSON.stringify({sessionId:"demo-"+crypto.randomUUID(),demo:true,message:"DEMO-läge - integrera med GrandID för riktig BankID"}),{headers:{"Content-Type":"application/json",...CORS}});
return new Response(JSON.stringify({error:"Konfigurera GRANDID_API_KEY"}),{status:400,headers:{"Content-Type":"application/json",...CORS}});
}
if(action==="poll"&&sessionId?.startsWith("demo-"))return new Response(JSON.stringify({status:"complete",personalNumber:"199001011234",givenName:"Anna",surname:"Andersson",name:"Anna Andersson",demo:true}),{headers:{"Content-Type":"application/json",...CORS}});
return new Response(JSON.stringify({error:"Unknown action"}),{status:400,headers:{"Content-Type":"application/json",...CORS}});
});
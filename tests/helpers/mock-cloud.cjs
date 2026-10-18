const crypto=require('node:crypto');
require('../../finance');globalThis.Finance=require('../../finance');
const {makeBackend}=require('../../cloud/backend');
function createMock(){
 const tables=Object.fromEntries(['households','household_members','household_plans','household_invites','connections','provider_secrets','bank_accounts','bank_transactions','paystubs','notifications','audit_events','reminder_deliveries'].map(t=>[t,[]]));
 const users=[],sessions=new Map(),rates=new Map();let clock=0;
 const reply=(data,status=200)=>new Response(data===undefined?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 function issue(user){const sessionId=crypto.randomUUID(),token='test.'+Buffer.from(JSON.stringify({sub:user.id,session_id:sessionId})).toString('base64url')+'.signature',refresh=crypto.randomUUID();sessions.set(sessionId,{user,token,refresh});return {access_token:token,refresh_token:refresh,expires_in:3600,user};}
 const parseBody=options=>options.body?JSON.parse(options.body):{};
 const service=async(urlString,options={})=>{
  const url=new URL(urlString),body=parseBody(options),method=options.method||'GET',token=options.headers?.Authorization?.replace('Bearer ','');
  if(url.pathname.includes('/auth/v1/')){
   const route=url.pathname.split('/auth/v1/')[1],session=[...sessions.values()].find(s=>s.token===token);
   if(route==='signup'){
    if(users.some(u=>u.email===body.email))return reply({message:'Already registered'},400);
    const user={id:crypto.randomUUID(),email:body.email,email_confirmed_at:new Date().toISOString(),password:body.password};users.push(user);return reply(issue(user));
   }
   if(route==='token'){
    const user=url.searchParams.get('grant_type')==='refresh_token'?[...sessions.values()].find(s=>s.refresh===body.refresh_token)?.user:users.find(u=>u.email===body.email&&u.password===body.password);
    return user?reply(issue(user)):reply({message:'Invalid login credentials'},401);
   }
   if(route==='user')return session?reply(session.user):reply({message:'Invalid token'},401);
   if(route==='logout'){for(const [id,s]of sessions)if(s.token===token)sessions.delete(id);return reply(undefined,204);}
   if(route==='recover')return reply({});
  }
  const route=url.pathname.split('/rest/v1/')[1];
  if(route?.startsWith('rpc/')){
   const name=route.slice(4);
   if(name==='is_live_session')return reply(sessions.has(body.p_session));
   if(name==='get_worker_secret')return reply('worker-test-only');
   if(name==='consume_rate_limit'){const n=(rates.get(body.p_bucket)||0)+1;rates.set(body.p_bucket,n);return reply(n<=body.p_limit);}
   if(name==='create_household'){
    const id=crypto.randomUUID();tables.households.push({id,owner_id:body.p_user,name:body.p_name});
    tables.household_members.push({household_id:id,user_id:body.p_user,email:body.p_email,role:'owner'});
    tables.household_plans.push({household_id:id,data:body.p_plan,revision:0});return reply(id);
   }
   if(name==='accept_household_invite'){
    const inv=tables.household_invites.find(i=>i.token_hash===body.p_hash&&i.email===body.p_email&&!i.used_at);
    if(!inv)return reply({message:'Invitation invalid'},400);
    inv.used_at=new Date().toISOString();if(!tables.household_members.some(m=>m.household_id===inv.household_id&&m.user_id===body.p_user))tables.household_members.push({household_id:inv.household_id,user_id:body.p_user,email:body.p_email,role:inv.role});
    return reply(inv.household_id);
   }
   return reply({message:'Unknown RPC '+name},404);
  }
  if(!tables[route])return reply({message:'Unknown table '+route},404);
  const matches=row=>[...url.searchParams].every(([k,v])=>!v.startsWith('eq.')||String(row[k])===decodeURIComponent(v.slice(3)));
  if(method==='GET'){
   let rows=tables[route].filter(matches);const order=url.searchParams.get('order');
   if(order){const [key,dir]=order.split('.');rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(dir==='desc'?-1:1));}
   if(url.searchParams.has('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));
   return reply(rows);
  }
  if(method==='POST'){
   const items=Array.isArray(body)?body:[body],out=[];
   for(const item of items){const conflicts=url.searchParams.get('on_conflict')?.split(',');const duplicate=conflicts&&tables[route].find(r=>conflicts.every(k=>r[k]===item[k]));
    if(duplicate){if(!options.headers.Prefer?.includes('ignore-duplicates'))Object.assign(duplicate,item);out.push(duplicate);}
    else{const row={id:crypto.randomUUID(),created_at:new Date(++clock+1792290000000).toISOString(),...item};tables[route].push(row);out.push(row);}
   }return reply(out,201);
  }
  if(method==='PATCH'){const rows=tables[route].filter(matches);rows.forEach(r=>Object.assign(r,body));return reply(rows);}
  if(method==='DELETE'){tables[route]=tables[route].filter(r=>!matches(r));return reply([]);}
  return reply({message:'Unsupported'},400);
 };
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',APP_ORIGIN:'http://127.0.0.1',TEST_MODE:'true'};
 return {tables,users,sessions,rates,fetch:service,env,handler:makeBackend(env,service)};
}
module.exports={createMock};

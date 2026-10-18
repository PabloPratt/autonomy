import '../finance.js';
import './backend.js';
const env=Deno.env.toObject(),base=env.SUPABASE_URL,anon=JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS||'{}').default||env.SUPABASE_ANON_KEY,service=JSON.parse(env.SUPABASE_SECRET_KEYS||'{}').default||env.SUPABASE_SERVICE_ROLE_KEY;
const headers={apikey:service,...(service.split('.').length===3?{Authorization:'Bearer '+service}:{}),'Content-Type':'application/json'};
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 const secretResponse=await fetch(base+'/rest/v1/rpc/get_worker_secret',{method:'POST',headers,body:'{}'});
 const secret=await secretResponse.json();
 if(request.headers.get('x-worker-secret')!==secret)return new Response('Unauthorized',{status:401});
 const handle=globalThis.makeBackend(env),users=[],households=[],results=[];
 async function upstream(path,method='GET',body){
  const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);if(!r.ok)throw Error('Verification setup request failed: '+r.status);return data;
 }
 function check(condition,name){if(!condition)throw Error(name);results.push(name);}
 function client(){let cookie='',access='';return {
  request:async(path,method='GET',body)=>{
   const r=await handle(new Request('https://autonomy-wheat.vercel.app'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-Autonomy-Client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
   const set=r.headers.getSetCookie();if(set.length){cookie=set.map(x=>x.split(';')[0]).join('; ');access=set.find(x=>x.startsWith('autonomy_access='))?.split(';')[0].slice('autonomy_access='.length)||access;}
   const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};
  },access:()=>access
 };}
 try{
  const password=crypto.randomUUID()+crypto.randomUUID(),suffix=crypto.randomUUID();
  for(let i=0;i<3;i++){const email='autonomy-verification-'+suffix+'-'+i+'@example.invalid';const created=await upstream('/auth/v1/admin/users','POST',{email,password,email_confirm:true});users.push({...created,email});}
  const a=client(),b=client(),c=client();
  for(const [i,client]of [a,b,c].entries()){const response=await client.request('/api/auth/login','POST',{email:users[i].email,password});check(response.status===200,'real_password_login_'+i);}
  const fresh=await a.request('/api/households','POST',{name:'AUTONOMY isolated verification'});
  check(fresh.status===201,'create_household_transaction');const h=fresh.data.id;households.push(h);
  check((await b.request('/api/household?household='+h)).status===403,'reject_unrelated_user');
  const invite=await a.request('/api/invitations','POST',{householdId:h,email:users[1].email,role:'viewer'});
  check(invite.status===200,'create_email_bound_invitation');const token=new URL(invite.data.url).hash.split('=')[1];
  check((await c.request('/api/invitations/accept','POST',{token})).status>=400,'reject_wrong_invited_email');
  check((await b.request('/api/invitations/accept','POST',{token})).status===200,'accept_verified_invited_email');
  check((await b.request('/api/household?household='+h)).status===200,'shared_household_read');
  const plan=globalThis.Finance.defaults();plan.cashBalance=1234.56;
  check((await b.request('/api/plan','PUT',{householdId:h,revision:0,plan})).status===403,'viewer_cannot_write');
  check((await a.request('/api/plan','PUT',{householdId:h,revision:0,plan})).status===200,'persist_cloud_plan');
  check((await a.request('/api/plan','PUT',{householdId:h,revision:0,plan})).status===409,'prevent_stale_overwrite');
  check((await b.request('/api/household?household='+h)).data.plan.cashBalance===1234.56,'other_member_sees_saved_plan');
  const rls=await fetch(base+'/rest/v1/household_plans?household_id=eq.'+h,{headers:{apikey:anon,Authorization:'Bearer '+c.access()}});
  check(rls.ok&&(await rls.json()).length===0,'database_rls_blocks_unrelated_user');
  const secrets=await fetch(base+'/rest/v1/provider_secrets',{headers:{apikey:anon,Authorization:'Bearer '+a.access()}});
  check(!secrets.ok,'database_denies_provider_secret_access');
  check((await a.request('/api/members/role','POST',{householdId:h,userId:users[1].id,role:'editor'})).status===200,'owner_can_change_member_role');
  check((await b.request('/api/plan','PUT',{householdId:h,revision:1,plan})).status===200,'editor_can_save');
  check((await a.request('/api/members/remove','POST',{householdId:h,userId:users[1].id})).status===200,'owner_removes_member');
  check((await b.request('/api/household?household='+h)).status===403,'removed_member_loses_access');
  check((await a.request('/api/auth/logout','POST',{})).status===200,'logout');
  check((await a.request('/api/households')).status===401,'revoked_session_rejected');
  return Response.json({ok:true,checks:results});
 }catch(error){return Response.json({ok:false,checks:results,failed:error.message},{status:500});}
 finally{
  for(const h of households)await fetch(base+'/rest/v1/households?id=eq.'+h,{method:'DELETE',headers});
  for(const u of users)await fetch(base+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers});
 }
});

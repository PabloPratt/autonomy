'use strict';
// Shared-project adapter: user JWTs and RLS, never a service-role credential.
const F=require('../finance');
const URL_DEFAULT='https://kfdyrwblvggfrhxcqnug.supabase.co';
const KEY_DEFAULT='sb_publishable_uo5V8EN8Yxr9Ag9Ck6aZWg_ZE7lFmSv';
function makeSharedBackend(env={},fetcher=fetch){
 const base=env.PV_SUPABASE_URL||URL_DEFAULT,key=env.PV_SUPABASE_PUBLISHABLE_KEY||KEY_DEFAULT,origin=env.APP_ORIGIN||'https://autonomy-wheat.vercel.app';
 const capabilities={cloud:true,banks:{ready:!!(env.PLAID_CLIENT_ID&&env.PLAID_SECRET)&&(!env.PLAID_ENV||env.PLAID_ENV==='sandbox'),environment:'sandbox'},payroll:{ready:false},email:{ready:false},payments:{ready:false},credit:{ready:false},auth:{signupReady:env.AUTH_EMAIL_READY!=='false'}};
 return async function(req,res){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'},cookies=[];
  const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
  const cookie=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)));
  let token=cookie.autonomy_pv_access,refresh=cookie.autonomy_pv_refresh;
  const session=s=>{token=s.access_token;refresh=s.refresh_token;for(const [name,value,max]of [['access',token,s.expires_in||3600],['refresh',refresh,2592000]])if(value)cookies.push('autonomy_pv_'+name+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+max+(origin.startsWith('https:')?'; Secure':''));};
  const call=async(path,{method='GET',body,authToken=token,prefer}={})=>{
   const response=await fetcher(base+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(authToken?{Authorization:'Bearer '+decodeURIComponent(authToken)}:{}),...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok){if(['42P01','PGRST202','PGRST205'].includes(data.code))fail('Shared household setup is pending. The reviewed database/supabase-autonomy.sql migration must be applied before household storage is available.',503);fail(data.msg||data.message||data.error_description||'Cloud request failed.',response.status);}
   return data;
  };
  const db=(name,opts)=>call('/rest/v1/'+name,opts),rpc=(name,body)=>db('rpc/autonomy_'+name,{method:'POST',body});
  const reply=(data,status=200)=>{res.statusCode=status;for(const [k,v]of Object.entries(headers))res.setHeader(k,v);if(cookies.length)res.setHeader('Set-Cookie',cookies);res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,origin),route=req.query?.route?'/api/'+req.query.route:url.pathname,input=req.body||{},method=req.method;
   if(method!=='GET'&&(req.headers['x-autonomy-client']!=='web'||(req.headers.origin&&req.headers.origin!==origin)))fail('Invalid request origin or client.',403);
   if(method!=='GET'&&!req.headers['content-type']?.startsWith('application/json'))fail('JSON required.',415);
   if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid request.');
   if(Buffer.byteLength(JSON.stringify(input))>1800000)fail('Request too large.',413);
   if(route==='/api/config')return reply({capabilities,version:3,backend:'shared'});
   if(route==='/api/auth/signup'||route==='/api/auth/login'){
    if(method!=='POST')fail('Method not allowed.',405);
    if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email)||typeof input.password!=='string'||input.password.length<12||input.password.length>256)fail('Use a valid email and a password of at least 12 characters.');
    const data=await call('/auth/v1/'+(route.endsWith('signup')?'signup?redirect_to='+encodeURIComponent(origin):'token?grant_type=password'),{method:'POST',authToken:null,body:{email:input.email.trim(),password:input.password}});
    if(data.access_token)session(data);
    return reply({confirmationRequired:!data.access_token,message:data.access_token?'Signed in.':'Check your email to confirm your account. No owner approval is required.'});
   }
   if(['/api/auth/recover','/api/auth/resend'].includes(route)&&method==='POST'){
    if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email))fail('Enter a valid email.');
    await call('/auth/v1/'+(route.endsWith('resend')?'resend':'recover')+'?redirect_to='+encodeURIComponent(origin),{method:'POST',authToken:null,body:{email:input.email,...(route.endsWith('resend')?{type:'signup'}:{})}});return reply({message:'If an account matches, an email has been requested. Check your inbox.'});
   }
   if(route==='/api/auth/verify'&&method==='POST'){
    if(!['signup','recovery'].includes(input.type)||typeof input.token_hash!=='string'||input.token_hash.length>256)fail('Invalid verification request.');
    session(await call('/auth/v1/verify',{method:'POST',authToken:null,body:{type:input.type,token_hash:input.token_hash}}));return reply({ok:true});
   }
   if(route==='/api/auth/email-session'&&method==='POST'){
    if(typeof input.access_token!=='string'||typeof input.refresh_token!=='string')fail('Invalid email session.');
    const original=await call('/auth/v1/user',{authToken:input.access_token});const data=await call('/auth/v1/token?grant_type=refresh_token',{method:'POST',authToken:null,body:{refresh_token:input.refresh_token}});
    if(data.user?.id!==original.id)fail('Session mismatch.',401);session(data);return reply({ok:true});
   }
   if(route==='/api/auth/logout'&&method==='POST'){
    try{if(token)await call('/auth/v1/logout?scope=local',{method:'POST',body:{}});}catch(e){if(![401,403].includes(e.status))throw e;}finally{for(const name of ['access','refresh'])cookies.push('autonomy_pv_'+name+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');}return reply({ok:true});
   }
   let user;
   try{if(token)user=await call('/auth/v1/user');}catch(e){if(![401,403].includes(e.status))throw e;}
   if(!user&&refresh){session(await call('/auth/v1/token?grant_type=refresh_token',{method:'POST',authToken:null,body:{refresh_token:decodeURIComponent(refresh)}}));user=await call('/auth/v1/user');}
   if(user){
    let claims;try{claims=JSON.parse(Buffer.from(decodeURIComponent(token).split('.')[1],'base64url').toString());}catch{fail('Invalid session.',401);}
    if(!claims.session_id||!await rpc('is_live_session',{p_session:claims.session_id})){
     for(const name of ['access','refresh'])cookies.push('autonomy_pv_'+name+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');user=null;
    }
   }
   if(route==='/api/session')return reply({user:user?{id:user.id,email:user.email}:null,mode:'shared'});
   if(!user)fail('Log in to continue.',401);
   if(route==='/api/auth/password'&&method==='PUT'){if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)fail('Use 12–256 characters.');await call('/auth/v1/user',{method:'PUT',body:{password:input.password}});return reply({ok:true});}
   if(!user.email_confirmed_at)fail('Confirm your email to access household finances.',403);
   if(route==='/api/households'&&method==='GET'){
    await rpc('record_usage',{});
    const rows=await db('autonomy_members?user_id=eq.'+user.id+'&select=role,autonomy_households(id,name)');return reply({households:rows.map(r=>({...r.autonomy_households,role:r.role}))});
   }
   if(route==='/api/households'&&method==='POST')return reply({id:await rpc('create_household',{p_name:input.name,p_plan:F.defaults()})},201);
   if(route==='/api/invitations/accept'&&method==='POST')return reply({id:await rpc('join_household',{p_code:input.token})});
   const h=input.householdId||url.searchParams.get('household');if(!/^[a-f0-9-]{36}$/i.test(h||''))fail('Invalid household.');
   const members=await db('autonomy_members?household_id=eq.'+h),member=members.find(m=>m.user_id===user.id);if(!member)fail('Household access denied.',403);
   if(route==='/api/household'&&method==='GET'){const [row]=await db('autonomy_plans?household_id=eq.'+h);let plan;try{plan=F.validate(row.data);}catch(e){return reply({error:'Saved plan has invalid data: '+e.message+' Export it below, fix or reset.',rawPlan:row.data,revision:row.revision,members,role:member.role},422);}return reply({plan,revision:row.revision,members,role:member.role,accounts:[],transactions:[],paystubs:[],connections:[],notifications:[],capabilities});}
   if(route==='/api/plan'&&method==='PUT'){
    if(member.role==='viewer')fail('Read-only household.',403);
    let plan;try{plan=F.validate(input.plan);}catch(e){fail(e.message);}plan.updatedAt=new Date().toISOString();
    const revision=await rpc('save_plan',{p_household:h,p_revision:input.revision,p_data:plan});return reply({plan,revision});
   }
   if(route==='/api/invitations'&&method==='POST')return reply({code:await rpc('invite_partner',{p_household:h}),expiresInDays:7});
   if(route==='/api/members/remove'&&method==='POST'){await rpc('remove_partner',{p_household:h,p_user:input.userId});return reply({ok:true});}
   if(route==='/api/members/role'&&method==='POST')fail('Shared couples households use owner and editor roles.',400);
   if(route==='/api/plaid/link'&&method==='POST'){
    if(member.role!=='owner')fail('Only the owner can link a bank.',403);
    const provider=require('./bank-provider').createBankProvider(env,fetcher);return reply(await provider.createLinkToken(user.id,h));
   }
   if(route==='/api/plaid/exchange'&&method==='POST'){if(member.role!=='owner')fail('Only the owner can link a bank.',403);return reply(await require('./bank-provider').createBankProvider(env,fetcher).exchangeSandbox(input.publicToken));}
   if(route==='/api/reminders/run')return reply({emailReady:false});
   if(route.startsWith('/api/payments'))fail('Money movement is not implemented.',503);
   fail('This provider feature is coming soon in the shared-project phase 1 build.',503);
  }catch(e){reply({error:e.status?e.message:'The cloud service is unavailable. Your saved data is preserved.'},e.status||502);}
 };
}
module.exports={makeSharedBackend};

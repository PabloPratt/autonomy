(function(root){
'use strict';
function makeBackend(env, fetcher=fetch){
 const keys=name=>{try{return JSON.parse(env[name]||'{}');}catch{return {};}};
 const F=root.Finance, base=env.SUPABASE_URL, anon=keys('SUPABASE_PUBLISHABLE_KEYS').default||env.SUPABASE_ANON_KEY, service=keys('SUPABASE_SECRET_KEYS').default||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!anon||!service)throw Error('Backend keys are not configured.');
 const serviceHeaders={apikey:service,...(service.split('.').length===3?{Authorization:'Bearer '+service}:{}),'Content-Type':'application/json'};
 const origin=env.APP_ORIGIN||'https://autonomy-wheat.vercel.app';
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
 async function request(url,options={}){
  const response=await fetcher(url,{...options,signal:AbortSignal.timeout(25000)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{fail('Upstream service returned an invalid response.',502);}
  if(!response.ok)throw Object.assign(new Error(data?.msg||data?.message||data?.error_description||data?.error_message||'Provider request failed.'),{status:response.status>=500?502:response.status,providerCode:data?.error_code});
  return data;
 }
 const db=(table,{method='GET',body,query='',prefer='return=representation'}={})=>request(base+'/rest/v1/'+table+query,{method,headers:{...serviceHeaders,Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const rpc=(name,body)=>db('rpc/'+name,{method:'POST',body});
 const auth=(route,body,token,method='POST')=>request(base+'/auth/v1/'+route,{method,headers:{apikey:anon,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const audit=(household,user,action)=>db('audit_events',{method:'POST',body:{household_id:household,actor_id:user,action}});
 function cookies(req){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));}
 function setSession(headers,data){
  const secure=origin.startsWith('https:')?'; Secure':'';
  for(const [name,value,max]of [['autonomy_access',data.access_token,data.expires_in||3600],['autonomy_refresh',data.refresh_token,2592000]]){
   if(value)headers.append('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+max+secure);
  }
 }
 function clearSession(headers){
  for(const name of ['autonomy_access','autonomy_refresh'])headers.append('Set-Cookie',name+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(origin.startsWith('https:')?'; Secure':''));
 }
 async function verifiedUser(req,headers,optional=false){
  const c=cookies(req);let token=c.autonomy_access,user;
  if(token)try{user=await auth('user',undefined,token,'GET');}catch(e){if(![401,403].includes(e.status))throw e;}
  if(!user&&c.autonomy_refresh){
   try{const session=await auth('token?grant_type=refresh_token',{refresh_token:c.autonomy_refresh});setSession(headers,session);token=session.access_token;user=await auth('user',undefined,token,'GET');}
   catch(e){if(![400,401,403].includes(e.status))throw e;clearSession(headers);}
  }
  if(!user){if(optional)return null;fail('Log in to continue.',401);}
  let claims;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('Invalid session.',401);}
  if(!claims.session_id||!await rpc('is_live_session',{p_session:claims.session_id})){clearSession(headers);if(optional)return null;fail('Your session ended. Log in again.',401);}
  return {...user,token};
 }
 function uuid(s){if(typeof s!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))fail('Invalid household or record ID.');return s;}
 async function member(h,user,role='viewer'){
  uuid(h);const rows=await db('household_members',{query:'?household_id=eq.'+h+'&user_id=eq.'+user.id});
  const m=rows[0];if(!m||(role==='editor'&&!['owner','editor'].includes(m.role))||(role==='owner'&&m.role!=='owner'))fail('You do not have access to this household action.',403);
  return m;
 }
 async function planFor(h){const rows=await db('household_plans',{query:'?household_id=eq.'+h});if(!rows[0])fail('Plan not found.',404);return rows[0];}
 function capability(){
  return {banks:{ready:!!(env.PLAID_CLIENT_ID&&env.PLAID_SECRET),environment:env.PLAID_ENV||'sandbox'},
   payroll:{ready:!!(env.ARGYLE_KEY_ID&&env.ARGYLE_KEY_SECRET),environment:env.ARGYLE_ENV||'sandbox'},
   email:{ready:!!(env.RESEND_API_KEY&&env.EMAIL_FROM)},payments:{ready:false},
   credit:{ready:false},auth:{signupReady:env.AUTH_EMAIL_READY==='true'},cloud:true};
 }
 function plaid(route,data){
  if(!capability().banks.ready)fail('Live bank connections need the deployment’s Plaid credentials and product approval. No account is connected yet.',503);
  const host=env.PLAID_ENV==='production'?'production':'sandbox';
  return request('https://'+host+'.plaid.com/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET,...data})});
 }
 function argyle(route,data,method){
  if(!capability().payroll.ready)fail('Payroll linking needs the deployment’s Argyle credentials. You can enter take-home pay now.',503);
  const host=env.ARGYLE_ENV==='production'?'api.argyle.com':'api-sandbox.argyle.com';
  return request('https://'+host+'/v2/'+route,{method:method||(data?'POST':'GET'),headers:{Authorization:'Basic '+btoa(env.ARGYLE_KEY_ID+':'+env.ARGYLE_KEY_SECRET),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 }
 async function cipher(text,decrypt=false){
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(service+'|autonomy-provider-v1'));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  if(decrypt){const [iv,payload]=text.split('.').map(v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0)));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,payload));}
  const iv=crypto.getRandomValues(new Uint8Array(12)),enc=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...enc));
 }
 async function syncPlaid(connection){
  const secret=(await db('provider_secrets',{query:'?connection_id=eq.'+connection.id}))[0];if(!secret)fail('Connection needs to be relinked.',409);
  const access=await cipher(secret.ciphertext,true),accounts=await plaid('accounts/get',{access_token:access});
  for(const account of accounts.accounts){
   await db('bank_accounts',{method:'POST',query:'?on_conflict=external_id',prefer:'resolution=merge-duplicates,return=minimal',body:{household_id:connection.household_id,connection_id:connection.id,external_id:account.account_id,name:account.name,mask:account.mask,type:account.type,subtype:account.subtype,balance:account.balances.available??account.balances.current,currency:account.balances.iso_currency_code||'USD',updated_at:new Date().toISOString()}});
  }
  const startCursor=secret.cursor;let cursor=startCursor,more=true,pages=0;
  while(more&&pages++<50){
   const delta=await plaid('transactions/sync',{access_token:access,...(cursor?{cursor}:{}),count:500});
   for(const tx of [...delta.added,...delta.modified]){
    if(tx.pending_transaction_id&&!tx.pending)await db('bank_transactions',{method:'DELETE',query:'?connection_id=eq.'+connection.id+'&external_id=eq.'+encodeURIComponent(tx.pending_transaction_id),prefer:'return=minimal'});
    await db('bank_transactions',{method:'POST',query:'?on_conflict=external_id',prefer:'resolution=merge-duplicates,return=minimal',body:{household_id:connection.household_id,connection_id:connection.id,external_id:tx.transaction_id,account_external_id:tx.account_id,date:tx.date,name:tx.merchant_name||tx.name,amount:tx.amount,category:tx.personal_finance_category?.primary||'Other',pending:tx.pending,is_transfer:/TRANSFER|LOAN_PAYMENTS/.test(tx.personal_finance_category?.primary||'')}});
   }
   for(const removed of delta.removed)await db('bank_transactions',{method:'DELETE',query:'?connection_id=eq.'+connection.id+'&external_id=eq.'+encodeURIComponent(removed.transaction_id),prefer:'return=minimal'});
   cursor=delta.next_cursor;more=delta.has_more;
  }
  if(more)fail('Bank sync is still catching up. Retry to continue.',503);
  await db('provider_secrets',{method:'PATCH',query:'?connection_id=eq.'+connection.id,body:{cursor,updated_at:new Date().toISOString()}});
  await db('connections',{method:'PATCH',query:'?id=eq.'+connection.id,body:{status:'connected',last_sync:new Date().toISOString()}});
 }
 async function syncPayroll(connection){
  const data=await argyle('paystubs?user='+encodeURIComponent(connection.external_id)+'&limit=200');
  for(const stub of data.results||[]){
   if(!stub.paystub_date||stub.net_pay===null)continue;
   await db('paystubs',{method:'POST',query:'?on_conflict=external_id',prefer:'resolution=merge-duplicates,return=minimal',body:{household_id:connection.household_id,connection_id:connection.id,external_id:stub.id,employer:stub.employer,pay_date:stub.paystub_date.slice(0,10),net:Number(stub.net_pay),gross:stub.gross_pay===null?null:Number(stub.gross_pay),currency:stub.currency||'USD',updated_at:new Date().toISOString()}});
  }
  await db('connections',{method:'PATCH',query:'?id=eq.'+connection.id,body:{status:(data.results||[]).length?'connected':'awaiting_data',last_sync:new Date().toISOString()}});
 }
 async function remind(h){
  const row=await planFor(h),p=F.validate(row.data),today=new Intl.DateTimeFormat('en-CA',{timeZone:p.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const due=F.obligations(p,today,p.reminderDays).filter(b=>b.date<=F.iso(new Date(F.date(today).getTime()+p.reminderDays*86400000)));
  for(const b of due)await db('notifications',{method:'POST',query:'?on_conflict=household_id,event_key,event_date',prefer:'resolution=ignore-duplicates,return=minimal',body:{household_id:h,event_key:b.kind+'-'+b.id+'-'+b.date,event_date:today,title:b.overdue?'Payment needs attention':'Upcoming payment',body:b.name+' · $'+b.amount.toFixed(2)+' · due '+b.date+(b.autopay?' · autopay noted; confirm with provider.':' · confirm payment with your bank.')}});
  if(!p.emailReminders||!capability().email.ready)return;
  const [members,notes]=await Promise.all([db('household_members',{query:'?household_id=eq.'+h}),db('notifications',{query:'?household_id=eq.'+h+'&event_date=eq.'+today})]);
  for(const m of members)for(const note of notes){
   // Provider idempotency key makes concurrent workers/retries safe for delivery.
   const delivery=(await db('reminder_deliveries',{query:'?notification_id=eq.'+note.id+'&recipient_id=eq.'+m.user_id}))[0];
   if(delivery?.status==='sent')continue;
   await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'autonomy/'+note.id+'/'+m.user_id},body:JSON.stringify({from:env.EMAIL_FROM,to:[m.email],subject:'AUTONOMY: a payment needs your attention',text:'A payment reminder is ready in your household dashboard. Sign in: '+origin})});
   await db('reminder_deliveries',{method:'POST',query:'?on_conflict=notification_id,recipient_id',prefer:'resolution=merge-duplicates,return=minimal',body:{notification_id:note.id,recipient_id:m.user_id,status:'sent',sent_at:new Date().toISOString()}});
  }
 }
 return async function handle(req){
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  try{
   const url=new URL(req.url),route=url.searchParams.get('path')||url.pathname.replace(/^\/autonomy/,'')||'/';
   if(route==='/worker'){
    const secret=await rpc('get_worker_secret',{});
    if(req.headers.get('x-worker-secret')!==secret)fail('Not authorized.',401);
    const households=await db('households'),errors=[];
    const connections=await db('connections');
    for(const c of connections)try{if(c.provider==='plaid'&&capability().banks.ready)await syncPlaid(c);else if(c.provider==='argyle'&&capability().payroll.ready)await syncPayroll(c);}catch{errors.push(c.id);await db('connections',{method:'PATCH',query:'?id=eq.'+c.id,body:{status:'needs_attention'}});}
    for(const h of households)try{await remind(h.id);}catch{errors.push(h.id);}
    return reply({processed:households.length,failed:errors.length});
   }
   if(!route.startsWith('/api/'))fail('Not found.',404);
   if(!['GET','POST','PUT','DELETE'].includes(req.method))fail('Method not allowed.',405);
   if(req.method!=='GET'){
    const requestOrigin=req.headers.get('origin');
    if(requestOrigin&&requestOrigin!==origin&&!((env.TEST_MODE==='true')&&requestOrigin.startsWith('http://127.0.0.1:')))fail('Invalid request origin.',403);
    if(req.headers.get('x-autonomy-client')!=='web')fail('Missing request header.',403);
    if(!req.headers.get('content-type')?.startsWith('application/json'))fail('JSON required.',415);
   }
   if(route==='/api/config'&&req.method==='GET')return reply({capabilities:capability(),version:3});
   let input={};
   if(req.method!=='GET'){
    const raw=await req.text();if(new TextEncoder().encode(raw).length>1800000)fail('Request too large.',413);
    try{input=raw?JSON.parse(raw):{};}catch{fail('Invalid JSON.');}
    if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid request.');
   }
   if(route==='/api/auth/signup'||route==='/api/auth/login'){
    if(req.method!=='POST')fail('Method not allowed.',405);
    if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email)||input.email.length>254||typeof input.password!=='string'||input.password.length<12||input.password.length>256)fail('Use a valid email and a password of at least 12 characters.');
    if(!await rpc('consume_rate_limit',{p_bucket:'auth:'+await hash(input.email.trim().toLowerCase()),p_limit:15,p_window:900}))fail('Too many attempts. Try again in 15 minutes.',429);
    const data=await auth(route.endsWith('signup')?'signup?redirect_to='+encodeURIComponent(origin):'token?grant_type=password',{email:input.email.trim().toLowerCase(),password:input.password});
    if(data.access_token)setSession(headers,data);
    return reply({user:data.user?{id:data.user.id,email:data.user.email}:null,confirmationRequired:!data.access_token,message:data.access_token?'Signed in.':'Check your email to confirm your account, then return here to log in.'});
   }
   if(route==='/api/auth/recover'&&req.method==='POST'){
    if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email))fail('Enter an email address.');
    await auth('recover?redirect_to='+encodeURIComponent(origin),{email:input.email});
    return reply({message:'If an account matches, recovery instructions have been sent.'});
   }
   if(route==='/api/auth/verify'&&req.method==='POST'){
    if(typeof input.token_hash!=='string'||input.token_hash.length>256||!['recovery','signup'].includes(input.type))fail('Invalid verification request.');
    const data=await auth('verify',{token_hash:input.token_hash,type:input.type});setSession(headers,data);return reply({ok:true});
   }
   if(route==='/api/session'&&req.method==='GET'){const u=await verifiedUser(req,headers,true);return reply({mode:'cloud',user:u?{id:u.id,email:u.email}:null});}
   const user=await verifiedUser(req,headers);
   if(!await rpc('consume_rate_limit',{p_bucket:'api:'+user.id,p_limit:300,p_window:60}))fail('Too many requests. Try again in a minute.',429);
   if(route==='/api/auth/logout'&&req.method==='POST'){await auth('logout?scope=local',{},user.token);clearSession(headers);return reply({ok:true});}
   if(route==='/api/auth/password'&&req.method==='PUT'){
    if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)fail('Use at least 12 characters.');
    await auth('user',{password:input.password},user.token,'PUT');return reply({ok:true});
   }
   if(!user.email_confirmed_at)fail('Confirm your email before sharing or accessing household finances.',403);
   if(route==='/api/households'&&req.method==='GET'){
    const memberships=await db('household_members',{query:'?user_id=eq.'+user.id});
    const households=await Promise.all(memberships.map(async m=>({...((await db('households',{query:'?id=eq.'+m.household_id}))[0]),role:m.role})));
    return reply({households,user:{id:user.id,email:user.email}});
   }
   if(route==='/api/households'&&req.method==='POST'){
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)fail('Enter a household name.');
    if((await db('household_members',{query:'?user_id=eq.'+user.id})).length>=10)fail('You already belong to 10 households.');
    const id=await rpc('create_household',{p_user:user.id,p_email:user.email,p_name:input.name.trim(),p_plan:F.defaults()});return reply({id},201);
   }
   if(route==='/api/invitations/accept'&&req.method==='POST'){
    if(typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))fail('Invalid invitation.');
    const id=await rpc('accept_household_invite',{p_user:user.id,p_email:user.email,p_hash:await hash(input.token)});return reply({id});
   }
   const h=uuid(input.householdId||url.searchParams.get('household'));
   const role=await member(h,user);
   if(route==='/api/household'&&req.method==='GET'){
    const [plan,members,accounts,transactions,paystubs,connections,notifications]=await Promise.all([
     planFor(h),db('household_members',{query:'?household_id=eq.'+h}),
     db('bank_accounts',{query:'?household_id=eq.'+h}),db('bank_transactions',{query:'?household_id=eq.'+h+'&order=date.desc&limit=1000'}),
     db('paystubs',{query:'?household_id=eq.'+h+'&order=pay_date.desc&limit=200'}),
     db('connections',{query:'?household_id=eq.'+h+'&select=id,user_id,provider,environment,label,status,last_sync'}),
     db('notifications',{query:'?household_id=eq.'+h+'&order=created_at.desc&limit=100'})
    ]);
    return reply({plan:F.validate(plan.data),revision:plan.revision,members,accounts,transactions,paystubs,connections,notifications,role:role.role,capabilities:capability()});
   }
   if(route==='/api/calendar'&&req.method==='GET'){const p=await planFor(h);headers.set('Content-Type','text/calendar; charset=utf-8');headers.set('Content-Disposition','attachment; filename="autonomy-reminders.ics"');return new Response(F.calendar(F.validate(p.data)),{headers});}
   if(route==='/api/plan'&&req.method==='PUT'){
    await member(h,user,'editor');const plan=F.validate(input.plan);
    if(!Number.isInteger(input.revision)||input.revision<0)fail('Invalid plan revision.');
    plan.updatedAt=new Date().toISOString();
    const updated=await db('household_plans',{method:'PATCH',query:'?household_id=eq.'+h+'&revision=eq.'+input.revision,body:{data:plan,revision:input.revision+1,updated_at:plan.updatedAt,updated_by:user.id}});
    if(!updated.length)fail('Another household member saved newer changes. Export your draft, then refresh before saving.',409);
    await audit(h,user.id,'plan_saved');return reply({plan,revision:input.revision+1});
   }
   if(route==='/api/invitations'&&req.method==='POST'){
    await member(h,user,'owner');if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email)||input.email.length>254||!['editor','viewer'].includes(input.role))fail('Enter a valid email and role.');
    const token=random();await db('household_invites',{method:'POST',body:{household_id:h,email:input.email.trim().toLowerCase(),role:input.role,token_hash:await hash(token),created_by:user.id}});
    await audit(h,user.id,'invitation_created');return reply({url:origin+'/#invite='+token,expiresInDays:7});
   }
   if(route==='/api/members/remove'&&req.method==='POST'){
    await member(h,user,'owner');uuid(input.userId);if(input.userId===user.id)fail('The owner cannot remove themselves.');
    await db('household_members',{method:'DELETE',query:'?household_id=eq.'+h+'&user_id=eq.'+input.userId});await audit(h,user.id,'member_removed');return reply({ok:true});
   }
   if(route==='/api/members/role'&&req.method==='POST'){
    await member(h,user,'owner');uuid(input.userId);if(input.userId===user.id||!['editor','viewer'].includes(input.role))fail('Invalid role change.');
    await db('household_members',{method:'PATCH',query:'?household_id=eq.'+h+'&user_id=eq.'+input.userId,body:{role:input.role}});await audit(h,user.id,'member_role_changed');return reply({ok:true});
   }
   if(route==='/api/plaid/link'&&req.method==='POST'){
    await member(h,user,'owner');
    const data=await plaid('link/token/create',{client_name:'AUTONOMY',user:{client_user_id:user.id+':'+h},products:['transactions'],optional_products:['liabilities'],country_codes:['US'],language:'en'});
    return reply({linkToken:data.link_token,environment:env.PLAID_ENV||'sandbox'});
   }
   if(route==='/api/plaid/exchange'&&req.method==='POST'){
    await member(h,user,'owner');if(typeof input.publicToken!=='string'||input.publicToken.length>300)fail('Invalid bank link result.');
    const data=await plaid('item/public_token/exchange',{public_token:input.publicToken});
    const connection=(await db('connections',{method:'POST',body:{household_id:h,user_id:user.id,provider:'plaid',environment:env.PLAID_ENV==='production'?'production':'sandbox',external_id:data.item_id,label:'Linked bank',status:'syncing'}}))[0];
    await db('provider_secrets',{method:'POST',body:{connection_id:connection.id,ciphertext:await cipher(data.access_token)}});
    await syncPlaid(connection);await audit(h,user.id,'bank_connected');return reply({ok:true});
   }
   if(route==='/api/plaid/liabilities'&&req.method==='POST'){
    await member(h,user,'owner');uuid(input.connectionId);
    const connection=(await db('connections',{query:'?id=eq.'+input.connectionId+'&household_id=eq.'+h+'&provider=eq.plaid'}))[0];if(!connection)fail('Bank connection not found.',404);
    const secret=(await db('provider_secrets',{query:'?connection_id=eq.'+connection.id}))[0];if(!secret)fail('Relink this bank account.',409);
    const data=await plaid('liabilities/get',{access_token:await cipher(secret.ciphertext,true)});
    const suggestions=[];
    for(const [kind,rows]of Object.entries(data.liabilities||{}))for(const loan of rows||[]){
     const account=data.accounts.find(a=>a.account_id===loan.account_id);if(!account||account.balances.iso_currency_code!=='USD')continue;
     const apr=kind==='credit'?(loan.aprs||[]).filter(a=>a.apr_type==='purchase_apr')[0]?.apr_percentage:kind==='mortgage'?loan.interest_rate?.percentage:loan.interest_rate_percentage??loan.interest_rate?.percentage;
     suggestions.push({id:'plaid-'+loan.account_id,name:account.name,type:kind==='credit'?'credit_card':'loan',balance:Math.max(0,account.balances.current||loan.last_statement_balance||0),apr:apr??null,minimum:loan.minimum_payment_amount??loan.next_monthly_payment??loan.next_payment_amount??null,dueDay:loan.next_payment_due_date?Number(loan.next_payment_due_date.slice(-2)):null,creditLimit:Math.max(0,account.balances.limit||0)});
    }
    return reply({suggestions,note:'Verify each balance, APR, minimum and due day with the provider. Missing values are unknown, not zero. Some student-loan minimums cover multiple loans; do not count them twice.'});
   }
   if(route==='/api/argyle/link'&&req.method==='POST'){
    await member(h,user,'owner');
    let connection=(await db('connections',{query:'?household_id=eq.'+h+'&user_id=eq.'+user.id+'&provider=eq.argyle'}))[0],data;
    if(connection)data=await argyle('user-tokens',{user:connection.external_id});
    else{data=await argyle('users',{external_id:user.id+':'+h});connection=(await db('connections',{method:'POST',body:{household_id:h,user_id:user.id,provider:'argyle',environment:env.ARGYLE_ENV==='production'?'production':'sandbox',external_id:data.id,label:'Payroll',status:'awaiting_link'}}))[0];}
    return reply({userToken:data.user_token,connectionId:connection.id,sandbox:env.ARGYLE_ENV!=='production'});
   }
   if(route==='/api/connections/sync'&&req.method==='POST'){
    await member(h,user,'owner');uuid(input.connectionId);
    const connection=(await db('connections',{query:'?id=eq.'+input.connectionId+'&household_id=eq.'+h}))[0];if(!connection)fail('Connection not found.',404);
    if(connection.provider==='plaid')await syncPlaid(connection);else await syncPayroll(connection);
    return reply({ok:true});
   }
   if(route==='/api/connections/disconnect'&&req.method==='POST'){
    await member(h,user,'owner');uuid(input.connectionId);
    const connection=(await db('connections',{query:'?id=eq.'+input.connectionId+'&household_id=eq.'+h}))[0];if(!connection)fail('Connection not found.',404);
    if(connection.provider==='plaid'){const secret=(await db('provider_secrets',{query:'?connection_id=eq.'+connection.id}))[0];if(secret)await plaid('item/remove',{access_token:await cipher(secret.ciphertext,true)});}
    else await argyle('users/'+encodeURIComponent(connection.external_id),null,'DELETE');
    await db('connections',{method:'DELETE',query:'?id=eq.'+connection.id});await audit(h,user.id,'connection_removed');return reply({ok:true});
   }
   if(route==='/api/reminders/run'&&req.method==='POST'){await member(h,user,'editor');await remind(h);return reply({ok:true,emailReady:capability().email.ready});}
   if(route==='/api/payments/execute'&&req.method==='POST'){await member(h,user,'owner');fail('Money movement is not activated. This deployment has no approved payment rail or verified transfer destinations. No payment was sent.',503);}
   fail('Not found.',404);
  }catch(error){
   const status=error.status||400;
   // Do not expose upstream tokens, stack traces, or request bodies.
   return reply({error:status>=500?(error.status===503?error.message:'A connected service could not complete the request. Your last saved plan is preserved.'):error.message},status);
  }
 };
}
if(typeof module!=='undefined'&&module.exports)module.exports={makeBackend};else root.makeBackend=makeBackend;
})(globalThis);

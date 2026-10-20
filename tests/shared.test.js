const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeSharedBackend}=require('../cloud/shared');
const {createBankProvider}=require('../cloud/bank-provider');
const F=require('../finance');
const user={id:'10000000-0000-4000-8000-000000000001',email:'test@example.test',email_confirmed_at:'2026-01-01'},household='20000000-0000-4000-8000-000000000001';
const token='test.'+Buffer.from(JSON.stringify({session_id:'30000000-0000-4000-8000-000000000001'})).toString('base64url')+'.signature';
function harness({missing=false,live=true,member=true,conflict=false}={}){
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push({url,options});const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(path.endsWith('/auth/v1/user'))return response(user);
  if(path.endsWith('/auth/v1/token')||path.endsWith('/auth/v1/signup')||path.endsWith('/auth/v1/verify'))return response({access_token:token,refresh_token:'test-refresh-token',expires_in:3600,user});
  if(path.endsWith('/auth/v1/recover')||path.endsWith('/auth/v1/resend')||path.endsWith('/auth/v1/logout'))return response({});
  if(missing)return response({code:'PGRST202',message:'missing function'},404);
  if(path.endsWith('/rpc/autonomy_is_live_session'))return response(live);
  if(path.endsWith('/rpc/autonomy_record_usage'))return response(null);
  if(path.endsWith('/rpc/autonomy_create_household'))return response(household);
  if(path.endsWith('/rpc/autonomy_invite_partner'))return response('a'.repeat(32));
  if(path.endsWith('/rpc/autonomy_join_household'))return response(household);
  if(path.endsWith('/rpc/autonomy_save_plan'))return conflict?response({message:'Another partner saved newer changes.',code:'40001'},409):response(body.p_revision+1);
  if(path.endsWith('/autonomy_members'))return response(member?[{household_id:household,user_id:user.id,role:'owner',email:user.email,autonomy_households:{id:household,name:'Ours'}}]:[]);
  if(path.endsWith('/autonomy_plans'))return response([{revision:0,data:F.defaults()}]);
  throw Error('Unexpected endpoint '+url);
 };
 const backend=makeSharedBackend({},fetcher);
 async function request(path,method='GET',body,auth=true,extra={}){
  const req={url:path,method,body,headers:{'content-type':'application/json','x-autonomy-client':'web',...(auth?{cookie:'autonomy_pv_access='+token}:{}),...extra}},res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.data=JSON.parse(s);}};
  await backend(req,res);return res;
 }
 return {request,calls};
}
test('shared adapter needs no service key, uses only prefixed storage and forwards user JWT for RLS',async()=>{
 const h=harness();let r=await h.request('/api/config');assert.equal(r.data.backend,'shared');assert.equal(r.data.capabilities.banks.ready,false);
 r=await h.request('/api/households');assert.equal(r.data.households[0].id,household);
 r=await h.request('/api/household?household='+household);assert.equal(r.data.role,'owner');
 r=await h.request('/api/plan','PUT',{householdId:household,revision:0,plan:F.defaults()});assert.equal(r.data.revision,1);
 for(const c of h.calls.filter(c=>c.url.includes('/rest/'))){assert.ok(c.url.includes('autonomy_'));assert.equal(c.options.headers.Authorization,'Bearer '+token);}
});
test('signup, forgot password, recovery, code invites and joins use the shared Auth/RPC contract',async()=>{
 const h=harness();const r=await h.request('/api/auth/signup','POST',{email:user.email,password:'synthetic-password'},false);
 assert.equal(r.statusCode,200);assert.match(r.headers['Set-Cookie'][0],/HttpOnly; SameSite=Strict/);assert.ok(r.headers['Set-Cookie'].every(c=>!c.includes('autonomy_access=')));
 assert.equal((await h.request('/api/auth/recover','POST',{email:user.email},false)).statusCode,200);
 assert.equal((await h.request('/api/auth/verify','POST',{token_hash:'test-hash',type:'recovery'},false)).statusCode,200);
 assert.equal((await h.request('/api/invitations','POST',{householdId:household})).data.code,'a'.repeat(32));
 assert.equal((await h.request('/api/invitations/accept','POST',{token:'a'.repeat(32)})).data.id,household);
});
test('shared adapter clearly handles missing migration, revoked sessions, outsiders, stale writes, CSRF, and size',async()=>{
 assert.equal((await harness({missing:true}).request('/api/households')).statusCode,503);
 assert.match((await harness({missing:true}).request('/api/households')).data.error,/migration/);
 assert.equal((await harness({live:false}).request('/api/session')).data.user,null);
 assert.equal((await harness({member:false}).request('/api/household?household='+household)).statusCode,403);
 assert.equal((await harness({conflict:true}).request('/api/plan','PUT',{householdId:household,revision:0,plan:F.defaults()})).statusCode,409);
 assert.equal((await harness().request('/api/plan','PUT',{},true,{origin:'https://attacker.invalid'})).statusCode,403);
 assert.equal((await harness().request('/api/auth/signup','POST',{text:'x'.repeat(1800001)},false)).statusCode,413);
 assert.equal((await harness().request('/api/auth/signup','POST',{},false,{'content-type':'text/plain'})).statusCode,415);
 assert.equal((await harness().request('/api/households','GET',undefined,false)).statusCode,401);
});
test('bank provider disables unset or production credentials and never sends secrets to the client',async()=>{
 await assert.rejects(createBankProvider({}).createLinkToken('user','household'),/coming soon/);
 assert.equal(createBankProvider({PLAID_CLIENT_ID:'id',PLAID_SECRET:'secret',PLAID_ENV:'production'}).status().ready,false);
 const calls=[],provider=createBankProvider({PLAID_CLIENT_ID:'id',PLAID_SECRET:'secret',PLAID_ENV:'sandbox'},async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(url.endsWith('link/token/create')?{link_token:'link-sandbox-test'}:url.endsWith('item/public_token/exchange')?{access_token:'private-test-token'}:{}));});
 const link=await provider.createLinkToken('user','household');assert.equal(link.linkToken,'link-sandbox-test');assert.ok(!JSON.stringify(link).includes('secret'));
 const result=await provider.exchangeSandbox('public-sandbox-example');assert.equal(result.sandbox,true);assert.ok(!JSON.stringify(result).includes('private-test-token'));assert.ok(calls.some(c=>c.url.endsWith('item/remove')));
 assert.ok(calls.every(c=>c.url.startsWith('https://sandbox.plaid.com/')));assert.equal(provider.status().transfers,false);
});

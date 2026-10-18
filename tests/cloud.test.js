const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMock}=require('./helpers/mock-cloud.cjs');
const F=require('../finance');
function client(mock){
 let cookie='';
 const request=async(path,method='GET',body)=>{
  const response=await mock.handler(new Request('http://127.0.0.1'+path,{method,headers:{cookie,'content-type':'application/json','x-autonomy-client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const set=response.headers.getSetCookie();if(set.length)cookie=set.map(x=>x.split(';')[0]).join('; ');
  return {status:response.status,data:await response.json()};
 };
 return {request,signup:email=>request('/api/auth/signup','POST',{email,password:'synthetic-password-only'}),cookie:()=>cookie};
}
test('cloud accounts, household roles, invitations, conflicts and session revocation',async()=>{
 const mock=createMock(),owner=client(mock),editor=client(mock),stranger=client(mock),viewer=client(mock);
 assert.equal((await owner.request('/api/households')).status,401);
 await owner.signup('owner@example.test');await editor.signup('editor@example.test');await stranger.signup('stranger@example.test');await viewer.signup('viewer@example.test');
 const created=await owner.request('/api/households','POST',{name:'Family'});const householdId=created.data.id;assert.equal(created.status,201);
 assert.equal((await stranger.request('/api/household?household='+householdId)).status,403);
 assert.equal((await stranger.request('/api/plan','PUT',{householdId,revision:0,plan:F.defaults()})).status,403);
 const invited=await owner.request('/api/invitations','POST',{householdId,email:'editor@example.test',role:'editor'});
 const token=new URL(invited.data.url).hash.split('=')[1];
 assert.equal((await stranger.request('/api/invitations/accept','POST',{token})).status,400);
 assert.equal((await editor.request('/api/invitations/accept','POST',{token})).status,200);
 assert.equal((await editor.request('/api/invitations/accept','POST',{token})).status,400);
 assert.equal((await editor.request('/api/invitations','POST',{householdId,email:'stranger@example.test',role:'editor'})).status,403);
 let p=F.defaults();p.cashBalance=1000;
 assert.equal((await editor.request('/api/plan','PUT',{householdId,revision:0,plan:p})).status,200);
 assert.equal((await owner.request('/api/plan','PUT',{householdId,revision:0,plan:F.defaults()})).status,409);
 assert.equal((await owner.request('/api/household?household='+householdId)).data.plan.cashBalance,1000);
 const vi=await owner.request('/api/invitations','POST',{householdId,email:'viewer@example.test',role:'viewer'});
 await viewer.request('/api/invitations/accept','POST',{token:new URL(vi.data.url).hash.split('=')[1]});
 assert.equal((await viewer.request('/api/household?household='+householdId)).status,200);
 assert.equal((await viewer.request('/api/plan','PUT',{householdId,revision:1,plan:p})).status,403);
 assert.equal((await viewer.request('/api/reminders/run','POST',{householdId})).status,403);
 assert.equal((await owner.request('/api/plaid/link','POST',{householdId})).status,503);
 assert.equal((await owner.request('/api/payments/execute','POST',{householdId})).status,503);
 const member=mock.users.find(u=>u.email==='editor@example.test');
 assert.equal((await owner.request('/api/members/remove','POST',{householdId,userId:member.id})).status,200);
 assert.equal((await editor.request('/api/household?household='+householdId)).status,403);
 await owner.request('/api/auth/logout','POST',{});
 assert.equal((await owner.request('/api/households')).status,401);
});
test('request origin, content type, credentials and input validation fail closed',async()=>{
 const mock=createMock();
 const csrf=await mock.handler(new Request('http://127.0.0.1/api/auth/login',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json','X-Autonomy-Client':'web'},body:'{}'}));assert.equal(csrf.status,403);
 const noHeader=await mock.handler(new Request('http://127.0.0.1/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));assert.equal(noHeader.status,403);
 const malformed=await mock.handler(new Request('http://127.0.0.1/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Autonomy-Client':'web'},body:'{'}));assert.equal(malformed.status,400);
 const bad=client(mock);await bad.signup('test@example.test');
 const r=await bad.request('/api/auth/login','POST',{email:'test@example.test',password:'wrong-password-123'});assert.equal(r.status,401);
 const config=await bad.request('/api/config');assert.equal(config.data.capabilities.banks.ready,false);assert.equal(config.data.capabilities.payments.ready,false);
 const h=(await bad.request('/api/households','POST',{name:'Test'})).data.id;
 assert.equal((await bad.request('/api/plan','PUT',{householdId:h,revision:0,plan:{...F.defaults(),cashBalance:-1}})).status,400);
});
test('persistent session check rejects a revoked access token even if auth user exists',async()=>{
 const mock=createMock(),c=client(mock);await c.signup('test@example.test');mock.sessions.clear();assert.equal((await c.request('/api/households')).status,401);
 assert.equal((await c.request('/api/auth/logout','POST',{})).status,200);assert.match(c.cookie(),/autonomy_access=;/);
});
test('password recovery requests are persistently rate limited',async()=>{
 const c=client(createMock());for(let i=0;i<3;i++)assert.equal((await c.request('/api/auth/recover','POST',{email:'test@example.test'})).status,200);
 assert.equal((await c.request('/api/auth/recover','POST',{email:'TEST@example.test'})).status,429);
});
test('resend confirmation shares the recovery email rate limit',async()=>{
 const c=client(createMock());for(let i=0;i<3;i++)assert.equal((await c.request('/api/auth/resend','POST',{email:'test@example.test'})).status,200);
 assert.equal((await c.request('/api/auth/recover','POST',{email:'test@example.test'})).status,429);
});
test('email redirect sessions validate tokens and bind them to the same account',async()=>{
 const mock=createMock(),a=client(mock),b=client(mock),callback=client(mock);await a.signup('a@example.test');await b.signup('b@example.test');
 const tokens=c=>Object.fromEntries(c.cookie().split('; ').map(s=>{const i=s.indexOf('=');return [s.slice(0,i).replace('autonomy_','')+'_token',s.slice(i+1)];}));
 assert.equal((await callback.request('/api/auth/email-session','POST',tokens(a))).status,200);
 assert.equal((await callback.request('/api/session')).data.user.email,'a@example.test');
 const other=client(mock);assert.equal((await other.request('/api/auth/email-session','POST',{...tokens(a),refresh_token:tokens(b).refresh_token})).status,401);
 assert.equal((await other.request('/api/session')).data.user,null);
 assert.equal((await other.request('/api/auth/email-session','POST',{access_token:'forged-access',refresh_token:'forged-refresh'})).status,401);
});

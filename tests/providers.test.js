const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMock}=require('./helpers/mock-cloud.cjs');
const {makeBackend}=require('../cloud/backend');
const {randomUUID}=require('node:crypto');
test('Plaid tokens stay encrypted, sync is idempotent, and payroll records map net pay',async()=>{
 const mock=createMock();const calls=[];
 const env={...mock.env,PLAID_CLIENT_ID:'synthetic-client',PLAID_SECRET:'synthetic-secret',ARGYLE_KEY_ID:'synthetic-id',ARGYLE_KEY_SECRET:'synthetic-argyle'};
 const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 const bankAccount={account_id:'account-1',name:'Checking',mask:'1234',type:'depository',subtype:'checking',balances:{available:500,current:500,iso_currency_code:'USD'}};
 const fetcher=async(url,options)=>{
  if(url.startsWith('https://sandbox.plaid.com/')){
   const route=url.split('.com/')[1],body=JSON.parse(options.body);calls.push({route,body});
   if(route==='link/token/create')return json({link_token:'test-link-token'});
   if(route==='item/public_token/exchange')return json({item_id:'item-1',access_token:'sensitive-test-access-token'});
   if(route==='accounts/get')return json({accounts:[bankAccount]});
   if(route==='transactions/sync')return json({added:[{transaction_id:'tx-1',account_id:'account-1',name:'Groceries',merchant_name:'Market',date:'2026-10-18',amount:100,pending:false,personal_finance_category:{primary:'FOOD_AND_DRINK'}}],modified:[],removed:[],next_cursor:'cursor-1',has_more:false});
   if(route==='item/remove')return json({removed:true});
   return json({});
  }
  if(url.startsWith('https://api-sandbox.argyle.com/')){
   if(url.endsWith('/users'))return json({id:'payroll-1',user_token:'sensitive-user-link-token'});
   if(url.includes('/paystubs?'))return json({results:[{id:'stub-1',paystub_date:'2026-10-18T00:00:00Z',net_pay:'1234.56',gross_pay:'1600.00',currency:'USD',employer:'Example employer'}]});
  }
  return mock.fetch(url,options);
 };
 const handler=makeBackend(env,fetcher);let cookie='';
 async function req(route,body,method='POST'){
  const response=await handler(new Request('http://127.0.0.1'+route,{method,headers:{cookie,'content-type':'application/json','x-autonomy-client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  if(response.headers.getSetCookie().length)cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  return {status:response.status,data:await response.json()};
 }
 await req('/api/auth/signup',{email:'owner@example.test',password:'synthetic-password-only'});
 const householdId=(await req('/api/households',{name:'Test'})).data.id;
 const linked=await req('/api/plaid/link',{householdId});assert.equal(linked.status,200);assert.equal(linked.data.environment,'sandbox');
 assert.equal((await req('/api/plaid/exchange',{householdId,publicToken:'public-sandbox-test'})).status,200);
 assert.equal(mock.tables.bank_transactions.length,1);assert.equal(mock.tables.bank_accounts.length,1);
 assert.ok(!mock.tables.provider_secrets[0].ciphertext.includes('sensitive-test-access-token'));
 const bank=mock.tables.connections[0];
 await req('/api/connections/sync',{householdId,connectionId:bank.id});
 assert.equal(mock.tables.bank_transactions.length,1);assert.equal(mock.tables.provider_secrets[0].cursor,'cursor-1');
 assert.ok(calls.filter(c=>c.route==='transactions/sync').every(c=>c.body.access_token==='sensitive-test-access-token'));
 const data=await req('/api/household?household='+householdId,undefined,'GET');assert.ok(!JSON.stringify(data).includes('sensitive-test-access-token'));assert.ok(!JSON.stringify(data).includes('ciphertext'));
 const payroll=await req('/api/argyle/link',{householdId});assert.equal(payroll.status,200);assert.equal(payroll.data.sandbox,true);
 assert.equal((await req('/api/connections/sync',{householdId,connectionId:payroll.data.connectionId})).status,200);
 assert.equal(mock.tables.paystubs[0].net,1234.56);assert.equal(mock.tables.paystubs[0].gross,1600);
 assert.equal((await req('/api/connections/sync',{householdId,connectionId:randomUUID()})).status,404);
});

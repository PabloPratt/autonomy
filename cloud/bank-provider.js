'use strict';
// Provider contract: status(), createLinkToken(user,household), exchangeSandbox(token).
// The established Edge adapter retains full encrypted persistence and sync.
function createBankProvider(env={},fetcher=fetch){
 const ready=!!(env.PLAID_CLIENT_ID&&env.PLAID_SECRET)&&(!env.PLAID_ENV||env.PLAID_ENV==='sandbox');
 const fail=message=>{throw Object.assign(Error(message),{status:503});};
 async function call(route,data){
  if(!ready)fail('Bank linking is coming soon. Sandbox Plaid credentials are not configured. Manual entry and CSV import work now.');
  const res=await fetcher('https://sandbox.plaid.com/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET,...data}),signal:AbortSignal.timeout(20000)});
  const result=await res.json();if(!res.ok)fail('Sandbox bank linking could not be completed.');return result;
 }
 return {status:()=>({ready,environment:'sandbox',transfers:false}),async createLinkToken(user,household){const r=await call('link/token/create',{client_name:'AUTONOMY',user:{client_user_id:user+':'+household},products:['transactions'],country_codes:['US'],language:'en'});return {linkToken:r.link_token,environment:'sandbox'};},async exchangeSandbox(publicToken){if(typeof publicToken!=='string'||!publicToken.startsWith('public-sandbox-'))fail('Use a sandbox Link token.');const item=await call('item/public_token/exchange',{public_token:publicToken});await call('item/remove',{access_token:item.access_token});return {sandbox:true,message:'Sandbox Link verified. Test connection removed; persistent bank sync is coming soon. No real account or transfer was created.'};}};
}
module.exports={createBankProvider};

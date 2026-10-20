const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright-core');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createMock}=require('./helpers/mock-cloud.cjs'),mock=createMock(),ROOT=path.join(__dirname,'..');
const files={'/':'platform.html','/platform.js':'platform.js','/platform.css':'platform.css','/finance.js':'finance.js'};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/')){
   let body='';for await(const c of req)body+=c;
   const response=await mock.handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}));
   res.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')res.setHeader(k,v);});res.setHeader('Set-Cookie',response.headers.getSetCookie());res.end(await response.text());return;
  }
  const file=files[req.url.split('?')[0]];if(!file){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(ROOT,file)));
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
 try{
  const errors=[],ctx=await browser.newContext(),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#signupMode').click();
  await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('synthetic-password-only');await page.locator('#authSubmit').click();
  await page.locator('#householdName').fill('Test household');await page.locator('#householdForm button').click();
  await page.locator('#metrics .metric').first().waitFor();
  async function add(key,fields){
   await page.locator('[data-view="'+({incomes:'income',bills:'bills',debts:'debts',goals:'goals'}[key])+'"]').click();
   await page.locator('[data-add="'+key+'"]').click();
   for(const [k,v]of Object.entries(fields)){const input=page.locator('#edit-'+k);if((await input.evaluate(e=>e.tagName))==='SELECT')await input.selectOption(v);else await input.fill(String(v));}
   await page.locator('#editForm button.primary').click();await page.locator('#editDialog').waitFor({state:'hidden'});
  }
  await add('incomes',{name:'Primary salary',amount:2200,frequency:'biweekly',nextDate:'2026-10-20'});
  await add('bills',{name:'Housing',amount:1500,dueDay:1});
  await add('debts',{name:'Example card',balance:2500,apr:24,minimum:100,dueDay:15,creditLimit:5000});
  await add('goals',{name:'Emergency savings',target:3000,saved:500,monthly:200});
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved to'));
  await page.reload();await page.locator('#metrics .metric').first().waitFor();assert.equal(mock.tables.household_plans[0].data.debts[0].balance,2500);
  await page.locator('[data-view="paycheck"]').click();await page.locator('#paycheckPlan table').waitFor();
  await page.locator('#threeMonthPlan details').first().waitFor();
  await page.locator('#splitMode').selectOption('custom');await page.locator('#customShare').fill('75');await page.locator('#customShare').dispatchEvent('change');
  assert.match(await page.locator('#threeMonthPlan').textContent(),/75.0%/);
  await page.locator('#splitMode').selectOption('proportional');
  await page.locator('[data-view="goals"]').click();assert.match(await page.locator('#rainyProgress').textContent(),/months of bills saved/);
  await page.locator('[data-view="spending"]').click();await page.locator('#roast').check();
  assert.equal(await page.locator('#priceTable tbody tr').count(),7);
  await page.locator('[data-view="debts"]').click();assert.match(await page.locator('#debtComparison').textContent(),/avalanche/);assert.match(await page.locator('#debtComparison').textContent(),/snowball/);
  await page.locator('[data-view="bills"]').click();await page.locator('#billList [data-paid]').click();await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved to'));
  const cal=page.waitForEvent('download');await page.locator('#calendar').click();assert.match((await cal).suggestedFilename(),/reminders.ics/);
  await page.locator('#runReminders').click();await page.waitForFunction(()=>document.querySelector('#reminderStatus').textContent.includes('refreshed'));
  await page.locator('[data-view="spending"]').click();
  await page.locator('#csvFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from('date,name,amount,category\n2026-10-10,Grocery,120,Food\n2026-10-11,Deposit,-2200,Income')});
  page.once('dialog',d=>d.accept());
  await page.waitForFunction(()=>document.querySelector('#transactionList').textContent.includes('Grocery'));
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved to'));
  await page.locator('[data-view="credit"]').click();
  assert.match(await page.locator('#creditSummary').innerText(),/Not recorded/);
  await page.locator('#disputeRecipient').fill('Example bureau');await page.locator('#disputeCreditor').fill('Example creditor');await page.locator('#disputeReason').fill('Duplicate entry');await page.locator('#disputeCorrection').fill('Remove the duplicate entry');await page.locator('#disputeForm button').click();
  assert.match(await page.locator('#draftText').inputValue(),/Duplicate entry/);
  await page.locator('[data-view="family"]').click();await page.locator('#inviteEmail').fill('partner@example.test');await page.locator('#inviteRole').selectOption('viewer');await page.locator('#inviteForm button').click();
  const invite=await page.locator('#inviteResult a').getAttribute('href');
  const partnerCtx=await browser.newContext(),partner=await partnerCtx.newPage();
  await partner.goto(base+new URL(invite).hash);await partner.locator('#signupMode').click();await partner.locator('#email').fill('partner@example.test');await partner.locator('#password').fill('synthetic-password-only');await partner.locator('#authSubmit').click();
  await partner.locator('#metrics .metric').first().waitFor();assert.equal(await partner.locator('#rolePill').innerText(),'viewer');assert.equal(await partner.locator('#save').isDisabled(),true);
  await partner.locator('[data-view="debts"]').click();assert.equal(await partner.locator('#debtList [data-edit]').count(),0);
  await partnerCtx.close();
  await page.locator('[data-view="connections"]').click();assert.equal(await page.locator('#connectBank').isDisabled(),true);assert.match(await page.locator('#connectionCapabilities').innerText(),/Not activated/);
  await page.locator('[data-view="overview"]').click();await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(ROOT,'test-results','platform-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,'test-results','platform-mobile.png'),fullPage:true});
  // A pending save must keep its household; a failed switch must restore the old draft.
  const original=await page.locator('#householdSelect').inputValue();
  const second=await page.evaluate(async()=>{const r=await fetch('/api/households',{method:'POST',headers:{'Content-Type':'application/json','X-Autonomy-Client':'web'},body:JSON.stringify({name:'Second household'})});return (await r.json()).id;});
  await page.reload();await page.locator('#metrics .metric').first().waitFor();
  if(await page.locator('#toggleNav').isVisible())await page.locator('#toggleNav').click();
  await page.locator('[data-view="settings"]').click();await page.locator('#cashBalance').fill('321');await page.locator('#cashBalance').dispatchEvent('change');
  let releaseSave;const heldSave=new Promise(r=>releaseSave=r);let saveStarted;const saveStart=new Promise(r=>saveStarted=r);
  await page.route('**/api/plan',async route=>{saveStarted();await heldSave;await route.continue();});
  await page.locator('#save').click();await saveStart;assert.equal(await page.locator('#householdSelect').isDisabled(),true);
  await page.locator('#householdSelect').evaluate((el,id)=>{el.value=id;el.dispatchEvent(new Event('change'));},second);
  assert.equal(await page.locator('#householdSelect').inputValue(),original);releaseSave();
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved to'));await page.unroute('**/api/plan');
  assert.equal(mock.tables.household_plans.find(p=>p.household_id===original).data.cashBalance,321);
  assert.equal(mock.tables.household_plans.find(p=>p.household_id===second).data.cashBalance,0);
  await page.route('**/api/household?household='+second,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic unavailable household'})}));
  await page.locator('#householdSelect').selectOption(second);await page.waitForFunction(id=>document.querySelector('#householdSelect').value===id,original);
  assert.equal(await page.locator('#cashBalance').inputValue(),'321');assert.equal(await page.locator('#save').isDisabled(),false);
  await page.locator('#timezone').fill('Invalid/Timezone');await page.locator('#timezone').dispatchEvent('change');
  assert.equal(await page.locator('#timezone').evaluate(e=>e.checkValidity()),false);
  assert.deepEqual(errors,[]);await ctx.close();
  const verifyContext=await browser.newContext(),verifyPage=await verifyContext.newPage();
  await verifyPage.goto(base+'/#token_hash=synthetic-unused-hash&type=signup');
  await verifyPage.locator('#verifySubmit').waitFor({state:'visible'});
  assert.equal(await verifyPage.locator('#verifyPanel').evaluate(e=>e.open),true);
  assert.equal(await verifyPage.locator('#verifySubmit').innerText(),'Confirm my email');
  assert.equal(await verifyPage.locator('#verifyToken').inputValue(),'synthetic-unused-hash');
  assert.equal(await verifyPage.locator('#authForm').isVisible(),false);
  assert.equal(await verifyPage.evaluate(()=>location.hash),'');
  let verification;
  await verifyPage.route('**/api/auth/verify',route=>{verification=route.request().postDataJSON();return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Synthetic link used only to test parsing'})});});
  await verifyPage.locator('#verifyToken').fill(base+'/#token_hash=synthetic-recovery&type=recovery');await verifyPage.locator('#verifySubmit').click();
  await verifyPage.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Synthetic link'));
  assert.deepEqual(verification,{token_hash:'synthetic-recovery',type:'recovery'});
  await verifyContext.close();
  console.log('PASS: cloud UI signup/login, household creation, income/bills/debt/goals, shared save/reload, paycheck plan, paid checklist, reminders/calendar, CSV, dispute draft, household invitation, viewer restrictions, provider status, desktop/mobile.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());

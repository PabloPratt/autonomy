// Run with PLAYWRIGHT_PATH pointing to an existing playwright-core installation.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const ROOT=path.join(__dirname,'..');
const M=require('../model');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autonomy-browser-'));
process.env.AUTONOMY_DATA_DIR=temp;
const {createServer}=require('../server');
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/model.js':'model.js','/styles.css':'styles.css','/api/session':'runtime.json'};
const staticServer=http.createServer((req,res)=>{
 const file=files[req.url];
 if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.json')?'application/json':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
 res.end(fs.readFileSync(path.join(ROOT,file)));
});
const localServer=createServer();
(async()=>{
 await Promise.all([new Promise(r=>staticServer.listen(0,'127.0.0.1',r)),new Promise(r=>localServer.listen(0,'127.0.0.1',r))]);
 const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:'+staticServer.address().port;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Open my planner'}).click();
  assert.match(await page.locator('#storageNotice').innerText(),/No cloud sync/);
  const amount=page.locator('#billItems input[data-field="amount"]').first();
  await amount.fill('1000');await amount.press('Tab');
  await page.locator('#regularPaycheck').fill('2000');await page.locator('#regularPaycheck').press('Tab');
  await page.locator('#billsBalance').fill('6000');await page.locator('#billsBalance').press('Tab');
  await page.getByRole('button',{name:'Save plan',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved'));
  assert.equal(await page.locator('#monthlyTotal').innerText(),'$1,000.00');
  await page.reload();await page.getByRole('button',{name:'Open my planner'}).click();
  assert.equal(await page.locator('#billsBalance').inputValue(),'6000');
  assert.equal(await page.locator('#monthlyTotal').innerText(),'$1,000.00');
  await page.getByRole('button',{name:'Mark paid',exact:true}).first().click();
  await page.getByRole('button',{name:'Save plan',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved'));
  await page.locator('[data-add="goals"]').click();
  await page.locator('#itemName').fill('Emergency fund');await page.locator('#itemAmount').fill('3000');
  await page.locator('#addForm').getByRole('button',{name:'Add',exact:true}).click();
  await page.locator('#goalItems [data-field="monthly"]').fill('500');
  await page.locator('#goalItems [data-field="monthly"]').press('Tab');
  assert.equal(await page.locator('#freeTotal').innerText(),'$2,500.00');
  // HTML-like names must remain text, including after import.
  const plan=M.defaults();plan.bills[0].name='<img src=x onerror=alert(1)>';plan.bills[0].amount=75;
  page.once('dialog',d=>d.accept());
  await page.locator('#importData').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'AUTONOMY',version:2,plan}))});
  await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('imported and saved'));
  assert.equal(await page.locator('#billItems img').count(),0);
  assert.equal(await page.locator('#monthlyTotal').innerText(),'$75.00');
  const downloaded=page.waitForEvent('download');await page.locator('#exportData').click();
  const download=await downloaded;assert.match(download.suggestedFilename(),/autonomy-backup/);
  // Bad backups must not overwrite valid state.
  await page.locator('#importData').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"app":"AUTONOMY","version":2,"plan":{"billsBalance":-1}}')});
  await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('Import failed'));
  assert.equal(await page.locator('#monthlyTotal').innerText(),'$75.00');
  // Storage failure is visible and never treated as a successful save.
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};});
  await page.locator('#billsBalance').fill('100');await page.locator('#billsBalance').press('Tab');
  await page.locator('#saveData').click();
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Export a backup'));
  await page.reload();await page.getByRole('button',{name:'Open my planner'}).click();
  assert.equal(await page.locator('#billsBalance').inputValue(),'0');
  // A stale tab cannot silently overwrite a more recent save.
  const other=await context.newPage();await other.goto(base);await other.locator('#openBrowser').click();
  await page.locator('#billsBalance').fill('100');await page.locator('#billsBalance').press('Tab');
  await page.locator('#saveData').click();await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved'));
  assert.equal(await other.locator('#billsBalance').inputValue(),'100');
  await other.locator('#regularPaycheck').fill('999');await other.locator('#regularPaycheck').press('Tab');
  await page.locator('#billsBalance').fill('200');await page.locator('#billsBalance').press('Tab');
  await page.locator('#saveData').click();
  await other.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Another tab'));
  await other.close();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,'test-results','mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(ROOT,'test-results','desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.close();
  const corrupt=await browser.newContext();
  await corrupt.addInitScript(()=>localStorage.setItem('autonomy.plan.v2','{broken'));
  const cp=await corrupt.newPage();await cp.goto(base);
  await cp.locator('#recoverData').waitFor({state:'visible'});
  assert.equal(await cp.locator('#appShell').isVisible(),false);
  assert.equal(await cp.evaluate(()=>localStorage.getItem('autonomy.plan.v2')),'{broken');
  await corrupt.close();
  const failed=await browser.newContext();
  await failed.route('**/api/session',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"Service unavailable"}'}));
  const fp=await failed.newPage();await fp.goto(base);await fp.waitForFunction(()=>document.querySelector('#authError').textContent==='Service unavailable');
  assert.equal(await fp.locator('#openBrowser').isVisible(),false);
  await failed.close();
  // Real local owner login + server persistence; wrong passwords stay rejected.
  const local=await browser.newContext();const lp=await local.newPage();
  await lp.goto('http://127.0.0.1:'+localServer.address().port);
  await lp.locator('#authEmail').fill('test@example.test');await lp.locator('#authPassword').fill('synthetic-test-password');
  await lp.locator('#authSubmit').click();await lp.locator('#appShell').waitFor({state:'visible'});
  await lp.locator('#billsBalance').fill('1234');await lp.locator('#saveData').click();
  await lp.waitForFunction(()=>document.querySelector('#saveStatus').textContent.startsWith('Saved'));
  await lp.locator('#logout').click();await lp.locator('#authForm').waitFor({state:'visible'});
  await lp.locator('#authEmail').fill('test@example.test');await lp.locator('#authPassword').fill('incorrect-password');
  await lp.locator('#authSubmit').click();await lp.waitForFunction(()=>document.querySelector('#authError').textContent==='Invalid login.');
  assert.equal(await lp.locator('#appShell').isVisible(),false);
  await lp.locator('#authPassword').fill('synthetic-test-password');await lp.locator('#authSubmit').click();
  await lp.locator('#appShell').waitFor({state:'visible'});assert.equal(await lp.locator('#billsBalance').inputValue(),'1234');
  await local.close();
  console.log('PASS: browser persistence, bill checklist, goals, import/export, injection handling, storage failure, mobile layout, and local owner login/save/logout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 await Promise.all([new Promise(r=>staticServer.close(r)),new Promise(r=>localServer.close(r))]);
 fs.rmSync(temp,{recursive:true,force:true});
});

'use strict';
const F=Finance,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n||0);
let user,households=[],householdId,record,plan=F.defaults(),revision=0,dirty=false,saving=false,generation=0,authMode='login',view='overview',editCollection,editId,editDraft,capabilities={},toastTimer;
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:plan.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function toast(message,bad=false){$('toast').textContent=message;$('toast').classList.remove('hidden');$('toast').style.background=bad?'#7d302a':'#133f32';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),8000);}
async function api(path,method='GET',body){
 const res=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Autonomy-Client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 let data;try{data=await res.json();}catch{throw Error('The service returned an invalid response. Your last saved data is preserved.');}
 if(!res.ok){const e=Object.assign(new Error(data.error||'Request failed.'),{status:res.status});if(res.status===401&&user)toast('Your session ended. Export unsaved changes before reloading to log in.',true);throw e;}
 return data;
}
function writeAllowed(){return record&&['owner','editor'].includes(record.role);}
function changed(){generation++;dirty=true;$('saveStatus').textContent='Unsaved household changes';$('saveStatus').classList.remove('danger');renderSummary();}
async function save(){
 if(saving||!writeAllowed())return false;
 try{
  const invalid=document.querySelector('#settingsFields input:invalid, #extraDebtMonthly:invalid');if(invalid){go('settings');invalid.reportValidity();toast('Correct the highlighted value before saving.',true);return false;}
  const checked=F.validate(plan),savedGeneration=generation;saving=true;$('save').disabled=true;
  const data=await api('/api/plan','PUT',{householdId,revision,plan:checked});
  revision=data.revision;if(generation===savedGeneration){plan=data.plan;dirty=false;$('saveStatus').textContent='Saved to your household · '+new Date().toLocaleTimeString();}else{$('saveStatus').textContent='New edits are unsaved. Save again to share them.';}return !dirty;
 }catch(e){$('saveStatus').textContent=e.message+' Export your draft before reloading.';$('saveStatus').classList.add('danger');toast(e.message,true);return false;}
 finally{saving=false;$('save').disabled=!writeAllowed();}
}
function go(id){
 if(!document.querySelector('[data-pane="'+id+'"]'))return;
 view=id;document.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('hidden',p.dataset.pane!==id));
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
 $('pageTitle').textContent=document.querySelector('[data-view="'+id+'"]').textContent;window.scrollTo({top:0,behavior:'instant'});
}
async function start(){
 const session=await api('/api/session');user=session.user;if(!user)return;
 $('auth').classList.add('hidden');$('app').classList.remove('hidden');$('signedInAs').textContent='Signed in as '+user.email;
 const list=await api('/api/households');households=list.households;
 const invitation=sessionStorage.getItem('autonomy.pendingInvite');
 if(invitation){
  try{await api('/api/invitations/accept','POST',{token:invitation});sessionStorage.removeItem('autonomy.pendingInvite');households=(await api('/api/households')).households;toast('You joined the household.');}
  catch(e){toast(e.message,true);}
 }
 $('householdSelect').innerHTML=households.map(h=>'<option value="'+h.id+'">'+esc(h.name)+'</option>').join('');
 $('noHousehold').classList.toggle('hidden',households.length>0);
 if(!households.length){document.querySelectorAll('[data-pane]').forEach(p=>p.classList.add('hidden'));$('save').disabled=true;$('saveStatus').textContent='Create a household to begin.';return;}
 householdId=households.find(h=>h.id===sessionStorage.getItem('autonomy.currentHousehold'))?.id||households[0].id;
 $('householdSelect').value=householdId;await loadHousehold();go(view);
}
async function loadHousehold(){
 const data=await api('/api/household?household='+householdId);
 record=data;plan=F.validate(data.plan);revision=data.revision;capabilities=data.capabilities;dirty=false;
 sessionStorage.setItem('autonomy.currentHousehold',householdId);
 $('rolePill').textContent=data.role;$('save').disabled=!writeAllowed();
 $('saveStatus').textContent=plan.updatedAt?'Saved '+new Date(plan.updatedAt).toLocaleString():'Your household plan is ready. Add your income and expenses.';
 renderAll();
}
function empty(text){return '<p class="empty">'+esc(text)+'</p>';}
function renderSummary(){
 if(!record)return;
 const t=F.totals(plan),pc=F.paycheckPlan(plan,today()),ob=F.obligations(plan,today(),30);
 const metrics=[['Monthly take-home',money(t.income),'Average based on each income schedule.'],['Monthly plan',money(t.spending),'Bills, essentials, spending, and debt minimums.'],['Room after goals',money(t.free),'After savings and extra debt payments.'],['Debt remaining',money(t.debt),'Across the debts in your plan.']];
 $('metrics').innerHTML=metrics.map(([title,value,note])=>'<article class="metric"><span class="metric-label">'+title+'</span><strong'+(title==='Room after goals'&&t.free<0?' class="danger"':'')+'>'+value+'</strong><p>'+note+'</p></article>').join('');
 $('overviewGreeting').textContent=t.income?'A clearer picture. A stronger next step.':"Let's give your money a direction.";
 $('overviewMessage').textContent=t.income?(t.free<0?'Your plan needs '+money(-t.free)+' more each month. Start with spending choices and bill timing.':'Your monthly plan leaves '+money(t.free)+' after the goals and extra debt payments you entered.'):'Add your income, bills, and debts to see the full picture.';
 $('upcoming').innerHTML=ob.length?ob.slice(0,5).map(b=>'<div class="data-row"><div><h3>'+esc(b.name)+'</h3><p'+(b.overdue?' class="danger"':'')+'>'+b.date+(b.overdue?' · overdue':'')+'</p></div><strong>'+money(b.amount)+'</strong></div>').join(''):empty('No unpaid bills in the next 30 days.');
 $('nextPaySummary').innerHTML=pc.checks.length?'<p>'+esc(pc.checks.map(c=>c.name).join(' + '))+' · '+pc.date+'</p><div class="big-number">'+money(pc.total)+'</div><p>'+money(pc.left)+' unallocated'+(pc.shortfall?' · '+money(pc.shortfall)+' planned shortfall':'')+'</p>':empty('Add a take-home income source and next payday.');
 $('paycheckPlan').innerHTML=pc.checks.length?'<div class="big-number">'+money(pc.total)+'</div><p>Expected '+pc.date+' · next household payday '+(pc.nextDate||'not scheduled')+'</p>'+pc.warnings.map(w=>'<div class="callout bad">'+esc(w)+'</div>').join('')+'<div class="table-scroll"><table class="allocation-table"><thead><tr><th>Purpose</th><th>Due / target</th><th>Needed</th><th>From this check</th><th>Shortfall</th></tr></thead><tbody>'+pc.allocations.map(a=>'<tr><td>'+esc(a.name)+'</td><td>'+esc(a.due||'Before next payday')+'</td><td>'+money(a.need)+'</td><td>'+money(a.allocated)+'</td><td'+(a.shortfall?' class="danger"':'')+'>'+money(a.shortfall)+'</td></tr>').join('')+'</tbody></table></div><div class="callout">'+money(pc.left)+' remains unallocated. Current cash: '+money(plan.cashBalance)+'; cash floor: '+money(plan.cashFloor)+'. Existing cash is not automatically counted toward every bill—enter reserved amounts for cash already earmarked.</div>':empty('Add your income schedule to build a paycheck plan.');
 const payoff=F.payoff(plan),base=F.payoff({...plan,extraDebtMonthly:0},0);
 $('payoffSummary').innerHTML='<div class="two-col"><div><p class="eyebrow">YOUR PLAN</p><div class="big-number">'+(payoff.months===0?'Debt-free':payoff.feasible?payoff.months+' months':'Not paid off within 50 years')+'</div><p>'+money(payoff.interest)+' modeled interest.</p></div><div><p class="eyebrow">MINIMUM BUDGET ONLY</p><div class="big-number">'+(base.months===0?'No debt':base.feasible?base.months+' months':'More than 50 years')+'</div><p>'+money(base.interest)+' modeled interest.</p></div></div>'+(t.free<0?'<div class="callout bad">This payoff budget exceeds regular income by '+money(-t.free)+' a month. Adjust the plan before relying on this timeline.</div>':'');
 const c=F.credit(plan);
 $('creditSummary').innerHTML='<div class="two-col"><div><p class="eyebrow">LAST RECORDED SCORE</p><div class="big-number">'+(c.latest?c.latest.score:'Not recorded')+'</div><p>'+(c.latest?esc(c.latest.source+' · '+c.latest.model+' · '+c.latest.date):'Record a score from a real source. We do not invent one.')+'</p></div><div><p class="eyebrow">ENTERED CARD UTILIZATION</p><div class="big-number">'+(c.utilization===null?'—':c.utilization.toFixed(1)+'%')+'</div><p>Based only on cards with credit limits entered. This is not your full credit profile.</p></div></div><ul>'+c.actions.map(a=>'<li>'+esc(a)+'</li>').join('')+'</ul>';
 const tx=[...plan.transactions,...record.transactions],insights=F.spendingInsights(tx,today());
 $('spendingInsights').innerHTML='<p>Last 30 days: '+money(insights.spent)+' spending · '+money(insights.income)+' incoming deposits (not necessarily payroll).</p>'+(insights.categories.length?insights.categories.map(([name,amount])=>'<div class="bar-row"><span>'+esc(name)+'</span><span class="bar"><i style="width:'+Math.min(100,amount/Math.max(insights.spent,1)*100)+'%"></i></span><strong>'+money(amount)+'</strong></div>').join(''):empty('Connect bank transactions or import a CSV to see spending patterns.'))+'<h3>Recurring merchant suggestions</h3>'+(insights.recurring.length?insights.recurring.slice(0,10).map(r=>'<div class="data-row"><div><h3>'+esc(r.name)+'</h3><p>'+r.occurrences+' charges · verify before adding a bill</p></div><div class="row-actions"><strong>'+money(r.amount)+'</strong><button data-recurring="'+esc(r.name)+'" data-amount="'+r.amount+'">Review as bill</button></div></div>').join(''):empty('More than one month of posted transactions is needed to suggest recurring merchants.'));
 $('spendingInsights').querySelectorAll('[data-recurring]').forEach(b=>b.onclick=()=>openEditor('bills',null,{name:b.dataset.recurring,amount:Number(b.dataset.amount)}));
 $('notifications').innerHTML=record.notifications.length?record.notifications.slice(0,10).map(n=>'<div class="notification"><strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p><span class="small muted">'+esc(n.event_date)+'</span></div>').join(''):empty('No reminders yet. Add due dates, then refresh reminders on the Bills screen.');
}
const definitions={
 incomes:{title:'Income',fields:[['name','Name / earner','text'],['amount','Take-home pay per check','number'],['frequency','Pay frequency','frequency'],['nextDate','Next payday','date']]},
 bills:{title:'Bill',fields:[['name','Bill name','text'],['amount','Monthly amount','number'],['dueDay','Due day of month','day'],['reserved','Cash already reserved for next payment','number'],['url','Provider payment website','url'],['autopay','Autopay arranged with provider','checkbox']]},
 variables:{title:'Essential category',fields:[['name','Category','text'],['amount','Monthly amount','number']]},
 spending:{title:'Spending category',fields:[['name','Category','text'],['amount','Monthly amount','number']]},
 debts:{title:'Debt',fields:[['name','Creditor / debt label','text'],['type','Debt type','debtType'],['balance','Current balance','number'],['apr','APR %','apr'],['minimum','Monthly minimum','number'],['dueDay','Due day','day'],['reserved','Cash reserved for next minimum','number'],['creditLimit','Credit limit (cards only)','number'],['url','Creditor payment website','url']]},
 goals:{title:'Savings goal',fields:[['name','Goal name','text'],['target','Target amount','positive'],['saved','Already saved','number'],['monthly','Monthly contribution','number'],['targetDate','Target date (optional)','optionalDate']]},
 transactions:{title:'Transaction',fields:[['name','Merchant / description','text'],['amount','Amount (positive spending, negative deposit)','signed'],['date','Transaction date','date'],['category','Category','text'],['is_transfer','Internal transfer or debt payment (exclude from spending)','checkbox']]},
 creditScores:{title:'Credit score',fields:[['score','Score from real source (300–850)','score'],['date','Score date','date'],['source','Bank or bureau source','text'],['model','Scoring model / version','text']]}
};
function newRow(key){const row={id:crypto.randomUUID()};for(const [field,,type]of definitions[key].fields)row[field]=type==='checkbox'?false:['number','signed','apr','day','score','positive'].includes(type)?(type==='day'?1:type==='score'?650:type==='positive'?1000:0):type==='frequency'?'biweekly':type==='debtType'?'credit_card':type==='date'?today():'';if(['bills','debts'].includes(key))row.paidMonths=[];return row;}
function openEditor(key,id,seed={}){
 if(!writeAllowed()){toast('Your household role is read-only.',true);return;}
 editCollection=key;editId=id;const row=id?plan[key].find(r=>r.id===id):{...newRow(key),...seed};editDraft=structuredClone(row);
 $('editTitle').textContent=(id?'Edit ':'Add ')+definitions[key].title.toLowerCase();$('editError').textContent='';
 $('editFields').innerHTML=definitions[key].fields.map(([field,label,type])=>{
  const name='edit-'+field;
  if(type==='checkbox')return '<label class="check"><input id="'+name+'" type="checkbox" '+(row[field]?'checked':'')+'>'+label+'</label>';
  const enums={frequency:[['weekly','Weekly'],['biweekly','Every two weeks'],['semimonthly','Twice monthly (15th / month-end)'],['monthly','Monthly']],debtType:[['credit_card','Credit card'],['loan','Loan'],['collection','Collection'],['other','Other']]};
  if(enums[type])return '<label>'+label+'<select id="'+name+'">'+enums[type].map(([v,n])=>'<option value="'+v+'" '+(row[field]===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>';
  const num=['number','signed','day','apr','score','positive'].includes(type);
  const min=type==='signed'?-1e9:type==='positive'?.01:type==='day'?1:type==='score'?300:0,max=type==='day'?31:type==='score'?850:type==='apr'?1000:1e9;
  return '<label>'+label+'<input id="'+name+'" type="'+(num?'number':type==='optionalDate'?'date':type)+'" value="'+esc(row[field])+'" '+(num?'min="'+min+'" max="'+max+'" step="'+(['day','score'].includes(type)?1:.01)+'"':'maxlength="200"')+' '+(type==='url'||type==='optionalDate'?'':'required')+'></label>';
 }).join('');$('editDialog').showModal();$('editFields').querySelector('input,select').focus();
}
function renderList(key,container){
 const rows=plan[key],allowed=writeAllowed();
 $(container).innerHTML=rows.length?rows.map(row=>{
  let description='',amount='',paid=false;
  if(key==='incomes'){description=row.frequency+' · next '+row.nextDate;amount=money(row.amount);}
  else if(key==='bills'||key==='debts'){
   const month=today().slice(0,7);paid=row.paidMonths.includes(month);
   description=(key==='debts'?row.apr+'% APR · '+money(row.minimum)+' minimum · ':'')+'due day '+row.dueDay+(paid?' · paid this month':' · unpaid')+(row.reserved?' · '+money(row.reserved)+' reserved':'');amount=money(key==='debts'?row.balance:row.amount);
  }else if(key==='goals'){description=money(row.saved)+' of '+money(row.target)+' · '+money(row.monthly)+'/month';amount=Math.min(100,row.saved/row.target*100).toFixed(0)+'%';}
  else if(key==='transactions'){description=row.date+' · '+row.category+(row.is_transfer?' · excluded transfer':'');amount=money(row.amount);}
  else if(key==='creditScores'){description=row.source+' · '+row.model+' · '+row.date;amount=row.score;}
  else amount=money(row.amount);
  return '<div class="'+(key==='goals'?'goal-item':'')+'"><div class="data-row"><div><h3>'+esc(row.name||row.source)+'</h3><p>'+esc(description)+'</p></div><div class="row-actions"><span class="row-amount">'+amount+'</span>'+(['bills','debts'].includes(key)&&allowed?'<button data-paid="'+row.id+'">'+(paid?'Undo paid':'Mark paid')+'</button>':'')+(row.url?'<a href="'+esc(row.url)+'" target="_blank" rel="noopener noreferrer">Provider website ↗</a>':'')+(allowed?'<button data-edit="'+row.id+'">Edit</button><button data-delete="'+row.id+'" class="danger">Remove</button>':'')+'</div></div>'+(key==='goals'?'<progress value="'+Math.min(row.saved,row.target)+'" max="'+row.target+'" aria-label="'+esc(row.name)+' progress"></progress>':'')+'</div>';
 }).join(''):empty('No '+definitions[key].title.toLowerCase()+' entries yet.');
 $(container).querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(key,b.dataset.edit));
 $(container).querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(!confirm('Remove this entry from your household plan?'))return;plan[key]=plan[key].filter(r=>r.id!==b.dataset.delete);changed();renderLists();});
 $(container).querySelectorAll('[data-paid]').forEach(b=>b.onclick=()=>{const row=plan[key].find(r=>r.id===b.dataset.paid),month=today().slice(0,7);row.paidMonths=row.paidMonths.includes(month)?row.paidMonths.filter(m=>m!==month):[...row.paidMonths.slice(-119),month];row.reserved=0;changed();renderLists();});
}
function renderLists(){
 for(const [key,id]of [['bills','billList'],['incomes','incomeList'],['debts','debtList'],['goals','goalList'],['variables','variableList'],['spending','spendingList'],['transactions','transactionList'],['creditScores','scoreList']])renderList(key,id);
}
function renderConnections(){
 const c=capabilities;
 $('connectionCapabilities').innerHTML=[['banks','Bank transactions & balances',c.banks?.ready?'Secure bank linking is available.':'Provider activation is required before live banks can be linked.'],['payroll','Payroll records',c.payroll?.ready?'Secure payroll linking is available.':'Provider activation is required before payroll can be linked.']].map(([key,title,note])=>'<div class="provider"><span class="pill">'+(c[key]?.ready?(c[key].environment==='sandbox'?'Sandbox only':'Live provider enabled'):'Not activated')+'</span><h3>'+title+'</h3><p>'+note+'</p></div>').join('');
 for(const id of ['connectBank'])$(id).disabled=!c.banks?.ready||record.role!=='owner';
 for(const id of ['connectPayroll','connectPayroll2'])$(id).disabled=!c.payroll?.ready||record.role!=='owner';
 $('emailStatus').textContent=c.email?.ready?'Email delivery service is configured. Reminders send a generic sign-in notice, without balances in the email.':'Email delivery is not activated. In-app reminders and downloaded calendar alerts are available.';
 $('connectionList').innerHTML=record.connections.length?record.connections.map(x=>'<div class="data-row"><div><h3>'+esc(x.label||x.provider)+'</h3><p>'+esc(x.provider+' · '+x.environment+' · '+x.status)+'<br>Last sync: '+esc(x.last_sync?new Date(x.last_sync).toLocaleString():'not yet')+'</p></div>'+(record.role==='owner'?'<div class="row-actions"><button data-sync="'+x.id+'">Sync</button><button data-disconnect="'+x.id+'">Disconnect & remove imported data</button></div>':'')+'</div>').join(''):empty('No linked providers. You can still enter your plan and import transactions.');
 $('connectionList').querySelectorAll('[data-sync]').forEach(b=>b.onclick=()=>action(async()=>{await api('/api/connections/sync','POST',{householdId,connectionId:b.dataset.sync});await refreshSafe();toast('Connection synchronized.');}));
 $('connectionList').querySelectorAll('[data-sync]').forEach(b=>{
  if(record.connections.find(c=>c.id===b.dataset.sync)?.provider!=='plaid')return;
  const review=document.createElement('button');review.textContent='Review supported debts';b.parentElement.append(review);
  review.onclick=()=>action(async()=>{
   const data=await api('/api/plaid/liabilities','POST',{householdId,connectionId:b.dataset.sync});
   const section=document.createElement('section');section.className='card';const note=document.createElement('p');note.textContent=data.note;section.append(note);
   for(const suggestion of data.suggestions){const row=document.createElement('div');row.className='data-row';const text=document.createElement('p');text.textContent=suggestion.name+' · '+money(suggestion.balance);row.append(text);const add=document.createElement('button');add.textContent=plan.debts.some(d=>d.id===suggestion.id)?'Already in plan':'Review & add';add.disabled=plan.debts.some(d=>d.id===suggestion.id);add.onclick=()=>openEditor('debts',null,suggestion);row.append(add);section.append(row);}
   if(!data.suggestions.length){const p=document.createElement('p');p.textContent='No supported debt details were returned. Check product consent and institution coverage.';section.append(p);}
   $('connectionList').append(section);
  });
 });
 $('connectionList').querySelectorAll('[data-disconnect]').forEach(b=>b.onclick=()=>action(async()=>{if(!confirm('Disconnect this provider and delete its imported accounts and transactions from the household?'))return;await api('/api/connections/disconnect','POST',{householdId,connectionId:b.dataset.disconnect});await refreshSafe();}));
 $('accountList').innerHTML=record.accounts.length?record.accounts.map(a=>'<div class="data-row"><div><h3>'+esc(a.name)+(a.mask?' · '+esc(a.mask):'')+'</h3><p>'+esc(a.type+' · '+a.currency)+' · '+new Date(a.updated_at).toLocaleString()+'</p></div><strong>'+money(a.balance)+'</strong></div>').join(''):empty('No bank accounts linked.');
 $('useBankCash').disabled=!writeAllowed()||!record.accounts.some(a=>a.type==='depository'&&a.currency==='USD');
 $('paystubList').innerHTML=record.paystubs.length?record.paystubs.map(s=>'<div class="data-row"><div><h3>'+esc(s.employer||'Payroll record')+'</h3><p>'+esc(s.pay_date)+' · '+esc(s.currency)+' · net '+money(s.net)+'</p></div>'+(writeAllowed()&&s.currency==='USD'?'<button data-paystub="'+s.id+'">Use as income</button>':'')+'</div>').join(''):empty('Connect payroll to import provider records, or enter your take-home income above.');
 $('paystubList').querySelectorAll('[data-paystub]').forEach(b=>b.onclick=()=>{const s=record.paystubs.find(x=>x.id===b.dataset.paystub);openEditor('incomes',null,{name:s.employer||'Payroll',amount:Number(s.net),nextDate:today()});});
}
function renderFamily(){
 $('memberList').innerHTML=record.members.map(m=>'<div class="data-row"><div class="member-email"><h3>'+esc(m.email)+'</h3><p>'+m.role+'</p></div>'+(record.role==='owner'&&m.role!=='owner'?'<div class="row-actions"><select data-member-role="'+m.user_id+'" aria-label="Role for '+esc(m.email)+'"><option value="editor" '+(m.role==='editor'?'selected':'')+'>Editor</option><option value="viewer" '+(m.role==='viewer'?'selected':'')+'>Viewer</option></select><button data-remove-member="'+m.user_id+'" class="danger">Remove</button></div>':'')+'</div>').join('');
 $('inviteCard').classList.toggle('hidden',record.role!=='owner');
 $('memberList').querySelectorAll('[data-member-role]').forEach(el=>el.onchange=()=>action(async()=>{await api('/api/members/role','POST',{householdId,userId:el.dataset.memberRole,role:el.value});await refreshSafe();}));
 $('memberList').querySelectorAll('[data-remove-member]').forEach(el=>el.onclick=()=>action(async()=>{if(!confirm('Remove this person from your household?'))return;await api('/api/members/remove','POST',{householdId,userId:el.dataset.removeMember});await refreshSafe();}));
}
const settingDefs=[['cashBalance','Available household cash',0,1e9,.01],['cashFloor','Cash floor to preserve',0,1e9,.01],['monthsToCover','Reserve months',1,60,.25],['bufferPct','Reserve buffer %',0,100,1],['reminderDays','Remind this many days before due',0,30,1]];
function renderSettings(){
 $('settingsFields').innerHTML=settingDefs.map(([id,label,min,max,step])=>'<label>'+label+'<input id="'+id+'" data-setting="'+id+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" required value="'+plan[id]+'"></label>').join('')+'<label>Timezone<input id="timezone" value="'+esc(plan.timezone)+'" required></label>';
 $('settingsFields').querySelectorAll('[data-setting]').forEach(el=>el.onchange=()=>{if(!el.checkValidity()){el.reportValidity();return;}plan[el.dataset.setting]=Number(el.value);changed();});
 $('timezone').onchange=()=>{try{new Intl.DateTimeFormat('en-US',{timeZone:$('timezone').value}).format();plan.timezone=$('timezone').value;changed();}catch{toast('Use a timezone such as America/Chicago.',true);}};
 $('emailReminders').checked=plan.emailReminders;$('debtStrategy').value=plan.debtStrategy;$('extraDebtMonthly').value=plan.extraDebtMonthly;
 const disabled=!writeAllowed();$('settingsFields').querySelectorAll('input').forEach(el=>el.disabled=disabled);for(const id of ['emailReminders','debtStrategy','extraDebtMonthly','csvFile','migrate','import','runReminders'])$(id).disabled=disabled;
}
function renderAll(){renderSummary();renderLists();renderConnections();renderFamily();renderSettings();document.querySelectorAll('[data-add]').forEach(b=>b.disabled=!writeAllowed());}
async function refreshSafe(){if(dirty){toast('Save or export your current changes before refreshing.',true);return;}await loadHousehold();}
function action(fn){return async function(...args){try{await fn(...args);}catch(e){toast(e.message,true);}}();}
function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function providerScript(url,globalName){if(window[globalName])return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(Error('Unable to open the provider connection window.'));document.head.append(s);});}
async function linkBank(){
 if(dirty){toast('Save your household changes before connecting an account.',true);return;}
 const data=await api('/api/plaid/link','POST',{householdId});await providerScript('https://cdn.plaid.com/link/v2/stable/link-initialize.js','Plaid');
 const instance=Plaid.create({token:data.linkToken,onSuccess:(publicToken)=>action(async()=>{await api('/api/plaid/exchange','POST',{householdId,publicToken});await loadHousehold();toast(data.environment==='sandbox'?'Sandbox bank connected. This is test data.':'Bank connected.');}),onExit:error=>{if(error)toast(error.display_message||'Bank connection was not completed.',true);instance.destroy();}});instance.open();
}
async function linkPayroll(){
 if(dirty){toast('Save changes before connecting payroll.',true);return;}
 const data=await api('/api/argyle/link','POST',{householdId});await providerScript('https://plugin.argyle.com/argyle.web.v5.js','Argyle');
 const instance=Argyle.create({userToken:data.userToken,sandbox:data.sandbox,onAccountConnected:()=>action(async()=>{await api('/api/connections/sync','POST',{householdId,connectionId:data.connectionId});await loadHousehold();}),onClose:()=>instance.destroy()});instance.open();
}
function csvParse(text){
 const rows=[];let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}
 else if(!quote&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(x=>x.trim()))rows.push(row);row=[];}}
 else cell+=c;
 }if(quote)throw Error('The CSV contains an unclosed quoted field.');row.push(cell.replace(/\r$/,''));if(row.some(x=>x.trim()))rows.push(row);return rows;
}
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function boot(){
 const fragment=new URLSearchParams(location.hash.slice(1));
 if(fragment.has('invite')){sessionStorage.setItem('autonomy.pendingInvite',fragment.get('invite'));history.replaceState(null,'',location.pathname);}
 // Recovery tokens returned by Supabase are used only long enough to establish an HttpOnly session.
 if(fragment.has('token_hash')){$('verifyToken').value=fragment.get('token_hash');$('verifyType').value=fragment.get('type')==='recovery'?'recovery':'signup';history.replaceState(null,'',location.pathname);}
 $('loginMode').onclick=()=>setAuthMode('login');$('signupMode').onclick=()=>setAuthMode('signup');
 function setAuthMode(mode){authMode=mode;$('authHeading').textContent=mode==='signup'?'Create your account':'Welcome back';$('authSubmit').textContent=mode==='signup'?'Create account':'Log in';$('loginMode').setAttribute('aria-pressed',mode==='login');$('signupMode').setAttribute('aria-pressed',mode==='signup');$('password').autocomplete=mode==='signup'?'new-password':'current-password';}
 $('authForm').onsubmit=async e=>{e.preventDefault();$('authSubmit').disabled=true;$('authMessage').textContent='';try{const data=await api('/api/auth/'+authMode,'POST',{email:$('email').value,password:$('password').value});$('password').value='';$('authMessage').textContent=data.message;if(!data.confirmationRequired)await start();}catch(error){$('authMessage').textContent=error.message;}finally{$('authSubmit').disabled=false;}};
 $('forgot').onclick=()=>action(async()=>{if(!$('email').value||!$('email').checkValidity()){$('email').reportValidity();return;}const data=await api('/api/auth/recover','POST',{email:$('email').value});$('authMessage').textContent=data.message;});
 $('verifyForm').onsubmit=e=>{e.preventDefault();action(async()=>{let token=$('verifyToken').value.trim();try{const url=new URL(token);token=url.searchParams.get('token')||url.searchParams.get('token_hash')||token;}catch{}await api('/api/auth/verify','POST',{token_hash:token,type:$('verifyType').value});$('verifyToken').value='';await start();if($('verifyType').value==='recovery'){go('settings');$('newPassword').focus();}});};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openEditor(b.dataset.add));
 $('save').onclick=()=>save();$('refresh').onclick=()=>action(refreshSafe);
 $('logout').onclick=()=>action(async()=>{if(dirty&&!confirm('Log out without saving your current changes? Export a backup first if needed.'))return;await api('/api/auth/logout','POST',{});dirty=false;location.reload();});
 $('householdSelect').onchange=()=>action(async()=>{if(dirty&&!confirm('Switch households and discard unsaved changes?')){$('householdSelect').value=householdId;return;}householdId=$('householdSelect').value;await loadHousehold();});
 $('householdForm').onsubmit=e=>{e.preventDefault();action(async()=>{const h=await api('/api/households','POST',{name:$('householdName').value});sessionStorage.setItem('autonomy.currentHousehold',h.id);await start();});};
 $('editForm').onsubmit=e=>{
  e.preventDefault();try{
   const row=structuredClone(editDraft);
   for(const [field,,type]of definitions[editCollection].fields){const input=$('edit-'+field);row[field]=type==='checkbox'?input.checked:['number','signed','day','apr','score','positive'].includes(type)?Number(input.value):input.value.trim();}
   const next=structuredClone(plan);if(editId)next[editCollection]=next[editCollection].map(r=>r.id===editId?row:r);else next[editCollection].push(row);
   plan=F.validate(next);changed();renderLists();$('editDialog').close();
  }catch(error){$('editError').textContent=error.message;}
 };
 $('cancelEdit').onclick=()=>$('editDialog').close();
 $('debtStrategy').onchange=()=>{plan.debtStrategy=$('debtStrategy').value;changed();};
 $('extraDebtMonthly').onchange=()=>{if(!$('extraDebtMonthly').checkValidity())return;plan.extraDebtMonthly=Number($('extraDebtMonthly').value);changed();};
 $('emailReminders').onchange=()=>{plan.emailReminders=$('emailReminders').checked;changed();};
 $('calendar').onclick=()=>download('autonomy-bill-reminders.ics',F.calendar(plan,today()),'text/calendar');
 $('runReminders').onclick=()=>action(async()=>{if(dirty&&!await save())return;const result=await api('/api/reminders/run','POST',{householdId});await loadHousehold();$('reminderStatus').textContent='In-app reminders refreshed.'+(result.emailReady?'':' Email delivery is not activated.');toast('Reminders refreshed.');});
 $('connectBank').onclick=()=>action(linkBank);$('connectPayroll').onclick=()=>action(linkPayroll);$('connectPayroll2').onclick=()=>action(linkPayroll);
 $('useBankCash').onclick=()=>{const cash=record.accounts.filter(a=>a.type==='depository'&&a.currency==='USD').reduce((n,a)=>n+Math.max(0,Number(a.balance)||0),0);if(!confirm('Replace available household cash with '+money(cash)+' from linked USD deposit accounts? This replaces the amount; it does not add cash twice.'))return;plan.cashBalance=F.round(cash);changed();renderSettings();toast('Cash updated in your draft. Save changes to share it.');};
 $('inviteForm').onsubmit=e=>{e.preventDefault();action(async()=>{const data=await api('/api/invitations','POST',{householdId,email:$('inviteEmail').value,role:$('inviteRole').value});$('inviteResult').replaceChildren();const a=document.createElement('a');a.href=data.url;a.textContent=data.url;$('inviteResult').append('Share this link with the invited person: ',a);});};
 $('export').onclick=()=>{download('autonomy-household-'+today()+'.json',JSON.stringify({app:'AUTONOMY',version:3,exportedAt:new Date().toISOString(),plan},null,2));$('backupStatus').textContent='Plan backup downloaded. Bank connection tokens are never included.';};
 $('import').onchange=e=>action(async()=>{try{const file=e.target.files[0];if(!file)return;if(file.size>1800000)throw Error('Backup must be under 1.8 MB.');const data=JSON.parse(await file.text());if(data.app!=='AUTONOMY'||![2,3].includes(data.version))throw Error('Choose an AUTONOMY backup.');const next=F.migrate(data.plan);if(!confirm('Replace the household plan draft with this backup? This does not replace bank connections.'))return;plan=next;changed();renderAll();$('backupStatus').textContent='Imported into your draft. Save changes to update the household.';}finally{e.target.value='';}});
 $('migrate').onclick=()=>action(async()=>{const raw=localStorage.getItem('autonomy.plan.v2')||localStorage.getItem('autonomy.hosted.plan.v1');if(!raw)throw Error('No previous browser plan was found in this browser profile.');const stored=JSON.parse(raw),next=F.migrate(stored.plan||stored);if(!confirm('Import the previous browser plan into this household draft? The old browser copy will be preserved.'))return;plan=next;changed();renderAll();toast('Previous plan imported into your draft. Save to share it.');});
 $('csvFile').onchange=e=>action(async()=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>2000000)throw Error('CSV must be under 2 MB.');const rows=csvParse((await file.text()).replace(/^\uFEFF/,''));const headers=rows.shift()?.map(x=>x.trim().toLowerCase());for(const k of ['date','name','amount'])if(!headers?.includes(k))throw Error('CSV needs date, name, and amount headers.');const ids=new Set(plan.transactions.map(t=>t.id)),added=[];
  for(const r of rows){const o=Object.fromEntries(headers.map((h,i)=>[h,r[i]||'']));const row={id:'csv-'+await digest([o.date,o.name,o.amount,o.category].join('|')),date:o.date.trim(),name:o.name.trim(),amount:Number(o.amount.replace(/[$,]/g,'')),category:o.category.trim()||'Other',is_transfer:/^(true|1|yes)$/i.test(o.is_transfer)};if(!ids.has(row.id)){added.push(row);ids.add(row.id);}}
  const next=F.validate({...plan,transactions:[...plan.transactions,...added]});if(!confirm('Import '+added.length+' unique transactions into your household draft?'))return;plan=next;changed();renderLists();toast(added.length+' transactions imported. Save changes to share them.');
  }finally{e.target.value='';}
 });
 $('disputeForm').onsubmit=e=>{e.preventDefault();try{$('draftText').value=F.dispute({recipient:$('disputeRecipient').value,creditor:$('disputeCreditor').value,reason:$('disputeReason').value,correction:$('disputeCorrection').value,evidence:$('disputeEvidence').value,type:$('disputeType').value});$('draftLabel').classList.remove('hidden');$('downloadDraft').classList.remove('hidden');}catch(error){toast(error.message,true);}};
 $('downloadDraft').onclick=()=>download('autonomy-dispute-draft.txt',$('draftText').value,'text/plain');
 $('passwordForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('/api/auth/password','PUT',{password:$('newPassword').value});$('newPassword').value='';$('passwordStatus').textContent='Password updated.';});};
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 const deployment=await api('/api/config');if(!deployment.capabilities.auth?.signupReady){$('authDeploymentStatus').textContent='New-account and recovery email delivery still needs activation for this deployment. Existing verified accounts can log in.';$('authDeploymentStatus').classList.remove('hidden');}
 await start();
 setInterval(async()=>{if(!user||!householdId||dirty||saving||document.hidden)return;try{const data=await api('/api/household?household='+householdId);if(data.revision!==revision||data.role!==record.role){record=data;plan=F.validate(data.plan);revision=data.revision;capabilities=data.capabilities;renderAll();$('saveStatus').textContent='Updated from your household.';}}catch{}},30000);
}
boot().catch(e=>{$('authMessage').textContent=e.message;toast(e.message,true);});

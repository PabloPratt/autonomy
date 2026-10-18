(function(root){
'use strict';
const DAY=86400000, averageMonth=365.25/12;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const iso=d=>new Date(d).toISOString().slice(0,10);
function date(s){const d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(d)||iso(d)!==s)throw Error('Use a valid date.');return d;}
const add=(d,n)=>new Date(d.getTime()+n*DAY);
const sum=(a,k)=>round(a.reduce((n,x)=>n+Number(x[k]||0),0));
function defaults(){return {version:3,cashBalance:0,cashFloor:500,extraDebtMonthly:0,monthsToCover:6,bufferPct:15,debtStrategy:'avalanche',timezone:'America/Chicago',reminderDays:3,emailReminders:false,incomes:[],bills:[],variables:[],spending:[],debts:[],goals:[],transactions:[],creditScores:[],updatedAt:null};}
const schema={
 incomes:{name:'text',amount:'money',frequency:'frequency',nextDate:'date'},
 bills:{name:'text',amount:'money',dueDay:'day',reserved:'money',url:'url',autopay:'bool',paidMonths:'months'},
 variables:{name:'text',amount:'money'},spending:{name:'text',amount:'money'},
 debts:{name:'text',balance:'money',apr:'apr',minimum:'money',dueDay:'day',reserved:'money',type:'debtType',creditLimit:'money',paidMonths:'months',url:'url'},
 goals:{name:'text',target:'positive',saved:'money',monthly:'money',targetDate:'optionalDate'},
 transactions:{name:'text',amount:'signed',date:'date',category:'text',is_transfer:'bool'},
 creditScores:{score:'score',date:'date',source:'text',model:'text'}
};
function value(v,type,key){
 if(type==='bool')return v===true;
 if(type==='months'){if(!Array.isArray(v)||v.length>120||v.some(x=>typeof x!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x)))throw Error('Invalid paid months.');return [...new Set(v)];}
 if(type==='optionalDate'){if(!v)return '';date(v);return v;}
 if(type==='date'){date(v);return v;}
 if(type==='url'){if(!v)return '';try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)throw 0;return u.href;}catch{throw Error('Use an https payment website URL.');}}
 const enums={frequency:['weekly','biweekly','semimonthly','monthly'],debtType:['credit_card','loan','collection','other']};
 if(enums[type]){if(!enums[type].includes(v))throw Error('Invalid '+key);return v;}
 if(type==='text'){if(typeof v!=='string'||!v.trim()||v.length>200)throw Error(key+' needs text (up to 200 characters).');return v.trim();}
 const ranges={money:[0,1e9],positive:[.01,1e9],signed:[-1e9,1e9],day:[1,31],apr:[0,1000],score:[300,850]};
 const [min,max]=ranges[type];
 if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(['day','score'].includes(type)&&!Number.isInteger(v)))throw Error(key+' must be between '+min+' and '+max+'.');
 return round(v);
}
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid plan.');
 const out=defaults();
 for(const k of ['cashBalance','cashFloor','extraDebtMonthly'])out[k]=value(input[k]??out[k],'money',k);
 out.monthsToCover=input.monthsToCover??6;if(!Number.isFinite(out.monthsToCover)||out.monthsToCover<1||out.monthsToCover>60)throw Error('Months must be 1–60.');
 out.bufferPct=input.bufferPct??15;if(!Number.isFinite(out.bufferPct)||out.bufferPct<0||out.bufferPct>100)throw Error('Buffer must be 0–100.');
 out.debtStrategy=input.debtStrategy??'avalanche';if(!['avalanche','snowball'].includes(out.debtStrategy))throw Error('Choose a debt strategy.');
 out.timezone=input.timezone??out.timezone;try{new Intl.DateTimeFormat('en-US',{timeZone:out.timezone}).format();}catch{throw Error('Invalid timezone.');}
 out.reminderDays=input.reminderDays??3;if(!Number.isInteger(out.reminderDays)||out.reminderDays<0||out.reminderDays>30)throw Error('Reminder days must be 0–30.');
 out.emailReminders=input.emailReminders===true;
 for(const [collection,fields]of Object.entries(schema)){
  const rows=input[collection]??[];if(!Array.isArray(rows)||rows.length>(collection==='transactions'?5000:200))throw Error('Too many '+collection+'.');
  const ids=new Set();
  out[collection]=rows.map(item=>{
   if(!item||typeof item.id!=='string'||!item.id||item.id.length>120||ids.has(item.id))throw Error('Invalid or duplicate item ID.');
   ids.add(item.id);const row={id:item.id};
   for(const [key,type]of Object.entries(fields)){
    const fallback=type==='bool'?false:type==='months'?[]:type==='url'||type==='optionalDate'?'':type==='money'?0:undefined;
    row[key]=value(item[key]??fallback,type,key);
   }
   return row;
  });
 }
 out.updatedAt=input.updatedAt??null;
 return out;
}
function monthlyIncome(p){return round(p.incomes.reduce((n,i)=>n+i.amount*({weekly:52/12,biweekly:26/12,semimonthly:2,monthly:1}[i.frequency]),0));}
function nextPay(d,frequency){
 if(frequency==='weekly')return add(d,7);
 if(frequency==='biweekly')return add(d,14);
 const day=d.getUTCDate(),y=d.getUTCFullYear(),m=d.getUTCMonth();
 if(frequency==='semimonthly')return day<15?new Date(Date.UTC(y,m,15,12)):new Date(Date.UTC(y,m+1,0,12));
 return new Date(Date.UTC(y,m+1,Math.min(day,new Date(Date.UTC(y,m+2,0)).getUTCDate()),12));
}
function paydays(p,today=iso(new Date()),days=90){
 const start=date(today),end=add(start,days),rows=[];
 for(const income of p.incomes){
  let d=date(income.nextDate),anchor=d.getUTCDate();
  for(let guard=0;d<=end&&guard<4000;guard++){
   if(d>=start)rows.push({id:income.id+'-'+iso(d),incomeId:income.id,name:income.name,date:iso(d),amount:income.amount});
   let next=nextPay(d,income.frequency);
   if(income.frequency==='monthly')next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,Math.min(anchor,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+2,0)).getUTCDate()),12));
   if(income.frequency==='semimonthly'&&d.getUTCDate()>15)next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,15,12));
   d=next;
  }
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function occurrence(row,month){
 const year=Number(month.slice(0,4)),m=Number(month.slice(5,7))-1;
 return iso(new Date(Date.UTC(year,m,Math.min(row.dueDay,new Date(Date.UTC(year,m+1,0)).getUTCDate()),12)));
}
function obligations(p,today=iso(new Date()),days=60){
 const end=iso(add(date(today),days)),start=date(today),items=[];
 for(let offset=0;offset<=Math.ceil(days/28);offset++){
  const month=iso(new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+offset,1,12))).slice(0,7);
  for(const [kind,rows]of [['bill',p.bills],['debt',p.debts]]){
   for(const row of rows){
    const amount=kind==='debt'?Math.min(row.minimum,row.balance):row.amount;
    const due=occurrence(row,month);if(due>end||amount<=0||row.paidMonths.includes(month))continue;
    const isNextUnpaid=!items.some(i=>i.kind===kind&&i.id===row.id);
    items.push({id:row.id,kind,name:row.name,date:due,amount,reserved:isNextUnpaid?row.reserved:0,overdue:due<today,autopay:row.autopay||false,url:row.url});
   }
  }
 }
 return items.sort((a,b)=>a.date.localeCompare(b.date));
}
function totals(p){
 const bills=sum(p.bills,'amount'),essentials=sum(p.variables,'amount'),other=sum(p.spending,'amount'),minimums=round(p.debts.reduce((n,d)=>n+Math.min(d.balance,d.minimum),0));
 const income=monthlyIncome(p),spending=round(bills+essentials+other+minimums),saving=round(p.goals.reduce((n,g)=>n+Math.min(g.monthly,Math.max(0,g.target-g.saved)),0));
 const debt=sum(p.debts,'balance'),extraDebt=Math.min(p.extraDebtMonthly,Math.max(0,debt-minimums));
 return {income,bills,essentials,other,minimums,spending,saving,extraDebt,free:round(income-spending-saving-extraDebt),debt,reserve:round(spending*p.monthsToCover*(1+p.bufferPct/100)),runway:spending?p.cashBalance/spending:null};
}
function paycheckPlan(p,today=iso(new Date())){
 const checks=paydays(p,today,90);
 if(!checks.length)return {checks:[],allocations:[],total:0,left:0,shortfall:0,warnings:['Add a take-home income source and next payday.']};
 const first=checks[0],sameDay=checks.filter(c=>c.date===first.date),amount=sum(sameDay,'amount');
 const next=checks.find(c=>c.date>first.date),period=next?Math.max(1,(date(next.date)-date(first.date))/DAY):30;
 let remaining=amount,shortfall=0;const allocations=[];
 const take=(name,need,kind,due)=>{need=round(Math.max(0,need));const allocated=round(Math.min(remaining,need));remaining=round(remaining-allocated);shortfall=round(shortfall+need-allocated);allocations.push({name,need,allocated,kind,due:due||'',shortfall:round(need-allocated)});};
 // Sinking funds split each remaining obligation across pay dates before its due date.
 const horizon=Math.ceil((date(first.date)-date(today))/DAY)+32,upcoming=obligations(p,today,horizon);
 for(const bill of upcoming){
  if(bill.date>iso(add(date(first.date),32)))continue;
  // Only the next unpaid occurrence per bill/debt is funded in this check.
  if(allocations.some(a=>a.kind===bill.kind&&a.itemId===bill.id))continue;
  const eligible=new Set(checks.filter(c=>c.date>=first.date&&c.date<=bill.date).map(c=>c.date)).size||1;
  const need=Math.max(0,bill.amount-bill.reserved)/eligible;
  take(bill.name,need,bill.kind,bill.date);allocations[allocations.length-1].itemId=bill.id;
 }
 const recurring=(sum(p.variables,'amount')+sum(p.spending,'amount'))*period/averageMonth;
 take('Everyday spending until next payday',recurring,'essentials');
 if(p.cashBalance<p.cashFloor)take('Restore the cash floor',p.cashFloor-p.cashBalance,'buffer');
 for(const goal of p.goals)take(goal.name,Math.min(Math.max(0,goal.target-goal.saved),goal.monthly*period/averageMonth),'saving',goal.targetDate);
 const priority=[...p.debts].filter(d=>d.balance>0).sort((a,b)=>p.debtStrategy==='snowball'?a.balance-b.balance:b.apr-a.apr);
 if(priority.length&&p.extraDebtMonthly){const minimumAlreadyAllocated=allocations.filter(a=>a.kind==='debt'&&a.itemId===priority[0].id).reduce((n,a)=>n+a.allocated,0);take('Extra: '+priority[0].name,Math.min(Math.max(0,priority[0].balance-minimumAlreadyAllocated),p.extraDebtMonthly*period/averageMonth),'extra_debt');}
 return {checks:sameDay,date:first.date,nextDate:next?.date,period,allocations,total:amount,left:remaining,shortfall,
  warnings:[...(upcoming.some(b=>b.date<first.date)?['Some bills are due before this paycheck. Use existing available cash or contact the provider; this paycheck arrives too late.']:[]),...(shortfall>0?['The check cannot cover all planned allocations. Amounts are capped at take-home pay.']:[])]};
}
function payoff(p,extra=p.extraDebtMonthly){
 const rows=p.debts.filter(d=>d.balance>0).map(d=>({...d,balance:round(d.balance)})),minimumBudget=sum(rows,'minimum'),budget=round(minimumBudget+extra);
 if(!rows.length)return {months:0,interest:0,paid:0,remaining:0,feasible:true};
 let interest=0,paid=0;
 for(let month=1;month<=600;month++){
  for(const d of rows){const charge=round(d.balance*d.apr/1200);d.balance=round(d.balance+charge);interest=round(interest+charge);}
  let available=budget;
  for(const d of rows){const payment=Math.min(d.balance,d.minimum,available);d.balance=round(d.balance-payment);available=round(available-payment);paid=round(paid+payment);}
  rows.sort((a,b)=>p.debtStrategy==='snowball'?a.balance-b.balance:b.apr-a.apr);
  for(const d of rows){if(d.balance<=0)continue;const payment=Math.min(d.balance,available);d.balance=round(d.balance-payment);available=round(available-payment);paid=round(paid+payment);}
  if(rows.every(d=>d.balance<=0))return {months:month,interest,paid,remaining:0,feasible:true};
  if(budget===0)break;
 }
 return {months:null,interest,paid,remaining:sum(rows,'balance'),feasible:false};
}
function spendingInsights(transactions,today=iso(new Date())){
 const cutoff=iso(add(date(today),-30)),rows=transactions.filter(t=>t.date>=cutoff&&t.date<=today&&!t.pending&&!t.is_transfer);
 const groups=Object.create(null);for(const t of rows){if(t.amount<=0)continue;const k=t.category||'Other';groups[k]=round((groups[k]||0)+t.amount);}
 const merchants=Object.create(null);for(const t of transactions.filter(t=>t.amount>0&&!t.pending&&!t.is_transfer)){const k=t.name.toLowerCase().replace(/\d+/g,'').trim();(merchants[k]??=[]).push(t);}
 const recurring=Object.values(merchants).filter(a=>new Set(a.map(t=>t.date.slice(0,7))).size>=2&&a.length>=2&&a.length<=12).map(a=>({name:a[0].name,amount:round(a.reduce((n,t)=>n+t.amount,0)/a.length),occurrences:a.length}));
 const income=round(-rows.filter(t=>t.amount<0).reduce((n,t)=>n+t.amount,0));
 return {categories:Object.entries(groups).sort((a,b)=>b[1]-a[1]),spent:round(Object.values(groups).reduce((a,b)=>a+b,0)),income,recurring};
}
function credit(p){
 const cards=p.debts.filter(d=>d.type==='credit_card'&&d.creditLimit>0),limit=sum(cards,'creditLimit'),balance=sum(cards,'balance');
 const latest=[...p.creditScores].sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
 return {limit,balance,utilization:limit?balance/limit*100:null,latest,
  actions:['Pay every minimum by its due date.','Review your reports for factual errors and document any dispute.','Lower revolving balances where your budget allows; utilization is only one scoring factor.','Keep track of the source, scoring model, and date of each real score.']};
}
function migrate(v){
 if(v.version===3)return validate(v);
 const p=defaults();p.cashBalance=['billsBalance','essentialsBalance','frostBalance','fidelityBalance'].reduce((n,k)=>n+Number(v[k]||0),0);
 p.monthsToCover=v.monthsToCover||6;p.bufferPct=v.bufferPct??15;
 for(const k of ['bills','variables','spending','goals'])p[k]=(v[k]||[]).map(r=>({...r,reserved:0,url:'',autopay:false,targetDate:'',dueDay:r.dueDay||1,paidMonths:r.paidMonths||[]}));
 if(v.regularPaycheck)p.incomes=[{id:'migrated-income',name:'Take-home pay',amount:v.regularPaycheck,frequency:v.regularChecks===4?'weekly':v.regularChecks===1?'monthly':'semimonthly',nextDate:iso(new Date())}];
 return validate(p);
}
function calendar(p,today=iso(new Date())){
 const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AUTONOMY//Bill reminders//EN','CALSCALE:GREGORIAN'];
 for(const b of obligations(p,today,365)){
  lines.push('BEGIN:VEVENT','UID:'+escape(b.kind+'-'+b.id+'-'+b.date)+'@autonomy','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART;VALUE=DATE:'+b.date.replace(/-/g,''),'SUMMARY:'+escape(b.name+' — $'+b.amount.toFixed(2)),'DESCRIPTION:'+escape('Confirm payment with your bank. '+(b.url||'')),'BEGIN:VALARM','TRIGGER:-P'+p.reminderDays+'D','ACTION:DISPLAY','DESCRIPTION:'+escape('Bill due: '+b.name),'END:VALARM','END:VEVENT');
 }
 lines.push('END:VCALENDAR');return lines.join('\r\n');
}
function dispute({recipient,creditor,reason,correction,evidence,type='credit_report'}){
 for(const [k,v]of Object.entries({recipient,creditor,reason,correction}))if(typeof v!=='string'||!v.trim()||v.length>3000)throw Error('Describe '+k+' before creating a draft.');
 const intro=type==='creditor'?'I am requesting a review of information your organization furnished about the account below.':'I am disputing information in my credit report about the account below.';
 return ['[Your name]','[Your mailing address]','[Date]','',recipient,'','Subject: Request to investigate a specific reporting error','',intro,'','Creditor/account label: '+creditor,'What I believe is incorrect: '+reason,'Requested correction: '+correction,'Supporting documents: '+(evidence||'[List copies you will attach]'),'','Please investigate the identified information, correct any verified error, and send me the result. Please let me know if you need additional information to identify the disputed entry.','','Sincerely,','[Your name]','','Before sending: verify the recipient using your report, describe only facts you believe are accurate, complete identity details privately, and keep copies. This draft is not a promise that accurate debt can be removed.'].join('\n');
}
const api={defaults,validate,totals,paydays,obligations,paycheckPlan,payoff,spendingInsights,credit,migrate,calendar,dispute,iso,date,round,schema};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Finance=api;
})(globalThis);

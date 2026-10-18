const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../finance');
const income=(id,amount,frequency,nextDate)=>({id,name:id,amount,frequency,nextDate});
const bill=(id,amount,dueDay)=>({id,name:id,amount,dueDay,reserved:0,url:'',autopay:false,paidMonths:[]});
const debt=(id,balance,apr,minimum,dueDay=15)=>({id,name:id,balance,apr,minimum,dueDay,reserved:0,url:'',type:'credit_card',creditLimit:10000,paidMonths:[]});
test('pay schedules retain monthly anchor and support household schedules',()=>{
 const p=F.defaults();p.incomes=[income('salary',1000,'monthly','2026-01-31'),income('spouse',500,'biweekly','2026-02-01')];
 const rows=F.paydays(p,'2026-02-01',65);
 assert.ok(rows.some(r=>r.date==='2026-02-28'&&r.name==='salary'));
 assert.ok(rows.some(r=>r.date==='2026-03-31'&&r.name==='salary'));
 assert.ok(rows.some(r=>r.date==='2026-02-15'&&r.name==='spouse'));
});
test('semimonthly paydays do not loop on the last day of a month',()=>{
 const p=F.defaults();p.incomes=[income('salary',1000,'semimonthly','2026-02-15')];
 assert.deepEqual(F.paydays(p,'2026-02-15',45).map(r=>r.date),['2026-02-15','2026-02-28','2026-03-15','2026-03-31']);
});
test('allocations split bills across pay dates and honor reserved money',()=>{
 const p=F.defaults();p.incomes=[income('pay',2000,'weekly','2026-10-19')];p.bills=[{...bill('rent',1000,30),reserved:200}];
 const pc=F.paycheckPlan(F.validate(p),'2026-10-18');
 assert.equal(pc.allocations[0].allocated,400);assert.equal(pc.left,1100);assert.equal(pc.shortfall,0);
 assert.equal(pc.allocations.find(a=>a.kind==='buffer').allocated,500);
});
test('overdue dates warn, paid bills roll over, allocations cannot exceed a check',()=>{
 const p=F.defaults();p.incomes=[income('pay',100,'biweekly','2026-10-20')];p.bills=[bill('rent',1000,1)];p.variables=[{id:'food',name:'Food',amount:300}];
 const pc=F.paycheckPlan(F.validate(p),'2026-10-18');
 assert.equal(pc.allocations.reduce((n,a)=>n+a.allocated,0),100);assert.ok(pc.shortfall>0);assert.ok(pc.warnings.some(w=>w.includes('before this paycheck')));
 p.bills[0].paidMonths=['2026-10'];assert.equal(F.obligations(p,'2026-10-18',60)[0].date,'2026-11-01');
});
test('minimum and extra debt allocation do not exceed the debt balance',()=>{
 const p=F.defaults();p.incomes=[income('pay',5000,'monthly','2026-10-18')];p.debts=[debt('card',100,10,80,18)];p.extraDebtMonthly=5000;
 const pc=F.paycheckPlan(p,'2026-10-18');
 assert.ok(pc.allocations.filter(a=>a.kind.includes('debt')).reduce((n,a)=>n+a.allocated,0)<=100);
});
test('debt minimums and savings contributions are included in monthly room',()=>{
 const p=F.defaults();p.incomes=[income('pay',2000,'semimonthly','2026-10-15')];p.bills=[bill('rent',1000,1)];p.debts=[debt('card',1000,20,100)];p.goals=[{id:'g',name:'Emergency',target:2000,saved:500,monthly:200,targetDate:''}];p.extraDebtMonthly=50;
 const t=F.totals(F.validate(p));assert.equal(t.income,4000);assert.equal(t.minimums,100);assert.equal(t.free,2650);
});
test('payoff uses fixed total budget and reports impossible plans honestly',()=>{
 const p=F.defaults();p.debts=[debt('zero',1000,0,100)];assert.equal(F.payoff(p).months,10);
 p.extraDebtMonthly=100;assert.equal(F.payoff(p).months,5);
 p.debts=[debt('bad',1000,30,1)];p.extraDebtMonthly=0;assert.equal(F.payoff(p).feasible,false);
});
test('debt alone never produces an invented credit score',()=>{
 const p=F.defaults();p.debts=[debt('card',1000,20,50)];const c=F.credit(p);assert.equal(c.latest,null);assert.equal(c.utilization,10);
});
test('completed goals and paid-off debts stop reducing monthly room',()=>{
 const p=F.defaults();p.incomes=[income('pay',1000,'monthly','2026-10-20')];p.extraDebtMonthly=500;
 p.goals=[{id:'done',name:'Done',target:100,saved:100,monthly:200,targetDate:''},{id:'almost',name:'Almost',target:100,saved:90,monthly:200,targetDate:''}];
 assert.equal(F.totals(p).saving,10);assert.equal(F.totals(p).free,990);
 p.debts=[debt('small',50,0,20)];assert.equal(F.totals(p).free,940);
});
test('reserved bill money follows the next unpaid occurrence',()=>{
 const p=F.defaults();p.bills=[{...bill('rent',1000,1),reserved:300,paidMonths:['2026-10']}];
 const rows=F.obligations(p,'2026-10-18',90);assert.equal(rows[0].date,'2026-11-01');assert.equal(rows[0].reserved,300);assert.equal(rows[1].reserved,0);
});
test('paycheck planning includes bills when the first pay date is more than 35 days away',()=>{
 const p=F.defaults();p.incomes=[income('pay',2000,'monthly','2026-12-20')];p.bills=[{...bill('rent',1000,25),paidMonths:['2026-10','2026-11']}];
 const pc=F.paycheckPlan(p,'2026-10-18');assert.equal(pc.allocations.find(a=>a.kind==='bill').due,'2026-12-25');assert.equal(pc.allocations.find(a=>a.kind==='bill').allocated,1000);
});
test('spending handles category and merchant names matching object properties',()=>{
 const rows=[{name:'constructor',category:'__proto__',amount:10,date:'2026-10-10'},{name:'toString',category:'constructor',amount:20,date:'2026-10-11'}];
 const i=F.spendingInsights(rows,'2026-10-18');assert.equal(i.spent,30);assert.ok(i.categories.some(([k,v])=>k==='__proto__'&&v===10));
});
test('spending excludes pending rows and transfers and respects date window',()=>{
 const rows=[{name:'Grocery',amount:100,date:'2026-10-10',category:'Food'},{name:'Transfer',amount:1000,date:'2026-10-10',category:'Other',is_transfer:true},{name:'Pending',amount:100,date:'2026-10-10',category:'Other',pending:true},{name:'Old',amount:100,date:'2026-01-01',category:'Other'},{name:'Pay',amount:-2000,date:'2026-10-10',category:'Income'}];
 const i=F.spendingInsights(rows,'2026-10-18');assert.equal(i.spent,100);assert.equal(i.income,2000);
});
test('validation rejects malformed dates, APRs, URLs, duplicate and nonfinite values',()=>{
 const p=F.defaults();assert.throws(()=>F.validate({...p,incomes:[income('x',1,'monthly','2026-02-30')]}));
 assert.throws(()=>F.validate({...p,bills:[{...bill('x',1,1),url:'javascript:alert(1)'}]}));
 assert.throws(()=>F.validate({...p,debts:[debt('x',1,-1,1)]}));
 assert.throws(()=>F.validate({...p,cashBalance:Infinity}));
 assert.throws(()=>F.validate({...p,transactions:[{id:'x',name:'a',amount:1,date:'2026-10-10',category:'x'},{id:'x',name:'a',amount:1,date:'2026-10-10',category:'x'}]}));
});
test('calendar includes dated bill alerts and dispute drafts require factual details',()=>{
 const p=F.defaults();p.bills=[bill('rent',100,31)];const cal=F.calendar(p,'2026-02-01');assert.match(cal,/DTSTART;VALUE=DATE:20260228/);assert.match(cal,/TRIGGER:-P3D/);
 assert.throws(()=>F.dispute({recipient:'Bureau'}));
 const text=F.dispute({recipient:'Bureau',creditor:'Example creditor',reason:'Reported duplicate entry',correction:'Remove the duplicate',evidence:'Statement copy'});assert.match(text,/Reported duplicate entry/);assert.match(text,/not a promise/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../finance');
const income=(id,partner,amount,frequency='weekly',nextDate='2026-01-01')=>({id,name:id,partner,amount,frequency,nextDate});
const bill=(id,amount,dueDay=15,extra={})=>({id,name:id,amount,dueDay,...extra});
const plan=(patch={})=>F.validate({...F.defaults(),cashFloor:0,...patch});
test('three calendar months clamp the end date, include leap day, and preserve custom semimonthly anchors',()=>{
 const p=plan({incomes:[{...income('a','a',100,'semimonthly','2028-01-01'),firstDay:5,secondDay:20},income('b','b',200,'monthly','2028-01-31')]});
 const r=F.threeMonthPlan(p,'2028-01-31');assert.equal(r.end,'2028-04-30');
 assert.deepEqual(r.checks.filter(c=>c.incomeId==='a').map(c=>c.date),['2028-02-05','2028-02-20','2028-03-05','2028-03-20','2028-04-05','2028-04-20']);
 assert.ok(r.checks.some(c=>c.incomeId==='b'&&c.date==='2028-02-29'));assert.ok(r.checks.some(c=>c.date==='2028-03-31'));
});
test('all checks conserve cash and every feasible bill is funded strictly before its due date',()=>{
 const p=plan({incomes:[income('a','a',1000),income('b','b',500)],bills:[bill('rent',900),bill('power',90,25)],rainyMonthly:200});
 const before=JSON.stringify(p),r=F.threeMonthPlan(p,'2026-01-01');assert.equal(JSON.stringify(p),before);assert.equal(r.shortfall,0);assert.equal(r.share,2/3);
 for(const b of r.bills){assert.equal(b.funded,b.amount);assert.equal(b.contributions.a,F.round((b.amount-b.reserved)*2/3));}
 for(const c of r.checks){assert.equal(F.round(c.left+c.allocations.reduce((n,a)=>n+a.amount,0)),c.amount);assert.ok(c.left>=0);for(const a of c.allocations.filter(a=>a.due))assert.ok(c.date<a.due);}
 assert.ok(r.rainyTotal>0);
});
test('equal/custom splits, rounding, zero-share partner, and an infeasible partner share are explicit',()=>{
 const p=plan({incomes:[income('a','a',1000),income('b','b',1000)],bills:[bill('rent',101.01)],splitMode:'equal'});
 let r=F.threeMonthPlan(p,'2026-01-01');assert.equal(r.bills[0].contributions.a,50.51);assert.equal(r.bills[0].contributions.b,50.5);
 r=F.threeMonthPlan({...p,splitMode:'custom',customShare:25},'2026-01-01');assert.equal(r.bills[0].contributions.a,25.25);assert.equal(r.shortfall,0);
 r=F.threeMonthPlan({...p,incomes:[p.incomes[0]],splitMode:'custom',customShare:100},'2026-01-01');assert.equal(r.shortfall,0);
 r=F.threeMonthPlan({...p,incomes:[p.incomes[0]]},'2026-01-01');assert.ok(r.shortfall>0);assert.ok(r.warnings.length);
});
test('due-today, overdue, no-income, low income and reserved cash never fabricate funding',()=>{
 const p=plan({incomes:[income('a','a',10)],bills:[bill('today',50,1),bill('later',100,15,{reserved:25})]});
 const r=F.threeMonthPlan(p,'2026-01-01');assert.equal(r.bills[0].funded,0);assert.ok(r.shortfall>0);
 assert.equal(r.bills.find(b=>b.name==='later').reserved,25);assert.equal(r.bills.filter(b=>b.name==='later')[1].reserved,0);
 assert.ok(F.threeMonthPlan({...p,incomes:[]},'2026-01-02').bills.some(b=>b.overdue));
 assert.equal(F.threeMonthPlan(plan(),'2026-01-01').checks.length,0);
});
test('bills support one-time, weekly, biweekly, quarterly and yearly schedules and paid occurrences',()=>{
 const p=plan({bills:[bill('once',100,1,{frequency:'once',dueDate:'2026-02-10'}),bill('weekly',10,1,{frequency:'weekly',dueDate:'2026-01-01'}),bill('biweekly',20,1,{frequency:'biweekly',dueDate:'2026-01-01'}),bill('quarter',300,1,{frequency:'quarterly',dueDate:'2026-01-31'}),bill('year',1200,1,{frequency:'yearly',dueDate:'2025-02-28'})]});
 const rows=F.obligations(p,'2026-01-01',90);assert.equal(rows.filter(b=>b.id==='once').length,1);assert.equal(rows.filter(b=>b.id==='weekly'&&!b.overdue).length,13);assert.ok(rows.some(b=>b.id==='year'&&b.date==='2026-02-28'));
 p.bills[0].paidMonths=['2026-02-10'];assert.equal(F.obligations(p,'2026-01-01',90).filter(b=>b.id==='once').length,0);
 assert.equal(F.totals(plan({bills:[p.bills[3],p.bills[4]]})).bills,200);
});
test('rainy-day months and 1/3/6 milestones use saved money, not planned contributions or generic cash',()=>{
 for(const [saved,expected]of [[0,[]],[100,[1]],[300,[1,3]],[600,[1,3,6]]]){
 const r=F.threeMonthPlan(plan({cashBalance:10000,rainySaved:saved,bills:[bill('rent',100)]}),'2026-01-01');assert.equal(r.monthsSaved,saved/100);assert.deepEqual(r.milestones,expected);}
 assert.equal(F.threeMonthPlan(plan({rainySaved:100}),'2026-01-01').monthsSaved,0);
});
test('monthly anchor survives short months, biweekly crosses year, and invalid entry is rejected',()=>{
 const p=plan({incomes:[income('a','a',100,'biweekly','2025-12-25'),income('b','b',200,'monthly','2026-01-31')]});
 assert.ok(F.paydays(p,'2026-01-01',90).some(c=>c.date==='2026-01-08'));assert.ok(F.paydays(p,'2026-01-01',90).some(c=>c.date==='2026-03-31'));
 assert.throws(()=>plan({customShare:101}));assert.throws(()=>plan({bills:[bill('bad',10,1,{frequency:'yearly'})]}));assert.throws(()=>plan({incomes:[{...p.incomes[0],firstDay:25,secondDay:15}]}));
});
test('leak finder matches bills and transactions, uses editable prices, and excludes transfers/pending',()=>{
 const tx=[{name:'Netflix',amount:10,date:'2026-01-05',category:'Entertainment'},{name:'Netflix',amount:10,date:'2026-02-05',category:'Entertainment'},{name:'Lunch',amount:90,date:'2026-02-05',category:'Eating out'},{name:'Lunch',amount:900,date:'2026-02-06',category:'Eating out',is_transfer:true},{name:'Lunch',amount:900,date:'2026-02-06',category:'Eating out',pending:true}];
 const p=plan({bills:[bill('Spotify family',10)],spending:[{id:'food',name:'Eating out',amount:50}],subscriptionPrices:[{name:'Netflix',monthly:10,yearly:100},{name:'Spotify',monthly:10,yearly:0}]});
 const r=F.leaks(p,tx,'2026-02-20');assert.equal(r.subscriptions.length,2);assert.equal(r.subscriptions[0].saving,20);assert.equal(r.subscriptions[1].saving,null);assert.equal(r.nudges[0].over,40);assert.notEqual(F.leaks({...p,roast:true},tx,'2026-02-20').nudges[0].message,r.nudges[0].message);
});
test('debt comparison models both budgets equally, recommends cheaper interest, and handles impossible debt',()=>{
 const debts=[{id:'a',name:'Large APR',balance:5000,apr:29,minimum:150,dueDay:15,type:'loan'},{id:'b',name:'Small loan',balance:500,apr:4,minimum:25,dueDay:15,type:'loan'}];
 const r=F.comparePayoff(plan({debts,extraDebtMonthly:100}));assert.equal(r.recommended,'avalanche');assert.ok(r.avalanche.interest<r.snowball.interest);
 assert.equal(F.comparePayoff(plan({debts:[{...debts[0],minimum:0}]})).recommended,null);
 assert.equal(F.comparePayoff(plan()).avalanche.months,0);
});
test('old schedule anchors stay bounded and unfunded everyday allocations remain visible',()=>{
 const p=plan({incomes:[income('a','a',10)],bills:[bill('old weekly',100,1,{frequency:'weekly',dueDate:'1900-01-01',reserved:25})],variables:[{id:'food',name:'Groceries',amount:500}]});
 const r=F.threeMonthPlan(p,'2026-01-01');assert.ok(r.bills.length<16);assert.equal(r.bills[0].reserved,25);
 assert.ok(r.checks.some(c=>c.allocations.some(a=>a.kind==='essentials'&&a.shortfall>0)));
 for(const c of r.checks)assert.equal(F.round(c.left+c.allocations.reduce((n,a)=>n+a.amount,0)),c.amount);
 assert.throws(()=>plan({bills:[bill('bad paid date',10,1,{paidMonths:['2026-02-30']})]}));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model');
test('prepaid memberships cannot fund bills, and all spending reduces runway', () => {
  const p = M.defaults();
  p.bills[0].amount = 1000; p.variables[0].amount = 200; p.spending[0].amount = 300;
  p.billsBalance = 6000; p.monthsToCover = 2; p.bufferPct = 10;
  p.prepaid = [{ id:'park', name:'Park', value:10000, covered:true }];
  const t = M.totals(p);
  assert.equal(t.monthlyTotal,1500); assert.equal(t.required,3300);
  assert.equal(t.liquid,6000); assert.equal(t.runway,4);
  assert.equal(t.prepaid,10000);
});
test('paycheck allocations never exceed income and include essentials', () => {
  const p=M.defaults(); p.bills[0].amount=1000; p.variables[0].amount=200;
  p.regularPaycheck=300; p.regularChecks=2;
  let t=M.totals(p);
  assert.equal(t.regularNeed,600); assert.equal(t.regularAllocated,300); assert.equal(t.regularShortfall,300); assert.equal(t.regularSurplus,0);
  p.regularPaycheck=1000; p.goals=[{id:'g',name:'Goal',target:1000,saved:0,monthly:200}];
  t=M.totals(p); assert.equal(t.monthlyFree,600);
});
test('empty plans have unknown runway and zero requirement',()=> {
  const t=M.totals(M.defaults()); assert.equal(t.runway,null); assert.equal(t.required,0);
});
test('validation rejects negative, nonfinite, excessive, duplicate and malformed data',()=>{
  for (const v of [-1,NaN,Infinity,'100',1e12]) assert.throws(()=>M.validate({...M.defaults(),billsBalance:v}));
  assert.throws(()=>M.validate({...M.defaults(),commissionFidelityPct:101}));
  assert.throws(()=>M.validate({...M.defaults(),regularChecks:1.5}));
  assert.throws(()=>M.validate({...M.defaults(),bills:[{id:'x',name:'X',amount:1,dueDay:0}]}));
  assert.throws(()=>M.validate({...M.defaults(),bills:[{id:'x',name:'X',amount:1,paidMonths:['2026-13']}]}));
  assert.throws(()=>M.validate({...M.defaults(),goals:[{id:'x',name:'X',saved:0,target:0,monthly:0}]}));
  const p=M.defaults(); p.bills.push(p.bills[0]); assert.throws(()=>M.validate(p));
});
test('payment checklists roll over by month and clamp February due day',()=>{
  const bill={dueDay:31,paidMonths:['2026-01']};
  assert.equal(M.billStatus(bill,new Date(2026,0,20)).paid,true);
  const feb=M.billStatus(bill,new Date(2026,1,28));
  assert.equal(feb.day,28); assert.equal(feb.label,'Due today'); assert.equal(feb.paid,false);
  assert.equal(M.billStatus({dueDay:1,paidMonths:[]},new Date(2026,1,2)).label,'Overdue');
});
test('old plan format upgrades with bill due dates and default goals',()=>{
  const p=M.defaults(); delete p.goals; delete p.bills[0].dueDay; delete p.bills[0].paidMonths;
  const v=M.validate(p); assert.deepEqual(v.goals,[]); assert.equal(v.bills[0].dueDay,1);
});

(function (root) {
  'use strict';
  const MAX = 1e9;
  const defaults = () => ({
    monthsToCover: 6, bufferPct: 15, billsBalance: 0, essentialsBalance: 0,
    frostBalance: 0, fidelityBalance: 0, regularPaycheck: 0, regularChecks: 2,
    commissionAmount: 0, commissionFidelityPct: 60, lumpSum: 0,
    manualApproval: true, approvalThreshold: 500, readOnlyMode: true, fidelityManual: true,
    bills: ['Housing', 'Electric', 'Water', 'Internet', 'Phone', 'Insurance'].map((name, i) => ({ id: `bill-${i}`, name, amount: 0, dueDay: 1, paidMonths: [] })),
    variables: ['Groceries', 'Fuel', 'Pharmacy'].map((name, i) => ({ id: `essential-${i}`, name, amount: 0 })),
    spending: ['Dining out', 'Entertainment', 'Shopping', 'Other'].map((name, i) => ({ id: `spend-${i}`, name, amount: 0 })),
    prepaid: [], goals: [], updatedAt: null
  });
  const bounds = { monthsToCover: [1, 60], bufferPct: [0, 100], regularChecks: [1, 31], commissionFidelityPct: [0, 100] };
  function number(value, key, min = 0, max = MAX) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    return value;
  }
  function text(value, key, max = 120) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${key} needs text (up to ${max} characters).`);
    return value.trim();
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid plan.');
    const out = defaults();
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'number' && input[key] !== undefined) out[key] = number(input[key], key, ...(bounds[key] || [0, MAX]));
    }
    if (!Number.isInteger(out.regularChecks)) throw new Error('Monthly checks must be a whole number.');
    for (const key of ['bills', 'variables', 'spending', 'prepaid', 'goals']) {
      if (input[key] === undefined) continue;
      if (!Array.isArray(input[key]) || input[key].length > 200) throw new Error(`Invalid ${key} list.`);
      const ids = new Set();
      out[key] = input[key].map(item => {
        if (!item || typeof item !== 'object') throw new Error(`Invalid ${key} item.`);
        const id = text(item.id, 'Item ID', 100);
        if (ids.has(id)) throw new Error('Duplicate item ID.');
        ids.add(id);
        const row = { id, name: text(item.name, 'Name') };
        if (key === 'goals') {
          row.target = number(item.target, 'Goal target', 0.01);
          row.saved = number(item.saved, 'Goal saved');
          row.monthly = number(item.monthly, 'Monthly saving');
        } else if (key === 'prepaid') {
          row.value = number(item.value, 'Prepaid value');
          row.covered = item.covered === true;
        } else row.amount = number(item.amount, 'Monthly amount');
        if (key === 'bills') {
          row.dueDay = number(item.dueDay ?? 1, 'Due day', 1, 31);
          if (!Number.isInteger(row.dueDay)) throw new Error('Due day must be a whole number.');
          row.paidMonths = item.paidMonths ?? [];
          if (!Array.isArray(row.paidMonths) || row.paidMonths.length > 120 || row.paidMonths.some(m => typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m))) throw new Error('Invalid bill payment history.');
          row.paidMonths = [...new Set(row.paidMonths)];
        }
        return row;
      });
    }
    out.updatedAt = typeof input.updatedAt === 'string' && !isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : null;
    return out;
  }
  const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (rows, key = 'amount') => cents(rows.reduce((n, r) => n + r[key], 0));
  function totals(plan) {
    const p = validate(plan);
    const monthlyBills = sum(p.bills), monthlyVariables = sum(p.variables), monthlySpending = sum(p.spending);
    const monthlyCore = monthlyBills + monthlyVariables;
    const monthlyTotal = monthlyCore + monthlySpending;
    const liquid = p.billsBalance + p.essentialsBalance + p.frostBalance + p.fidelityBalance;
    const required = cents(monthlyTotal * p.monthsToCover * (1 + p.bufferPct / 100));
    const regularNeed = monthlyTotal / p.regularChecks;
    const regularAllocated = Math.min(p.regularPaycheck, regularNeed);
    const regularSurplus = Math.max(0, p.regularPaycheck - regularNeed);
    const monthlyIncome = p.regularPaycheck * p.regularChecks;
    const goalMonthly = sum(p.goals, 'monthly');
    const lumpToCoverage = Math.min(p.lumpSum, Math.max(0, required - liquid));
    return { monthlyBills, monthlyVariables, monthlySpending, monthlyCore, monthlyTotal, liquid, required,
      prepaid: sum(p.prepaid.filter(r => r.covered), 'value'), gap: liquid - required,
      runway: monthlyTotal > 0 ? liquid / monthlyTotal : null,
      monthlyIncome, monthlyFree: monthlyIncome - monthlyTotal - goalMonthly, goalMonthly,
      regularNeed, regularAllocated, regularSurplus, regularShortfall: Math.max(0, regularNeed - p.regularPaycheck),
      commissionSavings: p.commissionAmount * p.commissionFidelityPct / 100,
      commissionBuffer: p.commissionAmount * (1 - p.commissionFidelityPct / 100), lumpToCoverage,
      lumpSurplus: p.lumpSum - lumpToCoverage };
  }
  function billStatus(bill, date = new Date()) {
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const day = Math.min(bill.dueDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    const delta = day - date.getDate();
    return { month, day, delta, paid: bill.paidMonths.includes(month), label: bill.paidMonths.includes(month) ? 'Paid this month' : delta < 0 ? 'Overdue' : delta === 0 ? 'Due today' : `Due in ${delta} days` };
  }
  const model = { defaults, validate, totals, billStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.Autonomy = model;
})(typeof globalThis !== 'undefined' ? globalThis : this);

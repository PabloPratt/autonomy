'use strict';
const M = Autonomy;
const $ = id => document.getElementById(id);
const PLAN_KEY = 'autonomy.plan.v2';
const LEGACY_KEY = 'autonomy.hosted.plan.v1';
let state = M.defaults(), mode, revision = 0, dirty = false, saving = false, generation = 0, saveTimer, addCollection, conflict = false;
const fmt = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(value, bad = false) { $('saveStatus').textContent = value; $('saveStatus').classList.toggle('error-text', bad); }
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  let data;
  try { data = await res.json(); } catch { throw new Error('The server returned an invalid response. Your changes have not been saved.'); }
  if (!res.ok) { const e = new Error(data.error || 'Request failed: ' + res.status); e.status = res.status; throw e; }
  return data;
}
function browserRecord() {
  const raw = localStorage.getItem(PLAN_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (data.version !== 2 || !Number.isInteger(data.revision)) throw new Error('Stored plan format is invalid. Download your stored data for recovery.');
    return { plan: M.validate(data.plan), revision: data.revision };
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  return { plan: legacy ? M.validate(JSON.parse(legacy)) : M.defaults(), revision: 0 };
}
function change() {
  generation++; dirty = true;
  message('Unsaved changes');
  clearTimeout(saveTimer);
  if (mode === 'browser') saveTimer = setTimeout(() => save(), 700);
}
async function save() {
  if (saving || conflict) return false;
  const invalid = $('appShell').querySelector('input:invalid');
  if (invalid) { invalid.reportValidity(); message('Correct the highlighted value before saving.', true); return false; }
  saving = true; $('saveData').disabled = true;
  const version = generation;
  try {
    const plan = M.validate(state);
    plan.updatedAt = new Date().toISOString();
    if (mode === 'browser') {
      const latest = browserRecord();
      if (latest.revision !== revision) { conflict = true; throw new Error('Another tab saved changes. Export this plan, then reload before saving.'); }
      const data = { version: 2, revision: revision + 1, plan };
      localStorage.setItem(PLAN_KEY, JSON.stringify(data));
      revision = data.revision;
    } else {
      const result = await api('/api/plan', { method: 'PUT', body: JSON.stringify({ plan, revision }) });
      revision = result.revision;
    }
    state.updatedAt = plan.updatedAt;
    if (version === generation) {
      dirty = false;
      message('Saved ' + new Date(plan.updatedAt).toLocaleTimeString());
    } else { message('Unsaved changes'); if (mode === 'browser') saveTimer = setTimeout(() => save(), 700); }
    return true;
  } catch (e) {
    if (e.status === 409) conflict = true;
    message(e.message + ' Export a backup to keep your changes.', true);
    return false;
  } finally { saving = false; $('saveData').disabled = false; }
}
const fields = [
  ['monthsToCover','Months to cover',1,60,0.25], ['bufferPct','Reserve buffer %',0,100,1],
  ['billsBalance','Bills account cash',0,1e9,0.01], ['essentialsBalance','Essentials account cash',0,1e9,0.01],
  ['frostBalance','Other cash / Frost',0,1e9,0.01], ['fidelityBalance','Withdrawable cash / Fidelity',0,1e9,0.01],
  ['regularPaycheck','Take-home pay per check',0,1e9,0.01], ['regularChecks','Regular checks per month',1,31,1],
  ['commissionAmount','One-time commission (net)',0,1e9,0.01], ['commissionFidelityPct','Commission to savings %',0,100,1],
  ['lumpSum','New lump sum (not in balances)',0,1e9,0.01]
];
function renderFields() {
  for (const [index, [id, label, min, max, step]] of fields.entries()) {
    const el = document.createElement('label');
    el.textContent = label;
    const input = document.createElement('input');
    Object.assign(input, { id, type: 'number', min, max, step, value: state[id], required: true });
    el.append(input);
    $(index < 6 ? 'coverageInputs' : 'incomeInputs').append(el);
    input.addEventListener('input', () => {
      if (!input.checkValidity() || input.value === '') { dirty = true; clearTimeout(saveTimer); message('Check ' + label.toLowerCase() + '.', true); return; }
      state[id] = Number(input.value); change(); summary();
    });
  }
}
function syncFields() { for (const [id] of fields) $(id).value = state[id]; }
function numberInput(row, label, key, min = 0, max = 1e9, step = 0.01) {
  return '<label>' + label + '<input data-field="' + key + '" type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + row[key] + '" required></label>';
}
function renderCollection(key, id) {
  const container = $(id); container.replaceChildren();
  if (!state[key].length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No items yet. Add one to get started.'; container.append(p); }
  for (const item of state[key]) {
    const row = document.createElement('div'); row.className = 'budget-row';
    let content = '<label class="item-name">Name<input data-field="name" value="' + esc(item.name) + '" maxlength="120" required></label>';
    if (key === 'goals') {
      const remaining = Math.max(0, item.target - item.saved);
      content += numberInput(item, 'Target', 'target', 0.01) + numberInput(item, 'Saved so far', 'saved') + numberInput(item, 'Save each month', 'monthly');
      content += '<div class="goal-progress"><progress max="' + item.target + '" value="' + Math.min(item.saved, item.target) + '" aria-label="' + esc(item.name) + ' progress"></progress><span>' + (remaining === 0 ? 'Goal reached' : fmt(remaining) + ' to go · ' + (item.monthly ? Math.ceil(remaining / item.monthly) + ' months at this rate' : 'Set a monthly contribution')) + '</span></div>';
    } else if (key === 'prepaid') {
      content += numberInput(item, 'Annual value', 'value') + '<label class="check-row"><input data-field="covered" type="checkbox" ' + (item.covered ? 'checked' : '') + '>Already paid</label>';
    } else {
      content += numberInput(item, 'Monthly amount', 'amount');
      if (key === 'bills') {
        const status = M.billStatus(item);
        content += numberInput(item, 'Due day', 'dueDay', 1, 31, 1);
        content += '<div class="' + (!status.paid && status.delta <= 0 && item.amount > 0 ? 'error-text' : 'muted') + '">' + (item.amount ? status.label : 'Set amount') + '</div><button type="button" data-paid>' + (status.paid ? 'Undo paid' : 'Mark paid') + '</button>';
      }
    }
    row.innerHTML = content + '<button type="button" data-remove aria-label="Remove ' + esc(item.name) + '">Remove</button>';
    row.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
      if (!input.checkValidity() || (input.type !== 'checkbox' && !input.value.trim())) { input.reportValidity(); return; }
      item[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
      change(); summary(); renderCollection(key, id);
    }));
    row.querySelector('[data-remove]').onclick = () => {
      if (!confirm('Remove ' + item.name + '?')) return;
      state[key] = state[key].filter(r => r.id !== item.id); change(); renderLists(); summary();
    };
    const paid = row.querySelector('[data-paid]');
    if (paid) paid.onclick = () => {
      const status = M.billStatus(item);
      item.paidMonths = status.paid ? item.paidMonths.filter(m => m !== status.month) : [...item.paidMonths.slice(-119), status.month];
      change(); renderCollection(key, id); summary();
    };
    container.append(row);
  }
}
function renderLists() {
  for (const [key,id] of [['bills','billItems'],['variables','variableItems'],['spending','spendingItems'],['goals','goalItems'],['prepaid','prepaidItems']]) renderCollection(key,id);
}
function summary() {
  const t = M.totals(state);
  $('monthlyTotal').textContent = fmt(t.monthlyTotal);
  $('monthlyDetail').textContent = fmt(t.monthlyBills) + ' bills + ' + fmt(t.monthlyVariables) + ' essentials + ' + fmt(t.monthlySpending) + ' other spending.';
  $('liquidTotal').textContent = fmt(t.liquid);
  $('liquidDetail').textContent = 'Count each account once. Exclude investments and cash unavailable to spend.';
  $('freeTotal').textContent = fmt(t.monthlyFree);
  $('freeTotal').classList.toggle('error-text', t.monthlyFree < 0);
  $('freeDetail').textContent = fmt(t.monthlyIncome) + ' regular income minus spending and ' + fmt(t.goalMonthly) + ' monthly savings. Commission is separate.';
  $('runwayTotal').textContent = t.runway === null ? '—' : t.runway.toFixed(1) + ' months';
  $('runwayDetail').textContent = t.runway === null ? 'Add monthly expenses to calculate runway.' : 'Assumes no new income and the spending entered above. Savings contributions are excluded.';
  $('coverageStatus').textContent = t.monthlyTotal === 0 ? 'Add expenses' : t.gap >= 0 ? 'Reserve funded' : 'Funding gap';
  $('coverageDetail').textContent = fmt(t.required) + ' needed for ' + state.monthsToCover + ' months including ' + state.bufferPct + '% buffer. ' + (t.gap < 0 ? fmt(-t.gap) + ' still needed.' : fmt(t.gap) + ' above target.') + ' Prepaid value: ' + fmt(t.prepaid) + ' (excluded from cash).';
  const percent = t.required ? Math.min(100, t.liquid / t.required * 100) : 0;
  $('coverageBars').innerHTML = '<label>Reserve funded: ' + percent.toFixed(0) + '%<progress max="100" value="' + percent + '"></progress></label>';
  $('billMonth').textContent = new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'}) + ' · ' + fmt(state.bills.filter(b => !M.billStatus(b).paid).reduce((n,b)=>n+b.amount,0)) + ' unmarked. Confirm payment with your bank.';
  const cards = [
    ['Per paycheck', fmt(t.regularAllocated) + ' for expenses', t.regularShortfall ? fmt(t.regularShortfall) + ' short per check.' : fmt(t.regularSurplus) + ' remains before savings goals.'],
    ['One-time commission', fmt(t.commissionSavings) + ' to savings', fmt(t.commissionBuffer) + ' to cash buffer.'],
    ['New lump sum', fmt(t.lumpToCoverage) + ' toward reserves', fmt(t.lumpSurplus) + ' remains after filling the gap.']
  ];
  $('allocationOutput').innerHTML = cards.map(([title,value,note])=>'<div class="allocation-card"><h3>'+title+'</h3><strong>'+value+'</strong><p>'+note+'</p></div>').join('');
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([data], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function openPlanner() {
  $('authScreen').classList.add('is-hidden'); $('appShell').classList.remove('is-hidden');
  $('userPill').textContent = mode === 'browser' ? 'Saved in this browser' : 'Local owner account';
  $('logout').classList.toggle('is-hidden', mode !== 'local');
  $('storageNotice').textContent = mode === 'browser'
    ? 'Your plan is stored only in this browser on this device, without a password. Anyone with access to this browser profile can view it. Clearing browser data deletes it. Export a backup to move devices. No cloud sync.'
    : 'Your plan is saved on this computer behind your owner login. Use Save plan after editing; export a backup regularly.';
  renderFields(); renderLists(); summary();
  message(state.updatedAt ? 'Last saved ' + new Date(state.updatedAt).toLocaleString() : 'Add your amounts, then save your first plan.');
}
async function boot() {
  $('saveData').onclick = () => save();
  $('exportData').onclick = () => {
    // Export the last valid in-memory plan even if storage is full or unavailable.
    download('autonomy-backup-' + new Date().toISOString().slice(0,10) + '.json', JSON.stringify({ app:'AUTONOMY', version:2, exportedAt:new Date().toISOString(), plan:state }, null, 2));
    $('backupStatus').textContent = 'Backup downloaded.';
  };
  $('recoverData').onclick = () => download('autonomy-recovery.json', localStorage.getItem(PLAN_KEY) || localStorage.getItem(LEGACY_KEY) || '{}');
  $('importData').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 256000) throw new Error('Backup is too large (maximum 256 KB).');
      const data = JSON.parse(await file.text());
      if (data.app !== 'AUTONOMY' || data.version !== 2) throw new Error('Choose an AUTONOMY v2 backup.');
      const plan = M.validate(data.plan);
      if (!confirm('Replace your current plan with this backup? Export your current plan first if needed.')) return;
      state = plan; change(); syncFields(); renderLists(); summary();
      $('backupStatus').textContent = await save() ? 'Backup imported and saved.' : 'Imported in memory. Save failed; see the save status above.';
    } catch (e) { $('backupStatus').textContent = 'Import failed: ' + e.message; }
    finally { event.target.value = ''; }
  };
  $('resetData').onclick = async () => {
    if (!confirm('Reset all amounts, bills, and goals? Export a backup first.')) return;
    state = M.defaults(); change(); syncFields(); renderLists(); summary(); await save();
  };
  $('logout').onclick = async () => {
    if (dirty && !confirm('You have unsaved changes. Log out without saving?')) return;
    try { await api('/api/logout',{method:'POST',body:'{}'}); dirty = false; location.reload(); }
    catch(e) { message(e.message,true); }
  };
  document.querySelectorAll('[data-add]').forEach(button => button.onclick = () => {
    addCollection = button.dataset.add;
    $('itemName').value=''; $('itemAmount').value = addCollection === 'goals' ? '1000' : '0';
    $('itemAmount').min = addCollection === 'goals' ? '0.01' : '0';
    $('addAmountLabel').textContent = addCollection === 'goals' ? 'Savings target' : addCollection === 'prepaid' ? 'Annual value' : 'Monthly amount';
    $('addTitle').textContent = addCollection === 'goals' ? 'Add savings goal' : 'Add budget item';
    $('addError').textContent=''; $('addDialog').showModal(); $('itemName').focus();
  });
  $('cancelAdd').onclick = () => $('addDialog').close();
  $('addForm').onsubmit = event => {
    event.preventDefault();
    if (! $('itemName').value.trim()) { $('addError').textContent='Enter a name.'; return; }
    if (state[addCollection].length >= 200) { $('addError').textContent='Maximum 200 items per section.'; return; }
    const item = {id:crypto.randomUUID(),name:$('itemName').value.trim()}, amount=Number($('itemAmount').value);
    if (addCollection === 'goals') Object.assign(item,{target:amount,saved:0,monthly:0});
    else if (addCollection === 'prepaid') Object.assign(item,{value:amount,covered:false});
    else Object.assign(item,{amount},addCollection==='bills'?{dueDay:1,paidMonths:[]}:{});
    state[addCollection].push(item); change(); renderLists(); summary(); $('addDialog').close();
  };
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue=''; } });
  window.addEventListener('storage', event => {
    if (mode === 'browser' && event.key === PLAN_KEY) {
      if (dirty || saving) { conflict=true; clearTimeout(saveTimer); message('Another tab changed this plan. Export your changes and reload.',true); }
      else try { const data=browserRecord(); state=data.plan; revision=data.revision; syncFields(); renderLists(); summary(); message('Updated from another tab.'); } catch(e) { message(e.message,true); }
    }
  });
  // Mode comes from an explicit server response. A network or login error never changes storage mode.
  const session = await api('/api/session');
  mode = session.mode;
  if (mode === 'browser') {
    const data=browserRecord(); state=data.plan; revision=data.revision;
    $('authTitle').textContent='A clearer plan for your money';
    $('authHelp').textContent='Plan bills, track savings, and see your cash runway. This personal planner saves only in this browser on this device. There is no cloud account or password. Export backups to keep a copy.';
    $('openBrowser').classList.remove('is-hidden');
    $('openBrowser').onclick = () => {
      try {
        const probe = PLAN_KEY + '.probe'; localStorage.setItem(probe,'1'); localStorage.removeItem(probe);
        openPlanner();
      } catch(e) { $('authError').textContent='Browser storage is unavailable. Allow site storage before using this planner.'; }
    };
  } else if (mode === 'local') {
    if (session.user) { const data=await api('/api/plan'); state=M.validate(data.plan); revision=data.revision; openPlanner(); return; }
    $('authTitle').textContent=session.setupRequired ? 'Create local owner access' : 'Log in';
    $('authHelp').textContent='Your account and budget are saved on this computer. This local server is accessible only on this computer.';
    $('authForm').classList.remove('is-hidden');
    $('authSubmit').textContent=session.setupRequired?'Create owner account':'Log in';
    $('authPassword').autocomplete=session.setupRequired?'new-password':'current-password';
    $('authForm').onsubmit=async event=>{
      event.preventDefault(); $('authError').textContent=''; $('authSubmit').disabled=true;
      try {
        await api(session.setupRequired?'/api/setup':'/api/login',{method:'POST',body:JSON.stringify({email:$('authEmail').value,password:$('authPassword').value})});
        $('authPassword').value='';
        const data=await api('/api/plan'); state=M.validate(data.plan); revision=data.revision; openPlanner();
      } catch(e) { $('authError').textContent=e.message; } finally { $('authSubmit').disabled=false; }
    };
  } else throw new Error('Unknown storage mode. Please reload after checking the deployment.');
}
boot().catch(e=>{
  $('authTitle').textContent='Unable to open your plan';
  $('authError').textContent=e.message;
  $('authHelp').textContent='Your stored data has not been changed. Reload to retry.';
  try { if (localStorage.getItem(PLAN_KEY)||localStorage.getItem(LEGACY_KEY)) $('recoverData').classList.remove('is-hidden'); } catch {}
});


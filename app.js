const blankFallback = {
  monthsToCover: 7,
  bufferPct: 15,
  billsBalance: 0,
  essentialsBalance: 0,
  frostBalance: 0,
  fidelityBalance: 0,
  regularPaycheck: 0,
  regularChecks: 4,
  commissionAmount: 0,
  commissionFidelityPct: 60,
  lumpSum: 0,
  manualApproval: true,
  approvalThreshold: 500,
  readOnlyMode: true,
  fidelityManual: true,
  bills: [],
  variables: [],
  prepaid: [],
  spending: []
};

let state = structuredClone(blankFallback);
let currentUser = null;
let setupRequired = false;
let connectors = [];
let auditRows = [];

function byId(id) {
  return document.getElementById(id);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function sum(items, field = "amount") {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function totals() {
  const monthlyBills = sum(state.bills);
  const monthlyVariables = sum(state.variables);
  const baseRequired = (monthlyBills + monthlyVariables) * Number(state.monthsToCover || 0);
  const buffer = baseRequired * (Number(state.bufferPct || 0) / 100);
  const required = baseRequired + buffer;
  const liquid =
    Number(state.billsBalance) +
    Number(state.essentialsBalance) +
    Number(state.frostBalance) +
    Number(state.fidelityBalance);
  const prepaid = sum(state.prepaid.filter((item) => item.covered), "value");
  const covered = liquid + prepaid;
  const gap = covered - required;
  const monthlyCore = monthlyBills + monthlyVariables;
  const runway = monthlyCore > 0 ? liquid / monthlyCore : 0;
  const regularBillNeed = monthlyBills / Math.max(Number(state.regularChecks || 1), 1);
  const regularToFidelity = Math.max(Number(state.regularPaycheck || 0) - regularBillNeed, 0);
  const commissionToFidelity =
    Number(state.commissionAmount || 0) * (Number(state.commissionFidelityPct || 0) / 100);
  const commissionToFrost = Number(state.commissionAmount || 0) - commissionToFidelity;
  const lumpNeed = Math.max(required - covered, 0);
  const lumpToCoverage = Math.min(Number(state.lumpSum || 0), lumpNeed);
  const lumpSurplus = Math.max(Number(state.lumpSum || 0) - lumpToCoverage, 0);

  return {
    monthlyBills,
    monthlyVariables,
    monthlyCore,
    baseRequired,
    buffer,
    required,
    liquid,
    prepaid,
    covered,
    gap,
    runway,
    regularBillNeed,
    regularToFidelity,
    commissionToFidelity,
    commissionToFrost,
    lumpToCoverage,
    lumpSurplus
  };
}

function scoreFromTotals(data) {
  let score = 0;
  if (state.readOnlyMode) score += 12;
  if (state.manualApproval) score += 12;
  if (state.fidelityManual) score += 10;
  if (data.covered >= data.required && data.required > 0) score += 28;
  else score += Math.max(0, Math.round((data.covered / Math.max(data.required, 1)) * 28));
  if (data.runway >= 6) score += 22;
  else score += Math.round((data.runway / 6) * 22);
  if (sum(state.prepaid.filter((item) => item.covered), "value") > 0) score += 8;
  if (data.regularToFidelity > 0) score += 8;
  return Math.min(100, score);
}

function renderAuth() {
  byId("authScreen").classList.toggle("is-hidden", Boolean(currentUser));
  byId("appShell").classList.toggle("is-hidden", !currentUser);
  byId("authTitle").textContent = setupRequired ? "Create Owner Access" : "Log In";
  byId("authSubmit").textContent = setupRequired ? "Create Owner Account" : "Log In";
  byId("authHelp").textContent = setupRequired
    ? "The first account becomes the owner. Use a strong password; this local MVP stores hashed credentials and your plan on this machine."
    : "Log in to view and update your saved AUTONOMY plan.";
  if (currentUser) byId("userPill").textContent = `${currentUser.email} · ${currentUser.role}`;
}

function bindScalar(id, type = "number") {
  const input = byId(id);
  input[type === "checkbox" ? "checked" : "value"] = state[id];
  input.oninput = () => {
    state[id] = type === "checkbox" ? input.checked : Number(input.value || 0);
    render();
  };
}

function initValues() {
  [
    "monthsToCover",
    "bufferPct",
    "billsBalance",
    "essentialsBalance",
    "frostBalance",
    "fidelityBalance",
    "regularPaycheck",
    "regularChecks",
    "commissionAmount",
    "commissionFidelityPct",
    "lumpSum",
    "approvalThreshold"
  ].forEach((id) => {
    byId(id).value = state[id] || 0;
  });
  ["manualApproval", "readOnlyMode", "fidelityManual"].forEach((id) => {
    byId(id).checked = Boolean(state[id]);
  });
}

function renderLineItems(containerId, collectionName) {
  const container = byId(containerId);
  container.innerHTML = "";
  state[collectionName].forEach((item) => {
    const row = document.createElement("div");
    row.className = "line-item";
    row.innerHTML = `
      <div>
        <div class="line-item-name">${item.name}</div>
        <div class="line-item-note">${item.note || ""}</div>
      </div>
      <input type="number" min="0" step="5" value="${item.amount}" aria-label="${item.name} amount" />
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      item.amount = Number(event.target.value || 0);
      render();
    });
    container.appendChild(row);
  });
}

function renderPrepaid() {
  const container = byId("prepaidItems");
  container.innerHTML = "";
  state.prepaid.forEach((item) => {
    const row = document.createElement("div");
    row.className = "prepaid-item";
    row.innerHTML = `
      <div>
        <div class="prepaid-title">${item.name}</div>
        <div class="prepaid-note">Estimated annual value: ${money(item.value)}</div>
      </div>
      <label class="check-row">
        <input type="checkbox" ${item.covered ? "checked" : ""} aria-label="${item.name} covered" />
        <span class="prepaid-status">${item.covered ? "Covered" : "Open"}</span>
      </label>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      item.covered = event.target.checked;
      render();
    });
    container.appendChild(row);
  });
}

function renderSpending() {
  const grid = byId("spendingItems");
  grid.innerHTML = "";
  state.spending.forEach((item) => {
    const row = document.createElement("div");
    row.className = "spending-item";
    row.innerHTML = `
      <label>${item.name}
        <input type="number" min="0" step="5" value="${item.amount}" aria-label="${item.name} monthly spending" />
      </label>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      item.amount = Number(event.target.value || 0);
      render();
    });
    grid.appendChild(row);
  });

  const max = Math.max(...state.spending.map((item) => item.amount), 1);
  const chart = byId("spendingChart");
  chart.innerHTML = "";
  [...state.spending]
    .sort((a, b) => b.amount - a.amount)
    .forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "spend-row";
      row.innerHTML = `
        <span>${item.name}</span>
        <span class="bar-track"><span class="bar-fill ${index % 3 === 1 ? "gold" : index % 3 === 2 ? "fig" : ""}" style="width:${Math.max((item.amount / max) * 100, 2)}%"></span></span>
        <strong>${money(item.amount)}</strong>
      `;
      chart.appendChild(row);
    });
}

function renderCoverageBars(data) {
  const bars = byId("coverageBars");
  const rows = [
    ["Monthly bills", data.monthlyBills, Math.max(data.monthlyCore, 1), ""],
    ["Variable essentials", data.monthlyVariables, Math.max(data.monthlyCore, 1), "gold"],
    ["Liquid reserves", data.liquid, Math.max(data.required, 1), "fig"],
    ["Prepaid value", data.prepaid, Math.max(data.required, 1), "gold"]
  ];
  bars.innerHTML = "";
  rows.forEach(([label, value, denominator, tone]) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    const width = Math.min((value / denominator) * 100, 100);
    row.innerHTML = `
      <span>${label}</span>
      <span class="bar-track"><span class="bar-fill ${tone}" style="width:${Math.max(width, value > 0 ? 2 : 0)}%"></span></span>
      <strong>${money(value)}</strong>
    `;
    bars.appendChild(row);
  });
}

function renderAllocation(data) {
  const container = byId("allocationOutput");
  const cards = [
    {
      title: "Regular Check",
      value: money(data.regularToFidelity),
      note: `${money(data.regularBillNeed)} to bills, remainder to Fidelity`
    },
    {
      title: "Commission",
      value: money(data.commissionToFidelity),
      note: `${money(data.commissionToFrost)} to Frost`
    },
    {
      title: "Lump Sum",
      value: money(data.lumpToCoverage),
      note: `${money(data.lumpSurplus)} surplus after coverage gap`
    }
  ];
  container.innerHTML = "";
  cards.forEach((card) => {
    const element = document.createElement("div");
    element.className = "allocation-card";
    element.innerHTML = `
      <div class="allocation-title">${card.title}</div>
      <strong>${card.value}</strong>
      <div class="allocation-note">${card.note}</div>
    `;
    container.appendChild(element);
  });
}

function renderRunway(data) {
  byId("runwayOutput").innerHTML = `
    <div class="runway-card">
      <div class="allocation-title">Liquid Runway</div>
      <strong>${data.runway.toFixed(1)} months</strong>
      <div class="allocation-note">Based on ${money(data.monthlyCore)} monthly bills plus essentials.</div>
    </div>
    <div class="runway-card">
      <div class="allocation-title">Monthly Core Need</div>
      <strong>${money(data.monthlyCore)}</strong>
      <div class="allocation-note">Fixed bills plus groceries, fuel, pharmacy basics.</div>
    </div>
    <div class="runway-card">
      <div class="allocation-title">Projected Buffer</div>
      <strong>${money(data.buffer)}</strong>
      <div class="allocation-note">${state.bufferPct}% reserve against anomalies and timing gaps.</div>
    </div>
  `;
}

function renderSummary(data) {
  const score = scoreFromTotals(data);
  byId("autonomyScore").textContent = score;
  byId("scoreMeter").style.width = `${score}%`;
  byId("requiredTotal").textContent = money(data.required);
  byId("coveredTotal").textContent = money(data.covered);
  byId("gapTotal").textContent = data.gap >= 0 ? `+${money(data.gap)}` : `-${money(Math.abs(data.gap))}`;
  byId("gapTotal").style.color = data.gap >= 0 ? "var(--teal)" : "var(--rose)";
  byId("requiredDetail").textContent = `${money(data.baseRequired)} base plus ${money(data.buffer)} buffer.`;
  byId("coveredDetail").textContent = `${money(data.liquid)} liquid and ${money(data.prepaid)} prepaid.`;
  byId("gapDetail").textContent = data.gap >= 0 ? "Fully covered under current assumptions." : "Funding gap before full coverage.";
  byId("coverageStatus").textContent = data.gap >= 0 ? "Covered" : "Needs Funding";
  byId("autonomySummary").textContent =
    score >= 85
      ? "Strong coverage with automation guardrails active."
      : score >= 65
        ? "Good draft. Increase reserves or reduce uncovered months."
        : "Enter real connected data or actual values before automation.";
}

function renderConnections() {
  const grid = byId("connectionsGrid");
  grid.innerHTML = "";
  const connectedCount = connectors.filter((item) => item.status === "configured").length;
  byId("connectionCount").textContent = `${connectedCount} Connected`;
  connectors.forEach((connector) => {
    const card = document.createElement("div");
    card.className = "connection-card";
    const status = connector.status.replaceAll("_", " ");
    card.innerHTML = `
      <span class="connector-status ${connector.status}">${status}</span>
      <h3>${connector.name}</h3>
      <p>${connector.provider}</p>
      <p>${connector.purpose}</p>
      <p><strong>Required config:</strong> ${connector.requiredEnv.join(", ") || "None"}</p>
    `;
    grid.appendChild(card);
  });
}

function renderAudit() {
  const panel = byId("auditPanel");
  if (!auditRows.length) {
    panel.innerHTML = "";
    return;
  }
  panel.innerHTML = `<h2>Owner Audit</h2>`;
  auditRows.slice(0, 5).forEach((row) => {
    const item = document.createElement("div");
    item.className = "audit-row";
    item.innerHTML = `<span>${row.action}</span><span>${new Date(row.at).toLocaleString()}</span>`;
    panel.appendChild(item);
  });
}

function render() {
  if (!currentUser) return renderAuth();
  const data = totals();
  renderAuth();
  renderSummary(data);
  renderConnections();
  renderLineItems("billItems", "bills");
  renderLineItems("variableItems", "variables");
  renderPrepaid();
  renderCoverageBars(data);
  renderAllocation(data);
  renderRunway(data);
  renderSpending();
  renderAudit();
}

async function savePlan() {
  await api("/api/plan", {
    method: "PUT",
    body: JSON.stringify({ plan: state })
  });
  await loadAudit();
  render();
}

async function loadPlan() {
  const payload = await api("/api/plan");
  state = payload.plan || structuredClone(blankFallback);
  currentUser = payload.user;
  initValues();
}

async function loadConnectors() {
  const payload = await api("/api/connectors");
  connectors = payload.connectors || [];
}

async function loadAudit() {
  if (currentUser?.role !== "owner") return;
  try {
    const payload = await api("/api/audit");
    auditRows = payload.audit || [];
  } catch {
    auditRows = [];
  }
}

async function boot() {
  [
    "monthsToCover",
    "bufferPct",
    "billsBalance",
    "essentialsBalance",
    "frostBalance",
    "fidelityBalance",
    "regularPaycheck",
    "regularChecks",
    "commissionAmount",
    "commissionFidelityPct",
    "lumpSum",
    "approvalThreshold"
  ].forEach((id) => bindScalar(id));
  ["manualApproval", "readOnlyMode", "fidelityManual"].forEach((id) => bindScalar(id, "checkbox"));

  byId("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    byId("authError").textContent = "";
    try {
      const endpoint = setupRequired ? "/api/setup" : "/api/login";
      const payload = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          email: byId("authEmail").value,
          password: byId("authPassword").value
        })
      });
      currentUser = payload.user;
      await loadPlan();
      await loadConnectors();
      await loadAudit();
      render();
    } catch (error) {
      byId("authError").textContent = error.message;
    }
  });

  byId("saveData").addEventListener("click", savePlan);
  byId("logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    render();
  });
  byId("resetData").addEventListener("click", async () => {
    if (!confirm("Reset the plan to blank values?")) return;
    const payload = await api("/api/plan", { method: "GET" });
    const plan = payload.plan;
    for (const key of Object.keys(plan)) {
      if (typeof plan[key] === "number") plan[key] = blankFallback[key] ?? 0;
    }
    state = plan;
    initValues();
    render();
  });

  const session = await api("/api/session");
  currentUser = session.user;
  setupRequired = session.setupRequired;
  if (currentUser) {
    await loadPlan();
    await loadConnectors();
    await loadAudit();
  }
  render();
}

boot().catch((error) => {
  byId("authError").textContent = error.message;
  renderAuth();
});

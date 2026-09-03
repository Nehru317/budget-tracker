let state = loadState();
let currentPage = "dashboard";
let txFilter = "all";
let whatIfDebtId = "";
let whatIfExtra = 0;

const PAGE_META = {
  dashboard: ["Dashboard", "Accounts, upcoming bills, and a snapshot of your money"],
  accounts: ["Accounts", "Checking, savings, cash, retirement, and transfers between them"],
  transactions: ["Transactions", "Current and future money in and out"],
  income: ["Income", "Biweekly paycheck and other deposits"],
  debts: ["Debts & Loans", "Balances, extra-payment what-ifs, and payoff estimates"],
  budgets: ["Budgets", "Monthly spending limits by category"],
  goals: ["Savings Goals", "Targets and how much to set aside each paycheck"],
  settings: ["Settings", "Backup, Navy Federal CSV import, and appearance"],
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function persist() {
  syncSpendingBalance(state);
  saveState(state);
  applyTheme();
  $("sidebar-balance").textContent = formatMoney(spendingTotal(state));
  $("sidebar-savings").textContent = formatMoney(savingsTotal(state));
  render();
}

function applyTheme() {
  document.body.classList.toggle("light", state.theme === "light");
  $("theme-toggle").textContent = state.theme === "light" ? "Dark mode" : "Light mode";
}

function toast(message) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

function setPage(page) {
  if (!PAGE_META[page]) page = "dashboard";
  currentPage = page;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });
  $("page-title").textContent = PAGE_META[page][0];
  $("page-subtitle").textContent = PAGE_META[page][1];
  try {
    if (location.hash.replace("#", "") !== page) {
      history.replaceState(null, "", `#${page}`);
    }
  } catch {
    /* file:// app windows can block history changes */
  }
  render();
}

function closeModal() {
  const backdrop = $("modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  backdrop.hidden = true;
  $("modal-body").innerHTML = "";
  $("modal-foot").innerHTML = "";
}

function openModal(title, bodyHtml, footerBtns) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-foot").innerHTML = "";
  const buttons = [...(footerBtns || [])];
  const hasClose = buttons.some((btn) => /cancel|close/i.test(btn.label));
  if (!hasClose) {
    buttons.unshift({ label: "Close", onClick: closeModal });
  }
  buttons.forEach((btn) => {
    const el = document.createElement("button");
    el.className = `btn ${btn.className || ""}`.trim();
    el.type = "button";
    el.textContent = btn.label;
    el.addEventListener("click", btn.onClick);
    $("modal-foot").appendChild(el);
  });
  const backdrop = $("modal-backdrop");
  backdrop.hidden = false;
  backdrop.classList.add("is-open");
}

function fieldValue(id) {
  return document.getElementById(id)?.value ?? "";
}

function categoryOptions(selected) {
  return CATEGORIES.map((c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function freqOptions(selected) {
  const opts = [
    ["none", "Does not repeat"],
    ["weekly", "Weekly"],
    ["biweekly", "Every 2 weeks"],
    ["monthly", "Monthly"],
    ["yearly", "Yearly"],
  ];
  return opts.map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("");
}

function payFreqOptions(selected) {
  const opts = [
    ["weekly", "Weekly"],
    ["biweekly", "Every 2 weeks"],
    ["monthly", "Monthly"],
  ];
  return opts.map(([v, l]) => `<option value="${v}" ${v === (selected || "biweekly") ? "selected" : ""}>${l}</option>`).join("");
}

function accountOptions(selectedId, allowEmpty = false) {
  const fallback = allowEmpty ? "" : defaultAccountId(state);
  const current = selectedId || fallback;
  return (state.accounts || []).map((account) => {
    const selected = current === account.id ? "selected" : "";
    return `<option value="${escapeHtml(account.id)}" ${selected}>${escapeHtml(account.name)}</option>`;
  }).join("");
}

function renderDashboard() {
  const debts = debtTotals(state);
  const month = monthlyTotals(state);
  const upcoming = (() => {
    let paycheckKept = false;
    return futureEvents(state, 2).filter((ev) => {
      if (ev.source !== "paycheck") return true;
      if (paycheckKept) return false;
      paycheckKept = true;
      return true;
    }).slice(0, 8);
  })();
  const assets = assetsTotal(state);
  const paydayTotal = projectedTotalAtPayday(state);
  const overBudget = (state.budgets || []).filter((b) => (month.byCategory[b.category] || 0) > Number(b.monthlyLimit));

  $("page-dashboard").innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>Accounts</h3>
        <div class="accounts-total">
          <span>Accounts total</span>
          ${formatMoney(assets)}
          <div class="accounts-projected">
            ${formatMoney(paydayTotal.projected)}
            <span>${paydayTotal.payday
              ? `Projected after next paycheck · ${formatDateNice(paydayTotal.payday)}`
              : "Set a next payday on Income to project this"}</span>
          </div>
        </div>
        ${(state.accounts || []).length ? (state.accounts || []).map((account) => `
          <div class="row-item">
            <div>
              <div>${escapeHtml(account.name)}</div>
              <div class="meta">${escapeHtml(accountTypeLabel(account.type))}${isRetirementAccount(account) ? " · net worth only" : account.includeInCashFlow ? " · used for bills" : " · set aside"}</div>
            </div>
            <strong>${formatMoney(account.balance)}</strong>
          </div>`).join("") : `<div class="empty">Add checking, savings, cash, or retirement on the Accounts page.</div>`}
      </div>
      <div class="card">
        <h3>Coming up</h3>
        ${upcoming.length ? `<div class="list">${upcoming.map((ev) => `
          <div class="row-item">
            <div>
              <div>${escapeHtml(ev.description)}</div>
              <div class="meta">${formatDateNice(ev.date)} · ${ev.type === "income" ? "Income" : "Expense"} · ${escapeHtml(accountName(state, ev.accountId))}</div>
            </div>
            <strong class="${ev.type === "income" ? "positive" : "negative"}">${ev.type === "income" ? "+" : "−"}${formatMoney(ev.amount)}</strong>
          </div>`).join("")}</div>` : `<div class="empty">No upcoming paycheck, deposit, or planned transaction yet.</div>`}
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>This month</h3>
      <div class="grid cols-2">
        <div class="row-item"><span>Recorded spending</span><strong class="negative">${formatMoney(month.spent)}</strong></div>
        <div class="row-item"><span>Recorded income</span><strong class="positive">${formatMoney(month.earned)}</strong></div>
        <div class="row-item"><span>Projected monthly income</span><strong>${formatMoney(projectedMonthlyIncome(state))}</strong></div>
        <div class="row-item"><span>Net worth</span><strong>${formatMoney(netWorth(state))}</strong></div>
        <div class="row-item"><span>Total debt</span><strong class="negative">${formatMoney(debts.balance)}</strong></div>
      </div>
      ${overBudget.length ? `<p class="negative" style="margin:12px 0 0">Over budget: ${overBudget.map((b) => escapeHtml(b.category)).join(", ")}</p>` : `<p class="muted" style="margin:12px 0 0">No budget overruns this month.</p>`}
    </div>
  `;
}

function renderAccounts() {
  const accounts = state.accounts || [];
  $("page-accounts").innerHTML = `
    <div class="help">Spending accounts drive the paycheck-to-paycheck forecast. Savings stays set aside until you transfer it. Retirement is left out of Accounts total and still counts in net worth.</div>
    <div class="toolbar">
      <div class="muted">Spending ${formatMoney(spendingTotal(state))} · Set aside ${formatMoney(savingsTotal(state))}${retirementTotal(state) ? ` · Retirement ${formatMoney(retirementTotal(state))}` : ""}</div>
      <div class="spacer"></div>
      <button class="btn" id="transfer-money">Transfer</button>
      <button class="btn primary" id="add-account">Add account</button>
    </div>
    <div class="accounts-total">
      <span>Accounts total</span>
      ${formatMoney(assetsTotal(state))}
      <div class="accounts-projected">
        ${formatMoney(netWorth(state))}
        <span>Net worth · includes retirement, minus debt</span>
      </div>
    </div>
    <div class="grid cols-3">
      ${accounts.length ? accounts.map((account) => `
        <div class="card">
          <div class="toolbar">
            <h3 style="margin:0">${escapeHtml(account.name)}</h3>
            <span class="badge">${escapeHtml(accountTypeLabel(account.type))}</span>
          </div>
          <div class="stat-value">${formatMoney(account.balance)}</div>
          <div class="stat-note">${isRetirementAccount(account) ? "Counts toward net worth, not Accounts total" : account.includeInCashFlow ? "Counts toward bills and payday forecast" : "Held back from spending forecast"}</div>
          ${state.primaryAccountId === account.id ? `<div class="account-flag" style="margin-top:8px">Default account for new transactions</div>` : ""}
          <div class="toolbar" style="margin-top:12px">
            ${state.primaryAccountId === account.id || isRetirementAccount(account) ? "" : `<button class="btn small" data-default-account="${account.id}">Make default</button>`}
            <button class="btn small" data-edit-account="${account.id}">Edit</button>
          </div>
        </div>`).join("") : `<div class="card empty">Add a checking, savings, cash, or retirement account.</div>`}
    </div>
  `;
  $("add-account").addEventListener("click", () => openAccountModal());
  $("transfer-money").addEventListener("click", () => openTransferModal());
  $("page-accounts").querySelectorAll("[data-edit-account]").forEach((btn) => {
    btn.addEventListener("click", () => openAccountModal(btn.dataset.editAccount));
  });
  $("page-accounts").querySelectorAll("[data-default-account]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.primaryAccountId = btn.dataset.defaultAccount;
      persist();
      toast("Default account updated");
    });
  });
}

function openAccountModal(id) {
  const account = (state.accounts || []).find((item) => item.id === id) || {
    name: "", type: "checking", balance: "", includeInCashFlow: true,
  };
  const retire = account.type === "retirement";
  openModal(id ? "Edit account" : "Add account", `
    <div class="form-grid">
      <div class="field span-2"><label>Name</label><input id="a-name" value="${escapeHtml(account.name)}" placeholder="Checking, emergency savings, TSP..."></div>
      <div class="field"><label>Type</label>
        <select id="a-type">${ACCOUNT_TYPES.map(([value, label]) => `<option value="${value}" ${value === (account.type || "checking") ? "selected" : ""}>${label}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Current balance</label><input id="a-bal" type="number" step="0.01" value="${escapeHtml(account.balance)}"></div>
      <div class="field span-2" id="a-spend-field" ${retire ? "hidden" : ""}><label class="check"><input id="a-spend" type="checkbox" ${!retire && account.includeInCashFlow !== false ? "checked" : ""}> Include in spending cash / payday forecast</label></div>
    </div>
    <p class="muted" id="a-retire-note" style="margin:12px 0 0" ${retire ? "" : "hidden"}>Retirement is left out of Accounts total and the payday forecast. It still counts toward net worth.</p>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => {
      if ((state.accounts || []).length <= 1) { toast("Keep at least one account"); return; }
      state.accounts = state.accounts.filter((item) => item.id !== id);
      if (state.primaryAccountId === id) state.primaryAccountId = defaultAccountId(state);
      closeModal();
      persist();
    } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      if (!fieldValue("a-name").trim()) { toast("Enter an account name"); return; }
      const type = fieldValue("a-type");
      const include = type === "retirement" ? false : document.getElementById("a-spend").checked;
      const next = {
        id: id || uid(),
        name: fieldValue("a-name").trim(),
        type,
        balance: Number(fieldValue("a-bal")) || 0,
        includeInCashFlow: include,
      };
      const existing = state.accounts.find((item) => item.id === next.id);
      if (existing) Object.assign(existing, next);
      else state.accounts.push(next);
      if (next.type === "retirement") {
        if (state.primaryAccountId === next.id) state.primaryAccountId = defaultAccountId(state);
      } else if (!state.primaryAccountId) {
        state.primaryAccountId = next.id;
      }
      closeModal();
      persist();
    } },
  ]);
  const syncTypeFields = () => {
    const type = fieldValue("a-type");
    const isRetire = type === "retirement";
    $("a-spend-field").hidden = isRetire;
    $("a-retire-note").hidden = !isRetire;
    if (isRetire) $("a-spend").checked = false;
    else if (!id) $("a-spend").checked = type !== "savings";
  };
  $("a-type").addEventListener("change", syncTypeFields);
}

function openTransferModal() {
  if ((state.accounts || []).length < 2) {
    toast("Add a second account before transferring");
    return;
  }
  const fromId = defaultAccountId(state);
  const toId = (state.accounts.find((account) => account.id !== fromId) || state.accounts[0]).id;
  openModal("Transfer between accounts", `
    <div class="form-grid">
      <div class="field"><label>From</label><select id="t-from">${accountOptions(fromId)}</select></div>
      <div class="field"><label>To</label><select id="t-to">${accountOptions(toId)}</select></div>
      <div class="field span-2"><label>Amount</label><input id="t-amt" type="number" min="0" step="0.01" placeholder="0.00"></div>
    </div>
  `, [
    { label: "Cancel", onClick: closeModal },
    { label: "Transfer", className: "primary", onClick: () => {
      const amount = Number(fieldValue("t-amt"));
      const from = fieldValue("t-from");
      const to = fieldValue("t-to");
      if (!(amount > 0) || !from || !to) { toast("Enter an amount and both accounts"); return; }
      if (from === to) { toast("Pick two different accounts"); return; }
      adjustAccount(state, from, -amount);
      adjustAccount(state, to, amount);
      state.transactions.push({
        id: uid(),
        date: toISODate(todayDate()),
        description: `Transfer · ${accountName(state, from)} → ${accountName(state, to)}`,
        category: "Other",
        amount,
        type: "transfer",
        status: "completed",
        recurring: "none",
        accountId: from,
        toAccountId: to,
      });
      closeModal();
      persist();
      toast("Transfer saved");
    } },
  ]);
}

function transactionRows() {
  const rows = [...(state.transactions || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows.filter((tx) => {
    if (txFilter === "planned") return tx.status !== "completed";
    if (txFilter === "completed") return tx.status === "completed";
    return true;
  });
}

function renderTransactions() {
  const rows = transactionRows();
  const spent = rows.filter((t) => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const earned = rows.filter((t) => t.type === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  $("page-transactions").innerHTML = `
    <div class="toolbar">
      <button class="btn small ${txFilter === "all" ? "primary" : ""}" data-filter="all">All</button>
      <button class="btn small ${txFilter === "planned" ? "primary" : ""}" data-filter="planned">Future / planned</button>
      <button class="btn small ${txFilter === "completed" ? "primary" : ""}" data-filter="completed">Completed</button>
      <div class="spacer"></div>
      <span class="muted">Recorded in this list: In ${formatMoney(earned)} · Out ${formatMoney(spent)} · Net ${formatMoney(earned - spent)}</span>
      <button class="btn" id="import-csv">Import Navy Federal CSV</button>
      <button class="btn primary" id="add-tx">Add transaction</button>
    </div>
    <div class="card table-wrap">
      ${rows.length ? `
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${rows.map((tx) => `
            <tr>
              <td>${escapeHtml(tx.date)}</td>
              <td>${escapeHtml(tx.description)}${tx.recurring && tx.recurring !== "none" ? ` <span class="badge">${escapeHtml(tx.recurring)}</span>` : ""}</td>
              <td>${escapeHtml(tx.type === "transfer" ? `${accountName(state, tx.accountId)} → ${accountName(state, tx.toAccountId)}` : accountName(state, tx.accountId))}</td>
              <td>${escapeHtml(tx.category || "Other")}</td>
              <td><span class="badge ${tx.status === "completed" ? "done" : "planned"}">${tx.type === "transfer" ? "Transfer" : (tx.status === "completed" ? "Completed" : "Planned")}</span></td>
              <td class="num ${tx.type === "income" ? "positive" : tx.type === "transfer" ? "" : "negative"}">${tx.type === "income" ? "+" : tx.type === "transfer" ? "" : "−"}${formatMoney(tx.amount)}</td>
              <td><button class="btn small" data-edit-tx="${tx.id}">Edit</button></td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<div class="empty">No transactions yet. Add a bill, purchase, or planned future expense.</div>`}
    </div>
  `;
  $("page-transactions").querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { txFilter = btn.dataset.filter; renderTransactions(); });
  });
  $("add-tx")?.addEventListener("click", () => openTransactionModal());
  $("import-csv")?.addEventListener("click", () => pickBankCsvFile());
  $("page-transactions").querySelectorAll("[data-edit-tx]").forEach((btn) => {
    btn.addEventListener("click", () => openTransactionModal(btn.dataset.editTx));
  });
}

function openTransactionModal(id) {
  const tx = (state.transactions || []).find((t) => t.id === id) || {
    date: toISODate(todayDate()),
    description: "",
    category: "Other",
    amount: "",
    type: "expense",
    status: "planned",
    recurring: "none",
    accountId: defaultAccountId(state),
  };
  if (tx.type === "transfer") {
    openModal("Transfer", `
      <p class="muted">${escapeHtml(tx.description)} · ${formatMoney(tx.amount)} on ${escapeHtml(tx.date)}</p>
      <p>Delete this transfer to reverse the account balances.</p>
    `, [
      { label: "Cancel", onClick: closeModal },
      { label: "Delete and reverse", className: "danger", onClick: () => {
        adjustAccount(state, tx.toAccountId, -(Number(tx.amount) || 0));
        adjustAccount(state, tx.accountId, Number(tx.amount) || 0);
        state.transactions = state.transactions.filter((item) => item.id !== id);
        closeModal();
        persist();
        toast("Transfer reversed");
      } },
    ]);
    return;
  }
  openModal(id ? "Edit transaction" : "Add transaction", `
    <div class="form-grid">
      <div class="field"><label>Date</label><input id="f-date" type="date" value="${escapeHtml(tx.date || "")}"></div>
      <div class="field"><label>Amount</label><input id="f-amount" type="number" min="0" step="0.01" value="${escapeHtml(tx.amount)}"></div>
      <div class="field span-2"><label>Description</label><input id="f-desc" value="${escapeHtml(tx.description)}" placeholder="Rent, groceries, car insurance..."></div>
      <div class="field"><label>Category</label><select id="f-cat">${categoryOptions(tx.category)}</select></div>
      <div class="field"><label>Account</label><select id="f-account">${accountOptions(tx.accountId)}</select></div>
      <div class="field"><label>Type</label>
        <select id="f-type">
          <option value="expense" ${tx.type !== "income" ? "selected" : ""}>Expense</option>
          <option value="income" ${tx.type === "income" ? "selected" : ""}>Income</option>
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select id="f-status">
          <option value="planned" ${tx.status !== "completed" ? "selected" : ""}>Planned / future</option>
          <option value="completed" ${tx.status === "completed" ? "selected" : ""}>Completed</option>
        </select>
      </div>
      <div class="field"><label>Repeat</label><select id="f-rec">${freqOptions(tx.recurring || "none")}</select></div>
      <div class="field span-2"><label class="check"><input id="f-apply" type="checkbox" ${tx.status === "completed" ? "checked" : ""}> Also update the selected account when saving a completed item</label></div>
    </div>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => { state.transactions = state.transactions.filter((t) => t.id !== id); closeModal(); persist(); toast("Transaction deleted"); } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      const amount = Number(fieldValue("f-amount"));
      if (!fieldValue("f-date") || !(amount >= 0) || !fieldValue("f-desc").trim()) {
        toast("Enter a date, description, and amount");
        return;
      }
      const next = {
        id: id || uid(),
        date: fieldValue("f-date"),
        description: fieldValue("f-desc").trim(),
        category: fieldValue("f-cat"),
        amount,
        type: fieldValue("f-type"),
        status: fieldValue("f-status"),
        recurring: fieldValue("f-rec"),
        accountId: fieldValue("f-account") || defaultAccountId(state),
      };
      const apply = document.getElementById("f-apply").checked && next.status === "completed";
      const existing = state.transactions.find((t) => t.id === next.id);
      if (apply) {
        const signed = next.type === "income" ? amount : -amount;
        if (!existing || existing.status !== "completed") adjustAccount(state, next.accountId, signed);
      }
      if (existing) Object.assign(existing, next);
      else state.transactions.push(next);
      closeModal();
      persist();
      toast("Transaction saved");
    } },
  ]);
}

function renderIncome() {
  const monthly = projectedMonthlyIncome(state);
  const payday = nextPayDate(state);
  $("page-income").innerHTML = `
    <div class="help">Enter your take-home paycheck and any other deposits (tax refund, side work, family help). Future paydays are projected automatically so the dashboard can tell you if you will make it to the next check.</div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Biweekly paycheck</h3>
        <div class="form-grid">
          <div class="field span-2"><label>Name</label><input id="pay-name" value="${escapeHtml(state.paycheck.name || "")}"></div>
          <div class="field"><label>Net amount per paycheck</label><input id="pay-amount" type="number" min="0" step="0.01" value="${escapeHtml(state.paycheck.amount || 0)}"></div>
          <div class="field"><label>Frequency</label><select id="pay-freq">${payFreqOptions(state.paycheck.frequency)}</select></div>
          <div class="field span-2"><label>Next payday</label><input id="pay-next" type="date" value="${escapeHtml(state.paycheck.nextDate || "")}"></div>
          <div class="field span-2"><label>Deposits into</label><select id="pay-account">${accountOptions(state.paycheck.accountId)}</select></div>
        </div>
        <div class="toolbar" style="margin-top:14px">
          <button class="btn primary" id="save-pay">Save paycheck</button>
          <span class="muted">${payday ? `Next: ${formatDateNice(payday)}` : "Set a next payday to project deposits"}</span>
        </div>
      </div>
      <div class="card">
        <h3>Projected earnings</h3>
        <div class="row-item"><span>Per paycheck</span><strong class="positive">${formatMoney(state.paycheck.amount)}</strong></div>
        <div class="row-item"><span>Typical month</span><strong>${formatMoney(monthly)}</strong></div>
        <div class="row-item"><span>Typical year</span><strong>${formatMoney(monthly * 12)}</strong></div>
        <p class="muted" style="margin:12px 0 0">Biweekly pay is counted as 26 checks a year (about 2.17 per month).</p>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="toolbar">
        <h3 style="margin:0">Other deposits</h3>
        <div class="spacer"></div>
        <button class="btn primary" id="add-dep">Add deposit</button>
      </div>
      ${(state.deposits || []).length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Account</th><th>Date</th><th>Repeat</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${state.deposits.map((d) => `
          <tr>
            <td>${escapeHtml(d.name)}</td>
            <td>${escapeHtml(accountName(state, d.accountId))}</td>
            <td>${escapeHtml(d.date)}</td>
            <td>${escapeHtml(d.recurring === "none" ? "One-time" : d.recurring)}</td>
            <td class="num positive">${formatMoney(d.amount)}</td>
            <td><button class="btn small" data-edit-dep="${d.id}">Edit</button></td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No extra deposits yet.</div>`}
    </div>
  `;
  $("save-pay").addEventListener("click", () => {
    state.paycheck = {
      name: fieldValue("pay-name").trim() || "Paycheck",
      amount: Number(fieldValue("pay-amount")) || 0,
      frequency: fieldValue("pay-freq") || "biweekly",
      nextDate: fieldValue("pay-next"),
      accountId: fieldValue("pay-account") || defaultAccountId(state),
    };
    persist();
    toast("Paycheck saved");
  });
  $("add-dep").addEventListener("click", () => openDepositModal());
  $("page-income").querySelectorAll("[data-edit-dep]").forEach((btn) => {
    btn.addEventListener("click", () => openDepositModal(btn.dataset.editDep));
  });
}

function openDepositModal(id) {
  const dep = (state.deposits || []).find((d) => d.id === id) || {
    name: "", amount: "", date: toISODate(todayDate()), recurring: "none", accountId: defaultAccountId(state),
  };
  openModal(id ? "Edit deposit" : "Add deposit", `
    <div class="form-grid">
      <div class="field span-2"><label>Name</label><input id="d-name" value="${escapeHtml(dep.name)}" placeholder="Bonus, tax refund, side job"></div>
      <div class="field"><label>Amount</label><input id="d-amount" type="number" min="0" step="0.01" value="${escapeHtml(dep.amount)}"></div>
      <div class="field"><label>Date / next date</label><input id="d-date" type="date" value="${escapeHtml(dep.date || "")}"></div>
      <div class="field"><label>Account</label><select id="d-account">${accountOptions(dep.accountId)}</select></div>
      <div class="field"><label>Repeat</label><select id="d-rec">${freqOptions(dep.recurring || "none")}</select></div>
    </div>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => { state.deposits = state.deposits.filter((d) => d.id !== id); closeModal(); persist(); } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      const amount = Number(fieldValue("d-amount"));
      if (!fieldValue("d-name").trim() || !(amount >= 0) || !fieldValue("d-date")) {
        toast("Fill in name, amount, and date");
        return;
      }
      const next = {
        id: id || uid(),
        name: fieldValue("d-name").trim(),
        amount,
        date: fieldValue("d-date"),
        recurring: fieldValue("d-rec"),
        accountId: fieldValue("d-account") || defaultAccountId(state),
      };
      const existing = state.deposits.find((d) => d.id === next.id);
      if (existing) Object.assign(existing, next);
      else state.deposits.push(next);
      closeModal();
      persist();
    } },
  ]);
}

function renderDebts() {
  const totals = debtTotals(state);
  const debts = [...(state.debts || [])];
  if (!whatIfDebtId || !debts.some((debt) => debt.id === whatIfDebtId)) {
    whatIfDebtId = debts[0]?.id || "";
    whatIfExtra = Number(debts[0]?.extraPayment) || 0;
  }
  const chosen = debts.find((debt) => debt.id === whatIfDebtId);
  const sliderMax = Math.max(400, Math.ceil(((Number(chosen?.minPayment) || 0) + 250) / 50) * 50, Math.ceil((Number(whatIfExtra) || 0) / 50) * 50 + 100);
  $("page-debts").innerHTML = `
    <div class="toolbar">
      <div>
        <div class="muted">Total owed ${formatMoney(totals.balance)} · Min payments ${formatMoney(totals.minPay)}/mo</div>
      </div>
      <div class="spacer"></div>
      <button class="btn primary" id="add-debt">Add debt or loan</button>
    </div>
    ${chosen ? `
    <div class="card" style="margin-bottom:14px">
      <h3>What-if extra payment</h3>
      <p class="muted">This does not change your loans until you save it. Drag the slider to see when a debt would be gone.</p>
      <div class="form-grid">
        <div class="field"><label>Debt</label>
          <select id="whatif-debt">${debts.map((debt) => `<option value="${escapeHtml(debt.id)}" ${debt.id === whatIfDebtId ? "selected" : ""}>${escapeHtml(debt.name)}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Extra per month on top of the ${formatMoney(chosen.minPayment)} minimum</label>
          <input id="whatif-extra" type="number" min="0" step="5" value="${whatIfExtra}">
        </div>
        <div class="field span-2 slider-row">
          <input id="whatif-slider" type="range" min="0" max="${sliderMax}" step="5" value="${Math.min(whatIfExtra, sliderMax)}">
        </div>
      </div>
      <div id="whatif-results">${whatIfResultsInner(chosen)}</div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn primary" id="whatif-apply">Save this extra on the loan</button>
        <span class="muted">Current saved extra: ${formatMoney(chosen.extraPayment)} / mo</span>
      </div>
    </div>` : ""}
    <div class="grid cols-2">
      ${debts.length ? debts.map((d) => {
        const payment = (Number(d.minPayment) || 0) + (Number(d.extraPayment) || 0);
        const sim = payoffSimulation(d.balance, d.rate, payment);
        const orig = Number(d.originalBalance) || Number(d.balance) || 1;
        const pct = Math.max(0, Math.min(100, 100 - (Number(d.balance) / orig) * 100));
        const when = payoffDateFromMonths(sim.months);
        return `<div class="card">
          <div class="toolbar">
            <h3 style="margin:0">${escapeHtml(d.name)}</h3>
            <span class="badge">${escapeHtml(d.kind || "Loan")}</span>
          </div>
          <div class="stat-value negative">${formatMoney(d.balance)}</div>
          <div class="stat-note">${Number(d.rate) || 0}% APR · due day ${d.dueDay || "—"} · ${payoffLabel(sim.months)}${when ? ` (${formatDateNice(when)})` : ""} at ${formatMoney(payment)}/mo</div>
          <div class="bar" style="margin:12px 0"><span style="width:${pct}%"></span></div>
          <div class="toolbar">
            <button class="btn small" data-pay-debt="${d.id}">Record payment</button>
            <button class="btn small" data-edit-debt="${d.id}">Edit</button>
          </div>
        </div>`;
      }).join("") : `<div class="card empty">Add student loans, auto loans, credit cards, or personal debt. The app estimates payoff time from the rate and payment.</div>`}
    </div>
    ${debts.length >= 2 ? renderDebtStrategy(debts) : ""}
  `;
  $("add-debt").addEventListener("click", () => openDebtModal());
  $("page-debts").querySelectorAll("[data-edit-debt]").forEach((btn) => {
    btn.addEventListener("click", () => openDebtModal(btn.dataset.editDebt));
  });
  $("page-debts").querySelectorAll("[data-pay-debt]").forEach((btn) => {
    btn.addEventListener("click", () => openDebtPaymentModal(btn.dataset.payDebt));
  });
  bindWhatIfControls();
}

function whatIfResultsInner(debt) {
  const min = Number(debt.minPayment) || 0;
  const currentExtra = Number(debt.extraPayment) || 0;
  const extra = Math.max(0, Number(whatIfExtra) || 0);
  const current = payoffSimulation(debt.balance, debt.rate, min + currentExtra);
  const trial = payoffSimulation(debt.balance, debt.rate, min + extra);
  const monthsSaved = isFinite(current.months) && isFinite(trial.months) ? current.months - trial.months : 0;
  const interestSaved = isFinite(current.interest) && isFinite(trial.interest) ? current.interest - trial.interest : 0;
  const when = payoffDateFromMonths(trial.months);
  const never = !isFinite(trial.months);
  return `
    <div class="whatif-stats">
      <div>
        <div class="stat-label">Paid off</div>
        <div class="stat-value">${never ? "Never" : payoffLabel(trial.months)}</div>
        <div class="stat-note">${never ? "Payment does not cover interest" : (when ? formatDateNice(when) : "Already paid off")}</div>
      </div>
      <div>
        <div class="stat-label">Time saved vs current extra</div>
        <div class="stat-value">${monthsSaved > 0 ? payoffLabel(monthsSaved) : (monthsSaved < 0 ? "Longer" : "Same")}</div>
        <div class="stat-note">Current plan: ${payoffLabel(current.months)}</div>
      </div>
      <div>
        <div class="stat-label">Interest saved</div>
        <div class="stat-value ${interestSaved > 0 ? "positive" : ""}">${never ? "—" : formatMoney(Math.max(0, interestSaved))}</div>
        <div class="stat-note">Total payment ${never ? "—" : formatMoney(min + extra)} / mo</div>
      </div>
    </div>
  `;
}

function bindWhatIfControls() {
  const slider = $("whatif-slider");
  const number = $("whatif-extra");
  const debtSelect = $("whatif-debt");
  const update = (value) => {
    whatIfExtra = Math.max(0, Number(value) || 0);
    if (slider) {
      if (whatIfExtra > Number(slider.max)) slider.max = String(Math.ceil(whatIfExtra / 50) * 50);
      slider.value = String(Math.min(whatIfExtra, Number(slider.max)));
    }
    if (number) number.value = String(whatIfExtra);
    const debt = (state.debts || []).find((item) => item.id === whatIfDebtId);
    if (debt && $("whatif-results")) $("whatif-results").innerHTML = whatIfResultsInner(debt);
  };
  debtSelect?.addEventListener("change", () => {
    whatIfDebtId = debtSelect.value;
    const debt = (state.debts || []).find((item) => item.id === whatIfDebtId);
    whatIfExtra = Number(debt?.extraPayment) || 0;
    renderDebts();
  });
  slider?.addEventListener("input", () => update(slider.value));
  number?.addEventListener("input", () => update(number.value));
  $("whatif-apply")?.addEventListener("click", () => {
    const debt = (state.debts || []).find((item) => item.id === whatIfDebtId);
    if (!debt) return;
    debt.extraPayment = Number(whatIfExtra) || 0;
    persist();
    toast("Extra payment saved on this loan");
  });
}

function simulateStrategy(debts, mode) {
  const copies = debts.map((d) => ({
    name: d.name,
    balance: Number(d.balance) || 0,
    rate: Number(d.rate) || 0,
    min: Number(d.minPayment) || 0,
    extra: Number(d.extraPayment) || 0,
  })).filter((d) => d.balance > 0);
  const poolExtra = copies.reduce((s, d) => s + d.extra, 0);
  copies.forEach((d) => { d.extra = 0; });
  const sortFn = mode === "avalanche"
    ? (a, b) => b.rate - a.rate
    : (a, b) => a.balance - b.balance;
  let months = 0;
  let interest = 0;
  while (copies.some((d) => d.balance > 0.5) && months < 600) {
    copies.sort(sortFn);
    const target = copies.find((d) => d.balance > 0.5);
    copies.forEach((d) => {
      const r = d.rate / 100 / 12;
      const interestNow = d.balance * r;
      interest += interestNow;
      d.balance += interestNow;
      let pay = d.min;
      if (d === target) pay += poolExtra;
      pay = Math.min(pay, d.balance);
      d.balance = Math.max(0, d.balance - pay);
    });
    months += 1;
  }
  return { months, interest };
}

function renderDebtStrategy(debts) {
  const snow = simulateStrategy(debts, "snowball");
  const ava = simulateStrategy(debts, "avalanche");
    const same = Math.abs(ava.interest - snow.interest) < 1 && snow.months === ava.months;
    const better = same
      ? "With these balances, both methods finish in about the same time and interest."
      : (ava.interest < snow.interest
        ? "Avalanche saves more interest with your current numbers."
        : "Snowball finishes with less interest with your current numbers.");
    return `<div class="card" style="margin-top:14px">
    <h3>Payoff strategy</h3>
    <p class="muted">Snowball attacks the smallest balance first. Avalanche attacks the highest interest rate first. Extra payments you entered are pooled onto the current target debt.</p>
    <div class="grid cols-2">
      <div>
        <div class="stat-label">Snowball</div>
        <div>${payoffLabel(snow.months)} · estimated interest ${formatMoney(snow.interest)}</div>
      </div>
      <div>
        <div class="stat-label">Avalanche</div>
        <div>${payoffLabel(ava.months)} · estimated interest ${formatMoney(ava.interest)}</div>
      </div>
    </div>
    <p style="margin:12px 0 0">${better}</p>
  </div>`;
}

function openDebtModal(id) {
  const d = (state.debts || []).find((x) => x.id === id) || {
    name: "", kind: "Loan", balance: "", originalBalance: "", rate: "", minPayment: "", extraPayment: "0", dueDay: "1",
  };
  openModal(id ? "Edit debt" : "Add debt or loan", `
    <div class="form-grid">
      <div class="field span-2"><label>Name</label><input id="debt-name" value="${escapeHtml(d.name)}" placeholder="Car loan, Visa, student loan"></div>
      <div class="field"><label>Type</label>
        <select id="debt-kind">
          ${["Loan", "Credit card", "Student loan", "Auto loan", "Mortgage", "Medical", "Other"].map((k) => `<option ${k === (d.kind || "Loan") ? "selected" : ""}>${k}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Due day of month</label><input id="debt-due" type="number" min="1" max="31" value="${escapeHtml(d.dueDay || 1)}"></div>
      <div class="field"><label>Current balance</label><input id="debt-bal" type="number" min="0" step="0.01" value="${escapeHtml(d.balance)}"></div>
      <div class="field"><label>Original balance (optional)</label><input id="debt-orig" type="number" min="0" step="0.01" value="${escapeHtml(d.originalBalance || "")}"></div>
      <div class="field"><label>Interest rate (APR %)</label><input id="debt-rate" type="number" min="0" step="0.01" value="${escapeHtml(d.rate)}"></div>
      <div class="field"><label>Minimum payment / month</label><input id="debt-min" type="number" min="0" step="0.01" value="${escapeHtml(d.minPayment)}"></div>
      <div class="field span-2"><label>Extra payment / month</label><input id="debt-extra" type="number" min="0" step="0.01" value="${escapeHtml(d.extraPayment || 0)}"></div>
    </div>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => { state.debts = state.debts.filter((x) => x.id !== id); closeModal(); persist(); } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      const balance = Number(fieldValue("debt-bal"));
      if (!fieldValue("debt-name").trim() || !(balance >= 0)) {
        toast("Enter a name and balance");
        return;
      }
      const next = {
        id: id || uid(),
        name: fieldValue("debt-name").trim(),
        kind: fieldValue("debt-kind"),
        dueDay: Number(fieldValue("debt-due")) || 1,
        balance,
        originalBalance: Number(fieldValue("debt-orig")) || balance,
        rate: Number(fieldValue("debt-rate")) || 0,
        minPayment: Number(fieldValue("debt-min")) || 0,
        extraPayment: Number(fieldValue("debt-extra")) || 0,
      };
      const existing = state.debts.find((x) => x.id === next.id);
      if (existing) Object.assign(existing, next);
      else state.debts.push(next);
      closeModal();
      persist();
    } },
  ]);
}

function openDebtPaymentModal(id) {
  const d = state.debts.find((x) => x.id === id);
  if (!d) return;
  const suggested = (Number(d.minPayment) || 0) + (Number(d.extraPayment) || 0);
  openModal(`Payment · ${d.name}`, `
    <div class="form-grid">
      <div class="field"><label>Payment amount</label><input id="p-amt" type="number" min="0" step="0.01" value="${suggested}"></div>
      <div class="field"><label>Date</label><input id="p-date" type="date" value="${toISODate(todayDate())}"></div>
      <div class="field span-2"><label>Pay from account</label><select id="p-account">${accountOptions(defaultAccountId(state))}</select></div>
      <div class="field span-2"><label class="check"><input id="p-apply" type="checkbox" checked> Subtract this payment from the selected account</label></div>
    </div>
  `, [
    { label: "Cancel", onClick: closeModal },
    { label: "Record payment", className: "primary", onClick: () => {
      const amount = Number(fieldValue("p-amt"));
      if (!(amount > 0)) { toast("Enter a payment amount"); return; }
      d.balance = Math.max(0, (Number(d.balance) || 0) - amount);
      const accountId = fieldValue("p-account") || defaultAccountId(state);
      state.transactions.push({
        id: uid(),
        date: fieldValue("p-date") || toISODate(todayDate()),
        description: `Payment · ${d.name}`,
        category: "Debt payment",
        amount,
        type: "expense",
        status: "completed",
        recurring: "none",
        accountId,
      });
      if (document.getElementById("p-apply").checked) {
        adjustAccount(state, accountId, -amount);
      }
      closeModal();
      persist();
      toast("Payment recorded");
    } },
  ]);
}

function renderBudgets() {
  const month = monthlyTotals(state);
  $("page-budgets").innerHTML = `
    <div class="toolbar">
      <p class="muted" style="margin:0">Limits apply to this calendar month's recorded transactions.</p>
      <div class="spacer"></div>
      <button class="btn primary" id="add-budget">Add category budget</button>
    </div>
    <div class="grid cols-2">
      ${(state.budgets || []).length ? state.budgets.map((b) => {
        const spent = month.byCategory[b.category] || 0;
        const limit = Number(b.monthlyLimit) || 0;
        const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
        const over = spent > limit && limit > 0;
        return `<div class="card">
          <div class="toolbar"><h3 style="margin:0">${escapeHtml(b.category)}</h3><button class="btn small" data-edit-budget="${b.id}">Edit</button></div>
          <div>${formatMoney(spent)} of ${formatMoney(limit)}</div>
          <div class="bar ${over ? "over" : ""}" style="margin-top:10px"><span style="width:${pct}%"></span></div>
          <div class="stat-note">${over ? "Over budget" : `${formatMoney(Math.max(0, limit - spent))} left`}</div>
        </div>`;
      }).join("") : `<div class="card empty">Set a monthly cap for groceries, dining, subscriptions, and anything else you want to keep an eye on.</div>`}
    </div>
  `;
  $("add-budget").addEventListener("click", () => openBudgetModal());
  $("page-budgets").querySelectorAll("[data-edit-budget]").forEach((btn) => {
    btn.addEventListener("click", () => openBudgetModal(btn.dataset.editBudget));
  });
}

function openBudgetModal(id) {
  const b = (state.budgets || []).find((x) => x.id === id) || { category: "Groceries", monthlyLimit: "" };
  openModal(id ? "Edit budget" : "Add budget", `
    <div class="form-grid">
      <div class="field"><label>Category</label><select id="b-cat">${categoryOptions(b.category)}</select></div>
      <div class="field"><label>Monthly limit</label><input id="b-lim" type="number" min="0" step="0.01" value="${escapeHtml(b.monthlyLimit)}"></div>
    </div>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => { state.budgets = state.budgets.filter((x) => x.id !== id); closeModal(); persist(); } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      const next = { id: id || uid(), category: fieldValue("b-cat"), monthlyLimit: Number(fieldValue("b-lim")) || 0 };
      const existing = state.budgets.find((x) => x.id === next.id);
      if (existing) Object.assign(existing, next);
      else state.budgets.push(next);
      closeModal();
      persist();
    } },
  ]);
}

function renderGoals() {
  $("page-goals").innerHTML = `
    <div class="toolbar">
      <p class="muted" style="margin:0">Link a goal to one account or to Accounts total. Unlinked goals use the "saved so far" amount you type.</p>
      <div class="spacer"></div>
      <button class="btn primary" id="add-goal">Add goal</button>
    </div>
    <div class="grid cols-2">
      ${(state.goals || []).length ? state.goals.map((g) => {
        const linkLabel = goalLinkLabel(g, state);
        const target = Number(g.target) || 0;
        const saved = goalSavedAmount(g, state);
        const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
        const per = goalPerPaycheck({ ...g, saved }, state);
        return `<div class="card">
          <div class="toolbar"><h3 style="margin:0">${escapeHtml(g.name)}</h3><button class="btn small" data-edit-goal="${g.id}">Edit</button></div>
          <div class="stat-value">${formatMoney(saved)} <span class="muted" style="font-size:14px">of ${formatMoney(target)}</span></div>
          <div class="bar" style="margin:10px 0"><span style="width:${pct}%"></span></div>
          <div class="stat-note">${linkLabel ? `Linked to ${escapeHtml(linkLabel)} · ` : ""}${g.deadline ? `By ${formatDateNice(g.deadline)} · ` : ""}Set aside about ${formatMoney(per)} per paycheck</div>
        </div>`;
      }).join("") : `<div class="card empty">Emergency fund, vacation, car down payment — add a target and a date.</div>`}
    </div>
  `;
  $("add-goal").addEventListener("click", () => openGoalModal());
  $("page-goals").querySelectorAll("[data-edit-goal]").forEach((btn) => {
    btn.addEventListener("click", () => openGoalModal(btn.dataset.editGoal));
  });
}

function openGoalModal(id) {
  const g = (state.goals || []).find((x) => x.id === id) || { name: "", target: "", saved: "0", deadline: "", accountId: "" };
  openModal(id ? "Edit goal" : "Add savings goal", `
    <div class="form-grid">
      <div class="field span-2"><label>Name</label><input id="g-name" value="${escapeHtml(g.name)}" placeholder="Emergency fund"></div>
      <div class="field"><label>Target</label><input id="g-target" type="number" min="0" step="0.01" value="${escapeHtml(g.target)}"></div>
      <div class="field"><label>Saved so far</label><input id="g-saved" type="number" min="0" step="0.01" value="${escapeHtml(g.saved)}"></div>
      <div class="field"><label>Link to account (optional)</label>
        <select id="g-account">
          <option value="">Not linked</option>
          <option value="${GOAL_LINK_TOTAL}" ${g.accountId === GOAL_LINK_TOTAL ? "selected" : ""}>Accounts total</option>
          ${accountOptions(g.accountId === GOAL_LINK_TOTAL ? "" : g.accountId, true)}
        </select>
      </div>
      <div class="field"><label>Target date</label><input id="g-dead" type="date" value="${escapeHtml(g.deadline || "")}"></div>
    </div>
    <p class="muted" style="margin:12px 0 0">Link to one account, or to Accounts total (checking, savings, and cash — not retirement). Linked progress ignores "saved so far."</p>
  `, [
    ...(id ? [{ label: "Delete", className: "danger", onClick: () => { state.goals = state.goals.filter((x) => x.id !== id); closeModal(); persist(); } }] : []),
    { label: "Cancel", onClick: closeModal },
    { label: "Save", className: "primary", onClick: () => {
      if (!fieldValue("g-name").trim()) { toast("Enter a name"); return; }
      const next = {
        id: id || uid(),
        name: fieldValue("g-name").trim(),
        target: Number(fieldValue("g-target")) || 0,
        saved: Number(fieldValue("g-saved")) || 0,
        deadline: fieldValue("g-dead"),
        accountId: fieldValue("g-account"),
      };
      const existing = state.goals.find((x) => x.id === next.id);
      if (existing) Object.assign(existing, next);
      else state.goals.push(next);
      closeModal();
      persist();
    } },
  ]);
}

function pickBankCsvFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseBankCsv(String(reader.result));
        openCsvImportModal(rows, file.name);
      } catch (err) {
        toast(err.message || "Could not read that CSV");
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function openCsvImportModal(rows, fileName) {
  const preview = rows.slice(0, 8);
  openModal("Import Navy Federal CSV", `
    <p class="muted">${escapeHtml(fileName || "Statement")} · ${rows.length} transaction${rows.length === 1 ? "" : "s"} found. They will be saved as completed history and will not change your account balances.</p>
    <div class="field"><label>Import into account</label><select id="csv-account">${accountOptions(defaultAccountId(state))}</select></div>
    <div class="table-wrap" style="margin-top:12px">
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${preview.map((row) => `
            <tr>
              <td>${escapeHtml(row.date)}</td>
              <td>${escapeHtml(row.description)}</td>
              <td>${row.type === "income" ? "Income" : "Expense"}</td>
              <td class="num ${row.type === "income" ? "positive" : "negative"}">${row.type === "income" ? "+" : "−"}${formatMoney(row.amount)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${rows.length > preview.length ? `<p class="muted">${rows.length - preview.length} more not shown in this preview.</p>` : ""}
  `, [
    { label: "Cancel", onClick: closeModal },
    { label: "Import", className: "primary", onClick: () => {
      const accountId = fieldValue("csv-account") || defaultAccountId(state);
      const result = importBankRows(state, rows, accountId);
      closeModal();
      persist();
      toast(`Imported ${result.added}. Skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}.`);
      setPage("transactions");
    } },
  ]);
}

function renderSettings() {
  $("page-settings").innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>Accounts</h3>
        <p class="muted">Checking, savings, and cash live on the Accounts page. Retirement is left out of Accounts total and still counts in net worth.</p>
        <div class="row-item"><span>Spending cash</span><strong>${formatMoney(spendingTotal(state))}</strong></div>
        <div class="row-item"><span>Savings / set-aside</span><strong>${formatMoney(savingsTotal(state))}</strong></div>
        <div class="row-item"><span>Retirement</span><strong>${formatMoney(retirementTotal(state))}</strong></div>
        <div class="row-item"><span>Net worth</span><strong>${formatMoney(netWorth(state))}</strong></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn primary" id="goto-accounts">Open accounts</button></div>
      </div>
      <div class="card">
        <h3>Backup</h3>
        <p class="muted">Your data stays on this PC (in the browser profile for this app). Export a JSON backup if you move folders or reinstall Windows.</p>
        <div class="toolbar">
          <button class="btn" id="export-data">Export backup</button>
          <label class="btn" style="margin:0">Import backup<input id="import-data" type="file" accept="application/json,.json" hidden></label>
        </div>
        <div class="toolbar">
          <button class="btn" id="sample-data">Load sample numbers</button>
          <button class="btn danger" id="reset-data">Erase all data</button>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Import Navy Federal CSV</h3>
      <ol class="help" style="margin:0; padding-left:20px">
        <li>On a computer, sign in at navyfederal.org. The phone app does not export CSV.</li>
        <li>Open the checking, savings, or credit card account you want.</li>
        <li>Go to transaction history and choose Export or Download, then CSV.</li>
        <li>In this app, choose that file, then pick the matching Checking, Savings, or credit account.</li>
      </ol>
      <p class="muted">Navy Federal uses separate Debit and Credit columns. The importer reads that automatically. Imported rows are history only — update the account balance on Accounts to match Navy Federal.</p>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn primary" id="import-nfcu">Choose CSV file</button>
      </div>
    </div>
  `;
  $("goto-accounts").addEventListener("click", () => setPage("accounts"));
  $("import-nfcu").addEventListener("click", () => pickBankCsvFile());
  $("export-data").addEventListener("click", () => {
    const blob = new Blob([exportState(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `budget-backup-${toISODate(todayDate())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("import-data").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = importState(String(reader.result));
        persist();
        toast("Backup imported");
      } catch {
        toast("Could not read that backup file");
      }
    };
    reader.readAsText(file);
  });
  $("sample-data").addEventListener("click", () => {
    if (!confirm("Replace your current data with sample numbers so you can see how the app looks?")) return;
    state = sampleState();
    persist();
    toast("Sample data loaded");
  });
  $("reset-data").addEventListener("click", () => {
    if (!confirm("Erase all budget data on this PC?")) return;
    state = migrateState(structuredClone(DEFAULT_STATE));
    persist();
    toast("Data cleared");
  });
}

function render() {
  const map = {
    dashboard: renderDashboard,
    accounts: renderAccounts,
    transactions: renderTransactions,
    income: renderIncome,
    debts: renderDebts,
    budgets: renderBudgets,
    goals: renderGoals,
    settings: renderSettings,
  };
  map[currentPage]?.();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setPage(btn.dataset.page);
    document.querySelector(".sidebar")?.classList.remove("open");
    $("nav-scrim")?.classList.remove("show");
  });
});
$("menu-toggle")?.addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.toggle("open");
  $("nav-scrim")?.classList.toggle("show");
});
$("nav-scrim")?.addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.remove("open");
  $("nav-scrim")?.classList.remove("show");
});
$("theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  persist();
});
$("quick-add").addEventListener("click", () => openTransactionModal());
$("modal-close").addEventListener("click", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  closeModal();
});
$("modal").addEventListener("click", (ev) => ev.stopPropagation());
$("modal-backdrop").addEventListener("click", (ev) => {
  if (ev.target === $("modal-backdrop")) closeModal();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeModal();
});

window.addEventListener("hashchange", () => {
  const page = location.hash.replace("#", "") || "dashboard";
  if (page !== currentPage) setPage(page);
});

if (new URLSearchParams(location.search).has("demo")) {
  state = sampleState();
  saveState(state);
}
if (new URLSearchParams(location.search).has("light")) {
  state.theme = "light";
}

applyTheme();
$("sidebar-balance").textContent = formatMoney(spendingTotal(state));
$("sidebar-savings").textContent = formatMoney(savingsTotal(state));
closeModal();
setPage(location.hash.replace("#", "") || "dashboard");

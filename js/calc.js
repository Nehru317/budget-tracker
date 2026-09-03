const CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Transportation",
  "Insurance",
  "Healthcare",
  "Subscriptions",
  "Entertainment",
  "Personal",
  "Debt payment",
  "Savings",
  "Income",
  "Other",
];

function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addFrequency(date, frequency) {
  const next = new Date(date.getTime());
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  else return null;
  return next;
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateNice(value) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function accountById(state, id) {
  return (state.accounts || []).find((account) => account.id === id) || null;
}

function isRetirementAccount(account) {
  return Boolean(account && account.type === "retirement");
}

function defaultAccountId(state) {
  const primary = accountById(state, state.primaryAccountId);
  if (primary && !isRetirementAccount(primary)) return primary.id;
  const spend = (state.accounts || []).find((account) => !isRetirementAccount(account) && account.includeInCashFlow !== false);
  const liquid = (state.accounts || []).find((account) => !isRetirementAccount(account));
  return spend?.id || liquid?.id || state.accounts?.[0]?.id || "";
}

function accountName(state, id) {
  return accountById(state, id)?.name || "Unassigned";
}

function spendingTotal(state) {
  return (state.accounts || [])
    .filter((account) => !isRetirementAccount(account) && account.includeInCashFlow !== false)
    .reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
}

function savingsTotal(state) {
  return (state.accounts || [])
    .filter((account) => !isRetirementAccount(account) && account.includeInCashFlow === false)
    .reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
}

function assetsTotal(state) {
  return (state.accounts || [])
    .filter((account) => !isRetirementAccount(account))
    .reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
}

function retirementTotal(state) {
  return (state.accounts || [])
    .filter((account) => isRetirementAccount(account))
    .reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
}

function allAssetsTotal(state) {
  return (state.accounts || []).reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
}

function isSpendingAccount(state, accountId) {
  if (!accountId) return true;
  const account = accountById(state, accountId);
  if (!account) return true;
  if (isRetirementAccount(account)) return false;
  return account.includeInCashFlow !== false;
}

function syncSpendingBalance(state) {
  state.currentBalance = spendingTotal(state);
  return state.currentBalance;
}

function adjustAccount(state, accountId, delta) {
  const account = accountById(state, accountId) || accountById(state, defaultAccountId(state));
  if (!account) return;
  account.balance = Math.round(((Number(account.balance) || 0) + Number(delta)) * 100) / 100;
  syncSpendingBalance(state);
}

function accountTypeLabel(type) {
  return (ACCOUNT_TYPES.find(([value]) => value === type) || ["other", "Other"])[1];
}

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function generateOccurrences(startValue, frequency, fromDate, toDate) {
  const start = parseDate(startValue);
  if (!start || frequency === "none" || !frequency) {
    if (!start) return [];
    if (start >= fromDate && start <= toDate) return [start];
    return [];
  }
  const dates = [];
  let cursor = new Date(start.getTime());
  let guard = 0;
  while (cursor < fromDate && guard < 400) {
    const bumped = addFrequency(cursor, frequency);
    if (!bumped) break;
    cursor = bumped;
    guard += 1;
  }
  guard = 0;
  while (cursor && cursor <= toDate && guard < 400) {
    if (cursor >= fromDate) dates.push(new Date(cursor.getTime()));
    const bumped = addFrequency(cursor, frequency);
    if (!bumped) break;
    cursor = bumped;
    guard += 1;
  }
  return dates;
}

function horizonDate(monthsAhead) {
  const d = todayDate();
  d.setMonth(d.getMonth() + monthsAhead);
  return d;
}

function futureEvents(state, monthsAhead = 6) {
  const to = horizonDate(monthsAhead);
  const events = [];

  if (state.paycheck && Number(state.paycheck.amount) > 0 && state.paycheck.nextDate) {
    generateOccurrences(state.paycheck.nextDate, state.paycheck.frequency || "biweekly", todayDate(), to).forEach((date) => {
      events.push({
        date,
        type: "income",
        amount: Number(state.paycheck.amount),
        description: state.paycheck.name || "Paycheck",
        source: "paycheck",
        accountId: state.paycheck.accountId || defaultAccountId(state),
      });
    });
  }

  (state.deposits || []).forEach((dep) => {
    const freq = dep.recurring || "none";
    const dates = freq === "none"
      ? (parseDate(dep.date) && parseDate(dep.date) >= todayDate() ? [parseDate(dep.date)] : [])
      : generateOccurrences(dep.date, freq, todayDate(), to);
    dates.forEach((date) => {
      events.push({
        date,
        type: "income",
        amount: Number(dep.amount) || 0,
        description: dep.name || "Deposit",
        source: "deposit",
        accountId: dep.accountId || defaultAccountId(state),
      });
    });
  });

  (state.transactions || []).forEach((tx) => {
    if (tx.status === "completed" || tx.type === "transfer") return;
    const freq = tx.recurring || "none";
    const start = parseDate(tx.date);
    if (!start) return;
    const dates = freq === "none"
      ? (start >= todayDate() ? [start] : [])
      : generateOccurrences(tx.date, freq, todayDate(), to);
    dates.forEach((date) => {
      const amount = Number(tx.amount) || 0;
      events.push({
        date,
        type: tx.type === "income" ? "income" : "expense",
        amount,
        description: tx.description || "Transaction",
        source: "transaction",
        category: tx.category,
        accountId: tx.accountId || defaultAccountId(state),
      });
    });
  });

  events.sort((a, b) => a.date - b.date || a.description.localeCompare(b.description));
  return events;
}

function cashFlowSeries(state, days = 28) {
  const events = futureEvents(state, 8);
  const start = todayDate();
  let balance = spendingTotal(state);
  const points = [];
  for (let i = 0; i <= days; i += 1) {
    const day = new Date(start.getTime());
    day.setDate(start.getDate() + i);
    const key = toISODate(day);
    events.filter((ev) => toISODate(ev.date) === key && isSpendingAccount(state, ev.accountId)).forEach((ev) => {
      balance += ev.type === "income" ? ev.amount : -ev.amount;
    });
    points.push({ date: day, balance, label: i === 0 ? "Today" : "" });
  }
  return points;
}

function nextPayDate(state) {
  if (!state.paycheck || !state.paycheck.nextDate) return null;
  const dates = generateOccurrences(
    state.paycheck.nextDate,
    state.paycheck.frequency || "biweekly",
    todayDate(),
    horizonDate(6)
  );
  return dates[0] || parseDate(state.paycheck.nextDate);
}

function payPeriodSummary(state) {
  const payday = nextPayDate(state);
  const events = futureEvents(state, 4);
  const end = payday ? new Date(payday.getTime()) : horizonDate(1);
  const untilPayday = events.filter((ev) => ev.date <= end && isSpendingAccount(state, ev.accountId));
  const income = untilPayday.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expenses = untilPayday.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const cash = spendingTotal(state);
  const projected = cash + income - expenses;
  const series = cashFlowSeries(state, payday ? Math.max(1, Math.ceil((end - todayDate()) / 86400000)) : 14);
  const lowest = series.reduce((min, p) => Math.min(min, p.balance), cash);
  return { payday, income, expenses, projected, lowest, untilPayday };
}

function projectedTotalAtPayday(state) {
  const payday = nextPayDate(state);
  const assets = assetsTotal(state);
  if (!payday) return { payday: null, income: 0, expenses: 0, projected: assets };
  const untilPayday = futureEvents(state, 4).filter((ev) => ev.date <= payday);
  const income = untilPayday.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expenses = untilPayday.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  return { payday, income, expenses, projected: assets + income - expenses };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthRange() {
  const t = todayDate();
  const start = new Date(t.getFullYear(), t.getMonth(), 1);
  const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  return { start, end };
}

function monthlyTotals(state) {
  const { start, end } = currentMonthRange();
  const txs = (state.transactions || []).filter((tx) => {
    if (tx.type === "transfer") return false;
    const d = parseDate(tx.date);
    return d && d >= start && d <= end;
  });
  const spent = txs.filter((t) => t.type !== "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const earned = txs.filter((t) => t.type === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const byCategory = {};
  txs.filter((t) => t.type !== "income").forEach((t) => {
    const key = t.category || "Other";
    byCategory[key] = (byCategory[key] || 0) + (Number(t.amount) || 0);
  });
  return { spent, earned, byCategory, count: txs.length };
}

function projectedMonthlyIncome(state) {
  let perMonth = 0;
  const paycheck = Number(state.paycheck?.amount) || 0;
  const freq = state.paycheck?.frequency || "biweekly";
  if (freq === "weekly") perMonth += paycheck * 52 / 12;
  else if (freq === "biweekly") perMonth += paycheck * 26 / 12;
  else if (freq === "monthly") perMonth += paycheck;
  else if (freq === "yearly") perMonth += paycheck / 12;

  (state.deposits || []).forEach((dep) => {
    const amount = Number(dep.amount) || 0;
    const rec = dep.recurring || "none";
    if (rec === "weekly") perMonth += amount * 52 / 12;
    else if (rec === "biweekly") perMonth += amount * 26 / 12;
    else if (rec === "monthly") perMonth += amount;
    else if (rec === "yearly") perMonth += amount / 12;
  });
  return perMonth;
}

function payoffSimulation(balance, annualRate, payment) {
  let remaining = Number(balance) || 0;
  const pay = Number(payment) || 0;
  if (remaining <= 0) return { months: 0, interest: 0 };
  if (pay <= 0) return { months: Infinity, interest: Infinity };
  const r = (Number(annualRate) || 0) / 100 / 12;
  if (r > 0 && pay <= remaining * r + 0.005) return { months: Infinity, interest: Infinity };
  let months = 0;
  let interest = 0;
  while (remaining > 0.5 && months < 600) {
    const charged = remaining * r;
    interest += charged;
    remaining += charged;
    remaining = Math.max(0, remaining - Math.min(pay, remaining));
    months += 1;
  }
  return { months, interest };
}

function monthsToPayoff(balance, annualRate, payment) {
  return payoffSimulation(balance, annualRate, payment).months;
}

function payoffDateFromMonths(months) {
  if (!isFinite(months) || months <= 0) return null;
  const d = todayDate();
  d.setMonth(d.getMonth() + months);
  return d;
}

function payoffLabel(months) {
  if (!isFinite(months)) return "Never at this payment";
  if (months <= 0) return "Paid off";
  const years = Math.floor(months / 12);
  const m = months % 12;
  if (years <= 0) return `${months} mo`;
  if (m === 0) return `${years} yr`;
  return `${years} yr ${m} mo`;
}

function debtTotals(state) {
  const debts = state.debts || [];
  const balance = debts.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  const minPay = debts.reduce((s, d) => s + (Number(d.minPayment) || 0), 0);
  const extra = debts.reduce((s, d) => s + (Number(d.extraPayment) || 0), 0);
  return { balance, minPay, extra, count: debts.length };
}

function netWorth(state) {
  return allAssetsTotal(state) - debtTotals(state).balance;
}

const GOAL_LINK_TOTAL = "__total__";

function goalSavedAmount(goal, state) {
  if (goal.accountId === GOAL_LINK_TOTAL) return assetsTotal(state);
  const linked = accountById(state, goal.accountId);
  if (linked) return Number(linked.balance) || 0;
  return Number(goal.saved) || 0;
}

function goalLinkLabel(goal, state) {
  if (goal.accountId === GOAL_LINK_TOTAL) return "Accounts total";
  const linked = accountById(state, goal.accountId);
  return linked ? linked.name : "";
}

function goalPerPaycheck(goal, state) {
  const remaining = Math.max(0, (Number(goal.target) || 0) - (Number(goal.saved) || 0));
  if (remaining <= 0) return 0;
  const deadline = parseDate(goal.deadline);
  if (!deadline) return remaining;
  const payday = nextPayDate(state);
  const freq = state.paycheck?.frequency || "biweekly";
  let periods = 0;
  let cursor = payday || todayDate();
  while (cursor <= deadline && periods < 400) {
    periods += 1;
    const next = addFrequency(cursor, freq);
    if (!next) break;
    cursor = next;
  }
  return periods > 0 ? remaining / periods : remaining;
}

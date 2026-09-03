const STORAGE_KEY = "budget-tracker-v1";

const ACCOUNT_TYPES = [
  ["checking", "Checking"],
  ["savings", "Savings"],
  ["cash", "Cash"],
  ["other", "Other"],
];

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultAccounts(checkingBalance) {
  const checkingId = uid();
  return {
    primaryAccountId: checkingId,
    accounts: [
      { id: checkingId, name: "Checking", type: "checking", balance: Number(checkingBalance) || 0, includeInCashFlow: true },
      { id: uid(), name: "Savings", type: "savings", balance: 0, includeInCashFlow: false },
      { id: uid(), name: "Cash", type: "cash", balance: 0, includeInCashFlow: true },
    ],
  };
}

function migrateState(state) {
  if (!Array.isArray(state.accounts) || state.accounts.length === 0) {
    const seeded = defaultAccounts(state.currentBalance);
    state.accounts = seeded.accounts;
    state.primaryAccountId = seeded.primaryAccountId;
  } else {
    state.accounts = state.accounts.map((account) => ({
      ...account,
      balance: Number(account.balance) || 0,
      includeInCashFlow: account.includeInCashFlow ?? account.type !== "savings",
    }));
  }
  if (!state.primaryAccountId || !state.accounts.some((account) => account.id === state.primaryAccountId)) {
    const spend = state.accounts.find((account) => account.includeInCashFlow) || state.accounts[0];
    state.primaryAccountId = spend?.id || "";
  }
  state.paycheck = state.paycheck || {};
  if (!state.paycheck.accountId) state.paycheck.accountId = state.primaryAccountId;
  state.currentBalance = (state.accounts || [])
    .filter((account) => account.includeInCashFlow !== false)
    .reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
  return state;
}

const DEFAULT_STATE = {
  version: 1,
  currentBalance: 0,
  primaryAccountId: "",
  accounts: [],
  theme: "dark",
  paycheck: {
    name: "Biweekly paycheck",
    amount: 0,
    frequency: "biweekly",
    nextDate: "",
    accountId: "",
  },
  deposits: [],
  transactions: [],
  debts: [],
  budgets: [],
  goals: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateState(structuredClone(DEFAULT_STATE));
    const parsed = JSON.parse(raw);
    return migrateState({
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      paycheck: { ...DEFAULT_STATE.paycheck, ...(parsed.paycheck || {}) },
      accounts: parsed.accounts || [],
      deposits: parsed.deposits || [],
      transactions: parsed.transactions || [],
      debts: parsed.debts || [],
      budgets: parsed.budgets || [],
      goals: parsed.goals || [],
    });
  } catch {
    return migrateState(structuredClone(DEFAULT_STATE));
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function exportState(state) {
  return JSON.stringify(state, null, 2);
}

function importState(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid backup file");
  const next = migrateState({
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    paycheck: { ...DEFAULT_STATE.paycheck, ...(parsed.paycheck || {}) },
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    debts: Array.isArray(parsed.debts) ? parsed.debts : [],
    budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
    goals: Array.isArray(parsed.goals) ? parsed.goals : [],
  });
  saveState(next);
  return next;
}

function sampleState() {
  const checkingId = uid();
  const savingsId = uid();
  const cashId = uid();
  return migrateState({
    version: 1,
    currentBalance: 1920.55,
    primaryAccountId: checkingId,
    theme: "dark",
    accounts: [
      { id: checkingId, name: "Checking", type: "checking", balance: 1840.55, includeInCashFlow: true },
      { id: savingsId, name: "Savings", type: "savings", balance: 2400, includeInCashFlow: false },
      { id: cashId, name: "Cash", type: "cash", balance: 80, includeInCashFlow: true },
    ],
    paycheck: {
      name: "Biweekly paycheck",
      amount: 2150,
      frequency: "biweekly",
      nextDate: "2026-09-11",
      accountId: checkingId,
    },
    deposits: [
      { id: uid(), name: "Side work", amount: 400, date: "2026-09-15", recurring: "monthly", accountId: checkingId },
    ],
    transactions: [
      { id: uid(), date: "2026-09-02", description: "Groceries", category: "Groceries", amount: 128.44, type: "expense", status: "completed", recurring: "none", accountId: checkingId },
      { id: uid(), date: "2026-09-05", description: "Electric bill", category: "Utilities", amount: 96.2, type: "expense", status: "planned", recurring: "monthly", accountId: checkingId },
      { id: uid(), date: "2026-09-08", description: "Car insurance", category: "Insurance", amount: 142, type: "expense", status: "planned", recurring: "monthly", accountId: checkingId },
      { id: uid(), date: "2026-10-01", description: "Rent", category: "Housing", amount: 1450, type: "expense", status: "planned", recurring: "monthly", accountId: checkingId },
      { id: uid(), date: "2026-09-03", description: "Streaming", category: "Subscriptions", amount: 15.99, type: "expense", status: "planned", recurring: "monthly", accountId: checkingId },
    ],
    debts: [
      { id: uid(), name: "Car loan", kind: "Auto loan", dueDay: 12, balance: 8420, originalBalance: 18000, rate: 6.9, minPayment: 285, extraPayment: 50 },
      { id: uid(), name: "Visa", kind: "Credit card", dueDay: 20, balance: 2100, originalBalance: 2500, rate: 21.99, minPayment: 75, extraPayment: 25 },
    ],
    budgets: [
      { id: uid(), category: "Groceries", monthlyLimit: 500 },
      { id: uid(), category: "Dining", monthlyLimit: 150 },
      { id: uid(), category: "Subscriptions", monthlyLimit: 40 },
    ],
    goals: [
      { id: uid(), name: "Emergency fund", target: 3000, saved: 650, deadline: "2026-12-31", accountId: savingsId },
    ],
  });
}

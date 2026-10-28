function scoreIssue(issue, now = new Date()) {
  const created = new Date(issue.createdAt || now);
  const ageDays = Math.max(0, Math.floor((now - created) / 86_400_000));
  return Number(issue.severity) * 100 + Math.min(ageDays, 30);
}

// 0/1 knapsack DP: maximise urgency score while staying within the repair budget.
// Cost is rounded up to ₹1,000 units so the DP array remains small and predictable.
function selectRepairsDP(issues, budgetRupees, now = new Date()) {
  if (!Number.isFinite(budgetRupees) || budgetRupees < 0) throw new Error('Budget must be a non-negative number.');
  const capacity = Math.floor(budgetRupees / 1000);
  if (capacity > 5000) throw new Error('Budget is too large for the demo optimiser. Use ₹5,000,000 or less.');
  const items = issues.map((issue) => ({
    issue,
    weight: Math.max(1, Math.ceil(Number(issue.estimatedCost) / 1000)),
    value: scoreIssue(issue, now)
  }));
  const dp = Array.from({ length: items.length + 1 }, () => Array(capacity + 1).fill(0));
  for (let i = 1; i <= items.length; i++) {
    const { weight, value } = items[i - 1];
    for (let b = 0; b <= capacity; b++) {
      dp[i][b] = dp[i - 1][b];
      if (weight <= b) dp[i][b] = Math.max(dp[i][b], dp[i - 1][b - weight] + value);
    }
  }
  const selected = [];
  let b = capacity;
  for (let i = items.length; i >= 1; i--) {
    if (dp[i][b] !== dp[i - 1][b]) {
      selected.push(items[i - 1].issue);
      b -= items[i - 1].weight;
    }
  }
  selected.reverse();
  return {
    selected,
    totalCost: selected.reduce((sum, issue) => sum + Number(issue.estimatedCost), 0),
    priorityScore: selected.reduce((sum, issue) => sum + scoreIssue(issue, now), 0),
    budgetCapacity: capacity * 1000
  };
}

module.exports = { scoreIssue, selectRepairsDP };

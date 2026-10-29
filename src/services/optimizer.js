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


/**
 * 0/1 knapsack DP with a second resource constraint for a single crew's work hours.
 * Budget is discretised into ₹1,000 units; the hours limit is deliberately bounded
 * to keep the reconstruction table predictable for a public demo.
 */
function selectRepairsWithHoursDP(issues, budgetRupees, maxCrewHours, now = new Date()) {
  if (!Number.isFinite(budgetRupees) || budgetRupees < 0) throw new Error('Budget must be a non-negative number.');
  if (!Number.isInteger(maxCrewHours) || maxCrewHours < 1 || maxCrewHours > 80) {
    throw new Error('Crew hours must be an integer between 1 and 80.');
  }
  const capacity = Math.floor(budgetRupees / 1000);
  if (capacity > 5000) throw new Error('Budget is too large for the demo optimiser. Use ₹5,000,000 or less.');
  const items = issues.map((issue) => ({
    issue,
    weight: Math.max(1, Math.ceil(Number(issue.estimatedCost) / 1000)),
    hours: Math.max(1, Math.ceil(Number(issue.estimatedHours) || 1)),
    value: scoreIssue(issue, now)
  }));
  const width = maxCrewHours + 1;
  const stateCount = (capacity + 1) * width;
  let previous = new Int32Array(stateCount);
  let current = new Int32Array(stateCount);
  const take = items.map(() => new Uint8Array(stateCount));

  for (let i = 0; i < items.length; i++) {
    current.set(previous);
    const item = items[i];
    if (item.weight <= capacity && item.hours <= maxCrewHours) {
      for (let cost = item.weight; cost <= capacity; cost++) {
        const targetCostOffset = cost * width;
        const sourceCostOffset = (cost - item.weight) * width;
        for (let hours = item.hours; hours <= maxCrewHours; hours++) {
          const target = targetCostOffset + hours;
          const source = sourceCostOffset + hours - item.hours;
          const candidate = previous[source] + item.value;
          if (candidate > current[target]) {
            current[target] = candidate;
            take[i][target] = 1;
          }
        }
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  const selected = [];
  let costCapacity = capacity;
  let hourCapacity = maxCrewHours;
  for (let i = items.length - 1; i >= 0; i--) {
    const index = costCapacity * width + hourCapacity;
    if (take[i][index]) {
      const item = items[i];
      selected.push(item.issue);
      costCapacity -= item.weight;
      hourCapacity -= item.hours;
    }
  }
  selected.reverse();
  const totalCost = selected.reduce((sum, issue) => sum + Number(issue.estimatedCost), 0);
  const totalHours = selected.reduce((sum, issue) => sum + Math.ceil(Number(issue.estimatedHours) || 1), 0);
  return {
    selected,
    totalCost,
    totalHours,
    priorityScore: selected.reduce((sum, issue) => sum + scoreIssue(issue, now), 0),
    budgetCapacity: capacity * 1000,
    maxCrewHours,
    hoursRemaining: maxCrewHours - totalHours
  };
}

module.exports = { scoreIssue, selectRepairsDP, selectRepairsWithHoursDP };


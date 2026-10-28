class MinPriorityQueue {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.items[p].priority <= this.items[i].priority) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      i = p;
    }
  }
  pop() {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const left = 2 * i + 1, right = 2 * i + 2;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

function buildGraph(nodes, edges, { includeClosed = false } = {}) {
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.is_closed && !includeClosed) continue;
    const distance = Number(edge.distance_km);
    if (!graph.has(edge.source_node_id) || !graph.has(edge.target_node_id) || !Number.isFinite(distance) || distance <= 0) continue;
    graph.get(edge.source_node_id).push({ to: edge.target_node_id, distance });
    graph.get(edge.target_node_id).push({ to: edge.source_node_id, distance });
  }
  return graph;
}

// Single-source Dijkstra. Pass `target` to stop early once that node is settled.
// O((V + E) log V) with the binary heap above; lazy deletion skips stale queue entries.
function shortestPathsFrom(graph, start, target = null) {
  const distances = new Map([...graph.keys()].map((node) => [node, Infinity]));
  const previous = new Map();
  if (!graph.has(start)) return { start, distances, previous };
  const queue = new MinPriorityQueue();
  distances.set(start, 0);
  queue.push({ node: start, priority: 0 });

  while (queue.size) {
    const current = queue.pop();
    if (current.priority !== distances.get(current.node)) continue;
    if (target !== null && current.node === target) break;
    for (const neighbor of graph.get(current.node) || []) {
      const candidate = current.priority + neighbor.distance;
      if (candidate < distances.get(neighbor.to)) {
        distances.set(neighbor.to, candidate);
        previous.set(neighbor.to, current.node);
        queue.push({ node: neighbor.to, priority: candidate });
      }
    }
  }
  return { start, distances, previous };
}

function pathTo({ start, distances, previous }, target) {
  const distance = distances.get(target);
  if (distance === undefined || !Number.isFinite(distance)) return { distance: Infinity, path: [] };
  const path = [];
  let cursor = target;
  while (cursor !== undefined) {
    path.push(cursor);
    if (cursor === start) break;
    cursor = previous.get(cursor);
  }
  if (path[path.length - 1] !== start) return { distance: Infinity, path: [] };
  return { distance, path: path.reverse() };
}

function dijkstra(graph, start, target) {
  if (!graph.has(start) || !graph.has(target)) return { distance: Infinity, path: [] };
  return pathTo(shortestPathsFrom(graph, start, target), target);
}

module.exports = { MinPriorityQueue, buildGraph, shortestPathsFrom, pathTo, dijkstra };

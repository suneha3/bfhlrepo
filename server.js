const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ── Identity ──────────────────────────────────────────────────────────────────
const USER_ID = 'suneha_03062005';
const EMAIL_ID = 'suneha2538.be23@chitkara.edu.in';
const ROLL_NUMBER = '2310992538';

// ── Validation ────────────────────────────────────────────────────────────────
const VALID_RE = /^[A-Z]->[A-Z]$/;

function isValid(entry) {
  return VALID_RE.test(entry) && entry[0] !== entry[3];
}

// ── Graph helpers ─────────────────────────────────────────────────────────────
function buildGraph(validEdges) {
  const childToParent = new Map();
  const parentToChildren = new Map();
  const allNodes = new Set();

  for (const edge of validEdges) {
    const parent = edge[0];
    const child = edge[3];
    allNodes.add(parent);
    allNodes.add(child);

    if (!childToParent.has(child)) {
      childToParent.set(child, parent);
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent).push(child);
    }
    // multi-parent: first-encountered wins, rest silently discarded
  }

  return { childToParent, parentToChildren, allNodes };
}

function unionFind(allNodes, childToParent) {
  const uf = {};
  for (const n of allNodes) uf[n] = n;

  function find(x) {
    if (uf[x] !== x) uf[x] = find(uf[x]);
    return uf[x];
  }

  for (const [child, parent] of childToParent) {
    const rc = find(child);
    const rp = find(parent);
    if (rc !== rp) uf[rc] = rp;
  }

  return find;
}

function detectCycle(nodes, parentToChildren) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  for (const n of nodes) color[n] = WHITE;

  function dfs(node) {
    color[node] = GRAY;
    for (const child of (parentToChildren.get(node) || [])) {
      if (color[child] === undefined) continue;
      if (color[child] === GRAY) return true;
      if (color[child] === WHITE && dfs(child)) return true;
    }
    color[node] = BLACK;
    return false;
  }

  for (const node of nodes) {
    if (color[node] === WHITE && dfs(node)) return true;
  }
  return false;
}

function buildNestedTree(node, parentToChildren) {
  const result = {};
  for (const child of (parentToChildren.get(node) || [])) {
    result[child] = buildNestedTree(child, parentToChildren);
  }
  return result;
}

function calcDepth(node, parentToChildren) {
  let max = 0;
  for (const child of (parentToChildren.get(node) || [])) {
    max = Math.max(max, calcDepth(child, parentToChildren));
  }
  return 1 + max;
}

// ── Core processor ────────────────────────────────────────────────────────────
function processData(data) {
  const invalidEntries = [];
  const seenEdges = new Set();
  const dupSet = new Set();
  const duplicateEdges = [];
  const validEdges = [];

  for (const raw of data) {
    const entry = (typeof raw === 'string' ? raw : String(raw)).trim();

    if (!isValid(entry)) {
      invalidEntries.push(entry);
      continue;
    }

    if (seenEdges.has(entry)) {
      if (!dupSet.has(entry)) {
        dupSet.add(entry);
        duplicateEdges.push(entry);
      }
    } else {
      seenEdges.add(entry);
      validEdges.push(entry);
    }
  }

  const { childToParent, parentToChildren, allNodes } = buildGraph(validEdges);

  if (allNodes.size === 0) {
    return {
      user_id: USER_ID, email_id: EMAIL_ID, college_roll_number: ROLL_NUMBER,
      hierarchies: [], invalid_entries: invalidEntries,
      duplicate_edges: duplicateEdges,
      summary: { total_trees: 0, total_cycles: 0, largest_tree_root: '' }
    };
  }

  const find = unionFind(allNodes, childToParent);

  // Track first-seen order per node
  const nodeOrder = new Map();
  let seq = 0;
  for (const edge of validEdges) {
    if (!nodeOrder.has(edge[0])) nodeOrder.set(edge[0], seq++);
    if (!nodeOrder.has(edge[3])) nodeOrder.set(edge[3], seq++);
  }

  // Group into components
  const compMap = new Map();
  for (const node of allNodes) {
    const rep = find(node);
    if (!compMap.has(rep)) compMap.set(rep, []);
    compMap.get(rep).push(node);
  }

  // Order components by earliest node appearance
  const components = [...compMap.values()].sort((a, b) => {
    const aMin = Math.min(...a.map(n => nodeOrder.get(n) ?? Infinity));
    const bMin = Math.min(...b.map(n => nodeOrder.get(n) ?? Infinity));
    return aMin - bMin;
  });

  const hierarchies = [];
  let totalTrees = 0;
  let totalCycles = 0;
  let largestTreeRoot = null;
  let largestDepth = -1;

  for (const nodes of components) {
    const childSet = new Set(childToParent.keys());
    const roots = nodes.filter(n => !childSet.has(n)).sort();
    const hasCycle = detectCycle(nodes, parentToChildren);
    const componentRoot = roots.length > 0 ? roots[0] : [...nodes].sort()[0];

    if (hasCycle) {
      hierarchies.push({ root: componentRoot, tree: {}, has_cycle: true });
      totalCycles++;
    } else {
      const innerTree = buildNestedTree(componentRoot, parentToChildren);
      const tree = { [componentRoot]: innerTree };
      const depth = calcDepth(componentRoot, parentToChildren);
      hierarchies.push({ root: componentRoot, tree, depth });
      totalTrees++;

      if (
        depth > largestDepth ||
        (depth === largestDepth && (largestTreeRoot === null || componentRoot < largestTreeRoot))
      ) {
        largestDepth = depth;
        largestTreeRoot = componentRoot;
      }
    }
  }

  return {
    user_id: USER_ID,
    email_id: EMAIL_ID,
    college_roll_number: ROLL_NUMBER,
    hierarchies,
    invalid_entries: invalidEntries,
    duplicate_edges: duplicateEdges,
    summary: {
      total_trees: totalTrees,
      total_cycles: totalCycles,
      largest_tree_root: largestTreeRoot || ''
    }
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/bfhl', (req, res) => {
  try {
    if (!req.body || !Array.isArray(req.body.data)) {
      return res.status(400).json({ error: 'Request body must be { "data": [...] }' });
    }
    res.json(processData(req.body.data));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));

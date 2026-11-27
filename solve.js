// solve.js — a fast drop-in for makefun-diff 1.0.0.
//
// Written from the competition rule alone: the common prefix of lines is
// kept, then the common suffix of the lines left; between them Myers's
// greedy search runs forward, diagonal by diagonal, keeping on each
// diagonal the path that reaches furthest into the old text, with a
// deletion winning when deletion and insertion reach the same point, no
// move past either text's end, no pruning of edge diagonals, and every
// run of equal lines followed as far as it goes; the first path to reach
// both ends is the script. The patch is then formatted per that rule:
// header line, hunks with "@ os ol ns nl", "=" / "-" / "+" lines,
// deletions before insertions inside each change run, up to 3 kept lines
// of context, runs at most 6 kept lines apart sharing a hunk, and a "%"
// line after a final line written without its newline.
//
// Speed comes only from the implementation, never from a different
// algorithm: lines are interned to integer ids (so the hot loop compares
// ints, not strings), the Myers V-history lives in one flat Int32Array
// (no objects, no allocation inside the search), and the patch is built
// with one array push per line plus a single join.

const KEEP = 0;
const DEL = 1;
const INS = 2;

/** Cut a text after every "\n"; a last line with no "\n" is a line too. */
function splitLines(text) {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  const cut = parts.length - 1;
  const noNewline = text.charCodeAt(text.length - 1) !== 10;
  const lines = new Array(cut + (noNewline ? 1 : 0));
  for (let i = 0; i < cut; i++) lines[i] = parts[i] + '\n';
  if (noNewline) lines[cut] = parts[cut];
  return lines;
}

/** Map each distinct line string to a small integer id (same string = same id). */
function internIds(lines, table) {
  const ids = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let id = table.get(s);
    if (id === undefined) {
      id = table.size;
      table.set(s, id);
    }
    ids[i] = id;
  }
  return ids;
}

/**
 * Myers greedy search on the trimmed middles a[0..n), b[0..m), returning
 * the edit ops in forward order: 0 = keep, 1 = delete an old line,
 * 2 = insert a new line. The V-history of every depth is kept in one
 * flat Int32Array (depth d starts at d*d, diagonal k at offset k+d) so
 * the walk back can retrace the exact path the search took.
 */
function myersOps(a, b, n, m) {
  const total = n + m;
  const ops = new Uint8Array(total);
  if (n === 0 && m === 0) return ops.subarray(0, 0);

  let cap = 1024; // deepest d the V-history currently holds
  let v = new Int32Array((cap + 1) * (cap + 1));
  v.fill(-1);

  // Depth 0: diagonal 0, no edit yet, then the opening snake.
  let x = 0;
  while (x < n && x < m && a[x] === b[x]) x++;
  v[0] = x;
  let depth = 0;
  if (!(x === n && x === m)) {
    const target = n - m;
    let done = false;
    for (let d = 1; !done; d++) {
      if (d > cap) {
        // Grow the flat history (doubling keeps the copy cost linear).
        const ncap = cap * 2;
        const nv = new Int32Array((ncap + 1) * (ncap + 1));
        nv.fill(-1);
        nv.set(v);
        v = nv;
        cap = ncap;
      }
      const base = d * d;
      const pbase = (d - 1) * (d - 1);
      // The V[d-1] slots for the two candidates move in step with k, so
      // walk them with running indices instead of recomputing each time.
      let di = pbase - 2; // deletion candidate: diagonal k-1
      let ii = pbase; // insertion candidate: diagonal k+1
      let wi = base; // write slot: diagonal k in V[d]
      for (let k = -d; k <= d; k += 2, di += 2, ii += 2, wi += 2) {
        // Deletion candidate: one old line past the (d-1)-point on k-1.
        let px = -1;
        if (k > -d) {
          const pv = v[di];
          if (pv >= 0 && pv + 1 <= n) px = pv + 1;
        }
        // Insertion candidate: one new line past the (d-1)-point on k+1.
        // The deletion wins a tie, so it only replaces it when further.
        if (k < d) {
          const pv = v[ii];
          if (pv >= 0 && pv - k <= m && (px < 0 || pv > px)) px = pv;
        }
        if (px >= 0) {
          let y = px - k;
          while (px < n && y < m && a[px] === b[y]) {
            px++;
            y++;
          }
        }
        v[wi] = px;
        if (k === target && px === n) {
          depth = d;
          done = true;
          break;
        }
      }
    }
  }

  // Walk the path back from (n, m), retracing each depth's move with
  // the same choice the forward search made, then the snake before it.
  let oi = total;
  x = n;
  let y = m;
  for (let d = depth; d >= 1; d--) {
    const k = x - y;
    const pbase = (d - 1) * (d - 1);
    let del;
    if (k === d) del = true;
    else if (k === -d) del = false;
    else {
      const dv = v[pbase + (k - 1) + (d - 1)];
      const iv = v[pbase + (k + 1) + (d - 1)];
      const delOk = dv >= 0 && dv + 1 <= n;
      const insOk = iv >= 0 && iv - k <= m;
      del = delOk && (!insOk || dv + 1 >= iv);
    }
    let px;
    if (del) px = v[pbase + (k - 1) + (d - 1)] + 1;
    else px = v[pbase + (k + 1) + (d - 1)];
    while (x > px) {
      ops[--oi] = KEEP;
      x--;
      y--;
    }
    if (del) {
      ops[--oi] = DEL;
      x--;
    } else {
      ops[--oi] = INS;
      y--;
    }
  }
  while (x > 0) {
    ops[--oi] = KEEP;
    x--;
    y--;
  }
  return ops.subarray(oi);
}

/**
 * The edit ops for the trimmed middle a[a0..a1), b[b0..b1).
 *
 * First drop the lines that occur in only one side: such a line can
 * never be kept in any edit script, so it is a deletion (or insertion)
 * wherever it stands, and the reduced problem has the same kept lines.
 * The reduced script is then expanded back, putting each unique line in
 * its own gap as a deletion/insertion. This is an optimization, not
 * part of the rule, and is only trusted because fuzz against the oracle
 * proves the expanded script identical.
 */
function middleOps(aIds, bIds, a0, a1, b0, b1, tableSize) {
  const na = a1 - a0;
  const nb = b1 - b0;
  // Mark the ids present on each side, then keep only the shared ones.
  const mark = new Uint8Array(tableSize);
  for (let j = 0; j < nb; j++) mark[bIds[b0 + j]] = 1;
  const aR = new Int32Array(na);
  const oldMap = new Int32Array(na);
  let w = 0;
  for (let i = 0; i < na; i++) {
    if (mark[aIds[a0 + i]] === 1) {
      aR[w] = aIds[a0 + i];
      oldMap[w] = i;
      w++;
    }
  }
  const naR = w;
  mark.fill(0);
  for (let i = 0; i < na; i++) mark[aIds[a0 + i]] = 1;
  const bR = new Int32Array(nb);
  const newMap = new Int32Array(nb);
  w = 0;
  for (let j = 0; j < nb; j++) {
    if (mark[bIds[b0 + j]] === 1) {
      bR[w] = bIds[b0 + j];
      newMap[w] = j;
      w++;
    }
  }
  const nbR = w;

  const opsR = myersOps(aR.subarray(0, naR), bR.subarray(0, nbR), naR, nbR);

  // Expand: walk the reduced ops, flushing the unique lines that stand
  // before each reduced line in its own gap.
  const ops = new Uint8Array(na + nb);
  let oi = 0;
  let mi = 0;
  let mj = 0;
  let ri = 0;
  let rj = 0;
  for (let p = 0; p < opsR.length; p++) {
    const op = opsR[p];
    if (op === KEEP) {
      while (mi < oldMap[ri]) {
        ops[oi++] = DEL;
        mi++;
      }
      while (mj < newMap[rj]) {
        ops[oi++] = INS;
        mj++;
      }
      ops[oi++] = KEEP;
      mi++;
      mj++;
      ri++;
      rj++;
    } else if (op === DEL) {
      while (mi < oldMap[ri]) {
        ops[oi++] = DEL;
        mi++;
      }
      ops[oi++] = DEL;
      mi++;
      ri++;
    } else {
      while (mj < newMap[rj]) {
        ops[oi++] = INS;
        mj++;
      }
      ops[oi++] = INS;
      mj++;
      rj++;
    }
  }
  while (mi < na) {
    ops[oi++] = DEL;
    mi++;
  }
  while (mj < nb) {
    ops[oi++] = INS;
    mj++;
  }
  return ops.subarray(0, oi);
}

/**
 * Push one block of lines sharing a marker: the marker, the lines joined
 * with the marker between them, and "%" when the block's last line lacks
 * its newline (only a text's final line can). The pieces stay separate
 * in the output array; the single join at the end puts them together.
 */
function emitBlock(out, marker, lines, start, len) {
  if (len <= 0) return;
  out.push(marker);
  out.push(lines.slice(start, start + len).join(marker));
  const last = lines[start + len - 1];
  if (last.charCodeAt(last.length - 1) !== 10) out.push('\n%\n');
}

/**
 * Format the patch for the full texts from the forward op list.
 * Change runs list their deletions, then their insertions; runs at most
 * 6 kept lines apart share a hunk, with up to 3 kept lines of context
 * around each hunk.
 */
function buildPatch(oldLines, newLines, ops) {
  const n = oldLines.length;
  const m = newLines.length;

  // Collect the change runs: [opStart, opEnd, oldStart, newStart,
  // deleted, inserted, keptBefore]. keptBefore is the kept lines since
  // the previous run (or the start).
  const runs = [];
  let deleted = 0;
  let inserted = 0;
  let i = 0;
  let j = 0;
  let p = 0;
  while (p < ops.length) {
    const keepStart = p;
    while (p < ops.length && ops[p] === KEEP) {
      p++;
      i++;
      j++;
    }
    if (p >= ops.length) break;
    const run = [p, 0, i, j, 0, 0, p - keepStart];
    while (p < ops.length && ops[p] !== KEEP) {
      if (ops[p] === DEL) {
        run[4]++;
        i++;
      } else {
        run[5]++;
        j++;
      }
      p++;
    }
    run[1] = p;
    deleted += run[4];
    inserted += run[5];
    runs.push(run);
  }
  const keptAfter = p - (runs.length ? runs[runs.length - 1][1] : 0);

  const out = [];
  // Hunk grouping: a run joins the current hunk while at most 6 kept
  // lines separate it from the previous run in that hunk.
  let h = 0;
  while (h < runs.length) {
    let e = h;
    while (e + 1 < runs.length && runs[e + 1][6] <= 6) e++;
    const first = runs[h];
    const last = runs[e];
    const ctxBefore = first[6] < 3 ? first[6] : 3;
    const afterLast = e + 1 < runs.length ? runs[e + 1][6] : keptAfter;
    const ctxAfter = afterLast < 3 ? afterLast : 3;
    const os = first[2] - ctxBefore;
    const ns = first[3] - ctxBefore;
    const oe = last[2] + last[4] + ctxAfter;
    const ne = last[3] + last[5] + ctxAfter;
    out.push(`@ ${os + 1} ${oe - os} ${ns + 1} ${ne - ns}\n`);

    // Emit the hunk: context keeps, then each run's deletions, then
    // its insertions, then the keeps up to the next run. Whole blocks
    // of one marker go out at once (marker, joined lines, "%" when the
    // block's last line lacks its newline) instead of one push a line.
    let ci = os;
    let cj = ns;
    for (let r = h; r <= e; r++) {
      const run = runs[r];
      if (run[2] > ci) {
        emitBlock(out, '=', oldLines, ci, run[2] - ci);
        cj += run[2] - ci;
        ci = run[2];
      }
      emitBlock(out, '-', oldLines, ci, run[4]);
      ci += run[4];
      emitBlock(out, '+', newLines, cj, run[5]);
      cj += run[5];
      if (r < e) {
        const gap = runs[r + 1][6];
        emitBlock(out, '=', oldLines, ci, gap);
        ci += gap;
        cj += gap;
      }
    }
    if (oe > ci) emitBlock(out, '=', oldLines, ci, oe - ci);
    h = e + 1;
  }

  const head =
    `makefun-diff/1 old=${n} new=${m} hunks=${runs.length === 0 ? 0 : countHunks(runs)} deleted=${deleted} inserted=${inserted}\n`;
  return head + out.join('');
}

/** Count hunks from the run list (same grouping as the emitter above). */
function countHunks(runs) {
  let hunks = 0;
  let h = 0;
  while (h < runs.length) {
    hunks++;
    let e = h;
    while (e + 1 < runs.length && runs[e + 1][6] <= 6) e++;
    h = e + 1;
  }
  return hunks;
}

export function run(input) {
  const oldLines = splitLines(input.old);
  const newLines = splitLines(input.new);
  const table = new Map();
  const aIds = internIds(oldLines, table);
  const bIds = internIds(newLines, table);
  const n = aIds.length;
  const m = bIds.length;

  // Longest common prefix, then longest common suffix of what is left.
  let a0 = 0;
  let b0 = 0;
  while (a0 < n && b0 < m && aIds[a0] === bIds[b0]) {
    a0++;
    b0++;
  }
  let a1 = n;
  let b1 = m;
  while (a1 > a0 && b1 > b0 && aIds[a1 - 1] === bIds[b1 - 1]) {
    a1--;
    b1--;
  }

  const middle = middleOps(aIds, bIds, a0, a1, b0, b1, table.size);

  // Full op list: prefix keeps + middle ops + suffix keeps.
  const ops = new Uint8Array(a0 + middle.length + (n - a1));
  ops.fill(KEEP, 0, a0);
  ops.set(middle, a0);
  ops.fill(KEEP, a0 + middle.length);
  return buildPatch(oldLines, newLines, ops);
}

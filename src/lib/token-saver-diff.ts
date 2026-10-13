/**
 * Minimal word-level diff for Prompt Token Saver UI.
 * Marks tokens removed from the original and tokens added in the compressed form.
 */

export type DiffSeg = {
  type: "equal" | "remove" | "add";
  text: string;
};

function tokenize(s: string): string[] {
  // Keep whitespace and punctuation as separate tokens so layout stays readable
  return s.split(/(\s+|[^a-zA-Z0-9_'-]+)/).filter((t) => t.length > 0);
}

/**
 * LCS-based word diff. Fine for prompt-sized strings (typically < 5k tokens).
 */
export function wordDiff(original: string, compressed: string): DiffSeg[] {
  const a = tokenize(original);
  const b = tokenize(compressed);
  const n = a.length;
  const m = b.length;

  // DP table of LCS lengths
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      segs.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      segs.push({ type: "remove", text: a[i] });
      i++;
    } else {
      segs.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    segs.push({ type: "remove", text: a[i++] });
  }
  while (j < m) {
    segs.push({ type: "add", text: b[j++] });
  }

  // Merge adjacent same-type segments for cleaner HTML
  const merged: DiffSeg[] = [];
  for (const seg of segs) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

/** Render wordDiff segments as HTML (removed = strike, added = highlight). */
export function wordDiffHtml(original: string, compressed: string): string {
  return wordDiff(original, compressed)
    .map((seg) => {
      const t = escHtml(seg.text);
      if (seg.type === "remove") {
        return `<del class="ts-diff-rm">${t}</del>`;
      }
      if (seg.type === "add") {
        return `<ins class="ts-diff-add">${t}</ins>`;
      }
      return t;
    })
    .join("");
}

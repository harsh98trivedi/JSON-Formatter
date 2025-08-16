let currentJobId = 0;

const TARGET_CHUNK_BYTES = 1000000;

self.onmessage = async (e) => {
  const { type, jobId, text } = e.data || {};
  if (type !== "format") return;

  currentJobId = jobId;

  try {
    post({ type: "progress", jobId, percent: 5, stage: "Parsing…" });
    const t0 = performance.now();

    // 1) Parse (native is fastest)
    const obj = JSON.parse(text);

    // 2) Pretty print
    post({ type: "progress", jobId, percent: 20, stage: "Formatting…" });
    const pretty = JSON.stringify(obj, null, 2);
    const totalChars = pretty.length;

    // 3) Stream by byte-sized chunks (not lines)
    post({
      type: "progress",
      jobId,
      percent: 35,
      stage: "Highlighting…",
      detail: bytesLabel(totalChars),
    });

    // Pre-encode for near-constant-time substring -> bytes estimation
    // JS strings are UTF-16; we’ll approximate byte splits by char length,
    // then snap to nearest newline to preserve line integrity.
    const indices = computeChunkBoundaries(pretty, TARGET_CHUNK_BYTES);

    const totalChunks = indices.length - 1;
    for (let i = 0; i < totalChunks; i++) {
      if (currentJobId !== jobId) return;

      const start = indices[i];
      const end = indices[i + 1];
      const slice = pretty.slice(start, end);

      // Single-pass tokenize + escape within this slice
      const html = highlightChunk(slice);

      post({ type: "chunk", jobId, index: i, html });

      // Yield to keep under frame budget
      // Microtask for small slices, small timeout for very large ones
      if (html.length > 150_000) {
        await delay(1);
      } else {
        await Promise.resolve();
      }

      const pct = 35 + Math.round(((i + 1) / totalChunks) * 60);
      post({
        type: "progress",
        jobId,
        percent: Math.min(97, pct),
        stage: "Highlighting…",
        detail: `${i + 1}/${totalChunks} chunks`,
      });
    }

    if (currentJobId !== jobId) return;
    const ms = Math.round(performance.now() - t0);

    post({
      type: "done",
      jobId,
      formatted: pretty,
      highlighted: true,
      totalLines: pretty.split("\n").length,
      ms,
    });
  } catch (err) {
    post({ type: "error", jobId, message: err?.message || String(err) });
  }
};

function post(msg) {
  self.postMessage(msg);
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function bytesLabel(n) {
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)}KB` : `${(kb / 1024).toFixed(1)}MB`;
}

function computeChunkBoundaries(str, targetBytes) {
  const len = str.length;
  if (len <= targetBytes) return [0, len];

  const idx = [0];
  let pos = 0;
  while (pos < len) {
    let next = pos + targetBytes;
    if (next >= len) {
      idx.push(len);
      break;
    }
    // snap to newline boundary nearby to avoid split mid-line
    let snap = next;
    // look forward a bit
    for (let j = 0; j < 2000 && snap < len; j++, snap++) {
      if (str.charCodeAt(snap) === 10) {
        next = snap + 1;
        break;
      }
    }
    if (next === pos + targetBytes) {
      // look backward a bit if no forward newline found
      snap = next;
      for (let j = 0; j < 2000 && snap > pos; j++, snap--) {
        if (str.charCodeAt(snap) === 10) {
          next = snap + 1;
          break;
        }
      }
    }
    idx.push(next);
    pos = next;
  }
  return idx;
}

// Fast escape
function esc(s) {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
  );
}

// Single-pass tokenizer over a chunk: highlights values, not keys
function highlightChunk(src) {
  let out = "";
  let i = 0;
  const n = src.length;

  // states
  const S_TEXT = 0,
    S_STRING = 1,
    S_STRING_ESC = 2;
  let state = S_TEXT;

  while (i < n) {
    const ch = src.charCodeAt(i);

    if (state === S_TEXT) {
      if (ch === 34 /* " */) {
        // string start - decide later if value or key by looking behind for colon
        // we’ll capture the raw string then decide based on preceding colon+whitespace
        const start = i;
        i++; // consume "
        let s = '"';
        state = S_STRING;
        // collect string
        while (i < n && state !== S_TEXT) {
          const c = src.charCodeAt(i++);
          if (state === S_STRING) {
            if (c === 92) {
              // \
              state = S_STRING_ESC;
              s += "\\";
            } else if (c === 34) {
              // "
              s += '"';
              state = S_TEXT;
              break;
            } else {
              s += String.fromCharCode(c);
            }
          } else {
            // ESC
            s += String.fromCharCode(c);
            state = S_STRING;
          }
        }
        // determine if this string is a value (after colon) or key (before colon)
        // look backward from start for non-space; if it’s a colon, treat as value
        let j = start - 1;
        while (j >= 0) {
          const cj = src.charCodeAt(j);
          if (cj === 32 || cj === 9 || cj === 13 || cj === 10) {
            j--;
            continue;
          }
          if (cj === 58 /* : */) {
            out += `<span class="jv-string">${esc(s)}</span>`;
          } else {
            out += esc(s);
          }
          break;
        }
        if (j < 0) {
          // beginning of chunk, unknown context -> emit raw escaped
          out += esc(s);
        }
        continue;
      }

      // numbers / booleans / null only in value position (after colon)
      if (isValueNumberStart(src, i)) {
        const { token, next } = readNumber(src, i);
        out += `<span class="jv-number">${esc(token)}</span>`;
        i = next;
        continue;
      }
      if (isValueKeyword(src, i, "true")) {
        out += `<span class="jv-boolean">true</span>`;
        i += 4;
        continue;
      }
      if (isValueKeyword(src, i, "false")) {
        out += `<span class="jv-boolean">false</span>`;
        i += 5;
        continue;
      }
      if (isValueKeyword(src, i, "null")) {
        out += `<span class="jv-null">null</span>`;
        i += 4;
        continue;
      }

      // punctuation
      if (ch === 123 || ch === 125 || ch === 91 || ch === 93 || ch === 44) {
        out += `<span class="jv-punc">${esc(src[i])}</span>`;
        i++;
        continue;
      }

      // other
      out += esc(src[i]);
      i++;
      continue;
    }

    // shouldn't get here; string handled inline
    i++;
  }
  return out;
}

function isValueNumberStart(src, i) {
  // check we are after a colon (value context)
  let k = i - 1;
  while (k >= 0) {
    const c = src.charCodeAt(k);
    if (c === 32 || c === 9 || c === 13 || c === 10) {
      k--;
      continue;
    }
    if (c === 58) break; // colon
    return false;
  }
  const ch = src.charCodeAt(i);
  return ch === 45 /* - */ || (ch >= 48 && ch <= 57); // digit
}
function readNumber(src, i) {
  const start = i;
  let ch = src.charCodeAt(i);
  if (ch === 45) i++; // -
  // int
  while (i < src.length) {
    ch = src.charCodeAt(i);
    if (ch < 48 || ch > 57) break;
    i++;
  }
  // frac
  if (src.charCodeAt(i) === 46 /* . */) {
    i++;
    while (i < src.length) {
      ch = src.charCodeAt(i);
      if (ch < 48 || ch > 57) break;
      i++;
    }
  }
  // exp
  const e = src.charCodeAt(i);
  if (e === 101 || e === 69) {
    // e/E
    i++;
    const sgn = src.charCodeAt(i);
    if (sgn === 43 || sgn === 45) i++;
    while (i < src.length) {
      ch = src.charCodeAt(i);
      if (ch < 48 || ch > 57) break;
      i++;
    }
  }
  return { token: src.slice(start, i), next: i };
}
function isValueKeyword(src, i, kw) {
  // must be after colon (value context) and exact match
  let k = i - 1;
  while (k >= 0) {
    const c = src.charCodeAt(k);
    if (c === 32 || c === 9 || c === 13 || c === 10) {
      k--;
      continue;
    }
    if (c === 58) break;
    return false;
  }
  if (src.substr(i, kw.length) !== kw) return false;
  const end = i + kw.length;
  const b = src.charCodeAt(end);
  // boundary char
  return (
    !(b >= 48 && b <= 57) &&
    !(b >= 65 && b <= 90) &&
    !(b >= 97 && b <= 122) &&
    b !== 95
  );
}

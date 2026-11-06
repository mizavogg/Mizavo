/* Mizavo — admin page (src/admin/main.ts)
   The admin review page: log in with Twitch, then approve, edit or retire draft questions.
   Every action goes through the database's admin functions, which check that you're an admin.
   This page never decides who is an admin; the database does. */
import { supabase, rpc, loginWithTwitch } from '../lib/supabase';
import { $, el, show } from '../lib/dom';

/* ---------- constants ---------- */
const UNDO_MS = 5000;   // approving waits this long before saving, so a mis-tap can be undone
type Status = 'draft' | 'approved' | 'retired';
interface Question {
  id: string; mode: 'ff' | 'ooo'; payload: { statement?: string; items?: string[] }; answer: boolean | number;
  explanation: string; difficulty: 1 | 2 | 3; category: string; fact_key: string; source_url: string;
  origin: string; status: Status; open_reports?: number;
}
interface Dashboard { drafts: number; approved: number; retired: number; approved_by_mode_and_difficulty: Record<string, number> | null }
interface Pending { q: Question; at: number; ends: number; timer: number; tick: number }

const CATEGORIES = ['animals', 'space', 'geography', 'history', 'food', 'science', 'human_body', 'pop_culture', 'language'];
const DIFF: Record<number, string> = { 1: 'easy', 2: 'medium', 3: 'hard' };
const MODE: Record<string, string> = { ff: 'Fact or Fake', ooo: 'Odd One Out' };
const KEYS = ['A', 'B', 'C', 'D'];

/* ---------- page state ---------- */
const A = {
  tab: 'draft' as Status,
  drafts: [] as Question[],                         // the review queue
  idx: 0,                                           // which draft is on screen
  lists: {} as Partial<Record<Status, Question[]>>, // cached approved / retired lists
  dash: null as Dashboard | null,                   // counts from admin_dashboard
  pending: null as Pending | null,                  // an approval waiting out its undo window
  bootRun: 0,
};

/* ---------- small helpers ---------- */
function chip(text: string, cls?: string) { return el('span', 'chip' + (cls ? ' ' + cls : ''), text); }
const prettyCat = (c: string) => c.replace('_', ' ');
const val = (sel: string) => $<HTMLInputElement>(sel).value;

/* ---------- login gate ---------- */
function gate(msg: string, { login = false } = {}) {
  show($('#app'), false); show($('#gate'), true);
  $('#gateMsg').textContent = msg;
  show($('#loginBtn'), login);
}

$('#loginBtn').onclick = async () => {
  try { await loginWithTwitch(); } catch (e) { gate('Login failed: ' + (e as Error).message, { login: true }); }
};
$('#logoutBtn').onclick = async () => { await flushPending(); await supabase.auth.signOut(); };

async function boot(session: { user: { user_metadata?: Record<string, string> } } | null) {
  const run = ++A.bootRun;
  if (!session) { show($('#who'), false); return gate('Log in with Twitch to review questions.', { login: true }); }

  const meta = session.user.user_metadata || {};
  $('#whoName').textContent = meta.nickname || meta.name || meta.preferred_username || meta.full_name || 'Logged in';
  show($('#who'), true);
  gate('Checking admin access…');

  try {
    A.dash = await rpc<Dashboard>('admin_dashboard');
  } catch (err) {
    const e = err as Error;
    if (run !== A.bootRun) return;
    if (/not_admin/.test(e.message)) return gate("This Twitch account isn't a Mizavo admin, so there's nothing to review here.");
    return gate('Something went wrong loading the admin data: ' + e.message);
  }
  if (run !== A.bootRun) return;
  show($('#gate'), false); show($('#app'), true);
  renderStats();
  await loadDrafts();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => boot(session), 0);
});

/* ---------- counts + difficulty balance ---------- */
async function refreshDash() {
  try { A.dash = await rpc<Dashboard>('admin_dashboard'); renderStats(); } catch { /* counts are a nice-to-have; keep going */ }
}
function renderStats() {
  const d = A.dash; if (!d) return;
  const box = $('#stats'); box.replaceChildren();
  const stat = (k: string, v: number, cls?: string) => { const s = el('div', 'stat ' + (cls || '')); s.append(el('div', 'k', k), el('div', 'v', String(v))); return s; };
  box.append(stat('DRAFTS', d.drafts, 'drafts'), stat('APPROVED', d.approved), stat('RETIRED', d.retired));

  const bal = el('div', 'bal');
  bal.append(el('div', 'k', 'APPROVED BY DIFFICULTY'));
  const t = el('table'), head = el('tr');
  ['', 'Easy', 'Medium', 'Hard'].forEach((h) => head.append(el('th', null, h)));
  t.append(head);
  const by = d.approved_by_mode_and_difficulty || {};
  for (const m of ['ff', 'ooo']) {
    const tr = el('tr'); tr.append(el('td', null, m === 'ff' ? 'Fact/Fake' : 'Odd One'));
    for (const lvl of [1, 2, 3]) { const n = by[m + '_' + lvl] || 0; tr.append(el('td', n ? null : 'zero', String(n))); }
    t.append(tr);
  }
  bal.append(t); box.append(bal);

  $('#nDraft').textContent = '(' + d.drafts + ')';
  $('#nApproved').textContent = '(' + d.approved + ')';
  $('#nRetired').textContent = '(' + d.retired + ')';
}

/* ---------- tabs ---------- */
document.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.onclick = () => setTab(b.dataset.tab as Status));
async function setTab(tab: Status) {
  A.tab = tab;
  document.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === tab));
  show($('#reviewPane'), tab === 'draft'); show($('#listPane'), tab !== 'draft');
  if (tab === 'draft') return renderCard();
  await renderList(tab);
}

/* ---------- the review queue ---------- */
async function loadDrafts() {
  $('#reviewPane').replaceChildren(el('p', 'empty', 'Loading drafts…'));
  try {
    A.drafts = await rpc<Question[]>('admin_list_questions', { p_status: 'draft', p_limit: 500 });
  } catch (e) {
    $('#reviewPane').replaceChildren(el('p', 'err', 'Could not load drafts: ' + (e as Error).message));
    return;
  }
  A.idx = 0;
  if (A.tab === 'draft') renderCard();
}
const current = (): Question | null => A.drafts[A.idx] || null;

function renderCard(errMsg?: string) {
  const pane = $('#reviewPane'); pane.replaceChildren();
  if (errMsg) pane.append(el('p', 'err', errMsg));
  const q = current();
  if (!q) {
    const box = el('div', 'empty');
    box.append(el('b', null, 'All caught up.'), el('span', null, 'No drafts are waiting for review.'));
    pane.append(box); return;
  }

  // top row: position + labels
  const top = el('div', 'cardTop');
  top.append(el('span', 'pos', `Draft ${A.idx + 1} / ${A.drafts.length}`),
    chip(MODE[q.mode]), chip(DIFF[q.difficulty], DIFF[q.difficulty]), chip(prettyCat(q.category)), chip(q.origin));
  if (q.open_reports) top.append(chip(q.open_reports + ' report' + (q.open_reports > 1 ? 's' : ''), 'hard'));
  pane.append(top);

  // the question, the way players see it, with the answer marked
  const pv = el('div', 'preview');
  if (q.mode === 'ff') {
    pv.append(el('span', 'sticker', 'TRUE OR NOT?'), el('div', 'statement', q.payload.statement ?? ''));
    pv.append(el('span', 'verdict ' + (q.answer ? 'fact' : 'fake'), 'ANSWER: ' + (q.answer ? 'FACT' : 'FAKE')));
  } else {
    pv.append(el('span', 'sticker', 'ODD ONE OUT'));
    const grid = el('div', 'items');
    (q.payload.items ?? []).forEach((it, i) => {
      const box = el('div', 'item' + (i === q.answer ? ' odd' : ''));
      box.append(el('span', 'key', KEYS[i] + (i === q.answer ? ' · THE ODD ONE' : '')), document.createTextNode(it));
      grid.append(box);
    });
    pv.append(grid);
  }
  pane.append(pv);

  const ex = el('div', 'explain');
  ex.append(el('b', null, 'WHY:'), document.createTextNode(q.explanation));
  pane.append(ex);

  // source + details
  const dl = el('dl', 'meta');
  const src = el('a', null, q.source_url); src.href = q.source_url; src.target = '_blank'; src.rel = 'noopener noreferrer';
  const dd = el('dd'); dd.append(src);
  dl.append(el('dt', null, 'SOURCE'), dd, el('dt', null, 'FACT KEY'), el('dd', null, q.fact_key));
  pane.append(dl);

  // actions
  const act = el('div', 'actions');
  const btn = (label: string, key: string, cls: string, fn: () => void) => { const b = el('button', 'btn ' + cls); b.append(document.createTextNode(label)); const k = el('kbd', null, key); b.append(k); b.onclick = fn; return b; };
  act.append(
    btn('Approve', 'A', 'primary', approveCurrent),
    btn('Edit', 'E', 'ghost', openEdit),
    btn('Retire', 'R', 'ghost retire', openRetire),
    btn('Skip', '→', 'ghost', skipCurrent),
  );
  pane.append(act);
}

function skipCurrent() {
  if (A.drafts.length < 2) return;
  const [q] = A.drafts.splice(A.idx, 1);
  A.drafts.push(q);
  if (A.idx >= A.drafts.length) A.idx = 0;
  renderCard();
}

/* ---------- approve, with a 5-second undo ---------- */
function approveCurrent() {
  const q = current(); if (!q) return;
  if (A.pending) commitPending();             // a second approve saves the first one right away
  A.drafts.splice(A.idx, 1);
  if (A.idx >= A.drafts.length) A.idx = 0;
  const p: Pending = { q, at: A.idx, ends: Date.now() + UNDO_MS, timer: 0, tick: 0 };
  p.timer = window.setTimeout(commitPending, UNDO_MS);
  p.tick = window.setInterval(() => updateToast(p), 250);
  A.pending = p;
  updateToast(p);
  renderCard();
}
function updateToast(p: Pending) {
  const secs = Math.max(0, Math.ceil((p.ends - Date.now()) / 1000));
  toast(`Approved: saving in ${secs}s`, true);
}
function undoPending() {
  const p = A.pending; if (!p) return;
  clearTimeout(p.timer); clearInterval(p.tick); A.pending = null;
  A.drafts.splice(Math.min(p.at, A.drafts.length), 0, p.q);
  A.idx = Math.min(p.at, A.drafts.length - 1);
  toast('Undone. Still a draft.', false, 1800);
  if (A.tab === 'draft') renderCard();
}
async function commitPending() {
  const p = A.pending; if (!p) return;
  clearTimeout(p.timer); clearInterval(p.tick); A.pending = null;
  try {
    const r = await rpc<{ approved: number }>('admin_approve_questions', { p_ids: [p.q.id] });
    if (r.approved !== 1) throw new Error('the database did not approve it (it may no longer be a draft)');
    toast('Approved and saved.', false, 1800);
    delete A.lists.approved;
    refreshDash();
  } catch (e) {
    A.drafts.splice(Math.min(p.at, A.drafts.length), 0, p.q);   // put it back so nothing is lost
    if (A.tab === 'draft') renderCard('Approve failed, so the question is back in the queue: ' + (e as Error).message);
    hideToast();
  }
}
const flushPending = () => (A.pending ? commitPending() : Promise.resolve());
window.addEventListener('beforeunload', (e) => { if (A.pending) { e.preventDefault(); e.returnValue = ''; } });

let toastTimer = 0;
function toast(msg: string, withUndo: boolean, hideAfter?: number) {
  clearTimeout(toastTimer);
  $('#toastMsg').textContent = msg; show($('#undoBtn'), withUndo); show($('#toast'), true);
  if (hideAfter) toastTimer = window.setTimeout(hideToast, hideAfter);
}
function hideToast() { show($('#toast'), false); }
$('#undoBtn').onclick = undoPending;

/* ---------- retire (asks first) ---------- */
const retireDlg = $<HTMLDialogElement>('#retireDlg');
function openRetire() { if (current()) retireDlg.showModal(); }
$('#retireCancel').onclick = () => retireDlg.close();
$('#retireOk').onclick = async () => {
  const q = current(); retireDlg.close(); if (!q) return;
  try {
    const r = await rpc<{ retired: number }>('admin_retire_questions', { p_ids: [q.id] });
    if (r.retired !== 1) throw new Error('the database did not retire it');
    A.drafts.splice(A.drafts.indexOf(q), 1);
    if (A.idx >= A.drafts.length) A.idx = 0;
    delete A.lists.retired;
    toast('Retired.', false, 1800);
    renderCard(); refreshDash();
  } catch (e) { renderCard('Retire failed: ' + (e as Error).message); }
};

/* ---------- edit a draft ---------- */
const editDlg = $<HTMLDialogElement>('#editDlg');
$('#fCategory').append(...CATEGORIES.map((c) => { const o = el('option', null, prettyCat(c)); o.value = c; return o; }));
const countExpl = () => { $('#explCount').textContent = `(${val('#fExplanation').trim().length}/300, at least 10)`; };
$('#fExplanation').oninput = countExpl;

function openEdit() {
  const q = current(); if (!q) return;
  show($('#ffFields'), q.mode === 'ff'); show($('#oooFields'), q.mode === 'ooo');
  const radio = (name: string, v: unknown) => { $<HTMLInputElement>(`input[name=${name}][value="${String(v)}"]`).checked = true; };
  const setVal = (sel: string, v: string) => { $<HTMLInputElement>(sel).value = v; };
  if (q.mode === 'ff') { setVal('#fStatement', q.payload.statement ?? ''); radio('fAnswerFF', q.answer); }
  else { (q.payload.items ?? []).forEach((it, i) => setVal('#fItem' + i, it)); radio('fAnswerOOO', q.answer); }
  setVal('#fExplanation', q.explanation); countExpl();
  setVal('#fDifficulty', String(q.difficulty));
  setVal('#fCategory', q.category);
  setVal('#fSource', q.source_url);
  setVal('#fFactKey', q.fact_key);
  show($('#editErr'), false);
  editDlg.showModal();
}
$('#editCancel').onclick = () => editDlg.close();

$('#editForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = current(); if (!q) return editDlg.close();
  const changes: Partial<Question> & { explanation: string; source_url: string; fact_key: string } = {
    explanation: val('#fExplanation').trim(),
    difficulty: +val('#fDifficulty') as 1 | 2 | 3,
    category: val('#fCategory'),
    source_url: val('#fSource').trim(),
    fact_key: val('#fFactKey').trim(),
  };
  const checked = (name: string) => $<HTMLInputElement>(`input[name=${name}]:checked`).value;
  const problems: string[] = [];
  if (q.mode === 'ff') {
    const statement = val('#fStatement').trim();
    changes.payload = { statement };
    changes.answer = checked('fAnswerFF') === 'true';
    if (!statement) problems.push('The statement is empty.');
  } else {
    const items = [0, 1, 2, 3].map((i) => val('#fItem' + i).trim());
    changes.payload = { items };
    changes.answer = +checked('fAnswerOOO');
    if (items.some((x) => !x)) problems.push('All four items need text.');
    if (new Set(items.map((x) => x.toLowerCase())).size < 4) problems.push('The four items must all be different.');
  }
  if (changes.explanation.length < 10 || changes.explanation.length > 300) problems.push('The explanation must be 10 to 300 characters.');
  if (!/^https?:\/\/\S+$/.test(changes.source_url)) problems.push('The source must be a full link starting with http:// or https://');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(changes.fact_key)) problems.push('The fact key must be lowercase words joined by dashes, like octopus-hearts.');
  if (problems.length) { $('#editErr').textContent = problems.join(' '); show($('#editErr'), true); return; }

  $<HTMLButtonElement>('#editSave').disabled = true;
  try {
    await rpc('admin_edit_draft', { p_id: q.id, p_changes: changes });
    Object.assign(q, changes);
    editDlg.close();
    toast('Saved. Still a draft: approve it when it looks right.', false, 2500);
    renderCard();
  } catch (err) {
    $('#editErr').textContent = 'The database rejected the change: ' + (err as Error).message;
    show($('#editErr'), true);
  } finally { $<HTMLButtonElement>('#editSave').disabled = false; }
};

/* ---------- approved / retired lists (read-only) ---------- */
async function renderList(status: Status) {
  const pane = $('#listPane');
  if (!A.lists[status]) {
    pane.replaceChildren(el('p', 'empty', 'Loading…'));
    try { A.lists[status] = await rpc<Question[]>('admin_list_questions', { p_status: status, p_limit: 500 }); }
    catch (e) { pane.replaceChildren(el('p', 'err', 'Could not load: ' + (e as Error).message)); return; }
  }
  if (A.tab !== status) return;
  const rows = A.lists[status] ?? [];
  pane.replaceChildren();
  if (!rows.length) { pane.append(el('p', 'empty', status === 'approved' ? 'Nothing approved yet.' : 'Nothing retired.')); return; }
  const ul = el('ul', 'list');
  for (const q of rows) {
    const li = el('li'), text = el('div', 'q');
    if (q.mode === 'ff') {
      text.append(document.createTextNode((q.payload.statement ?? '') + ' '), el('span', 'ans', '→ ' + (q.answer ? 'FACT' : 'FAKE')));
    } else {
      const items = q.payload.items ?? [];
      text.append(document.createTextNode(items.join(' · ') + ' '), el('span', 'ans', '→ ' + items[q.answer as number]));
    }
    const tags = el('div', 'tags');
    tags.append(chip(q.mode === 'ff' ? 'FF' : 'OOO'), chip(DIFF[q.difficulty], DIFF[q.difficulty]), chip(prettyCat(q.category)));
    li.append(text, tags); ul.append(li);
  }
  pane.append(ul);
}

/* ---------- keyboard shortcuts (laptop) ---------- */
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'u' && A.pending) { e.preventDefault(); return undoPending(); }
  if (A.tab !== 'draft' || $('#app').classList.contains('hidden')) return;
  if (k === 'a') { e.preventDefault(); approveCurrent(); }
  else if (k === 'e') { e.preventDefault(); openEdit(); }
  else if (k === 'r') { e.preventDefault(); openRetire(); }
  else if (k === 'arrowright') { e.preventDefault(); skipCurrent(); }
});

/* ---------- import drafts from the pipeline (drafts.json) ---------- */
interface AddResult { added: number; skipped: number; failed: number; skipped_rows: { row: number; reason: string }[]; failed_rows: { row: number; reason: string }[] }
const importDlg = $<HTMLDialogElement>('#importDlg');
let toImport: Record<string, unknown>[] = [];
const CHUNK = 200;

$<HTMLInputElement>('#importFile').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  show($('#importErrs'), false);
  $<HTMLButtonElement>('#importOk').disabled = false; show($('#importOk'), true);
  $('#importCancel').textContent = 'Cancel';
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((q) => q && typeof q === 'object' && (q.mode === 'ff' || q.mode === 'ooo'))) {
      throw new Error("this doesn't look like the pipeline's drafts.json");
    }
    toImport = data;
    const ff = data.filter((q) => q.mode === 'ff').length;
    $('#importTitle').textContent = `Import ${data.length} drafts?`;
    $('#importText').textContent = `${ff} Fact or Fake and ${data.length - ff} Odd One Out, from ${file.name}. ` +
      'They arrive as drafts: nothing can be played until you approve it. Exact repeats are skipped automatically.';
  } catch (err) {
    toImport = [];
    $('#importTitle').textContent = "Can't import that file";
    $('#importText').textContent = (err as Error).message;
    show($('#importOk'), false);
  }
  importDlg.showModal();
};
$('#importCancel').onclick = () => importDlg.close();
$('#importOk').onclick = async () => {
  if (!toImport.length) return;
  const ok = $<HTMLButtonElement>('#importOk'); ok.disabled = true;
  let added = 0, skipped = 0, failed = 0;
  const problems: string[] = [];
  try {
    for (let i = 0; i < toImport.length; i += CHUNK) {
      $('#importText').textContent = `Importing… ${Math.min(i + CHUNK, toImport.length)} of ${toImport.length}`;
      const r = await rpc<AddResult>('admin_add_questions', { p_questions: toImport.slice(i, i + CHUNK) });
      added += r.added; skipped += r.skipped; failed += r.failed;
      for (const f of [...r.skipped_rows, ...r.failed_rows]) problems.push(`Row ${i + f.row}: ${f.reason}`);
    }
    $('#importTitle').textContent = 'Import finished';
    $('#importText').textContent = `${added} added as drafts, ${skipped} skipped as exact repeats, ${failed} failed.`;
  } catch (err) {
    $('#importTitle').textContent = 'Import stopped';
    $('#importText').textContent = `${added} added before an error: ${(err as Error).message}`;
  }
  const ul = $('#importErrs'); ul.replaceChildren(...problems.map((p) => el('li', null, p)));
  show(ul, problems.length > 0);
  show(ok, false); $('#importCancel').textContent = 'Close';
  toImport = [];
  A.lists = {};
  await Promise.all([refreshDash(), loadDrafts()]);
};

/* ---------- download the whole bank as CSV (for the pipeline's repeat check) ---------- */
async function listAll(status: Status): Promise<Question[]> {
  const out: Question[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rpc<Question[]>('admin_list_questions', { p_status: status, p_limit: 500, p_offset: offset });
    out.push(...page);
    if (page.length < 500) return out;
  }
}
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
$('#exportBtn').onclick = async () => {
  const btn = $<HTMLButtonElement>('#exportBtn'); btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const all = [...await listAll('draft'), ...await listAll('approved'), ...await listAll('retired')];
    const head = ['fact_key', 'mode', 'statement', 'items', 'answer', 'status', 'difficulty', 'category'];
    const rows = all.map((q) => [q.fact_key, q.mode, q.payload.statement ?? '', (q.payload.items ?? []).join(' | '),
      q.mode === 'ff' ? (q.answer ? 'fact' : 'fake') : 'ABCD'[q.answer as number], q.status, q.difficulty, q.category].map(csvCell).join(','));
    const blob = new Blob(['﻿' + [head.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `mizavo-bank-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    toast(`Downloaded ${all.length} questions.`, false, 2500);
  } catch (err) {
    toast('Download failed: ' + (err as Error).message, false, 4000);
  } finally { btn.disabled = false; btn.textContent = 'Download bank (.csv)'; }
};

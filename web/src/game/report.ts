/* Mizavo — "Report this question" on the reveal panel.
   The streamer picks a reason (and can add a note); it goes to the admin Reports tab.
   The game waits on the reveal screen while the dialog is open, so nothing is missed. */
import { $, el, show } from '../lib/dom';
import { REPORT_REASONS, type ReportReason } from '../lib/reasons';
import { S } from './state';
import { api, friendly } from './api';
import { resetReportBtn } from './flow';

const dlg = $<HTMLDialogElement>('#reportDlg');
const NOTE_MIN_FOR_OTHER = 5;   // the database needs a short note when the reason is "Something else"

// build the reason radio buttons once
$('#reportReasons').append(...Object.entries(REPORT_REASONS).map(([key, label]) => {
  const l = el('label', 'radio'), r = el('input');
  r.type = 'radio'; r.name = 'reportReason'; r.value = key;
  l.append(r, label);
  return l;
}));

function chosen(): ReportReason | null {
  const r = document.querySelector<HTMLInputElement>('input[name=reportReason]:checked');
  return r ? (r.value as ReportReason) : null;
}
function err(msg: string | null): void { const e = $('#reportErr'); e.textContent = msg || ''; show(e, !!msg); }

export function openReport(): void {
  const R = S.R;
  if (!R?.questionId || R.reported) return;
  document.querySelectorAll<HTMLInputElement>('input[name=reportReason]').forEach((r) => { r.checked = false; });
  $<HTMLTextAreaElement>('#reportNote').value = '';
  $('#reportWhat').textContent = R.type === 'ff' ? `"${R.statement}"` : R.opts.join(' · ');
  err(null);
  $<HTMLButtonElement>('#reportSend').disabled = false;
  dlg.showModal();
}

$('#reportCancel').onclick = () => dlg.close();
$('#reportForm').onsubmit = async (e) => {
  e.preventDefault();
  const R = S.R, reason = chosen();
  const note = $<HTMLTextAreaElement>('#reportNote').value.trim();
  if (!R?.questionId) return dlg.close();
  if (!reason) return err('Pick a reason first.');
  if (reason === 'other' && note.length < NOTE_MIN_FOR_OTHER) return err('Add a few words about what is wrong.');
  $<HTMLButtonElement>('#reportSend').disabled = true;
  try {
    await api.report(R.questionId, reason, note || null);
    R.reported = true; resetReportBtn(true); dlg.close();
  } catch (ex) {
    if (/^already_reported/.test((ex as Error).message)) { R.reported = true; resetReportBtn(true); dlg.close(); return; }
    err(friendly(ex));
    $<HTMLButtonElement>('#reportSend').disabled = false;
  }
};

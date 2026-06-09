/* Mālama Labs — shared professional contact modal.
 * Replaces mailto links: any element with [data-contact] opens a Name/Email/Message
 * form that POSTs to /api/contact (Resend → info@ / tyler@ / jeffrey@). */
(function () {
  if (window.__mlmaContact) return;
  window.__mlmaContact = true;

  var css = [
    '.mlma-ov{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}',
    '.mlma-ov.open{display:flex}',
    '.mlma-modal{position:relative;width:100%;max-width:480px;background:var(--bg-card,#131a14);border:1px solid var(--line-bright,#2d3d2e);border-radius:6px;padding:32px 30px;font-family:var(--sans,"Inter Tight",system-ui,sans-serif);max-height:90vh;overflow-y:auto}',
    '.mlma-modal:before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent,#c4f061),transparent)}',
    '.mlma-eyebrow{font-family:var(--mono,"JetBrains Mono",monospace);font-size:10px;text-transform:uppercase;letter-spacing:.15em;color:var(--accent,#c4f061);margin-bottom:10px}',
    '.mlma-modal h3{font-family:var(--serif,Fraunces,Georgia,serif);font-size:26px;font-weight:400;color:var(--ink,#e8efe5);margin:0 0 6px;line-height:1.1}',
    '.mlma-modal p.sub{color:var(--ink-dim,#9ba89a);font-size:14px;line-height:1.55;margin:0 0 22px}',
    '.mlma-modal label{display:block;font-family:var(--mono,monospace);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-faint,#5f6c5f);margin:0 0 6px}',
    '.mlma-modal input,.mlma-modal textarea{width:100%;padding:12px 14px;background:var(--bg,#0a0e0a);border:1px solid var(--line,#1f2a20);border-radius:4px;color:var(--ink,#e8efe5);font-family:var(--sans,system-ui);font-size:14px;outline:none;box-sizing:border-box;margin-bottom:16px}',
    '.mlma-modal input:focus,.mlma-modal textarea:focus{border-color:var(--accent,#c4f061)}',
    '.mlma-modal textarea{min-height:110px;resize:vertical}',
    '.mlma-btn{width:100%;padding:14px;background:var(--accent,#c4f061);color:var(--bg,#0a0e0a);border:none;border-radius:2px;font-family:var(--mono,monospace);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;transition:transform .15s}',
    '.mlma-btn:hover{transform:translateY(-1px)}.mlma-btn:disabled{opacity:.5;cursor:default;transform:none}',
    '.mlma-x{position:absolute;top:16px;right:18px;background:none;border:none;color:var(--ink-faint,#5f6c5f);font-size:22px;line-height:1;cursor:pointer}',
    '.mlma-x:hover{color:var(--accent,#c4f061)}',
    '.mlma-status{margin-top:14px;font-family:var(--mono,monospace);font-size:12px;line-height:1.5;display:none}',
    '.mlma-fine{margin-top:16px;font-family:var(--mono,monospace);font-size:10px;color:var(--ink-faint,#5f6c5f);line-height:1.5}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var ov = document.createElement('div');
  ov.className = 'mlma-ov';
  ov.innerHTML =
    '<div class="mlma-modal" role="dialog" aria-modal="true" aria-labelledby="mlma-h">' +
      '<button class="mlma-x" type="button" aria-label="Close">×</button>' +
      '<div class="mlma-eyebrow" id="mlma-ctx">Contact</div>' +
      '<h3 id="mlma-h">Talk to the team.</h3>' +
      '<p class="sub">Share your details and we will follow up within 24 hours on business days.</p>' +
      '<form id="mlma-form">' +
        '<label for="mlma-name">Name</label><input id="mlma-name" name="name" type="text" autocomplete="name" required>' +
        '<label for="mlma-email">Email</label><input id="mlma-email" name="email" type="email" autocomplete="email" required>' +
        '<label for="mlma-org">Organization (optional)</label><input id="mlma-org" name="firm" type="text" autocomplete="organization">' +
        '<label for="mlma-msg">How can we help?</label><textarea id="mlma-msg" name="message" required></textarea>' +
        '<button class="mlma-btn" type="submit">Send →</button>' +
        '<p class="mlma-status" id="mlma-status"></p>' +
        '<p class="mlma-fine">Goes to the Mālama Labs team. We never share your details.</p>' +
      '</form>' +
    '</div>';
  document.body.appendChild(ov);

  var ctxEl = ov.querySelector('#mlma-ctx'),
      form = ov.querySelector('#mlma-form'),
      statusEl = ov.querySelector('#mlma-status'),
      btn = form.querySelector('.mlma-btn'),
      current = 'General Inquiry';

  function open(context) {
    current = context || 'General Inquiry';
    ctxEl.textContent = current;
    statusEl.style.display = 'none'; statusEl.textContent = '';
    ov.classList.add('open');
    setTimeout(function () { ov.querySelector('#mlma-name').focus(); }, 50);
  }
  function close() { ov.classList.remove('open'); }
  window.openContact = open;

  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  ov.querySelector('.mlma-x').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // Any [data-contact] element opens the modal with its context label.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-contact]');
    if (t) { e.preventDefault(); open(t.getAttribute('data-contact') || 'General Inquiry'); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var body = { source: current, name: fd.get('name'), email: fd.get('email'), firm: fd.get('firm'), message: fd.get('message') };
    statusEl.style.display = 'block'; statusEl.style.color = 'var(--ink-dim,#9ba89a)'; statusEl.textContent = 'Sending…';
    btn.disabled = true;
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d.ok, d: d }; }); })
      .then(function (x) {
        btn.disabled = false;
        if (x.ok) {
          statusEl.style.color = 'var(--accent,#c4f061)';
          statusEl.textContent = 'Sent. We will follow up within 24 hours on business days.';
          form.reset();
        } else {
          statusEl.style.color = '#f0a05a';
          statusEl.textContent = (x.d && x.d.error) || 'Something went wrong. Email tyler@malamalabs.com.';
        }
      })
      .catch(function () { btn.disabled = false; statusEl.style.color = '#f0a05a'; statusEl.textContent = 'Network error. Email tyler@malamalabs.com.'; });
  });
})();

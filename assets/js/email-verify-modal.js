// ===== Quest Zone — email verification modal =====
//
// Shared pop-up used everywhere the "Email Not Confirmed" state shows up
// (right now: qz-header-auth.js's header button, and profile/index.html's
// locked-profile screen). One instance, built lazily on first use and
// reused after that, so including this script on a page costs nothing
// until someone actually opens it.
//
// window.QZEmailVerify.open(email) — email is the account's own address
// (from getProfile()'s linked auth user, or just passed in by the caller
// that already has it). Requires qz-auth.js (sendVerificationCode/
// verifyEmailCode) and site.js (qzToast) already loaded on the page.
(function () {
  const RESEND_COOLDOWN_MS = 30000;
  // Must match supabase/config.toml's [auth.email] otp_length. Discovered
  // the hard way: this project's otp_length is 8 (inherited from the
  // project's pre-existing settings, restored after an earlier config
  // mix-up), not Supabase's own default of 6 — the input was capped at 6
  // and silently truncated every real code, so nothing anyone typed could
  // ever match. If otp_length ever changes, update this constant too.
  const CODE_LENGTH = 8;

  let modalEl = null;
  let codeInput = null;
  let statusEl = null;
  let confirmBtn = null;
  let resendBtn = null;
  let currentEmail = '';
  let cooldownTimer = null;

  function injectStyles() {
    if (document.getElementById('qz-email-verify-style')) return;
    const style = document.createElement('style');
    style.id = 'qz-email-verify-style';
    style.textContent = `
      .qz-ev-backdrop {
        position: fixed; inset: 0; z-index: 700; display: none;
        align-items: flex-start; justify-content: center;
        padding: 8vh 16px; overflow-y: auto;
        background: rgba(4,7,14,0.75); backdrop-filter: blur(3px);
      }
      .qz-ev-backdrop.show { display: flex; }
      .qz-ev-modal {
        position: relative; width: 100%; max-width: 420px;
        border: 1.5px solid rgba(140,195,255,0.35); border-radius: 14px;
        background: linear-gradient(165deg, #0d1830 0%, #081222 55%, #050a16 100%);
        box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(60,140,255,0.15);
        padding: 26px 24px 24px;
        font-family: 'Exo 2', sans-serif;
      }
      .qz-ev-close {
        position: absolute; top: 12px; right: 12px; width: 28px; height: 28px;
        border-radius: 50%; border: 1.5px solid rgba(140,160,190,0.3); background: rgba(10,16,28,0.7);
        color: #a9b1d6; font-size: 14px; cursor: pointer; line-height: 1;
      }
      .qz-ev-close:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
      .qz-ev-icon { font-size: 28px; text-align: center; margin-bottom: 8px; }
      .qz-ev-title {
        font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 15px;
        letter-spacing: 0.06em; text-transform: uppercase; text-align: center;
        color: #fff; margin: 0 0 10px;
      }
      .qz-ev-body { font-size: 13px; line-height: 1.6; color: #a9b1d6; text-align: center; margin-bottom: 6px; }
      .qz-ev-email { color: #7fb3ff; font-weight: 600; word-break: break-all; }
      .qz-ev-row { margin-top: 16px; }
      .qz-ev-code-input {
        width: 100%; padding: 11px 12px; border-radius: 8px; text-align: center;
        border: 1.5px solid rgba(120,160,220,0.35); background: rgba(4,8,16,0.65);
        color: #fff; font-size: 16px; letter-spacing: 0.2em; font-family: 'Orbitron', monospace;
      }
      .qz-ev-code-input::placeholder { letter-spacing: 0.2em; font-size: 13px; color: rgba(169,177,214,0.5); }
      .qz-ev-code-input:focus { outline: none; border-color: #7fb3ff; }
      .qz-ev-status { min-height: 16px; font-size: 12px; text-align: center; margin-top: 10px; color: #ff9d9d; }
      .qz-ev-status.ok { color: #6be3a0; }
      .qz-ev-actions { display: flex; gap: 10px; margin-top: 14px; }
      .qz-ev-btn {
        flex: 1; padding: 10px 12px; border-radius: 8px; cursor: pointer;
        font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
        border: 1.5px solid rgba(120,160,220,0.35); background: rgba(4,8,16,0.55); color: #cfe0ff;
        transition: box-shadow 0.15s ease, opacity 0.15s ease;
      }
      .qz-ev-btn:hover:not(:disabled) { box-shadow: 0 0 14px rgba(90,160,255,0.4); }
      .qz-ev-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .qz-ev-btn.primary { background: linear-gradient(180deg,#3b6fe0,#1c3a8f); border-color: rgba(150,200,255,0.8); color: #fff; }
    `;
    document.head.appendChild(style);
  }

  function build() {
    if (modalEl) return;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.className = 'qz-ev-backdrop';
    modalEl.innerHTML =
      '<div class="qz-ev-modal">' +
        '<button type="button" class="qz-ev-close" aria-label="Close">✕</button>' +
        '<div class="qz-ev-icon">📧</div>' +
        '<h3 class="qz-ev-title">Confirm Your Email</h3>' +
        '<p class="qz-ev-body">You haven’t confirmed <span class="qz-ev-email" id="qz-ev-email"></span> yet.<br>' +
          'Check your inbox (and spam folder) for a code from Quest Zone.</p>' +
        '<div class="qz-ev-row">' +
          '<input type="text" class="qz-ev-code-input" id="qz-ev-code" placeholder="Enter code" inputmode="numeric" maxlength="' + CODE_LENGTH + '" autocomplete="one-time-code">' +
        '</div>' +
        '<div class="qz-ev-status" id="qz-ev-status"></div>' +
        '<div class="qz-ev-actions">' +
          '<button type="button" class="qz-ev-btn" id="qz-ev-resend">Resend Code</button>' +
          '<button type="button" class="qz-ev-btn primary" id="qz-ev-confirm">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);

    codeInput = modalEl.querySelector('#qz-ev-code');
    statusEl = modalEl.querySelector('#qz-ev-status');
    confirmBtn = modalEl.querySelector('#qz-ev-confirm');
    resendBtn = modalEl.querySelector('#qz-ev-resend');

    modalEl.querySelector('.qz-ev-close').addEventListener('click', close);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmBtn.click(); });

    resendBtn.addEventListener('click', onResend);
    confirmBtn.addEventListener('click', onConfirm);
  }

  function setStatus(msg, ok) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('ok', !!ok);
  }

  function startCooldown() {
    let remaining = RESEND_COOLDOWN_MS / 1000;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Resend Code (' + remaining + 's)';
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
      } else {
        resendBtn.textContent = 'Resend Code (' + remaining + 's)';
      }
    }, 1000);
  }

  async function onResend() {
    if (!window.QZAuth || !window.QZAuth.sendVerificationCode) return;
    resendBtn.disabled = true;
    setStatus('Sending…', false);
    try {
      await window.QZAuth.sendVerificationCode(currentEmail);
      setStatus('Code sent — check your inbox.', true);
      startCooldown();
    } catch (err) {
      setStatus((err && err.message) || 'Could not send the code — try again shortly.', false);
      resendBtn.disabled = false;
    }
  }

  async function onConfirm() {
    const code = codeInput.value.trim();
    if (code.length !== CODE_LENGTH) { setStatus('Enter the full code from your email.', false); return; }
    if (!window.QZAuth || !window.QZAuth.verifyEmailCode) return;
    confirmBtn.disabled = true;
    setStatus('Checking…', false);
    try {
      await window.QZAuth.verifyEmailCode(currentEmail, code);
      setStatus('Email confirmed!', true);
      if (window.qzToast) window.qzToast('Email confirmed — welcome to Quest Zone!');
      setTimeout(() => { close(); location.reload(); }, 700);
    } catch (err) {
      setStatus((err && err.message) || 'That code didn’t work — check it and try again.', false);
      confirmBtn.disabled = false;
    }
  }

  function open(email) {
    build();
    currentEmail = String(email || '').trim();
    modalEl.querySelector('#qz-ev-email').textContent = currentEmail;
    codeInput.value = '';
    setStatus('', false);
    confirmBtn.disabled = false;
    modalEl.classList.add('show');
    setTimeout(() => codeInput.focus(), 50);
  }

  function close() {
    if (modalEl) modalEl.classList.remove('show');
  }

  window.QZEmailVerify = { open, close };
})();

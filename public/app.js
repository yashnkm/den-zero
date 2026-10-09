/* ============================================================
   DEN ZERO — Registration logic
   ============================================================ */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     1. Constellation background (brand-panel canvas)
     --------------------------------------------------------- */
  const canvas = document.getElementById('constellation');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    let raf;

    const resize = () => {
      const { offsetWidth: w, offsetHeight: h } = canvas.parentElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(70, Math.floor((w * h) / 14000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.4,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const LINK_DIST = 130;

    const draw = () => {
      const w = canvas.parentElement.offsetWidth;
      const h = canvas.parentElement.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        s.x += s.vx; s.y += s.vy; s.tw += 0.02;
        if (s.x < 0 || s.x > w) s.vx *= -1;
        if (s.y < 0 || s.y > h) s.vy *= -1;
      }

      // links
      ctx.lineWidth = 0.6;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x;
          const dy = stars[i].y - stars[j].y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(189, 215, 255, ${0.14 * (1 - d / LINK_DIST)})`;
            ctx.beginPath();
            ctx.moveTo(stars[i].x, stars[i].y);
            ctx.lineTo(stars[j].x, stars[j].y);
            ctx.stroke();
          }
        }
      }

      // stars
      for (const s of stars) {
        const a = 0.45 + Math.sin(s.tw) * 0.3;
        ctx.fillStyle = `rgba(244, 246, 252, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); draw(); });
  }

  /* ---------------------------------------------------------
     2. Element refs + state
     --------------------------------------------------------- */
  const form         = document.getElementById('regForm');
  const steps        = [...form.querySelectorAll('.step')];
  const indexItems   = [...document.querySelectorAll('#stepIndex li')];
  const backBtn      = document.getElementById('backBtn');
  const nextBtn      = document.getElementById('nextBtn');
  const submitBtn    = document.getElementById('submitBtn');
  const progressFill = document.getElementById('progressFill');
  const mobileLabel  = document.getElementById('mobileStepLabel');
  const membersWrap  = document.getElementById('membersWrap');
  const leadSelect   = document.getElementById('leadSelect');

  const TOTAL = steps.length;
  let current = 0;

  /* ---------------------------------------------------------
     3. Dynamic member cards (1–3)
     --------------------------------------------------------- */
  const ROLE = ['Founder', 'Co-founder', 'Co-founder'];
  const TODAY = new Date().toISOString().slice(0, 10);   // DOB max (no future dates)
  const DOB_MIN = '1995-01-01';                          // oldest allowed: born on/after Jan 1995

  const memberCard = (i) => `
    <div class="member-card" data-member="${i}">
      <div class="member-card__head">
        <span class="member-card__num">0${i + 1}</span>
        <span class="member-card__role">${i === 0 ? 'Member 01 · required' : `Member 0${i + 1}`}</span>
      </div>
      <div class="member-card__body">
        <div class="field-group span-2">
          <label class="field-label" for="m${i}-name">Full name <b>*</b></label>
          <input class="input" id="m${i}-name" name="m${i}-name" type="text" placeholder="As on college ID" required />
          <p class="field-error">Name is required.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-college">College name <b>*</b> <em class="field-hint">(N/A if not a student)</em></label>
          <input class="input" id="m${i}-college" name="m${i}-college" type="text" placeholder="Institution, or N/A" required />
          <p class="field-error">College is required.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-course">Course &amp; year <b>*</b> <em class="field-hint">(N/A if not a student)</em></label>
          <input class="input" id="m${i}-course" name="m${i}-course" type="text" placeholder="e.g. B.Tech CSE, 3rd yr (or N/A)" required />
          <p class="field-error">Course &amp; year required.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-email">Email ID <b>*</b></label>
          <input class="input" id="m${i}-email" name="m${i}-email" type="email" placeholder="you@college.edu" required />
          <p class="field-error">Valid email required.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-phone">Phone number <b>*</b></label>
          <input class="input phone-input" id="m${i}-phone" name="m${i}-phone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number" pattern="[0-9]{10}" required />
          <p class="field-error">Enter a valid 10-digit number.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-dob">Date of birth <b>*</b></label>
          <input class="input" id="m${i}-dob" name="m${i}-dob" type="date" min="${DOB_MIN}" max="${TODAY}" required />
          <p class="field-error">Must be born on or after 1 Jan 1995.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="m${i}-linkedin">LinkedIn profile <em class="field-hint">(optional)</em></label>
          <input class="input" id="m${i}-linkedin" name="m${i}-linkedin" type="url" placeholder="linkedin.com/in/…" />
        </div>
      </div>
    </div>`;

  const renderMembers = (n) => {
    membersWrap.innerHTML = Array.from({ length: n }, (_, i) => memberCard(i)).join('');
    bindValidationReset(membersWrap);
  };

  form.querySelectorAll('input[name="teamSize"]').forEach((r) =>
    r.addEventListener('change', () => renderMembers(+r.value))
  );
  renderMembers(3); // default checked = 3

  /* ---------------------------------------------------------
     4. Lead select — populated from members; autofills contact
     --------------------------------------------------------- */
  const getMembers = () => {
    const out = [];
    membersWrap.querySelectorAll('input[name$="-name"]').forEach((nameInput) => {
      const prefix = nameInput.name.replace(/-name$/, '');         // "m0", "m1", …
      const name = nameInput.value.trim();
      if (!name) return;
      out.push({
        name,
        phone: (form.querySelector(`[name="${prefix}-phone"]`)?.value || '').trim(),
        email: (form.querySelector(`[name="${prefix}-email"]`)?.value || '').trim(),
      });
    });
    return out;
  };

  const fillLeadFrom = (m) => {
    const wa = document.getElementById('leadWhatsapp');
    const em = document.getElementById('leadEmail');
    if (m.phone) { wa.value = m.phone; markError(wa, false); }
    if (m.email) { em.value = m.email; markError(em, false); }
  };

  const populateLeads = () => {
    const members = getMembers();
    const prev = leadSelect.value;
    leadSelect.innerHTML = '<option value="" disabled>Select a team member…</option>';
    members.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      opt.dataset.phone = m.phone;
      opt.dataset.email = m.email;
      leadSelect.appendChild(opt);
    });
    if (members.length === 1) {
      // solo team → auto-select the only member and autofill their contact
      leadSelect.value = members[0].name;
      fillLeadFrom(members[0]);
    } else if (prev && members.some((m) => m.name === prev)) {
      leadSelect.value = prev;          // keep previous valid choice
    } else {
      leadSelect.selectedIndex = 0;     // show placeholder
    }
  };

  // picking a member from the dropdown autofills lead WhatsApp + email
  leadSelect.addEventListener('change', () => {
    const opt = leadSelect.selectedOptions[0];
    if (opt && opt.value) fillLeadFrom({ phone: opt.dataset.phone, email: opt.dataset.email });
    markError(leadSelect, false);
  });

  /* ---------------------------------------------------------
     5. Step navigation + progress
     --------------------------------------------------------- */
  const show = (i) => {
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    indexItems.forEach((li, k) => {
      li.classList.toggle('is-current', k === i);
      li.classList.toggle('is-done', k < i);
    });
    progressFill.style.width = `${((i + 1) / TOTAL) * 100}%`;
    mobileLabel.textContent = `0${i + 1} / 0${TOTAL}`;
    backBtn.disabled = i === 0;
    nextBtn.hidden = i === TOTAL - 1;
    submitBtn.hidden = i !== TOTAL - 1;
    current = i;
    document.querySelector('.form-side').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (i === 1) populateLeads();
  };

  /* ---------------------------------------------------------
     6. Validation
     --------------------------------------------------------- */
  function markError(el, on) {
    const group = el.closest('.field-group');
    if (group) group.classList.toggle('has-error', on);
  }

  function bindValidationReset(scope) {
    scope.querySelectorAll('.input, input[type="radio"], input[type="checkbox"], input[type="file"]').forEach((el) => {
      el.addEventListener('input', () => markError(el, false));
      el.addEventListener('change', () => markError(el, false));
    });
  }

  bindValidationReset(form);

  const validateStep = (i) => {
    const step = steps[i];
    let firstBad = null;

    // text / email / tel / url / select / textarea
    step.querySelectorAll('.input[required]').forEach((el) => {
      const bad = !el.checkValidity();
      markError(el, bad);
      if (bad && !firstBad) firstBad = el;
    });

    // radio groups
    const radioNames = new Set([...step.querySelectorAll('input[type="radio"][required]')].map((r) => r.name));
    radioNames.forEach((name) => {
      const checked = step.querySelector(`input[name="${name}"]:checked`);
      const any = step.querySelector(`input[name="${name}"]`);
      markError(any, !checked);
      if (!checked && !firstBad) firstBad = any;
    });

    // file inputs
    step.querySelectorAll('input[type="file"][required]').forEach((el) => {
      const bad = !el.files.length;
      markError(el, bad);
      if (bad && !firstBad) firstBad = el.closest('label');
    });

    // "looking for" — at least one pill
    const pills = step.querySelector('#lookingFor');
    if (pills) {
      const any = pills.querySelectorAll('input:checked').length > 0;
      markError(pills.querySelector('input'), !any);
      if (!any && !firstBad) firstBad = pills;
    }

    // declarations — each required checkbox
    step.querySelectorAll('.check input[required]').forEach((el) => {
      const bad = !el.checked;
      markError(el, bad);
      if (bad && !firstBad) firstBad = el.closest('.check');
    });

    if (firstBad) {
      (firstBad.scrollIntoView ? firstBad : step).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  };

  nextBtn.addEventListener('click', () => {
    if (validateStep(current)) show(current + 1);
  });

  backBtn.addEventListener('click', () => show(current - 1));

  // Enter advances to the next step (like Continue) instead of submitting the
  // whole form early. Textareas keep normal Enter (newlines); last step submits.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (current < TOTAL - 1) nextBtn.click();
    else submitBtn.click();
  });

  // phone fields: keep digits only, hard cap at 10 (covers member + lead fields)
  form.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('phone-input')) {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
    }
  });

  // allow jumping back via the sidebar index (only to completed steps, and not once saved for payment)
  indexItems.forEach((li) => {
    li.addEventListener('click', () => {
      const target = +li.dataset.step;
      if (target < current && !backBtn.disabled) show(target);
    });
  });

  /* ---------------------------------------------------------
     7. Word counters (max 700 words, hard-capped)
     --------------------------------------------------------- */
  const WORD_LIMIT = 700;
  const countWords = (s) => (s.trim().match(/\S+/g) || []).length;
  document.querySelectorAll('.char-count').forEach((counter) => {
    const field = document.getElementById(counter.dataset.for);
    if (!field) return;
    let lastValid = field.value;
    const update = () => {
      if (countWords(field.value) > WORD_LIMIT) {
        field.value = lastValid;          // reject input beyond 700 words
      } else {
        lastValid = field.value;
      }
      counter.textContent = `${countWords(field.value)} / ${WORD_LIMIT} words`;
    };
    field.addEventListener('input', update);
    update();
  });

  /* ---------------------------------------------------------
     8. Dropzones (deck + payment screenshot)
     --------------------------------------------------------- */
  const wireDropzone = (zoneId, inputId, { accept, maxMB }) => {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const fileTag = zone.querySelector('.dropzone__file');

    const setFile = (file) => {
      if (!file) {
        fileTag.hidden = true;
        fileTag.textContent = '';
        zone.classList.remove('has-file');
        return;
      }
      const okType = accept.some((t) => file.type.includes(t) || file.name.toLowerCase().endsWith(t));
      if (!okType) { markError(input, true); return; }
      if (file.size > maxMB * 1024 * 1024) {
        fileTag.hidden = false;
        fileTag.textContent = `✕ ${file.name} · over ${maxMB} MB`;
        input.value = '';
        zone.classList.remove('has-file');
        markError(input, true);
        return;
      }
      fileTag.hidden = false;
      fileTag.textContent = `✓ ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      zone.classList.add('has-file');
      markError(input, false);
    };

    input.addEventListener('change', () => setFile(input.files[0]));

    ['dragenter', 'dragover'].forEach((ev) =>
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-drag'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-drag'); })
    );
    zone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        setFile(file);
      }
    });
  };

  wireDropzone('deckZone', 'deckFile', { accept: ['pdf'], maxMB: 10 });

  /* ---------------------------------------------------------
     9. City gate — greets on page load; city sets the fee
        (display only — the server creates the order amount itself)
     --------------------------------------------------------- */
  const cityGate    = document.getElementById('cityGate');
  const cityInput   = document.getElementById('cityInput');
  const submitLabel = document.getElementById('submitLabel');
  const behind      = [document.querySelector('.brand-panel'), document.querySelector('.form-side')];
  const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
  let selectedFee = 0;

  const setPayLabel = () => {
    submitLabel.textContent = selectedFee ? `Pay ${inr(selectedFee)} & enter the Den` : 'Pay & enter the Den';
  };

  const openCityGate = () => {
    cityGate.hidden = false;
    behind.forEach((el) => (el.inert = true));
    document.body.style.overflow = 'hidden';
    (cityGate.querySelector('.city-card.is-selected') || cityGate.querySelector('.city-card')).focus();
  };

  const closeCityGate = () => {
    cityGate.hidden = true;
    behind.forEach((el) => (el.inert = false));
    document.body.style.overflow = '';
  };

  cityGate.querySelectorAll('.city-card').forEach((card) =>
    card.addEventListener('click', () => {
      const { city, fee } = card.dataset;
      cityInput.value = city;
      selectedFee = +fee;
      document.getElementById('payFee').textContent = inr(selectedFee);
      document.getElementById('payCity').textContent = `${city} edition`;
      document.getElementById('footCity').textContent = `${city} edition`;
      cityGate.querySelectorAll('.city-card').forEach((c) => c.classList.toggle('is-selected', c === card));
      setPayLabel();
      closeCityGate();
    })
  );

  // The server's fees win over the defaults in the HTML, so the price shown is the price charged.
  fetch('/api/fees')
    .then((r) => (r.ok ? r.json() : null))
    .then((fees) => {
      if (!fees) return;
      cityGate.querySelectorAll('.city-card').forEach((card) => {
        if (fees[card.dataset.city]) card.dataset.fee = fees[card.dataset.city];
      });
    })
    .catch(() => {});

  // Picking a city is mandatory the first time; after that, Esc / backdrop close it.
  cityGate.addEventListener('click', (e) => { if (e.target === cityGate && cityInput.value) closeCityGate(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cityGate.hidden && cityInput.value) closeCityGate();
  });

  // Greet on load — the gate sits under the preloader and is revealed as it lifts.
  openCityGate();

  /* ---------------------------------------------------------
     10. Submit → save registration → Razorpay checkout → verify → success
     --------------------------------------------------------- */
  const submitError = document.getElementById('submitError');
  let pending = null;           // { refId, keyId, order, prefill, city } once the registration is saved
  let awaitingConfirm = false;  // paid, but the server couldn't confirm yet — never offer to pay again

  const showError = (msg) => {
    submitError.textContent = msg;
    submitError.hidden = false;
    submitError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Once saved, the order amount is fixed: no going back to edit, no city change.
  const lockRegistration = () => {
    backBtn.disabled = true;
  };

  const openCheckout = () => new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      return reject(new Error('The payment window could not load. Check your connection and try again.'));
    }
    let lastFailure = '';
    const rzp = new window.Razorpay({
      key: pending.keyId,
      order_id: pending.order.id,
      amount: pending.order.amount,
      currency: pending.order.currency,
      name: 'Den Zero',
      description: `${pending.city} registration · ${pending.refId}`,
      prefill: pending.prefill,
      notes: { ref_id: pending.refId },
      theme: { color: '#001F65' },
      handler: resolve,
      modal: {
        confirm_close: true,
        ondismiss: () => reject(new Error(
          `${lastFailure ? `${lastFailure} ` : ''}Payment was not completed. Your details are saved; press Pay to try again.`
        )),
      },
    });
    // Checkout lets them retry inside the window; remember why it failed for the message.
    rzp.on('payment.failed', (r) => { lastFailure = r.error?.description || ''; });
    rzp.open();
  });

  const showSuccess = (refId, paymentId) => {
    document.getElementById('refId').textContent = refId;
    document.getElementById('payId').textContent = paymentId;
    form.hidden = true;
    document.querySelector('.progress-rail').style.opacity = '0';
    const success = document.getElementById('successScreen');
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
    indexItems.forEach((li) => { li.classList.remove('is-current'); li.classList.add('is-done'); });
    progressFill.style.width = '100%';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (awaitingConfirm) return;
    if (!cityInput.value) return openCityGate();
    if (!validateStep(current)) return;

    submitError.hidden = true;
    submitBtn.disabled = true;

    try {
      if (!pending) {
        submitLabel.textContent = 'Saving your details…';
        const res = await fetch('/api/register', { method: 'POST', body: new FormData(form) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Submission failed (${res.status}). Please try again.`);
        pending = json;
        lockRegistration();
      }

      submitLabel.textContent = 'Waiting for payment…';
      const paid = await openCheckout();

      submitLabel.textContent = 'Confirming payment…';
      const res = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paid),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        awaitingConfirm = true;
        throw new Error(json.error || 'We could not confirm your payment yet. Please do not pay again; we will confirm it automatically.');
      }
      showSuccess(json.refId, json.paymentId);
    } catch (err) {
      showError(pending ? `${err.message} Reference: ${pending.refId}.` : err.message);
    } finally {
      submitBtn.disabled = awaitingConfirm;
      if (awaitingConfirm) submitLabel.textContent = 'Payment being confirmed';
      else setPayLabel();
    }
  });

  /* boot */
  show(0);
})();

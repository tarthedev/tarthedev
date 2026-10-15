// Turns the qualifier into one question per screen and submits it without leaving the page.
(() => {
  const form = document.getElementById('quiz');
  if (!form) return;
  document.documentElement.classList.add('js');

  const steps = [...form.querySelectorAll('fieldset[data-step]')];
  const bar = form.querySelector('.progress i');
  const back = form.querySelector('.back');
  const error = form.querySelector('.error');
  const done = document.getElementById('done');
  form.elements.started_at.value = String(Date.now());
  let current = 0;

  const show = (i) => {
    current = i;
    steps.forEach((s, n) => s.classList.toggle('on', n === i));
    bar.style.width = `${(i / steps.length) * 100}%`;
    back.hidden = i === 0;
    error.hidden = true;
  };

  const fail = (msg) => {
    error.textContent = msg;
    error.hidden = false;
  };

  form.addEventListener('change', (e) => {
    if (e.target.type !== 'radio') return;
    const i = steps.indexOf(e.target.closest('fieldset'));
    if (i === current && i < steps.length - 1) setTimeout(() => show(i + 1), 180);
  });
  back.addEventListener('click', () => show(Math.max(0, current - 1)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = steps.findIndex((s) => s.querySelector('input[type=radio]') && !s.querySelector('input:checked'));
    if (missing !== -1) return show(missing);

    const { name, business, phone } = form.elements;
    if (!name.value.trim()) return fail('Please add your name.'), name.focus();
    if (!business.value.trim()) return fail('Please add your business name.'), business.focus();
    const digits = phone.value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (digits.length !== 10) return fail('Please enter a 10-digit phone number.'), phone.focus();

    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!res.ok) throw new Error(String(res.status));
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch {
      button.disabled = false;
      button.textContent = 'Send — I’ll call you';
      fail('That didn’t go through. Please call or text (252) 250-3044 instead.');
    }
  });

  show(0);
})();

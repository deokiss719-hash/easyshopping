(() => {
  'use strict';
  const form = document.getElementById('advertise-form');
  const button = document.getElementById('advertise-submit');
  const message = document.getElementById('advertise-message');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      companyName: String(data.get('companyName') || '').trim(),
      contactName: String(data.get('contactName') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      email: String(data.get('email') || '').trim(),
      adType: String(data.get('adType') || ''),
      message: String(data.get('message') || '').trim(),
      privacyConsent: data.get('privacyConsent') === 'on',
      website: String(data.get('website') || ''),
    };
    button.disabled = true;
    message.textContent = '광고문의를 접수하는 중이에요.';
    message.className = 'advertise-message';
    try {
      const response = await fetch('/api/advertising-inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('submit_failed');
      form.reset();
      message.textContent = '광고문의가 접수됐어요. 확인 후 연락드릴게요.';
      message.className = 'advertise-message success';
    } catch {
      message.textContent = '접수하지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.';
      message.className = 'advertise-message error';
    } finally { button.disabled = false; }
  });
})();

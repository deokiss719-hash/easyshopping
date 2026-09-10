(() => {
  const form = document.querySelector('#login-form');
  const message = document.querySelector('#login-message');

  fetch('/api/admin/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => { if (response.ok) window.location.replace('/admin'); })
    .catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = '';
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.querySelector('#username').value,
          password: document.querySelector('#password').value,
        }),
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
        if (response.status === 401) throw new Error('아이디 또는 비밀번호를 확인해 주세요.');
        throw new Error('로그인할 수 없어요. 잠시 후 다시 시도해 주세요.');
      }
      window.location.replace('/admin');
    } catch (error) {
      message.textContent = error.message;
      message.className = 'message error';
      button.disabled = false;
    }
  });
})();

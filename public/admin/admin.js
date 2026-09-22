(() => {
  'use strict';

  const state = {
    csrfToken: '',
    deals: [],
    fetchedMetadataUrl: '',
    formGeneration: 0,
    uploadGeneration: 0,
    uploadController: null,
    uploadPromise: null,
    savingDeal: false,
    productPage: 1,
    productTotal: 0,
    productSize: 30,
    inquiries: [],
    communityPosts: [],
    communityDeletedPosts: [],
    communityReports: [],
    communityBannedWords: [],
    communityBlocks: [],
    communitySettings: {},
  };
  const byId = (id) => document.getElementById(id);
  const normalizeHttpsUrlInput = window.AdminUrlUtils.normalizeHttpsUrlInput;

  function showMessage(id, message, kind = 'notice') {
    const element = byId(id);
    if (!element) return;
    element.textContent = message;
    element.className = `message ${kind}`;
  }

  function errorMessage(error, fallback) {
    if (error && error.message && !/^HTTP \d+$/.test(error.message)) return error.message;
    return fallback;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const method = String(options.method || 'GET').toUpperCase();
    if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
    if (response.status === 401) {
      window.location.replace('/admin/login');
      throw new Error('로그인이 만료되었습니다.');
    }
    if (!response.ok) {
      let detail = null;
      try { detail = await response.json(); } catch { /* An empty error response is valid. */ }
      throw new Error(detail?.message || detail?.error || `HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function setView(viewId) {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === viewId));
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
    byId('sidebar')?.classList.remove('open');
    byId('scrim')?.classList.remove('open');
    byId('menu-toggle')?.setAttribute('aria-expanded', 'false');
    if (viewId === 'phone-inquiries' && state.csrfToken) void loadPhoneInquiries();
    if (viewId === 'community' && state.csrfToken) void loadCommunity();
  }

  function textNode(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function priceText(value) {
    return Number.isSafeInteger(value) ? `${value.toLocaleString('ko-KR')}원` : '가격 미정';
  }

  function dealSummary(deal, compact = false) {
    const article = document.createElement('article');
    article.className = compact ? 'compact-item' : 'deal-item';
    const body = document.createElement('div');
    if (!compact) {
      body.className = 'deal-content';
      let thumbnail;
      if (isTrustedImageUrl(deal.imageUrl)) {
        thumbnail = document.createElement('img');
        thumbnail.className = 'deal-thumb';
        thumbnail.src = deal.imageUrl;
        thumbnail.alt = '';
        thumbnail.addEventListener('error', () => {
          thumbnail.replaceWith(textNode('div', '이미지 없음', 'deal-thumb deal-thumb-placeholder'));
        }, { once: true });
      } else {
        thumbnail = textNode('div', '이미지 없음', 'deal-thumb deal-thumb-placeholder');
      }
      article.append(thumbnail);
    }
    body.append(textNode('strong', deal.title || '제목 없음'));
    body.append(textNode('p', `${deal.merchant || '판매처 미정'} · ${priceText(deal.priceAmount)}`));
    const flags = [];
    flags.push(deal.isPublished ? '게시 중' : '초안');
    if (deal.showOnHome) flags.push('메인 노출');
    flags.push(`우선순위 ${Number.isSafeInteger(deal.priority) ? deal.priority : 0}`);
    body.append(textNode('span', flags.join(' · '), 'deal-meta'));
    if (!compact) {
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      const edit = textNode('button', '편집', 'button secondary');
      edit.type = 'button';
      edit.addEventListener('click', () => editDeal(deal.id));
      const remove = textNode('button', '삭제', 'text-button danger');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteDeal(deal.id));
      actions.append(edit, remove);
      body.append(actions);
    }
    article.append(body);
    return article;
  }

  function renderDeals() {
    byId('stat-total').textContent = String(state.deals.length);
    byId('stat-published').textContent = String(state.deals.filter((deal) => deal.isPublished).length);
    byId('stat-home').textContent = String(state.deals.filter((deal) => deal.isPublished && deal.showOnHome).length);
    byId('deal-count').textContent = String(state.deals.length);

    const recent = byId('recent-deals');
    const list = byId('deal-list');
    recent.replaceChildren();
    list.replaceChildren();
    if (!state.deals.length) {
      recent.append(textNode('p', '등록된 핫딜이 없습니다.', 'empty-state'));
      list.append(textNode('p', '새 핫딜을 등록해 주세요.', 'empty-state'));
      return;
    }
    state.deals.slice(0, 5).forEach((deal) => recent.append(dealSummary(deal, true)));
    state.deals.forEach((deal) => list.append(dealSummary(deal)));
  }

  async function loadDeals() {
    const data = await api('/api/admin/manual-deals');
    state.deals = Array.isArray(data?.deals) ? data.deals : [];
    renderDeals();
  }

  const inquiryTypeLabels = Object.freeze({ banner: '배너 광고', deal: '핫딜·상품 노출', partnership: '제휴·협업', other: '기타' });
  const inquiryStatusLabels = Object.freeze({ new: '신규', in_progress: '확인중', done: '처리완료' });

  function renderInquiries() {
    const list = byId('inquiry-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.inquiries.length) {
      list.append(textNode('p', '접수된 광고문의가 없습니다.', 'empty'));
      return;
    }
    state.inquiries.forEach((inquiry) => {
      const article = document.createElement('article');
      article.className = 'inquiry-item panel';
      const header = document.createElement('div');
      header.className = 'inquiry-header';
      const heading = document.createElement('div');
      heading.append(textNode('strong', inquiry.companyName || '업체명 없음'));
      heading.append(textNode('span', `${inquiryTypeLabels[inquiry.adType] || inquiry.adType} · ${new Date(inquiry.createdAt).toLocaleString('ko-KR')}`, 'deal-meta'));
      const status = document.createElement('select');
      ['new', 'in_progress', 'done'].forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = inquiryStatusLabels[value];
        option.selected = inquiry.status === value;
        status.append(option);
      });
      header.append(heading, status);
      const contact = textNode('p', `${inquiry.contactName} · ${inquiry.phone} · ${inquiry.email}`, 'inquiry-contact');
      const body = textNode('p', inquiry.message, 'inquiry-message');
      const note = document.createElement('textarea');
      note.rows = 3;
      note.maxLength = 1000;
      note.placeholder = '관리자 메모';
      note.value = inquiry.adminNote || '';
      const save = textNode('button', '상태·메모 저장', 'button primary small');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const updated = await api(`/api/admin/advertising-inquiries/${encodeURIComponent(inquiry.id)}`, {
            method: 'PATCH', body: JSON.stringify({ status: status.value, adminNote: note.value.trim() }),
          });
          Object.assign(inquiry, updated);
          showMessage('inquiries-message', '광고문의 상태를 저장했습니다.', 'success');
        } catch (error) {
          showMessage('inquiries-message', errorMessage(error, '광고문의 상태를 저장하지 못했습니다.'), 'error');
        } finally { save.disabled = false; }
      });
      article.append(header, contact, body, note, save);
      list.append(article);
    });
  }

  async function loadInquiries() {
    const data = await api('/api/admin/advertising-inquiries');
    state.inquiries = Array.isArray(data?.inquiries) ? data.inquiries : [];
    renderInquiries();
  }

  function communityAction(label, handler, className = 'button secondary small') {
    const button = textNode('button', label, className);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function renderCommunityPosts() {
    const list = byId('community-post-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.communityPosts.length) {
      list.append(textNode('p', '조건에 맞는 게시글이 없습니다.', 'empty-copy'));
      return;
    }
    state.communityPosts.forEach((post) => {
      const item = document.createElement('article');
      item.className = 'deal-item community-post-item';
      const body = document.createElement('div');
      body.className = 'deal-content';
      const title = textNode('strong', post.title);
      const meta = textNode('p', `${post.categoryName} · ${post.nickname} · 댓글 ${post.commentCount} · 조회 ${post.views} · ${new Date(post.createdAt).toLocaleString('ko-KR')}`, 'deal-meta');
      const flags = [];
      if (post.isNotice) flags.push('공지');
      if (post.isPinned) flags.push('상단 고정');
      if (post.hidden) flags.push('숨김');
      if (post.deleted) flags.push('삭제');
      if (flags.length) body.append(textNode('span', flags.join(' · '), 'deal-meta'));
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      const open = textNode('a', '게시글 보기', 'button secondary small');
      open.href = `/community/posts/${encodeURIComponent(post.id)}`;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      actions.append(open);
      if (!post.deleted) {
        actions.append(communityAction('댓글 등록', async () => {
          const data = await api(`/api/admin/community/posts/${post.id}/comments`);
          const existing = item.querySelector('.community-comment-admin');
          if (existing) { existing.remove(); return; }
          const box = document.createElement('div');
          box.className = 'community-comment-admin deal-list';
          const replyForm = document.createElement('form');
          replyForm.className = 'community-admin-reply-form';
          const replyArea = document.createElement('textarea');
          replyArea.rows = 3;
          replyArea.maxLength = 3000;
          replyArea.required = true;
          replyArea.placeholder = '관리자 댓글을 입력하세요.';
          const replyFooter = document.createElement('div');
          replyFooter.className = 'community-admin-reply-footer';
          const replyMessage = textNode('span', '', 'deal-meta community-admin-reply-message');
          const replyButton = textNode('button', '관리자 댓글 등록', 'button primary small');
          replyButton.type = 'submit';
          replyFooter.append(replyMessage, replyButton);
          replyForm.append(replyArea, replyFooter);

          const renderComments = (comments) => {
            box.replaceChildren(replyForm);
            if (!comments?.length) box.append(textNode('p', '등록된 댓글이 없습니다.', 'empty-copy'));
            const depths = new Map();
            (comments || []).forEach((comment) => {
              const depth = comment.parentCommentId ? Math.min((depths.get(comment.parentCommentId) || 0) + 1, 6) : 0;
              depths.set(comment.id, depth);
              const row = document.createElement('div');
              row.className = `compact-item community-admin-comment${comment.isAdmin ? ' admin-comment' : ''}${comment.parentCommentId ? ' reply-comment' : ''}`;
              if (depth) row.style.setProperty('--admin-reply-depth', String(depth));
              const copy = document.createElement('div');
              const label = comment.isAdmin ? '이지핫딜 관리자' : `${comment.nickname}${comment.isPostAuthor ? ' · 글쓴이' : ''}`;
              copy.append(textNode('strong', label));
              if (comment.isAdmin) copy.append(textNode('span', '관리자', 'community-admin-badge'));
              copy.append(textNode('p', comment.body, 'deal-meta'));
              if (comment.hidden || comment.deleted) copy.append(textNode('span', [comment.hidden ? '숨김' : '', comment.deleted ? '삭제' : ''].filter(Boolean).join(' · '), 'deal-meta'));
              const commentActions = document.createElement('div');
              commentActions.className = 'deal-actions';
              commentActions.append(communityAction(comment.hidden ? '숨김 해제' : '숨기기', async () => {
                await api(`/api/admin/community/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: !comment.hidden, deleted: comment.deleted }) });
                const refreshed = await api(`/api/admin/community/posts/${post.id}/comments`);
                renderComments(refreshed.comments || []);
              }));
              if (!comment.deleted) {
                commentActions.append(communityAction('대댓글 등록', async () => {
                  const existingReply = row.querySelector('.community-admin-nested-reply-form');
                  if (existingReply) { existingReply.remove(); return; }
                  const nestedForm = document.createElement('form');
                  nestedForm.className = 'community-admin-reply-form community-admin-nested-reply-form';
                  const nestedArea = document.createElement('textarea');
                  nestedArea.rows = 3;
                  nestedArea.maxLength = 3000;
                  nestedArea.required = true;
                  nestedArea.placeholder = '이 댓글에 관리자 대댓글을 입력하세요.';
                  const nestedFooter = document.createElement('div');
                  nestedFooter.className = 'community-admin-reply-footer';
                  const nestedMessage = textNode('span', '', 'deal-meta community-admin-reply-message');
                  const nestedButton = textNode('button', '대댓글 등록', 'button primary small');
                  nestedButton.type = 'submit';
                  nestedFooter.append(nestedMessage, nestedButton);
                  nestedForm.append(nestedArea, nestedFooter);
                  nestedForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const body = nestedArea.value.trim();
                    if (!body) return;
                    nestedButton.disabled = true;
                    nestedMessage.textContent = '등록 중...';
                    try {
                      await api(`/api/admin/community/posts/${post.id}/reply`, { method: 'POST', body: JSON.stringify({ body, parentCommentId: comment.id }) });
                      nestedArea.value = '';
                      nestedMessage.textContent = '대댓글이 등록됐어요. 계속 작성할 수 있어요.';
                      nestedButton.disabled = false;
                      nestedArea.focus();
                    } catch (error) {
                      nestedMessage.textContent = error.message || '대댓글 등록에 실패했어요.';
                      nestedButton.disabled = false;
                    }
                  });
                  row.append(nestedForm);
                  nestedArea.focus();
                }));
                commentActions.append(communityAction('삭제', async () => {
                  await api(`/api/admin/community/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: true, deleted: true }) });
                  const refreshed = await api(`/api/admin/community/posts/${post.id}/comments`);
                  renderComments(refreshed.comments || []);
                }, 'text-button danger'));
              }
              row.append(copy, commentActions);
              box.append(row);
            });
          };

          replyForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const body = replyArea.value.trim();
            if (!body) return;
            replyButton.disabled = true;
            replyMessage.textContent = '등록 중...';
            try {
              await api(`/api/admin/community/posts/${post.id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
              replyArea.value = '';
              replyMessage.textContent = '관리자 댓글이 등록됐어요.';
              const refreshed = await api(`/api/admin/community/posts/${post.id}/comments`);
              renderComments(refreshed.comments || []);
            } catch (error) {
              replyMessage.textContent = error.message || '댓글 등록에 실패했어요.';
            } finally {
              replyButton.disabled = false;
            }
          });

          renderComments(data.comments || []);
          item.append(box);
        }));
        actions.append(communityAction(post.hidden ? '숨김 해제' : '숨기기', async () => {
          await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: post.hidden ? 'show' : 'hide' }) });
          await loadCommunity();
        }));
        if (!post.isNotice) actions.append(communityAction(post.isPinned ? '고정 해제' : '상단 고정', async () => {
          await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: post.isPinned ? 'unpin' : 'pin' }) });
          showMessage('community-admin-message', post.isPinned ? '게시글 고정을 해제했습니다.' : '게시글을 상단에 고정했습니다.', 'success');
          await loadCommunity();
        }));
        actions.append(communityAction(post.isNotice ? '공지 삭제' : '삭제', async () => {
          if (!window.confirm(post.isNotice ? '이 공지글을 삭제할까요?' : '이 게시글을 삭제 처리할까요?')) return;
          await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'delete' }) });
          await loadCommunity();
        }, 'text-button danger'));
      } else {
        actions.append(communityAction('복구', async () => {
          await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }) });
          await loadCommunity();
        }));
      }
      if (!post.isNotice) actions.append(communityAction('사용자 차단', async () => {
        const reason = window.prompt('차단 사유를 입력하세요.', '스팸/운영정책 위반');
        if (reason == null) return;
        await api('/api/admin/community/blocks', { method: 'POST', body: JSON.stringify({ authorHash: post.authorHash, reason }) });
        showMessage('community-admin-message', '해당 익명 사용자를 차단했습니다.', 'success');
      }, 'text-button danger'));
      body.prepend(title, meta);
      body.append(actions);
      item.append(body);
      list.append(item);
    });
  }

  function renderDeletedCommunityPosts() {
    const list = byId('community-deleted-post-list');
    const count = byId('community-deleted-count');
    if (!list) return;
    list.replaceChildren();
    if (count) count.textContent = `${state.communityDeletedPosts.length}개`;
    if (!state.communityDeletedPosts.length) {
      list.append(textNode('p', '삭제된 게시글이 없습니다.', 'empty-copy'));
      return;
    }
    state.communityDeletedPosts.forEach((post) => {
      const item = document.createElement('article');
      item.className = 'deal-item community-post-item';
      const body = document.createElement('div');
      body.className = 'deal-content';
      body.append(textNode('strong', post.title));
      body.append(textNode('p', `${post.categoryName} · ${post.nickname} · 삭제 ${new Date(post.updatedAt).toLocaleString('ko-KR')}`, 'deal-meta'));
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      actions.append(communityAction('복구', async () => {
        await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }) });
        showMessage('community-admin-message', '게시글을 복구했습니다.', 'success');
        await loadCommunity();
      }));
      body.append(actions);
      item.append(body);
      list.append(item);
    });
  }

  function renderCommunityNotices() {
    const list = byId('community-notice-list');
    if (!list) return;
    list.replaceChildren();
    const notices = state.communityPosts.filter((post) => post.isNotice && !post.deleted);
    if (!notices.length) {
      list.append(textNode('p', '등록된 공지글이 없습니다.', 'empty-copy'));
      return;
    }
    notices.forEach((post) => {
      const item = document.createElement('article');
      item.className = 'compact-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', post.title));
      copy.append(textNode('p', new Date(post.createdAt).toLocaleString('ko-KR'), 'deal-meta'));
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      const open = textNode('a', '보기', 'button secondary small');
      open.href = `/community/posts/${encodeURIComponent(post.id)}`;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      actions.append(open);
      actions.append(communityAction('공지 삭제', async () => {
        if (!window.confirm('이 공지글을 삭제할까요?')) return;
        await api(`/api/admin/community/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'delete' }) });
        showMessage('community-admin-message', '공지글을 삭제했습니다.', 'success');
        await loadCommunity();
      }, 'text-button danger'));
      item.append(copy, actions);
      list.append(item);
    });
  }

  function renderCommunityReports() {
    const list = byId('community-report-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.communityReports.length) {
      list.append(textNode('p', '접수된 신고가 없습니다.', 'empty-copy'));
      return;
    }
    state.communityReports.forEach((report) => {
      const item = document.createElement('article');
      item.className = 'compact-item';
      const body = document.createElement('div');
      body.append(textNode('strong', `${report.targetType === 'post' ? '게시글' : '댓글'} #${report.targetId}`));
      body.append(textNode('p', `${report.reason} · ${new Date(report.createdAt).toLocaleString('ko-KR')}`, 'deal-meta'));
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      ['resolved', 'dismissed'].forEach((status) => actions.append(communityAction(status === 'resolved' ? '처리완료' : '기각', async () => {
        await api(`/api/admin/community/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        await loadCommunity();
      })));
      body.append(actions);
      item.append(body);
      list.append(item);
    });
  }

  function renderCommunityBannedWords() {
    const list = byId('community-banned-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.communityBannedWords.length) list.append(textNode('p', '등록된 금칙어가 없습니다.', 'empty-copy'));
    state.communityBannedWords.forEach((word) => {
      const item = document.createElement('div');
      item.className = 'compact-item';
      item.append(textNode('strong', word.word), communityAction('삭제', async () => {
        await api(`/api/admin/community/banned-words/${word.id}`, { method: 'DELETE' });
        await loadCommunity();
      }, 'text-button danger'));
      list.append(item);
    });
  }

  function renderCommunityBlocks() {
    const list = byId('community-block-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.communityBlocks.length) {
      list.append(textNode('p', '차단된 사용자가 없습니다.', 'empty-copy'));
      return;
    }
    state.communityBlocks.forEach((block) => {
      const item = document.createElement('div');
      item.className = 'compact-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', `익명 ${block.authorKey}`));
      copy.append(textNode('p', `${block.reason || '사유 없음'}${block.expiresAt ? ` · ${new Date(block.expiresAt).toLocaleString('ko-KR')}까지` : ' · 무기한'}`, 'deal-meta'));
      item.append(copy, communityAction('차단 해제', async () => {
        await api(`/api/admin/community/blocks/${encodeURIComponent(block.authorHash)}`, { method: 'DELETE' });
        await loadCommunity();
      }, 'text-button danger'));
      list.append(item);
    });
  }

  function renderCommunitySettings() {
    const values = state.communitySettings || {};
    const map = {
      'community-rank-up': values.rank_upvote_weight ?? '8',
      'community-rank-down': values.rank_downvote_weight ?? '5',
      'community-rank-comment': values.rank_comment_weight ?? '4',
      'community-rank-view': values.rank_view_weight ?? '0.125',
      'community-rank-age': values.rank_age_power ?? '0.55',
    };
    Object.entries(map).forEach(([id, value]) => { if (byId(id)) byId(id).value = value; });
  }

  async function loadCommunity() {
    const q = byId('community-post-q')?.value.trim() || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    try {
      const [posts, deletedPosts, reports, banned, blocks, settings] = await Promise.all([
        api(`/api/admin/community/posts${params.size ? `?${params}` : ''}`),
        api(`/api/admin/community/posts?deleted=only${q ? `&q=${encodeURIComponent(q)}` : ''}`),
        api('/api/admin/community/reports'),
        api('/api/admin/community/banned-words'),
        api('/api/admin/community/blocks'),
        api('/api/admin/community/settings'),
      ]);
      state.communityPosts = posts.posts || [];
      state.communityDeletedPosts = deletedPosts.posts || [];
      state.communityReports = reports.reports || [];
      state.communityBannedWords = banned.words || [];
      state.communityBlocks = blocks.blocks || [];
      state.communitySettings = settings.settings || {};
      renderCommunityNotices(); renderCommunityPosts(); renderDeletedCommunityPosts(); renderCommunityReports(); renderCommunityBannedWords(); renderCommunityBlocks(); renderCommunitySettings();
    } catch (error) {
      showMessage('community-admin-message', errorMessage(error, '커뮤니티 관리 데이터를 불러오지 못했습니다.'), 'error');
    }
  }

  const trafficSourceLabels = Object.freeze({
    direct: '직접 방문',
    internal: '사이트 내부',
    search: '검색',
    social: 'SNS',
    referral: '외부 사이트',
  });

  function referrerGroup(row) {
    const domain = String(row?.domain || '').toLowerCase();
    if (row?.source === 'direct') return '직접 방문';
    if (row?.source === 'internal') return '사이트 내부';
    if (/(^|\.)naver\.com$/.test(domain)) return '네이버';
    if (/(^|\.)google\./.test(domain)) return '구글';
    if (/(^|\.)(kakao\.com|kakaocdn\.net|daum\.net)$/.test(domain)) return '카카오·다음';
    if (/(^|\.)(instagram\.com|facebook\.com|threads\.net)$/.test(domain)) return 'Meta SNS';
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(domain)) return '유튜브';
    if (row?.source === 'search') return '기타 검색';
    if (row?.source === 'social') return '기타 SNS';
    return domain || trafficSourceLabels[row?.source] || '기타';
  }

  function summarizeReferrers(rows) {
    const grouped = new Map();
    rows.forEach((row) => {
      const label = referrerGroup(row);
      grouped.set(label, (grouped.get(label) || 0) + Number(row.visitors || 0));
    });
    const sorted = [...grouped.entries()]
      .map(([label, visitors]) => ({ label, visitors }))
      .sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label, 'ko'));
    if (sorted.length <= 5) return sorted;
    return [...sorted.slice(0, 5), { label: '기타', visitors: sorted.slice(5).reduce((sum, row) => sum + row.visitors, 0) }];
  }

  function renderReferrerSummary(list, rows, totalVisitors) {
    list.replaceChildren();
    const summary = summarizeReferrers(rows);
    if (!summary.length) {
      list.append(textNode('p', '아직 오늘 유입 기록이 없습니다.', 'empty-copy'));
      return;
    }
    summary.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'referrer-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', row.label));
      const ratio = totalVisitors ? row.visitors / totalVisitors * 100 : 0;
      copy.append(textNode('span', `${ratio.toFixed(1)}%`));
      item.append(copy, textNode('b', `${row.visitors.toLocaleString('ko-KR')}명`));
      list.append(item);
    });
  }

  function renderTrafficRows(list, rows, emptyCopy, showDetails = false) {
    list.replaceChildren();
    if (!rows.length) {
      list.append(textNode('p', emptyCopy, 'empty-copy'));
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'referrer-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', trafficSourceLabels[row.source] || '기타'));
      copy.append(textNode('span', row.domain || '주소 직접 입력·즐겨찾기'));
      if (showDetails && row.searchTerm) copy.append(textNode('span', `검색어: ${row.searchTerm}`, 'referrer-detail'));
      if (showDetails && row.referrerUrl) {
        try {
          const url = new URL(row.referrerUrl);
          if (['https:', 'http:'].includes(url.protocol)) {
            const link = textNode('a', row.referrerUrl, 'referrer-link');
            link.href = row.referrerUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            copy.append(link);
          }
        } catch { /* Invalid analytics URLs are not rendered as links. */ }
      }
      item.append(copy, textNode('b', `${Number(row.visitors || 0).toLocaleString('ko-KR')}명`));
      list.append(item);
    });
  }

  function renderTraffic(data) {
    byId('stat-visitors-today').textContent = Number(data.uniqueVisitors || 0).toLocaleString('ko-KR');
    byId('stat-pageviews-today').textContent = Number(data.pageViews || 0).toLocaleString('ko-KR');
    byId('analytics-day').textContent = `${String(data.day || '')} · 한국시간 기준`;
    const metrics = Array.isArray(data.dealMetrics) ? data.dealMetrics : [];
    const sections = metrics.filter((row) => row.section);
    const impressions = sections.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
    const clicks = sections.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
    byId('stat-impressions-today').textContent = impressions.toLocaleString('ko-KR');
    byId('stat-ctr-today').textContent = impressions ? `${(clicks / impressions * 100).toFixed(1)}%` : '0%';
    const ctaMetrics = Array.isArray(data.ctaMetrics) ? data.ctaMetrics : [];
    const ctaImpressions = ctaMetrics.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
    const ctaClicks = ctaMetrics.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
    byId('stat-kakao-clicks').textContent = ctaClicks.toLocaleString('ko-KR');
    byId('stat-kakao-ctr').textContent = ctaImpressions ? `${(ctaClicks / ctaImpressions * 100).toFixed(1)}%` : '0%';
    const kakaoPerformance = byId('kakao-performance');
    kakaoPerformance.replaceChildren();
    const placementLabels = { hero: '상단', middle: '상품 목록 중간', mobile: '모바일 고정' };
    if (!ctaMetrics.length) kakaoPerformance.append(textNode('p', '아직 오늘 카카오 버튼 기록이 없습니다.', 'empty-copy'));
    ctaMetrics.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'referrer-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', placementLabels[row.placement] || row.placement));
      copy.append(textNode('span', `노출 ${Number(row.impressions || 0).toLocaleString('ko-KR')}회`));
      item.append(copy, textNode('b', `${Number(row.clicks || 0).toLocaleString('ko-KR')}회`));
      kakaoPerformance.append(item);
    });
    const performance = byId('deal-performance');
    performance.replaceChildren();
    const deals = metrics.filter((row) => row.dealId).slice(0, 10);
    if (!deals.length) performance.append(textNode('p', '아직 오늘 상품 클릭이 없습니다.', 'empty-copy'));
    deals.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'referrer-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', row.title || `상품 ${row.dealId}`));
      copy.append(textNode('span', `${row.source || '기타'} · 노출 ${Number(row.impressions || 0).toLocaleString('ko-KR')}회`));
      item.append(copy, textNode('b', `${Number(row.clicks || 0).toLocaleString('ko-KR')}회`));
      performance.append(item);
    });
    const referrers = Array.isArray(data.referrers) ? data.referrers : [];
    const referrerDetails = Array.isArray(data.referrerDetails) ? data.referrerDetails : [];
    renderReferrerSummary(byId('referrer-breakdown'), referrers, Number(data.uniqueVisitors || 0));
    renderTrafficRows(byId('referrer-all-sites'), referrers, '아직 오늘 유입 기록이 없습니다.');
    renderTrafficRows(
      byId('referrer-details'),
      referrerDetails,
      '아직 검색어나 유입 URL 기록이 없습니다.',
      true,
    );
    const detailCount = byId('referrer-detail-count');
    if (detailCount) detailCount.textContent = `${referrers.length + referrerDetails.length}개 항목`;
  }

  async function loadTraffic() {
    const button = byId('refresh-traffic');
    if (button) button.disabled = true;
    showMessage('analytics-message', '');
    try {
      renderTraffic(await api('/api/admin/analytics/today'));
    } catch (error) {
      showMessage('analytics-message', errorMessage(error, '트래픽을 불러오지 못했습니다.'), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderDaily(rows) {
    const wrap = byId('daily-table');
    wrap.replaceChildren();
    const table = document.createElement('table');
    table.className = 'data-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['날짜', '방문자', '조회수', '상품 노출', '상품 클릭', '카카오 클릭'].forEach((label) => headRow.append(textNode('th', label)));
    head.append(headRow);
    const body = document.createElement('tbody');
    rows.slice().reverse().forEach((row) => {
      const tr = document.createElement('tr');
      [row.day, row.uniqueVisitors, row.pageViews, row.impressions, row.clicks, row.kakaoClicks]
        .forEach((value, index) => tr.append(textNode('td', index === 0 ? String(value) : Number(value || 0).toLocaleString('ko-KR'))));
      body.append(tr);
    });
    table.append(head, body);
    wrap.append(table);
  }

  async function loadDaily(event) {
    event?.preventDefault();
    const params = new URLSearchParams();
    const start = byId('daily-start')?.value;
    const end = byId('daily-end')?.value;
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    try {
      const data = await api(`/api/admin/analytics/daily${params.size ? `?${params}` : ''}`);
      if (byId('daily-start') && !start) byId('daily-start').value = data.start || '';
      if (byId('daily-end') && !end) byId('daily-end').value = data.end || '';
      renderDaily(Array.isArray(data.rows) ? data.rows : []);
    } catch (error) {
      showMessage('analytics-message', errorMessage(error, '일자별 통계를 불러오지 못했습니다.'), 'error');
    }
  }

  const sourceLabels = Object.freeze({ ppomppu: '뽐뿌', fmkorea: 'FM코리아', ruliweb: '루리웹', toss: '토스' });

  function formatDateTime(value) {
    if (!value) return '기록 없음';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '기록 없음' : date.toLocaleString('ko-KR');
  }

  function renderOperations(data) {
    const list = byId('source-status');
    list.replaceChildren();
    (Array.isArray(data.sources) ? data.sources : []).forEach((item) => {
      const card = document.createElement('article');
      card.className = 'status-card';
      card.append(textNode('strong', sourceLabels[item.source] || item.source));
      card.append(textNode('span', `활성 ${Number(item.active_count || 0).toLocaleString('ko-KR')}개 · 오늘 ${Number(item.new_today || 0).toLocaleString('ko-KR')}개`));
      card.append(textNode('span', `이미지 없음 ${Number(item.missing_images || 0).toLocaleString('ko-KR')}개`));
      card.append(textNode('span', `최근 확인 ${formatDateTime(item.last_seen_at)}`));
      const run = item.latestRun;
      card.append(textNode('span', run ? `최근 수집 ${run.status || '-'} · ${formatDateTime(run.finished_at || run.started_at)}` : '수집 기록 없음'));
      list.append(card);
    });
    const automation = byId('automation-status');
    automation.replaceChildren();
    const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
    if (!snapshots.length) automation.append(textNode('p', '아직 자동화 실행 기록이 없습니다.', 'empty-copy'));
    snapshots.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'status-card';
      const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
      card.append(textNode('strong', item.name || '자동화'));
      card.append(textNode('span', `상태 ${payload.status || payload.result || '-'}`));
      if (payload.processed != null || payload.updated != null || payload.failed != null) {
        card.append(textNode('span', `처리 ${Number(payload.processed || 0).toLocaleString('ko-KR')} · 반영 ${Number(payload.updated || 0).toLocaleString('ko-KR')} · 실패 ${Number(payload.failed || 0).toLocaleString('ko-KR')}`));
      }
      card.append(textNode('span', `최근 보고 ${formatDateTime(item.reported_at)}`));
      automation.append(card);
    });
  }

  function productStateText(product) {
    if (product.is_hidden) return '숨김';
    if (product.admin_ended) return '관리자 종료';
    if (product.source_ended) return '수집 종료';
    return '노출 중';
  }

  function productRow(product) {
    const article = document.createElement('article');
    article.className = 'operation-product';
    const copy = document.createElement('div');
    copy.className = 'operation-copy';
    copy.append(textNode('strong', product.title || '제목 없음'));
    copy.append(textNode('span', `${sourceLabels[product.source] || product.source} · ${priceText(product.price_amount)} · ${productStateText(product)}`));
    copy.append(textNode('span', `최근 확인 ${formatDateTime(product.last_seen_at)}`));
    const actions = document.createElement('div');
    actions.className = 'deal-actions';
    const hide = textNode('button', product.is_hidden ? '숨김 해제' : '숨기기', 'button secondary small');
    hide.type = 'button';
    hide.addEventListener('click', () => moderateProduct(product.id, product.is_hidden ? 'unhide' : 'hide'));
    const end = textNode('button', product.admin_ended ? '종료 해제' : '종료', product.admin_ended ? 'button secondary small' : 'button danger small');
    end.type = 'button';
    end.addEventListener('click', () => moderateProduct(product.id, product.admin_ended ? 'restore' : 'end'));
    actions.append(hide, end);
    article.append(copy, actions);
    return article;
  }

  async function loadProducts({ resetPage = false } = {}) {
    if (resetPage) state.productPage = 1;
    const params = new URLSearchParams({ page: String(state.productPage) });
    const q = byId('product-q')?.value.trim();
    const source = byId('product-source')?.value;
    const status = byId('product-status')?.value;
    if (q) params.set('q', q);
    if (source) params.set('source', source);
    if (status) params.set('status', status);
    const data = await api(`/api/admin/products?${params}`);
    state.productTotal = Number(data.total || 0);
    state.productSize = Number(data.size || 30);
    const list = byId('product-results');
    list.replaceChildren();
    const products = Array.isArray(data.products) ? data.products : [];
    if (!products.length) list.append(textNode('p', '조건에 맞는 상품이 없습니다.', 'empty-copy'));
    products.forEach((product) => list.append(productRow(product)));
    byId('product-count').textContent = `총 ${state.productTotal.toLocaleString('ko-KR')}개`;
    byId('product-page').textContent = `${state.productPage.toLocaleString('ko-KR')}페이지`;
    byId('product-prev').disabled = state.productPage <= 1;
    byId('product-next').disabled = state.productPage * state.productSize >= state.productTotal;
  }

  async function moderateProduct(id, action) {
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action }) });
      await Promise.all([loadProducts(), loadOperations()]);
      showMessage('operations-message', '상품 상태를 반영했습니다.', 'success');
    } catch (error) {
      showMessage('operations-message', errorMessage(error, '상품 상태를 변경하지 못했습니다.'), 'error');
    }
  }

  async function loadOperations() {
    const button = byId('refresh-operations');
    if (button) button.disabled = true;
    try {
      renderOperations(await api('/api/admin/operations'));
    } catch (error) {
      showMessage('operations-message', errorMessage(error, '수집 상태를 불러오지 못했습니다.'), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? '' : String(value);
  }

  function updateSaveControl() {
    const button = byId('save-deal');
    if (button) button.disabled = state.savingDeal || state.uploadPromise !== null;
  }

  function clearImagePreview() {
    const preview = byId('image-preview');
    if (!preview) return;
    preview.removeAttribute('src');
    preview.hidden = true;
  }

  function isTrustedImageUrl(value) {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  function showExistingImagePreview(value) {
    clearImagePreview();
    if (!isTrustedImageUrl(value)) return;
    const preview = byId('image-preview');
    preview.src = value;
    preview.hidden = false;
  }

  function invalidateUpload() {
    state.formGeneration += 1;
    state.uploadGeneration += 1;
    state.uploadController?.abort();
    state.uploadController = null;
    state.uploadPromise = null;
    updateSaveControl();
  }

  function resetForm() {
    invalidateUpload();
    byId('deal-form').reset();
    setValue('deal-id', '');
    setValue('priority', 0);
    setValue('category', '디지털/가전');
    byId('form-title').textContent = '새 핫딜 등록';
    byId('cancel-edit').classList.add('hidden');
    state.fetchedMetadataUrl = '';
    clearImagePreview();
    byId('image-upload-status').textContent = '이미지를 선택하면 안전한 WebP 파일로 업로드합니다. (최대 10 MiB)';
    byId('metadata-message').textContent = 'HTTPS 상품 URL을 입력하면 제목, 가격, 이미지 등을 자동으로 채워요.';
  }

  function editDeal(id) {
    const deal = state.deals.find((item) => String(item.id) === String(id));
    if (!deal) return;
    invalidateUpload();
    setView('phone-deals');
    setValue('deal-id', deal.id);
    setValue('metadata-url', deal.productUrl);
    setValue('target-url', deal.productUrl);
    setValue('title', deal.title);
    setValue('current-price', deal.priceAmount);
    setValue('original-price', deal.originalPriceAmount);
    setValue('image-url', deal.imageUrl);
    showExistingImagePreview(deal.imageUrl);
    setValue('merchant', deal.merchant);
    setValue('category', deal.category || '디지털/가전');
    setValue('description', deal.description);
    setValue('priority', Number.isSafeInteger(deal.priority) ? deal.priority : 0);
    byId('is-published').checked = deal.isPublished === true;
    byId('show-on-home').checked = deal.showOnHome === true;
    byId('form-title').textContent = '핫딜 편집';
    byId('cancel-edit').classList.remove('hidden');
    state.fetchedMetadataUrl = deal.productUrl || '';
    byId('deal-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function parsePrice(id) {
    const raw = byId(id).value.trim();
    if (!raw) return null;
    const value = Number(raw.replaceAll(',', ''));
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('가격은 0 이상의 정수로 입력해 주세요.');
    return value;
  }

  function formPayload() {
    const priority = Number(byId('priority').value);
    if (!Number.isSafeInteger(priority)) throw new TypeError('우선순위는 정수로 입력해 주세요.');
    const productUrl = normalizeHttpsUrlInput(byId('target-url').value);
    setValue('target-url', productUrl);
    return {
      title: byId('title').value.trim(),
      productUrl,
      imageUrl: byId('image-url').value.trim() || null,
      merchant: byId('merchant').value.trim() || null,
      priceAmount: parsePrice('current-price'),
      originalPriceAmount: parsePrice('original-price'),
      description: byId('description').value.trim() || null,
      category: byId('category').value,
      isPublished: byId('is-published').checked,
      showOnHome: byId('show-on-home').checked,
      priority,
    };
  }

  async function fetchMetadata({ quiet = false } = {}) {
    const url = normalizeHttpsUrlInput(byId('metadata-url').value);
    setValue('metadata-url', url);
    if (!url) {
      if (!quiet) byId('metadata-message').textContent = '상품 URL을 입력해 주세요.';
      return false;
    }
    const button = byId('metadata-fetch');
    button.disabled = true;
    byId('metadata-message').textContent = '상품 정보를 가져오는 중입니다…';
    try {
      const data = await api('/api/admin/url-metadata', { method: 'POST', body: JSON.stringify({ url }) });
      if (data.title) setValue('title', data.title);
      if (data.priceAmount != null) setValue('current-price', data.priceAmount);
      if (data.imageUrl) setValue('image-url', data.imageUrl);
      if (data.merchant) setValue('merchant', data.merchant);
      setValue('target-url', data.productUrl || url);
      state.fetchedMetadataUrl = url;
      byId('metadata-message').textContent = '상품 정보를 가져왔습니다. 내용을 확인해 주세요.';
      return true;
    } catch (error) {
      state.fetchedMetadataUrl = '';
      byId('metadata-message').textContent = errorMessage(error, '상품 정보를 가져오지 못했습니다.');
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function uploadImage() {
    const input = byId('image-file');
    const file = input.files?.[0];
    if (!file) return;

    state.uploadController?.abort();
    const formGeneration = state.formGeneration;
    const uploadGeneration = ++state.uploadGeneration;
    const controller = new AbortController();
    state.uploadController = controller;

    const preview = byId('image-preview');
    clearImagePreview();
    setValue('image-url', '');
    byId('image-upload-status').textContent = '이미지를 업로드하는 중입니다…';

    let uploadPromise;
    try {
      uploadPromise = api('/api/admin/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
        signal: controller.signal,
      });
      state.uploadPromise = uploadPromise;
      updateSaveControl();
      const data = await uploadPromise;
      if (state.formGeneration !== formGeneration || state.uploadGeneration !== uploadGeneration || controller.signal.aborted) return;
      if (!isTrustedImageUrl(data?.imageUrl)) throw new Error('서버가 안전한 이미지 URL을 반환하지 않았습니다.');
      setValue('image-url', data.imageUrl);
      preview.src = data.imageUrl;
      preview.hidden = false;
      byId('image-upload-status').textContent = '이미지를 업로드했습니다.';
    } catch (error) {
      if (state.formGeneration === formGeneration && state.uploadGeneration === uploadGeneration && !controller.signal.aborted) {
        byId('image-upload-status').textContent = errorMessage(error, '이미지를 업로드하지 못했습니다.');
      }
    } finally {
      if (state.formGeneration === formGeneration && state.uploadGeneration === uploadGeneration && state.uploadPromise === uploadPromise) {
        state.uploadController = null;
        state.uploadPromise = null;
        updateSaveControl();
      }
    }
  }

  async function saveDeal(event) {
    event.preventDefault();
    const formGeneration = state.formGeneration;
    const uploadGeneration = state.uploadGeneration;
    state.savingDeal = true;
    updateSaveControl();
    try {
      if (state.uploadPromise) await state.uploadPromise;
      if (state.formGeneration !== formGeneration || state.uploadGeneration !== uploadGeneration) return;
      const id = byId('deal-id').value;
      const payload = formPayload();
      await api(id ? `/api/admin/manual-deals/${encodeURIComponent(id)}` : '/api/admin/manual-deals', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      resetForm();
      await loadDeals();
      showMessage('status-message', id ? '핫딜을 수정했습니다.' : '새 핫딜을 등록했습니다.', 'success');
    } catch (error) {
      showMessage('status-message', errorMessage(error, '핫딜을 저장하지 못했습니다.'), 'error');
    } finally {
      state.savingDeal = false;
      updateSaveControl();
    }
  }

  async function deleteDeal(id) {
    const deal = state.deals.find((item) => String(item.id) === String(id));
    if (!deal || !window.confirm(`“${deal.title}” 핫딜을 삭제할까요?`)) return;
    invalidateUpload();
    try {
      await api(`/api/admin/manual-deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (byId('deal-id').value === String(id)) resetForm();
      await loadDeals();
      showMessage('status-message', '핫딜을 삭제했습니다.', 'success');
    } catch (error) {
      showMessage('status-message', errorMessage(error, '핫딜을 삭제하지 못했습니다.'), 'error');
    }
  }

  async function loadSettings() {
    const settings = await api('/api/admin/settings');
    setValue('setting-home-limit', settings.home_manual_limit ?? 4);
    setValue('setting-searches', Array.isArray(settings.recommended_searches) ? settings.recommended_searches.join(', ') : '');
    setValue('setting-main-copy', settings.main_copy);
    setValue('setting-phone-title', settings.phone_section_title);
    setValue('setting-admin-note', settings.admin_note);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const values = {
      home_manual_limit: Number(byId('setting-home-limit').value),
      recommended_searches: byId('setting-searches').value.split(',').map((value) => value.trim()).filter(Boolean),
      main_copy: byId('setting-main-copy').value.trim(),
      phone_section_title: byId('setting-phone-title').value.trim(),
      admin_note: byId('setting-admin-note').value.trim(),
    };
    const button = byId('save-settings');
    button.disabled = true;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
      showMessage('settings-message', '사이트 설정을 저장했습니다.', 'success');
    } catch (error) {
      showMessage('settings-message', errorMessage(error, '설정을 저장하지 못했습니다.'), 'error');
    } finally {
      button.disabled = false;
    }
  }


  const phoneStatuses = {new:'신규',consulting:'상담 중',reserved:'방문 예약',completed:'개통 완료',absent:'부재중',closed:'상담 종료'};
  let phoneRows=[];
  function renderPhoneInquiries(){
    const list=byId('phone-inquiry-list');list.replaceChildren();
    const counts=Object.keys(phoneStatuses).map(k=>`${phoneStatuses[k]} ${phoneRows.filter(r=>r.status===k).length}건`);byId('phone-summary').textContent=counts.join(' · ')+' (최근 500건, 최대 90일)';
    const days=new Map();for(const row of phoneRows){const day=new Date(row.created_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});const count=days.get(day)||{all:0,reserved:0,completed:0};count.all++;if(row.status==='reserved')count.reserved++;if(row.status==='completed')count.completed++;days.set(day,count);}
    const daily=byId('phone-daily');daily.replaceChildren();for(const [day,count] of days){daily.append(textNode('p',`${day} 접수 ${count.all}건 · 현재 방문 예약 ${count.reserved}건 · 개통 완료 ${count.completed}건`));}
    const rows=phoneRows.filter(r=>!byId('phone-status-filter').value||r.status===byId('phone-status-filter').value);
    if(!rows.length)list.append(textNode('p','해당 상담이 없습니다.'));
    for(const r of rows){const card=textNode('article','','panel');card.append(textNode('h3',r.model),textNode('p',`${new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · ${r.id}`),textNode('p',`${r.carrier} · ${r.change_type} · ${r.method==='phone'?'전화 상담':(r.status==='new'?'카카오 상담 시작 미확인 — 채널에서 견적번호 확인':'카카오 상담')}`));
      if(r.phone){const a=textNode('a',r.phone+' 전화 걸기');a.href='tel:'+r.phone;card.append(a,textNode('p','통화 가능: '+r.preferred_time));}
      const select=document.createElement('select');select.setAttribute('aria-label','상담 상태');for(const [value,label] of Object.entries(phoneStatuses)){const o=textNode('option',label);o.value=value;select.append(o);}select.value=r.status;
      const note=document.createElement('textarea');note.value=r.admin_note;note.maxLength=2000;note.rows=3;note.placeholder='상담 메모';note.setAttribute('aria-label','상담 메모');
      const save=textNode('button','상태·메모 저장','button primary');save.type='button';save.onclick=async()=>{save.disabled=true;try{const updated=await api('/api/admin/phone-inquiries/'+r.id,{method:'PATCH',body:JSON.stringify({status:select.value,note:note.value})});Object.assign(r,updated);showMessage('phone-admin-message','저장했습니다.','success');}catch(e){showMessage('phone-admin-message',e.message,'error');}finally{save.disabled=false;}};
      const remove=textNode('button','문의 삭제','button secondary');remove.type='button';remove.onclick=async()=>{if(!confirm('이 상담 문의와 개인정보를 삭제할까요?'))return;try{await api('/api/admin/phone-inquiries/'+r.id,{method:'DELETE'});phoneRows=phoneRows.filter(x=>x.id!==r.id);renderPhoneInquiries();}catch(e){showMessage('phone-admin-message',e.message,'error');}};
      card.append(select,note,save,remove);list.append(card);
    }
  }
  async function loadPhoneInquiries(){try{const data=await api('/api/admin/phone-inquiries');phoneRows=data.inquiries;renderPhoneInquiries();const settings=await api('/api/admin/settings');byId('phone-channel-url').value=(settings.settings||settings).phone_consultation_url||'';}catch(e){showMessage('phone-admin-message',e.message,'error');}}

  async function logout() {
    try { await api('/api/admin/auth/logout', { method: 'POST' }); } finally { window.location.replace('/admin/login'); }
  }

  function bindEvents() {
    byId('refresh-phone').addEventListener('click',loadPhoneInquiries);
    byId('phone-status-filter').addEventListener('change',renderPhoneInquiries);
    byId('phone-channel-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({values:{phone_consultation_url:byId('phone-channel-url').value.trim()}})});showMessage('phone-admin-message','카카오 상담 주소를 저장했습니다.','success');}catch(err){showMessage('phone-admin-message',err.message,'error');}});
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
    document.querySelectorAll('[data-open-deals]').forEach((button) => button.addEventListener('click', () => setView('phone-deals')));
    byId('new-deal').addEventListener('click', () => { resetForm(); setView('phone-deals'); byId('title').focus(); });
    byId('cancel-edit').addEventListener('click', resetForm);
    byId('deal-form').addEventListener('submit', saveDeal);
    byId('metadata-fetch').addEventListener('click', () => fetchMetadata());
    byId('image-file').addEventListener('change', uploadImage);
    byId('metadata-url').addEventListener('input', () => { state.fetchedMetadataUrl = ''; });
    byId('metadata-url').addEventListener('change', () => { if (byId('metadata-url').checkValidity()) fetchMetadata({ quiet: true }); });
    byId('settings-form')?.addEventListener('submit', saveSettings);
    byId('refresh-traffic')?.addEventListener('click', loadTraffic);
    byId('daily-filter')?.addEventListener('submit', loadDaily);
    byId('refresh-operations')?.addEventListener('click', () => Promise.all([loadOperations(), loadProducts()]));
    byId('product-filter')?.addEventListener('submit', (event) => { event.preventDefault(); loadProducts({ resetPage: true }); });
    byId('product-prev')?.addEventListener('click', () => { if (state.productPage > 1) { state.productPage -= 1; loadProducts(); } });
    byId('product-next')?.addEventListener('click', () => { if (state.productPage * state.productSize < state.productTotal) { state.productPage += 1; loadProducts(); } });
    byId('refresh-inquiries')?.addEventListener('click', loadInquiries);
    byId('refresh-community')?.addEventListener('click', loadCommunity);
    byId('community-post-filter')?.addEventListener('submit', (event) => { event.preventDefault(); loadCommunity(); });
    byId('community-notice-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/community/posts/notice', { method: 'POST', body: JSON.stringify({ title: byId('community-notice-title').value.trim(), body: byId('community-notice-body').value.trim() }) });
        event.currentTarget.reset();
        showMessage('community-admin-message', '공지글을 등록했습니다.', 'success');
        await loadCommunity();
      } catch (error) { showMessage('community-admin-message', errorMessage(error, '공지글을 등록하지 못했습니다.'), 'error'); }
    });
    byId('community-banned-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/community/banned-words', { method: 'POST', body: JSON.stringify({ word: byId('community-banned-word').value.trim() }) });
        event.currentTarget.reset(); await loadCommunity();
      } catch (error) { showMessage('community-admin-message', errorMessage(error, '금칙어를 추가하지 못했습니다.'), 'error'); }
    });
    byId('community-settings-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = {
        rank_upvote_weight: byId('community-rank-up').value,
        rank_downvote_weight: byId('community-rank-down').value,
        rank_comment_weight: byId('community-rank-comment').value,
        rank_view_weight: byId('community-rank-view').value,
        rank_age_power: byId('community-rank-age').value,
        consultation_url: byId('community-consultation-url').value.trim(),
      };
      try {
        const result = await api('/api/admin/community/settings', { method: 'PUT', body: JSON.stringify(values) });
        state.communitySettings = result.settings || {};
        renderCommunitySettings();
        showMessage('community-admin-message', '커뮤니티 설정을 저장했습니다.', 'success');
      } catch (error) { showMessage('community-admin-message', errorMessage(error, '커뮤니티 설정을 저장하지 못했습니다.'), 'error'); }
    });
    byId('logout').addEventListener('click', logout);
    byId('menu-toggle').addEventListener('click', () => {
      const open = !byId('sidebar').classList.contains('open');
      byId('sidebar').classList.toggle('open', open);
      byId('scrim').classList.toggle('open', open);
      byId('menu-toggle').setAttribute('aria-expanded', String(open));
    });
    byId('scrim').addEventListener('click', () => {
      byId('sidebar').classList.remove('open');
      byId('scrim').classList.remove('open');
      byId('menu-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  async function start() {
    bindEvents();
    try {
      const session = await api('/api/admin/auth/session');
      state.csrfToken = session.csrfToken;
      byId('admin-user').textContent = session.username || '';
      await Promise.all([loadDeals(), loadSettings(), loadTraffic(), loadDaily(), loadOperations(), loadProducts(), loadInquiries(), loadCommunity()]);
      window.setInterval(() => {
        const replyEditorOpen = Boolean(document.querySelector('#community-post-list .community-admin-reply-form'));
        if (!document.hidden && byId('community')?.classList.contains('active') && !replyEditorOpen) void loadCommunity();
      }, 15000);
    } catch (error) {
      showMessage('status-message', errorMessage(error, '관리자 데이터를 불러오지 못했습니다.'), 'error');
    }
  }

  start();
})();

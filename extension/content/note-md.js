/**
 * 视频笔记 iframe（/fcb/videoedit）：在「分享」后加入「下载MD」，
 * 把「以下为AI生成的图文笔记的内容」及其后的正文导出为 Markdown。
 */
(function () {
  'use strict';

  const MARKER = '以下为AI生成的图文笔记的内容';
  const BUTTON_ATTR = 'data-panrelay-md';

  let enabled = true;
  let timer = 0;

  chrome.storage.sync.get({ noteMdExportEnabled: true }, (stored) => {
    enabled = stored.noteMdExportEnabled !== false;
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.noteMdExportEnabled) return;
    enabled = changes.noteMdExportEnabled.newValue !== false;
    schedule();
  });

  function schedule() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      realize();
    }, 200);
  }

  function realize() {
    const existing = document.querySelector(`[${BUTTON_ATTR}]`);
    if (!enabled) {
      if (existing) existing.remove();
      return;
    }
    const share = findShareLabel();
    if (!share || !share.parentNode) return;
    let button = existing;
    if (!button) {
      button = buildButton(share);
      button.addEventListener('click', onDownloadClick);
    }
    if (button.previousElementSibling !== share) {
      share.parentNode.insertBefore(button, share.nextSibling);
    }
  }

  function findShareLabel() {
    const nodes = document.querySelectorAll('.footer-right .text');
    for (const node of nodes) {
      if (node.textContent.trim() !== '分享') continue;
      return node.closest('.label') || node.parentElement;
    }
    return null;
  }

  function scopedName(el) {
    return [...el.attributes].find((attr) => attr.name.startsWith('data-v-'))?.name || '';
  }

  function buildButton(share) {
    const scope = scopedName(share);
    const button = document.createElement('div');
    button.className = share.className || 'label label-hover';
    button.setAttribute(BUTTON_ATTR, '1');
    button.title = '下载 AI 图文笔记 Markdown';
    if (scope) button.setAttribute(scope, '');
    button.innerHTML =
      '<span class="icon" aria-hidden="true">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2.5h5.2L12.5 5.8V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" stroke="var(--note-editor-text-color)" stroke-width="1.3"/>' +
      '<path d="M9 2.7V6h3.2M5.2 8.2h5.6M5.2 10.4h5.6" stroke="var(--note-editor-text-color)" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg></span><span class="text">下载MD</span>';
    if (scope) {
      button.querySelectorAll('span').forEach((span) => span.setAttribute(scope, ''));
    }
    return button;
  }

  function onDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const label = button.querySelector('.text');
    try {
      const markdown = buildMarkdown();
      if (!markdown.trim()) {
        flash(label, '没有笔记');
        return;
      }
      download(filename(), markdown);
      flash(label, '已下载');
    } catch (error) {
      flash(label, '导出失败');
      console.info('[PanRelay] 笔记导出失败', error);
    }
  }

  function flash(label, text) {
    if (!label) return;
    label.textContent = text;
    window.setTimeout(() => {
      if (label.isConnected) label.textContent = '下载MD';
    }, 1600);
  }

  function filename() {
    const title = document.querySelector('.note-doc-editor-title')?.value?.trim();
    const base = (title || '图文笔记').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    return `${base || '图文笔记'}.md`;
  }

  function buildMarkdown() {
    const editor = document.querySelector('.ql-editor');
    if (!editor) throw new Error('找不到笔记正文');
    const blocks = [...editor.children];
    const start = blocks.findIndex((el) => (el.textContent || '').includes(MARKER));
    const slice = start >= 0 ? blocks.slice(start) : blocks;
    const parts = [];
    const title = document.querySelector('.note-doc-editor-title')?.value?.trim();
    if (title) parts.push(`# ${title}`);
    slice.forEach((block) => {
      const line = blockToMd(block);
      if (line) parts.push(line);
    });
    return `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  }

  function inlineText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.classList.contains('ql-ui')) return '';
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') return imageMarkdown(node);
    const inner = [...node.childNodes].map(inlineText).join('');
    if (tag === 'STRONG' || tag === 'B') return wrapMark(inner, '**');
    if (tag === 'EM' || tag === 'I') return wrapMark(inner, '*');
    if (tag === 'A') {
      const href = node.getAttribute('href');
      const text = inner.trim();
      return href ? `[${text || href}](${href})` : inner;
    }
    return inner;
  }

  function wrapMark(text, mark) {
    const trimmed = text.trim();
    if (!trimmed) return text;
    return `${mark}${trimmed}${mark}`;
  }

  function imageMarkdown(img) {
    const src = img.getAttribute('src') || '';
    const name = img.getAttribute('data-path') || img.getAttribute('alt') || '图片';
    if (/^https?:/i.test(src)) return `![${name}](${src})`;
    return name ? `[图片: ${name}]` : '';
  }

  function blockToMd(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.classList.contains('ql-divider')) return '---';
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      return `${'#'.repeat(Number(tag[1]))} ${collapse(inlineText(el))}`;
    }
    if (tag === 'P') return collapse(inlineText(el));
    if (tag === 'UL' || tag === 'OL' || el.classList.contains('ql-list-container')) {
      const ordered = tag === 'OL' || el.getAttribute('list-type') === 'ordered';
      const items = [...el.children].filter(
        (child) => child.tagName === 'LI' || child.classList.contains('ql-list-item'),
      );
      return items
        .map((item, index) => {
          const prefix = ordered ? `${index + 1}. ` : '- ';
          return prefix + collapse(inlineText(item));
        })
        .filter((line) => line.trim() !== '-' && !/^\d+\.\s*$/.test(line.trim()))
        .join('\n');
    }
    if (el.classList.contains('ql-table-embed')) {
      const cells = [...el.querySelectorAll('.ql-table-embed-cell-content')];
      return cells
        .map((cell) => collapse(inlineText(cell)))
        .filter(Boolean)
        .join('\n\n');
    }
    if (tag === 'IMG') return imageMarkdown(el);
    const nested = [...el.children].map(blockToMd).filter(Boolean);
    if (nested.length) return nested.join('\n\n');
    return collapse(inlineText(el));
  }

  function collapse(text) {
    return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();

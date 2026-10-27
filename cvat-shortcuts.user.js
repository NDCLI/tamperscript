// ==UserScript==
// @name         CVAT - khóa zoom, Switch label nhanh và Edit mask
// @namespace    cvat-internal-shortcuts
// @version      1.7.1
// @description  Khóa zoom, đổi nhãn, Edit mask, chỉnh brush; chặn chọn chữ/menu ngoài ô nhập, giữ Alt để copy
// @match        http://10.43.2.147:8080/*
// @match        http://10.43.2.12:8080/*
// @match        https://app.cvat.ai/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/NDCLI/tamperscript/main/cvat-shortcuts.user.js
// @downloadURL  https://raw.githubusercontent.com/NDCLI/tamperscript/main/cvat-shortcuts.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Chỉ chạy trên hai server nội bộ và CVAT Online.
  if (![
    'http://10.43.2.147:8080',
    'http://10.43.2.12:8080',
    'https://app.cvat.ai',
  ].includes(location.origin)) return;

  const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  let switchingLicenseplate = false;

  function isEditing(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      Boolean(target.closest('input, textarea, select, [role="textbox"]'))
    );
  }

  // Chặn chọn chữ vô tình trên CVAT; giữ Alt để chọn chữ và mở menu copy.
  const COPY_MODE_CLASS = 'cvat-shortcuts-copy-mode';
  function setCopyMode(enabled) {
    document.documentElement?.classList.toggle(COPY_MODE_CLASS, enabled);
  }

  function installSelectionGuard() {
    const style = document.createElement('style');
    style.textContent = `
      html:not(.${COPY_MODE_CLASS}), html:not(.${COPY_MODE_CLASS}) * {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      html:not(.${COPY_MODE_CLASS}) :is(input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])),
      html:not(.${COPY_MODE_CLASS}) :is([role="textbox"], [contenteditable]:not([contenteditable="false"])) *,
      html.${COPY_MODE_CLASS}, html.${COPY_MODE_CLASS} * {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `;
    document.documentElement.appendChild(style);
  }
  if (document.documentElement) installSelectionGuard();
  else document.addEventListener('DOMContentLoaded', installSelectionGuard, { once: true });

  window.addEventListener('keydown', (event) => {
    setCopyMode(event.altKey || event.key === 'Alt');
    // Giữ Ctrl+A trong ô nhập; ngoài ô nhập không chọn toàn bộ chữ trên trang.
    if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      (event.code === 'KeyA' || event.key.toLowerCase() === 'a') &&
      !isEditing(event.target)) event.preventDefault();
  }, true);
  window.addEventListener('keyup', (event) => {
    setCopyMode(event.altKey && event.key !== 'Alt');
  }, true);
  window.addEventListener('blur', () => setCopyMode(false));

  window.addEventListener('selectstart', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!document.documentElement?.classList.contains(COPY_MODE_CLASS) &&
      !isEditing(target)) event.preventDefault();
  }, true);

  window.addEventListener('contextmenu', (event) => {
    if (!event.altKey && !isEditing(event.target)) event.preventDefault();
    // Không chặn propagation: CVAT vẫn nhận chuột phải để thao tác annotation.
  }, true);

  function isVisible(element) {
    return Boolean(
      element &&
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden'
    );
  }

  // Nhấp đúp chuột trái trên mask -> Shift + nhấp đúp mặc định của CVAT.
  window.addEventListener('dblclick', (event) => {
    if (
      event.button !== 0 ||
      event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
      !(event.target instanceof Element)
    ) return;

    // CVAT vẽ mask bằng SVG <image>; không áp dụng cho polygon/rectangle.
    const mask = event.target.closest('image.cvat_canvas_shape');
    if (
      !mask ||
      mask.namespaceURI !== 'http://www.w3.org/2000/svg' ||
      !mask.closest('#cvat_canvas_content, #cvat_canvas_masks_content')
    ) return;

    try {
      // Giữ nguyên sự kiện và tọa độ; để CVAT tự xử lý Edit mask.
      Object.defineProperty(event, 'shiftKey', {
        value: true,
        configurable: true,
      });
    } catch (error) {
      console.warn('[CVAT] Không chuyển được nhấp đúp sang Edit mask:', error);
    }
  }, true);

  // Ctrl hoặc Shift + lăn lên tăng 2; lăn xuống giảm 5.
  const BRUSH_WHEEL_INCREASE = 2;
  const BRUSH_WHEEL_DECREASE = 5;

  // Ctrl/Shift + lăn: chỉnh brush khi toolbox mở; Ctrl luôn chặn zoom.
  window.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.shiftKey) return;

    if (event.ctrlKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    if (
      event.altKey || event.metaKey ||
      event.deltaY === 0 ||
      !(event.target instanceof Element) ||
      !event.target.closest('#cvat_canvas_wrapper, .cvat-brush-tools-toolbox')
    ) return;

    const toolbox = [...document.querySelectorAll('.cvat-brush-tools-toolbox')]
      .find(isVisible);
    const input = toolbox?.querySelector(
      '.cvat-brush-tools-brush-size input'
    );

    if (
      !(input instanceof HTMLInputElement) ||
      !isVisible(input) || input.disabled || input.readOnly
    ) return;

    // Shift chỉ chặn cuộn khi đang có ô chỉnh brush dùng được.
    if (!event.ctrlKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const current = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(current)) return;

    const minimum = Number(input.getAttribute('aria-valuemin') ?? input.min);
    const maximumText = input.getAttribute('aria-valuemax') ?? input.max;
    const maximum = maximumText ? Number(maximumText) : Infinity;
    const lower = Number.isFinite(minimum) ? Math.max(1, minimum) : 1;
    const upper = Number.isFinite(maximum) ? maximum : Infinity;
    const adjustment = event.deltaY < 0 ? BRUSH_WHEEL_INCREASE : -BRUSH_WHEEL_DECREASE;
    const next = Math.min(upper, Math.max(lower,
      Math.round(current) + adjustment
    ));

    if (next === current) return;

    // Đi qua ô Brush size để React/CVAT cập nhật kích thước brush thật.
    setNativeValue(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { capture: true, passive: false });

    // Hotstring "tr=" -> "licenseplate" + Enter (thay cho AHK)
  const TRIGGER = 'tr=';
  const REPLACEMENT = 'licenseplate';
  const TEXT_FIELD =
    'input:not([type]), input[type="text"], input[type="search"], textarea';

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function pressEnter(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  document.addEventListener(
    'input',
    (event) => {
      if (event.inputType !== 'insertText') return;

      const el = event.target;
      if (!(el instanceof Element) || !el.matches(TEXT_FIELD)) return;

      const caret = el.selectionStart;
      if (caret === null) return;

      const start = caret - TRIGGER.length;
      if (start < 0) return;
      if (el.value.slice(start, caret).toLowerCase() !== TRIGGER) return;

      setNativeValue(
        el,
        el.value.slice(0, start) + REPLACEMENT + el.value.slice(caret)
      );
      const end = start + REPLACEMENT.length;
      el.setSelectionRange(end, end);
      el.dispatchEvent(new Event('input', { bubbles: true }));

      setTimeout(() => pressEnter(el), 0);
    },
    true
  );
    function findDropdown(input) {
    const listId =
      input.getAttribute('aria-controls') ||
      input.getAttribute('aria-owns');

    if (!listId) return null;

    for (const id of listId.split(/\s+/)) {
      const dropdown = document.getElementById(id)
        ?.closest('.ant-select-dropdown');

      if (isVisible(dropdown)) return dropdown;
    }

    return null;
  }

  function setSearch(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;

    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function closeSearch(input) {
    if (!input?.isConnected) return;

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }));

    input.blur();
  }

  // Đổi nhãn của object đang chọn thành licenseplate.
  async function switchActiveObjectToLabel(labelName) {
    if (switchingLicenseplate) return;

    const activeObjects = document.querySelectorAll(
      '.cvat-objects-sidebar-state-active-item'
    );

    // Không chọn tùy tiện nếu không xác định được một object duy nhất.
    if (activeObjects.length !== 1) {
      console.warn('[CVAT] Hãy chọn một object trong tab Objects.');
      return;
    }

    const activeObject = activeObjects[0];
    const selector = activeObject.querySelector(
      '.cvat-objects-sidebar-state-item-label-selector'
    );

    if (
      !selector ||
      selector.classList.contains('ant-select-disabled')
    ) return;

    const input = selector.querySelector('input');

    if (!input || input.disabled) return;

    switchingLicenseplate = true;

    try {
      if (!selector.classList.contains('ant-select-open')) {
        const button =
          selector.querySelector('.ant-select-selector') || input;

        button.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
        }));
      }

      // Đợi menu mở trước khi tìm kiếm.
      let dropdown = null;

      for (let attempt = 0; attempt < 20; attempt++) {
        await wait(50);

        if (
          !selector.isConnected ||
          !activeObject.classList.contains(
            'cvat-objects-sidebar-state-active-item'
          )
        ) return;

        dropdown = findDropdown(input);
        if (dropdown) break;
      }

      if (!dropdown) {
        console.warn('[CVAT] Không mở được menu chọn nhãn.');
        return;
      }

      input.focus();
      setSearch(input, labelName);

      // Chờ kết quả tìm kiếm, kể cả nhãn cuối danh sách.
      for (let attempt = 0; attempt < 30; attempt++) {
        await wait(50);

        if (
          !selector.isConnected ||
          !activeObject.classList.contains(
            'cvat-objects-sidebar-state-active-item'
          )
        ) return;

        dropdown = findDropdown(input);
        if (!dropdown) continue;

        const option = [
          ...dropdown.querySelectorAll('.ant-select-item-option'),
        ].find((item) => {
          const name =
            item.getAttribute('title') ||
            item.querySelector('.ant-select-item-option-content')
              ?.textContent ||
            item.textContent ||
            '';

          return (
            name.trim().toLowerCase() === labelName.trim().toLowerCase() &&
            isVisible(item) &&
            !item.classList.contains('ant-select-item-option-disabled')
          );
        });

        if (!option) continue;

        option.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
        }));

        option.click();
        await wait(50);
        return;
      }

      console.warn('[CVAT] Không tìm thấy nhãn:', labelName);
    } catch (error) {
      console.error('[CVAT] Lỗi chọn nhãn:', error);
    } finally {
      closeSearch(input);
      switchingLicenseplate = false;
    }
  }

  // Bảng phím được lưu riêng theo từng origin của CVAT.
  const STORAGE_KEY = 'cvat-shortcuts-label-settings-v1';
  const defaults = [
    ...Object.entries({ y:'1', s:'2', u:'3', o:'4', '0':'0', '1':'1', '2':'2', '3':'3', '4':'4', '5':'5', '6':'6', '7':'7', '8':'8', '9':'9' })
      .map(([key, value]) => ({ shortcut: key.toUpperCase(), type: 'number', value })),
    { shortcut: 'Alt+3', type: 'number', value: '3' },
    { shortcut: 'Alt+2', type: 'number', value: '4' },
    { shortcut: 'Shift+S', type: 'number', value: '0' },
    { shortcut: 'Alt+`', type: 'name', value: 'licenseplate' },
  ];
  const keyName = (event) => {
    const code = event.code;
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3) :
      /^Digit[0-9]$/.test(code) ? code.slice(5) :
      code === 'Backquote' ? '`' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (['Control', 'Alt', 'Shift', 'Meta', 'Unidentified'].includes(key)) return '';
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
  };
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved) && saved.every(x => x && typeof x.shortcut === 'string' && ['number', 'name'].includes(x.type) && typeof x.value === 'string')) return saved;
    } catch (error) { console.warn('[CVAT] Không đọc được cấu hình:', error); }
    return defaults.map(x => ({ ...x }));
  }
  let shortcuts = loadSettings();
  function openSettings() {
    if (document.getElementById('cvat-shortcut-settings')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cvat-shortcut-settings';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:2147483647;display:flex;align-items:center;justify-content:center;font:14px Arial;color:#222';
    const box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:8px;padding:18px;width:min(700px,95vw);max-height:85vh;overflow:auto;box-shadow:0 4px 25px #0006';
    overlay.appendChild(box);
    const title = document.createElement('h3'); title.textContent = 'Bảng phím tắt đổi label'; box.appendChild(title);
    const help = document.createElement('p'); help.textContent = 'Nhấp vào ô phím rồi bấm tổ hợp muốn dùng. Số CVAT là nhãn tương ứng Ctrl+0 đến Ctrl+9; tên label phải khớp tên trong task. Cấu hình lưu riêng cho từng địa chỉ CVAT.'; box.appendChild(help);
    const table = document.createElement('div'); box.appendChild(table);
    const message = document.createElement('p'); message.style.color = '#b42318'; box.appendChild(message);
    let rows = shortcuts.map(x => ({ ...x }));
    function render() {
      table.replaceChildren();
      rows.forEach((row, index) => {
        const line = document.createElement('div'); line.style.cssText = 'display:flex;gap:6px;margin:6px 0;align-items:center';
        const key = document.createElement('input'); key.type = 'text'; key.readOnly = true; key.value = row.shortcut; key.placeholder = 'Bấm phím'; key.style.cssText = 'width:125px;padding:6px'; key.title = 'Nhấp vào đây rồi bấm tổ hợp phím';
        key.addEventListener('keydown', e => { e.preventDefault(); e.stopImmediatePropagation(); const name = keyName(e); if (name) { row.shortcut = name; key.value = name; } }, true);
        const type = document.createElement('select'); type.style.padding = '6px';
        for (const [value, label] of [['number', 'Số CVAT'], ['name', 'Tên label']]) { const opt = document.createElement('option'); opt.value = value; opt.textContent = label; type.appendChild(opt); }
        type.value = row.type; type.addEventListener('change', () => { row.type = type.value; value.placeholder = row.type === 'name' ? 'Tên label chính xác' : 'Số từ 0 đến 9'; });
        const value = document.createElement('input'); value.type = 'text'; value.value = row.value; value.placeholder = row.type === 'name' ? 'Tên label chính xác' : 'Số từ 0 đến 9'; value.style.cssText = 'flex:1;min-width:70px;padding:6px'; value.addEventListener('input', () => { row.value = value.value; });
        const remove = document.createElement('button'); remove.textContent = 'Xóa'; remove.onclick = () => { rows.splice(index, 1); render(); };
        line.append(key, type, value, remove); table.appendChild(line);
      });
    }
    function button(text, action) { const b = document.createElement('button'); b.textContent = text; b.style.cssText = 'margin:6px 8px 0 0;padding:7px 12px'; b.onclick = action; box.appendChild(b); }
    button('Thêm dòng', () => { rows.push({ shortcut:'', type:'name', value:'' }); render(); });
    button('Mặc định', () => { rows = defaults.map(x => ({ ...x })); message.textContent = ''; render(); });
    button('Lưu', () => {
      const seen = new Set();
      for (const row of rows) {
        row.value = row.value.trim();
        if (!row.shortcut || !row.value || (row.type === 'number' && !/^[0-9]$/.test(row.value))) { message.textContent = 'Hãy nhập phím và giá trị hợp lệ; số CVAT phải từ 0 đến 9.'; return; }
        if (seen.has(row.shortcut)) { message.textContent = 'Phím bị trùng: ' + row.shortcut; return; }
        if (['Q', 'R', 'Alt+Q'].includes(row.shortcut)) { message.textContent = 'Phím ' + row.shortcut + ' đang dùng cho công cụ mask; hãy chọn phím khác.'; return; }
        seen.add(row.shortcut);
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); shortcuts = rows.map(x => ({ ...x })); overlay.remove(); }
      catch (error) { message.textContent = 'Không lưu được cấu hình: ' + error.message; }
    });
    button('Đóng', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay); render();
  }
  function installSettingsButton() {
    const fullscreen = document.querySelector('.cvat-annotation-header-fullscreen-button');
    if (!fullscreen || !fullscreen.parentElement) return;
    let button = document.getElementById('cvat-shortcut-settings-button');
    if (!button) {
      button = document.createElement('button');
      button.id = 'cvat-shortcut-settings-button';
      button.type = 'button';
      button.className = 'ant-btn ant-btn-link cvat-annotation-header-button';
      button.title = 'Cấu hình phím tắt đổi label';
      const icon = document.createElement('span');
      icon.textContent = '⌨';
      icon.style.cssText = 'font-size:20px;line-height:22px';
      const label = document.createElement('span');
      label.textContent = 'Phím tắt';
      button.append(icon, label);
      button.onclick = openSettings;
    }
    if (button.parentElement !== fullscreen.parentElement || button.nextElementSibling !== fullscreen) {
      fullscreen.before(button);
    }
  }
  function observeSettingsButton() {
    installSettingsButton();
    new MutationObserver(installSettingsButton).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeSettingsButton, { once:true });
  else observeSettingsButton();

  let switchingBrushForm = false;

  function findBrushFormSelector() {
    const toolbox = [...document.querySelectorAll('.cvat-brush-tools-toolbox')]
      .find(isVisible);
    if (!toolbox) return null;

    return [...toolbox.querySelectorAll('.ant-select')].find((selector) => {
      const selected = selector.querySelector('.ant-select-selection-item');
      const name = (selected?.textContent || '').trim().toLowerCase();
      return isVisible(selector) &&
        !selector.classList.contains('ant-select-disabled') &&
        (name === 'circle' || name === 'square');
    }) || null;
  }

  async function toggleBrushForm(selector) {
    if (switchingBrushForm) return;
    const input = selector.querySelector('input');
    const selected = selector.querySelector('.ant-select-selection-item');
    const current = (selected?.textContent || '').trim().toLowerCase();
    if (!input || input.disabled || !['circle', 'square'].includes(current)) return;

    const next = current === 'circle' ? 'square' : 'circle';
    const previousFocus = document.activeElement;
    switchingBrushForm = true;

    try {
      if (!selector.classList.contains('ant-select-open')) {
        (selector.querySelector('.ant-select-selector') || input)
          .dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, button: 0, view: window,
          }));
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        await wait(25);
        if (!selector.isConnected || !isVisible(selector)) return;
        const dropdown = findDropdown(input);
        const option = dropdown && [...dropdown.querySelectorAll('.ant-select-item-option')]
          .find((item) => {
            const name = (item.getAttribute('title') || item.textContent || '')
              .trim().toLowerCase();
            return name === next && isVisible(item) &&
              !item.classList.contains('ant-select-item-option-disabled');
          });
        if (!option) continue;
        option.click();
        return;
      }
      console.warn('[CVAT] Không tìm thấy lựa chọn Circle/Square.');
    } catch (error) {
      console.error('[CVAT] Lỗi chuyển Circle/Square:', error);
    } finally {
      // Không gửi Escape vì phím đó có thể hủy phiên Edit mask.
      if (input.isConnected) input.blur();
      if (previousFocus?.isConnected && previousFocus !== document.body) {
        previousFocus.focus({ preventScroll: true });
      }
      switchingBrushForm = false;
    }
  }

  function handleLabelShortcut(event) {
    if (event.isComposing) return;

    const polygonKey = event.code === 'KeyQ' ? 'q' :
      event.code === 'KeyR' ? 'r' : event.key.toLowerCase();
    if (['q', 'r'].includes(polygonKey) &&
      !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      const toolbox = [...document.querySelectorAll('.cvat-brush-tools-toolbox')]
        .find(isVisible);
      const button = toolbox?.querySelector(polygonKey === 'q' ?
        '.cvat-brush-tools-polygon-plus' : '.cvat-brush-tools-polygon-minus');
      const inBrushSize = event.target instanceof Element &&
        event.target.closest('.cvat-brush-tools-brush-size');
      if (button && isVisible(button) && (!isEditing(event.target) || inBrushSize)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'keydown' && !event.repeat &&
          !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
          button.click();
        }
        return;
      }
    }

    if (event.code === 'KeyQ' && event.altKey &&
      !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      const selector = findBrushFormSelector();
      if (!selector) return;
      const inBrushSize = event.target instanceof Element &&
        event.target.closest('.cvat-brush-tools-brush-size');
      if (isEditing(event.target) && !selector.contains(event.target) && !inBrushSize) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown' && !event.repeat) {
        void toggleBrushForm(selector);
      }
      return;
    }

    if (document.getElementById('cvat-shortcut-settings')) return;
    if (isEditing(event.target) || !document.querySelector('.cvat-objects-sidebar')) return;
    const mapping = shortcuts.find(item => item.shortcut === keyName(event));
    if (!mapping) return;
    if (mapping.type === 'name') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown' && !event.repeat) void switchActiveObjectToLabel(mapping.value);
      return;
    }
    const labelNumber = mapping.value;

    // Chặn keypress chữ gốc; vẫn cho CVAT nhận Ctrl+số qua propagation.
    if (event.type === 'keydown') event.preventDefault();

    // Giữ cách chuyển phím đang dùng cho 10 nhãn đầu.
    const keyCode = 48 + Number(labelNumber);

    const changes = {
      key: labelNumber,
      code: `Digit${labelNumber}`,
      which: keyCode,
      keyCode,
      charCode: keyCode,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };

    for (const [name, value] of Object.entries(changes)) {
      try {
        Object.defineProperty(event, name, {
          value,
          configurable: true,
        });
      } catch (error) {
        console.warn('[CVAT] Không đổi được thuộc tính phím:', name);
      }
    }
  }

  for (const type of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(type, handleLabelShortcut, true);
  }
})();

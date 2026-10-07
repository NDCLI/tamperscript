// ==UserScript==
// @name         CVAT - khóa zoom, Switch label nhanh và Edit mask
// @namespace    cvat-internal-shortcuts
// @version      1.6.3
// @description  Khóa zoom, đổi nhãn nhanh, nhấp đúp Edit mask và Ctrl+lăn chỉnh brush
// @match        http://10.43.2.147:8080/*
// @match        http://10.43.2.12:8080/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/NDCLI/tamperscript/main/cvat-shortcuts.user.js
// @downloadURL  https://raw.githubusercontent.com/NDCLI/tamperscript/main/cvat-shortcuts.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Giới hạn chính xác hai địa chỉ, gồm cả cổng.
  if (![
    'http://10.43.2.147:8080',
    'http://10.43.2.12:8080',
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

  // Ctrl + lăn lên tăng 2; Ctrl + lăn xuống giảm 5.
  const BRUSH_WHEEL_INCREASE = 2;
  const BRUSH_WHEEL_DECREASE = 5;

  // Ctrl + lăn chuột: chỉnh brush khi toolbox mở, đồng thời chặn zoom.
  window.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (
      event.altKey || event.metaKey || event.shiftKey ||
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
  async function switchActiveObjectToLicenseplate() {
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
      setSearch(input, 'licenseplate');

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
            name.trim().toLowerCase() === 'licenseplate' &&
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

      console.warn('[CVAT] Không tìm thấy nhãn licenseplate trong menu.');
    } catch (error) {
      console.error('[CVAT] Lỗi chọn licenseplate:', error);
    } finally {
      closeSearch(input);
      switchingLicenseplate = false;
    }
  }

  // Phím thường -> shortcut Ctrl+số mặc định.
  const plainKeys = {
    'y': '1', // person
    's': '2', // car
    'u': '3', // bus
    'o': '4', // truck
    '0': '0', // Cùng shortcut Ctrl+0; vẫn giữ Shift+S cho _skip
    '1': '1', // person
    '2': '2', // car
    '3': '3', // bus
    '4': '4', // truck
    '5': '5', // Nhãn đang được CVAT gán cho Ctrl+5
    '6': '6', // Nhãn đang được CVAT gán cho Ctrl+6
    '7': '7', // Nhãn đang được CVAT gán cho Ctrl+7
    '8': '8', // face
    '9': '9', // head
  };

  const altKeys = {
    '3': '3', // motorbike
    '2': '4', // bicycle
  };

  function handleLabelShortcut(event) {
    if (event.isComposing) return;

    const isLicenseplateShortcut =
      event.code === 'Backquote' &&
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey;

    if (isLicenseplateShortcut) {
      // Cho phép thử lại nếu focus còn trong ô nhãn của object đang chọn.
      const inActiveLabelSelector =
        event.target instanceof Element &&
        Boolean(event.target.closest(
          '.cvat-objects-sidebar-state-active-item ' +
          '.cvat-objects-sidebar-state-item-label-selector'
        ));

      if (isEditing(event.target) && !inActiveLabelSelector) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.type === 'keydown' && !event.repeat) {
        void switchActiveObjectToLicenseplate();
      }

      return;
    }

    if (
      isEditing(event.target) ||
      event.ctrlKey ||
      event.metaKey
    ) return;

    // Chỉ đổi phím trong màn hình annotation có Object sidebar.
    if (!document.querySelector('.cvat-objects-sidebar')) return;

    // Dùng vị trí phím để Caps Lock/bố cục bàn phím không đổi mapping.
    const physicalKey = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    const key = (physicalKey ? physicalKey[1] || physicalKey[2] : event.key).toLowerCase();
    let labelNumber = null;

    if (event.altKey && !event.shiftKey) {
      labelNumber = altKeys[key] || null;
    } else if (event.shiftKey && !event.altKey && key === 's') {
      labelNumber = '0'; // _skip
    } else if (!event.altKey && !event.shiftKey) {
      labelNumber = plainKeys[key] || null;
    }

    if (!labelNumber) return;

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
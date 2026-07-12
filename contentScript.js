(() => {
  'use strict';

  const STORAGE_KEYS = {
    interval: 'ar_interval',
    scrollPx: 'ar_scrollPx',
    autoStart: 'ar_autoStart',
    collapsed: 'ar_collapsed',
  };

  const INTERVAL_DEFAULT = 100; // ms
  const INTERVAL_MIN = 30;
  const INTERVAL_MAX = 3000;

  const SCROLL_PX_DEFAULT = 50; // px per step
  const SCROLL_PX_MIN = 5;
  const SCROLL_PX_MAX = 500;

  const BOTTOM_THRESHOLD_PX = 20;
  const BOTTOM_STREAK_TO_STOP = 3;
  const NO_GROWTH_AFTER_MS = 5000;
  const HEIGHT_EPS = 3;

  /** @type {HTMLElement | null} */
  let container = null;

  let interval = INTERVAL_DEFAULT;
  let scrollPx = SCROLL_PX_DEFAULT;
  let running = false;
  /** @type {boolean} */
  let paused = true;

  let timerToken = null;

  let bottomStreak = 0;
  let lastScrollHeight = 0;
  let lastHeightChangedTs = 0;
  let heightUnchangedStreak = 0;

  let lastContainerCheckTs = 0;
  let isSeeking = false;
  let lastProgressUiTs = 0;
  let isPanelDragging = false;
  let dragPointerId = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartHostLeft = 0;
  let dragStartHostTop = 0;

  const ui = createOverlayUI();
  let uiHost = ui.host;
  uiHost.id = 'autoReader-ui-host';

  initStorageAndMaybeAutostart();
  attachPauseOnUserInteraction();
  attachPanelDrag();

  function createOverlayUI() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'false');
    host.style.position = 'fixed';
    host.style.top = '12px';
    host.style.right = '12px';
    host.style.zIndex = '2147483647';

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue", "Apple Color Emoji", "Segoe UI Emoji";
          font-size: 12px;
          color: rgba(255,255,255,0.92);
          background: rgba(20, 20, 20, 0.72);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          backdrop-filter: blur(10px);
          padding: 10px;
          width: 220px;
          user-select: none;
        }
        .row { display:flex; align-items:center; gap:8px; }
        button {
          appearance:none;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.95);
          border-radius: 8px;
          padding: 7px 10px;
          cursor: pointer;
          font-weight: 600;
        }
        button:hover { background: rgba(255,255,255,0.12); }
        button:active { transform: translateY(1px); }
        .pill {
          flex: 1;
          font-weight: 700;
          text-align: right;
          opacity: 0.9;
        }
        .sliderRow { margin-top: 8px; }
        .dragHandle { cursor: grab; }
        .dragHandle.dragging { cursor: grabbing; }
        .rangeMetaRow { margin-top: 8px; display:flex; align-items:center; justify-content: space-between; gap:10px; }
        input[type="range"]{
          width: 100%;
          accent-color: #7dd3fc;
        }
        .meta {
          margin-top: 6px;
          opacity: 0.9;
          display:flex;
          justify-content: space-between;
          gap:10px;
        }
        .label { opacity: 0.9; }
        .value { font-variant-numeric: tabular-nums; }
        .iconBtn {
          padding: 6px 8px;
          min-width: 30px;
          font-size: 12px;
          line-height: 1;
          font-weight: 700;
        }
        .panel.collapsed .panelBody { display: none; }
        .panel.collapsed { padding: 6px 8px; }
      </style>
      <div class="panel" id="ar-panel" role="group" aria-label="AutoReader controls">
        <div class="row dragHandle" id="ar-dragHandle" title="Drag to move (not on buttons)">
          <button id="ar-collapse" class="iconBtn" type="button" title="收起" aria-expanded="true" aria-controls="ar-panelBody">▲</button>
          <button id="ar-toggle" type="button" title="Start / Pause / Resume">Start</button>
          <div class="pill" id="ar-status">Idle</div>
        </div>

        <div class="panelBody" id="ar-panelBody">
          <div class="sliderRow">
            <div class="rangeMetaRow">
              <div class="label">Progress</div>
              <div class="value" id="ar-progressText">0%</div>
            </div>
            <input id="ar-progress" type="range" min="0" max="100" step="1" value="0" />

            <div class="rangeMetaRow">
              <div class="label">滚动间隔</div>
              <div class="value" id="ar-intervalText">${INTERVAL_DEFAULT} ms</div>
            </div>
            <input id="ar-interval" type="range" min="${INTERVAL_MIN}" max="${INTERVAL_MAX}" step="10" value="${INTERVAL_DEFAULT}" />

            <div class="rangeMetaRow">
              <div class="label">每次下滑</div>
              <div class="value" id="ar-scrollPxText">${SCROLL_PX_DEFAULT} px</div>
            </div>
            <input id="ar-scrollPx" type="range" min="${SCROLL_PX_MIN}" max="${SCROLL_PX_MAX}" step="5" value="${SCROLL_PX_DEFAULT}" />
          </div>

          <div class="meta">
            <div class="label">Container</div>
            <div class="value" id="ar-containerText">auto</div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);

    const toggleBtn = shadow.getElementById('ar-toggle');
    const statusEl = shadow.getElementById('ar-status');
    const dragHandle = shadow.getElementById('ar-dragHandle');
    const progressInput = shadow.getElementById('ar-progress');
    const progressText = shadow.getElementById('ar-progressText');
    const intervalInput = shadow.getElementById('ar-interval');
    const intervalText = shadow.getElementById('ar-intervalText');
    const scrollPxInput = shadow.getElementById('ar-scrollPx');
    const scrollPxText = shadow.getElementById('ar-scrollPxText');
    const containerText = shadow.getElementById('ar-containerText');

    toggleBtn.addEventListener('click', () => {
      if (!running || paused) {
        startOrResume();
      } else {
        pause('User');
      }
    });

    intervalInput.addEventListener('input', () => {
      const v = Number(intervalInput.value);
      interval = Number.isFinite(v) ? v : INTERVAL_DEFAULT;
      intervalText.textContent = `${interval} ms`;
      saveInterval(interval);
      // If running, restart timer with new interval
      if (running && !paused) {
        cancelTick();
        scheduleTick();
      }
    });

    scrollPxInput.addEventListener('input', () => {
      const v = Number(scrollPxInput.value);
      scrollPx = Number.isFinite(v) ? v : SCROLL_PX_DEFAULT;
      scrollPxText.textContent = `${scrollPx} px`;
      saveScrollPx(scrollPx);
    });

    const panelEl = shadow.getElementById('ar-panel');
    const collapseBtn = shadow.getElementById('ar-collapse');
    let panelCollapsed = false;

    function applyPanelCollapsed() {
      if (!panelEl || !collapseBtn) return;
      if (panelCollapsed) {
        panelEl.classList.add('collapsed');
        collapseBtn.textContent = '▼';
        collapseBtn.title = '展开';
        collapseBtn.setAttribute('aria-expanded', 'false');
      } else {
        panelEl.classList.remove('collapsed');
        collapseBtn.textContent = '▲';
        collapseBtn.title = '收起';
        collapseBtn.setAttribute('aria-expanded', 'true');
      }
    }

    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panelCollapsed = !panelCollapsed;
      applyPanelCollapsed();
      saveCollapsed(panelCollapsed);
    });

    applyPanelCollapsed();

    return {
      host,
      shadow,
      panelEl,
      collapseBtn,
      toggleBtn,
      statusEl,
      intervalInput,
      intervalText,
      scrollPxInput,
      scrollPxText,
      containerText,
      dragHandle,
      progressInput,
      progressText,
      setCollapsed: (v) => {
        panelCollapsed = !!v;
        applyPanelCollapsed();
      },
      setStatus: (text) => {
        statusEl.textContent = text;
        toggleBtn.textContent = text.startsWith('Running') ? 'Pause' : 'Start';
        if (text === 'Paused') toggleBtn.textContent = 'Resume';
      },
      setProgress: (percent) => {
        const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        progressInput.value = String(p);
        progressText.textContent = `${p}%`;
      },
      setInterval: (v) => {
        const vv = Math.max(INTERVAL_MIN, Math.min(INTERVAL_MAX, v));
        intervalInput.value = String(vv);
        intervalText.textContent = `${vv} ms`;
      },
      setScrollPx: (v) => {
        const vv = Math.max(SCROLL_PX_MIN, Math.min(SCROLL_PX_MAX, v));
        scrollPxInput.value = String(vv);
        scrollPxText.textContent = `${vv} px`;
      },
      setContainerLabel: (label) => {
        containerText.textContent = label;
      },
    };
  }

  function updateUIState() {
    if (!running) {
      ui.setStatus('Idle');
      return;
    }
    if (paused) {
      ui.setStatus('Paused');
      return;
    }
    ui.setStatus(`Running`);
  }

  function ensureContainer() {
    if (!container) container = findScrollableContainer();
    return container;
  }

  function getProgressPercentForContainer(scroller) {
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (!(max > 5)) return 0;
    return (scroller.scrollTop / max) * 100;
  }

  function updateProgressUI(force, ts) {
    if (!force && !running) return;

    const scroller = container || findScrollableContainer();
    if (!scroller) return;

    const now = ts ?? performance.now();
    if (!force && now - lastProgressUiTs < 200) return;

    const percent = getProgressPercentForContainer(scroller);
    ui.setProgress(percent);
    lastProgressUiTs = now;
  }

  function seekToPercent(percent) {
    const scroller = ensureContainer();
    if (!scroller) return;

    const max = scroller.scrollHeight - scroller.clientHeight;
    if (!(max > 5)) return;

    const p = clamp(Number(percent) || 0, 0, 100);
    const targetTop = clamp((max * p) / 100, 0, max);
    scroller.scrollTop = targetTop;

    // Reset end-detection so a subsequent Resume doesn't immediately stop.
    bottomStreak = 0;
    heightUnchangedStreak = 0;
    lastScrollHeight = scroller.scrollHeight;
    lastHeightChangedTs = performance.now();
    lastContainerCheckTs = 0;

    updateProgressUI(true);
  }

  async function initStorageAndMaybeAutostart() {
    try {
      if (!chrome?.storage?.sync) {
        ui.setInterval(interval);
        ui.setScrollPx(scrollPx);
        updateUIState();
        return;
      }

      chrome.storage.sync.get(
        [STORAGE_KEYS.interval, STORAGE_KEYS.scrollPx, STORAGE_KEYS.autoStart, STORAGE_KEYS.collapsed],
        (res) => {
        if (typeof res?.[STORAGE_KEYS.interval] === 'number') interval = res[STORAGE_KEYS.interval];
        if (typeof res?.[STORAGE_KEYS.scrollPx] === 'number') scrollPx = res[STORAGE_KEYS.scrollPx];
        ui.setInterval(interval);
        ui.setScrollPx(scrollPx);
        ui.setContainerLabel('auto');
        if (res?.[STORAGE_KEYS.collapsed] === true) ui.setCollapsed(true);

        paused = true;
        running = false;
        updateUIState();

        if (res?.[STORAGE_KEYS.autoStart] === true) {
          // Slight delay to avoid interfering with page initial layout.
          setTimeout(() => startOrResume(), 500);
        }
        });
    } catch {
      ui.setInterval(interval);
      ui.setScrollPx(scrollPx);
      updateUIState();
    }
  }

  function saveInterval(v) {
    try {
      if (!chrome?.storage?.sync) return;
      chrome.storage.sync.set({ [STORAGE_KEYS.interval]: v });
    } catch {
      // ignore
    }
  }

  function saveScrollPx(v) {
    try {
      if (!chrome?.storage?.sync) return;
      chrome.storage.sync.set({ [STORAGE_KEYS.scrollPx]: v });
    } catch {
      // ignore
    }
  }

  function saveCollapsed(v) {
    try {
      if (!chrome?.storage?.sync) return;
      chrome.storage.sync.set({ [STORAGE_KEYS.collapsed]: !!v });
    } catch {
      // ignore
    }
  }

  function attachPauseOnUserInteraction() {
    // Events from inside Shadow DOM can be tricky for `contains()`, so we rely on
    // `composedPath()` when available.
    const shouldIgnoreEvent = (e) => {
      const path = typeof e?.composedPath === 'function' ? e.composedPath() : [e?.target];
      return path.some((n) => n === uiHost);
    };

    document.addEventListener(
      'wheel',
      (e) => {
        if (!running || paused) return;
        if (shouldIgnoreEvent(e)) return;
        pause('User wheel');
      },
      { capture: true, passive: true }
    );

    document.addEventListener(
      'touchstart',
      (e) => {
        if (!running || paused) return;
        if (shouldIgnoreEvent(e)) return;
        pause('User touch');
      },
      { capture: true, passive: true }
    );

    document.addEventListener(
      'touchmove',
      (e) => {
        if (!running || paused) return;
        if (shouldIgnoreEvent(e)) return;
        pause('User touch');
      },
      { capture: true, passive: true }
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (!running || paused) return;
        if (shouldIgnoreEvent(e)) return;
        const k = e.key;
        const keys = new Set([
          ' ',
          'Spacebar',
          'PageDown',
          'PageUp',
          'ArrowDown',
          'ArrowUp',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
        ]);
        if (keys.has(k)) pause(`User key: ${k}`);
      },
      { capture: true }
    );
  }

  function attachPanelDrag() {
    if (!ui.dragHandle) return;
    const handle = ui.dragHandle;

    handle.addEventListener(
      'pointerdown',
      (e) => {
        // Don't start dragging when the user interacts with controls.
        const t = /** @type {any} */ (e.target);
        if (t instanceof Element) {
          if (t.closest('button') || t.closest('input') || t.closest('label')) return;
        }
        if (e.button !== 0) return;

        isPanelDragging = true;
        dragPointerId = e.pointerId;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;

        const rect = uiHost.getBoundingClientRect();
        dragStartHostLeft = rect.left;
        dragStartHostTop = rect.top;

        handle.classList.add('dragging');

        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true }
    );

    document.addEventListener(
      'pointermove',
      (e) => {
        if (!isPanelDragging) return;
        if (dragPointerId !== null && e.pointerId !== dragPointerId) return;

        const hostRect = uiHost.getBoundingClientRect();
        const panelWidth = hostRect.width;
        const panelHeight = hostRect.height;

        const dx = e.clientX - dragStartClientX;
        const dy = e.clientY - dragStartClientY;

        const nextLeft = dragStartHostLeft + dx;
        const nextTop = dragStartHostTop + dy;

        const minLeft = 8;
        const minTop = 8;
        const maxLeft = window.innerWidth - panelWidth - 8;
        const maxTop = window.innerHeight - panelHeight - 8;

        const clampedLeft = clamp(nextLeft, minLeft, Math.max(minLeft, maxLeft));
        const clampedTop = clamp(nextTop, minTop, Math.max(minTop, maxTop));

        uiHost.style.right = 'auto';
        uiHost.style.left = `${clampedLeft}px`;
        uiHost.style.top = `${clampedTop}px`;
      },
      { capture: true }
    );

    const finish = (e) => {
      if (!isPanelDragging) return;
      if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
      isPanelDragging = false;
      dragPointerId = null;
      handle.classList.remove('dragging');
    };

    document.addEventListener('pointerup', finish, { capture: true });
    document.addEventListener('pointercancel', finish, { capture: true });
  }

  function isScrollable(el) {
    if (!el || !(el instanceof HTMLElement)) return false;

    // Exclude elements that cannot scroll.
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (!(maxScroll > 5)) return false;

    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if (!['auto', 'scroll', 'overlay'].includes(overflowY)) return false;

    return true;
  }

  /**
   * Try to find a scrollable container for the current viewport.
   * @returns {HTMLElement | null}
   */
  function findScrollableContainer() {
    const points = [
      [window.innerWidth * 0.5, window.innerHeight * 0.7],
      [window.innerWidth * 0.5, window.innerHeight * 0.5],
      [window.innerWidth * 0.5, window.innerHeight * 0.3],
      [window.innerWidth * 0.25, window.innerHeight * 0.7],
      [window.innerWidth * 0.75, window.innerHeight * 0.7],
    ];

    for (const [x, y] of points) {
      const el = document.elementFromPoint(x, y);
      const found = walkScrollableUp(el);
      if (found) return found;
    }

    const se = document.scrollingElement || document.documentElement;
    if (se && isScrollable(se)) return se;

    // Last resort: still return something so the loop can attempt.
    return document.scrollingElement || document.documentElement;
  }

  /**
   * @param {Element | null} start
   * @returns {HTMLElement | null}
   */
  function walkScrollableUp(start) {
    let cur = start;
    while (cur && cur instanceof HTMLElement) {
      if (isScrollable(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function startOrResume() {
    if (!running) {
      container = findScrollableContainer();
      ui.setContainerLabel(container ? container.tagName.toLowerCase() : 'auto');

      bottomStreak = 0;
      heightUnchangedStreak = 0;
      lastScrollHeight = container?.scrollHeight ?? 0;
      lastHeightChangedTs = performance.now();
    }

    running = true;
    paused = false;
    updateUIState();

    lastContainerCheckTs = 0;
    updateProgressUI(true);

    scheduleTick();
  }

  function scheduleTick() {
    if (timerToken) clearInterval(timerToken);
    timerToken = setInterval(tick, interval);
  }

  function pause(reason) {
    if (!running || paused) return;
    paused = true;
    cancelTick();
    ui.setStatus('Paused');
    // reason is intentionally unused here; we keep it for later debug improvements.
    updateProgressUI(true);
  }

  function cancelTick() {
    if (timerToken) clearInterval(timerToken);
    timerToken = null;
  }

  function stop(text) {
    running = false;
    paused = true;
    container = null;
    cancelTick();
    ui.setStatus(text || 'Stopped');
    ui.setContainerLabel('auto');
    ui.setProgress(0);
  }

  function tick() {
    if (!running || paused) return;
    if (!container) container = findScrollableContainer();
    if (!container) {
      stop('No scroll container');
      return;
    }

    // Re-evaluate occasionally (nested apps / lazy loaded content).
    const now = performance.now();
    if (now - lastContainerCheckTs > 2000) {
      const nextContainer = findScrollableContainer();
      if (nextContainer && nextContainer !== container) {
        const currentMaxScroll = container.scrollHeight - container.clientHeight;
        const currentNearBottom =
          currentMaxScroll - container.scrollTop <= BOTTOM_THRESHOLD_PX;
        const currentStuck = currentMaxScroll <= 5;

        // Only switch when the current container is basically "done",
        // otherwise nested pages may cause container thrashing.
        if (currentStuck || currentNearBottom) {
          container = nextContainer;
          bottomStreak = 0;
          lastScrollHeight = container.scrollHeight;
          lastHeightChangedTs = now;
        }
      }

      ui.setContainerLabel(container ? container.tagName.toLowerCase() : 'auto');
      lastContainerCheckTs = now;
    }

    const maxScroll = container.scrollHeight - container.clientHeight;
    if (!(maxScroll > 5)) {
      stop('Reached end');
      return;
    }

    const currentTop = container.scrollTop;
    const nextTop = clamp(currentTop + scrollPx, 0, maxScroll);
    container.scrollTop = nextTop;

    const nearBottom = maxScroll - container.scrollTop <= BOTTOM_THRESHOLD_PX;

    if (nearBottom) bottomStreak += 1;
    else bottomStreak = 0;

    const scrollHeight = container.scrollHeight;
    const heightChanged = scrollHeight - lastScrollHeight > HEIGHT_EPS;
    if (nearBottom) {
      if (heightChanged) {
        lastScrollHeight = scrollHeight;
        lastHeightChangedTs = now;
        heightUnchangedStreak = 0;
      } else {
        heightUnchangedStreak += 1;
      }
    } else {
      // When not near bottom, reset the "stuck at bottom" streak,
      // but still track height changes for later.
      if (heightChanged) {
        lastScrollHeight = scrollHeight;
        lastHeightChangedTs = now;
      }
      heightUnchangedStreak = 0;
    }

    const noGrowthTooLong = now - lastHeightChangedTs > NO_GROWTH_AFTER_MS;
    if (
      bottomStreak >= BOTTOM_STREAK_TO_STOP &&
      heightUnchangedStreak >= BOTTOM_STREAK_TO_STOP &&
      noGrowthTooLong
    ) {
      stop('End reached');
      return;
    }

    updateProgressUI(false, now);
  }

  // ===== Seek (drag to change scroll position) =====
  ui.progressInput.addEventListener('pointerdown', () => {
    isSeeking = true;
    if (running && !paused) pause('User seek');
  });

  ui.progressInput.addEventListener('input', () => {
    if (!isSeeking) return;
    const percent = Number(ui.progressInput.value);
    if (!Number.isFinite(percent)) return;
    seekToPercent(percent);
  });

  const finishSeeking = () => {
    isSeeking = false;
    updateProgressUI(true);
  };

  ui.progressInput.addEventListener('pointerup', finishSeeking);
  ui.progressInput.addEventListener('pointercancel', finishSeeking);
  ui.progressInput.addEventListener('change', () => {
    // Keyboard interaction might not fire `input` during the interaction.
    isSeeking = false;
    const percent = Number(ui.progressInput.value);
    if (Number.isFinite(percent) && paused) seekToPercent(percent);
    updateProgressUI(true);
  });
})();


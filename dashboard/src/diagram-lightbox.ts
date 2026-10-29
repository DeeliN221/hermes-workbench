/**
 * Interactive pan-and-zoom lightbox for Mermaid and PlantUML diagrams.
 * Supports mouse drag, wheel zoom, mobile pinch-to-zoom, and keyboard controls.
 */
import { uiText } from './ui-locale';

let activeLightbox: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

export function isDiagramHost(element: HTMLElement | null): boolean {
  if (!element) return false;
  return element.classList.contains('hti-rich-mermaid') ||
         element.classList.contains('hti-rich-plantuml') ||
         element.classList.contains('hti-mermaid');
}

export function extractDiagramGraphic(host: HTMLElement): { element: SVGElement | HTMLImageElement; title: string } | null {
  if (host.classList.contains('hti-rich-mermaid-error')) return null;
  const isPlantUML = host.classList.contains('hti-rich-plantuml') || host.dataset.plantumlSource !== undefined;
  const title = isPlantUML ? 'PlantUML' : 'Mermaid';
  const container = host.querySelector<HTMLElement>('.hti-rich-mermaid-svg') || host;
  const svg = container.querySelector<SVGElement>('svg');
  if (svg) {
    return { element: svg.cloneNode(true) as SVGElement, title };
  }
  const img = container.querySelector<HTMLImageElement>('img');
  if (img && img.src) {
    return { element: img.cloneNode(true) as HTMLImageElement, title };
  }
  return null;
}

export function closeDiagramLightbox(): void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  if (activeLightbox) {
    activeLightbox.remove();
    activeLightbox = null;
  }
}

export function openDiagramLightbox(host: HTMLElement): HTMLElement | null {
  const graphic = extractDiagramGraphic(host);
  if (!graphic) return null;

  closeDiagramLightbox();

  let scale = 1.0;
  let translateX = 0;
  let translateY = 0;

  const lightbox = document.createElement('div');
  lightbox.id = 'hti-diagram-lightbox';
  lightbox.className = 'hti-diagram-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', `${graphic.title} ${uiText('图表放大查看', 'Diagram Zoom Viewer')}`);

  // Header toolbar
  const header = document.createElement('header');
  header.className = 'hti-diagram-lightbox-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'hti-diagram-lightbox-title-wrap';

  const title = document.createElement('span');
  title.className = 'hti-diagram-lightbox-title';
  title.textContent = graphic.title;

  const scaleBadge = document.createElement('span');
  scaleBadge.className = 'hti-diagram-lightbox-scale';
  scaleBadge.textContent = '100%';

  titleWrap.append(title, scaleBadge);

  const actions = document.createElement('div');
  actions.className = 'hti-diagram-lightbox-actions';

  const btnOut = document.createElement('button');
  btnOut.type = 'button';
  btnOut.className = 'hti-diagram-lightbox-btn';
  btnOut.dataset.action = 'zoom-out';
  btnOut.textContent = '−';
  btnOut.title = uiText('缩小 (-)', 'Zoom out (-)');
  btnOut.setAttribute('aria-label', btnOut.title);

  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.className = 'hti-diagram-lightbox-btn';
  btnReset.dataset.action = 'reset';
  btnReset.textContent = '1:1';
  btnReset.title = uiText('重置 (0)', 'Reset zoom (0)');
  btnReset.setAttribute('aria-label', btnReset.title);

  const btnIn = document.createElement('button');
  btnIn.type = 'button';
  btnIn.className = 'hti-diagram-lightbox-btn';
  btnIn.dataset.action = 'zoom-in';
  btnIn.textContent = '+';
  btnIn.title = uiText('放大 (+)', 'Zoom in (+)');
  btnIn.setAttribute('aria-label', btnIn.title);

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'hti-diagram-lightbox-btn hti-diagram-lightbox-close';
  btnClose.dataset.action = 'close';
  btnClose.textContent = '✕';
  btnClose.title = uiText('关闭 (Esc)', 'Close (Esc)');
  btnClose.setAttribute('aria-label', btnClose.title);

  actions.append(btnOut, btnReset, btnIn, btnClose);
  header.append(titleWrap, actions);

  // Viewport & stage
  const viewport = document.createElement('div');
  viewport.className = 'hti-diagram-lightbox-viewport';

  const stage = document.createElement('div');
  stage.className = 'hti-diagram-lightbox-stage';
  stage.append(graphic.element);
  viewport.append(stage);

  // Footer hint
  const hint = document.createElement('div');
  hint.className = 'hti-diagram-lightbox-hint';
  hint.textContent = uiText('滚轮/双指缩放 · 拖拽平移 · 双击还原', 'Scroll or pinch to zoom · Drag to pan · Double click to reset');

  lightbox.append(header, viewport, hint);
  document.body.append(lightbox);
  activeLightbox = lightbox;

  function update(animate = false) {
    stage.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    stage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    scaleBadge.textContent = `${Math.round(scale * 100)}%`;
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const rect = viewport.getBoundingClientRect();
    const cx = clientX !== undefined ? clientX - rect.left - rect.width / 2 : 0;
    const cy = clientY !== undefined ? clientY - rect.top - rect.height / 2 : 0;
    const nextScale = Math.min(10, Math.max(0.2, scale * factor));
    translateX = cx - (cx - translateX) * (nextScale / scale);
    translateY = cy - (cy - translateY) * (nextScale / scale);
    scale = nextScale;
    update(true);
  }

  // Actions click
  header.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'zoom-in') zoomAt(1.25);
    else if (action === 'zoom-out') zoomAt(0.8);
    else if (action === 'reset') { scale = 1.0; translateX = 0; translateY = 0; update(true); }
    else if (action === 'close') closeDiagramLightbox();
  });

  // Pointer drag
  let isDragging = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let startTranslateX = 0;
  let startTranslateY = 0;
  let dragMoved = false;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isDragging = true;
    dragMoved = false;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    startTranslateX = translateX;
    startTranslateY = translateY;
    viewport.classList.add('is-dragging');
    try { viewport.setPointerCapture?.(e.pointerId); } catch {}
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;
    if (Math.hypot(dx, dy) > 4) dragMoved = true;
    translateX = startTranslateX + dx;
    translateY = startTranslateY + dy;
    update(false);
  });

  const stopDrag = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    viewport.classList.remove('is-dragging');
    try { viewport.releasePointerCapture?.(e.pointerId); } catch {}
  };
  viewport.addEventListener('pointerup', stopDrag);
  viewport.addEventListener('pointercancel', stopDrag);

  // Mouse wheel zoom
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(factor, e.clientX, e.clientY);
  };
  viewport.addEventListener('wheel', onWheel, { passive: false });

  // Touch pinch-to-zoom (mobile 2-finger)
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchMidX = 0;
  let pinchMidY = 0;
  let isPinching = false;

  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;
      isDragging = false;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      pinchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchStartScale = scale;
      const rect = viewport.getBoundingClientRect();
      pinchMidX = (t0.clientX + t1.clientX) / 2 - rect.left - rect.width / 2;
      pinchMidY = (t0.clientY + t1.clientY) / 2 - rect.top - rect.height / 2;
    }
  }, { passive: true });

  const onTouchMove = (e: TouchEvent) => {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      if (pinchStartDist > 0) {
        const factor = dist / pinchStartDist;
        const nextScale = Math.min(10, Math.max(0.2, pinchStartScale * factor));
        translateX = pinchMidX - (pinchMidX - translateX) * (nextScale / scale);
        translateY = pinchMidY - (pinchMidY - translateY) * (nextScale / scale);
        scale = nextScale;
        update(false);
      }
    }
  };
  viewport.addEventListener('touchmove', onTouchMove, { passive: false });

  viewport.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) isPinching = false;
  }, { passive: true });

  // Double-click to toggle zoom
  viewport.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (scale > 1.25) {
      scale = 1.0;
      translateX = 0;
      translateY = 0;
      update(true);
    } else {
      zoomAt(2.5, e.clientX, e.clientY);
    }
  });

  // Backdrop click to close (when not dragging)
  viewport.addEventListener('click', (e) => {
    if (e.target === viewport && !dragMoved) {
      closeDiagramLightbox();
    }
  });

  // Keyboard
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDiagramLightbox();
    } else if (e.key === '+' || e.key === '=') {
      zoomAt(1.25);
    } else if (e.key === '-' || e.key === '_') {
      zoomAt(0.8);
    } else if (e.key === '0') {
      scale = 1.0;
      translateX = 0;
      translateY = 0;
      update(true);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  activeCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    viewport.removeEventListener('wheel', onWheel);
    viewport.removeEventListener('touchmove', onTouchMove);
  };

  update(false);
  btnClose.focus({ preventScroll: true });
  return lightbox;
}

export function createDiagramZoomButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hti-rich-diagram-zoom';
  btn.textContent = uiText('放大', 'Zoom');
  btn.title = uiText('全屏放大查看', 'Open zoomable diagram');
  btn.setAttribute('aria-label', btn.title);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function installDiagramLightbox(): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Ignore clicks inside details (source code view) or copy button
    if (target.closest('.hti-rich-mermaid-source, .hti-rich-code-copy')) return;

    // 1. Direct zoom button click
    const zoomBtn = target.closest<HTMLElement>('.hti-rich-diagram-zoom');
    if (zoomBtn) {
      const host = zoomBtn.closest<HTMLElement>('.hti-rich-mermaid, .hti-rich-plantuml, .hti-mermaid');
      if (host) {
        event.preventDefault();
        openDiagramLightbox(host);
        return;
      }
    }

    // 2. Click on diagram SVG or IMG
    const container = target.closest<HTMLElement>('.hti-rich-mermaid-svg, .hti-mermaid');
    if (container) {
      if (target.closest('a')) return; // Allow node link navigation
      const host = container.closest<HTMLElement>('.hti-rich-mermaid, .hti-rich-plantuml') || container;
      if (host.classList.contains('hti-rich-mermaid-error')) return;
      if (!container.querySelector('svg, img')) return;
      event.preventDefault();
      openDiagramLightbox(host);
    }
  };

  document.addEventListener('click', onClick);
  return () => {
    document.removeEventListener('click', onClick);
    closeDiagramLightbox();
  };
}

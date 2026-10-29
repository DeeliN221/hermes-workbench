// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDiagramLightbox,
  extractDiagramGraphic,
  installDiagramLightbox,
  openDiagramLightbox,
} from '../dashboard/src/diagram-lightbox';

describe('diagram lightbox viewer', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    uninstall = installDiagramLightbox();
  });

  afterEach(() => {
    closeDiagramLightbox();
    uninstall?.();
    uninstall = null;
    document.body.replaceChildren();
  });

  function createMermaidFixture(): HTMLElement {
    const host = document.createElement('section');
    host.className = 'hti-rich-mermaid';
    host.dataset.mermaidSource = 'graph TD; A-->B;';
    const header = document.createElement('div');
    header.className = 'hti-rich-mermaid-header';
    const controls = document.createElement('div');
    controls.className = 'hti-rich-mermaid-controls';
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'hti-rich-diagram-zoom';
    zoomBtn.textContent = 'Zoom';
    controls.append(zoomBtn);
    header.append(controls);
    const svgBox = document.createElement('div');
    svgBox.className = 'hti-rich-mermaid-svg';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    svgBox.append(svg);
    host.append(header, svgBox);
    document.body.append(host);
    return host;
  }

  function createPlantUMLFixture(): HTMLElement {
    const host = document.createElement('section');
    host.className = 'hti-rich-plantuml hti-rich-mermaid';
    host.dataset.plantumlSource = '@startuml\nA -> B\n@enduml';
    const header = document.createElement('div');
    header.className = 'hti-rich-mermaid-header';
    const controls = document.createElement('div');
    controls.className = 'hti-rich-mermaid-controls';
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'hti-rich-diagram-zoom';
    zoomBtn.textContent = 'Zoom';
    controls.append(zoomBtn);
    header.append(controls);
    const svgBox = document.createElement('div');
    svgBox.className = 'hti-rich-mermaid-svg';
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E';
    svgBox.append(img);
    host.append(header, svgBox);
    document.body.append(host);
    return host;
  }

  it('extracts SVG from Mermaid and IMG from PlantUML host', () => {
    const mermaidHost = createMermaidFixture();
    const mermaidGraphic = extractDiagramGraphic(mermaidHost);
    expect(mermaidGraphic).not.toBeNull();
    expect(mermaidGraphic?.title).toBe('Mermaid');
    expect(mermaidGraphic?.element.tagName.toLowerCase()).toBe('svg');

    const plantumlHost = createPlantUMLFixture();
    const plantumlGraphic = extractDiagramGraphic(plantumlHost);
    expect(plantumlGraphic).not.toBeNull();
    expect(plantumlGraphic?.title).toBe('PlantUML');
    expect(plantumlGraphic?.element.tagName.toLowerCase()).toBe('img');
  });

  it('opens lightbox on diagram click and adjusts zoom via buttons', () => {
    const host = createMermaidFixture();
    const svgBox = host.querySelector('.hti-rich-mermaid-svg') as HTMLElement;
    svgBox.click();

    const lightbox = document.getElementById('hti-diagram-lightbox');
    expect(lightbox).not.toBeNull();
    expect(lightbox?.getAttribute('aria-label')).toContain('Mermaid');

    const scaleBadge = lightbox?.querySelector('.hti-diagram-lightbox-scale');
    expect(scaleBadge?.textContent).toBe('100%');

    const btnIn = lightbox?.querySelector('button[data-action="zoom-in"]') as HTMLButtonElement;
    btnIn.click();
    expect(scaleBadge?.textContent).toBe('125%');

    const btnOut = lightbox?.querySelector('button[data-action="zoom-out"]') as HTMLButtonElement;
    btnOut.click();
    expect(scaleBadge?.textContent).toBe('100%');

    const btnReset = lightbox?.querySelector('button[data-action="reset"]') as HTMLButtonElement;
    btnIn.click();
    expect(scaleBadge?.textContent).toBe('125%');
    btnReset.click();
    expect(scaleBadge?.textContent).toBe('100%');

    const btnClose = lightbox?.querySelector('button[data-action="close"]') as HTMLButtonElement;
    btnClose.click();
    expect(document.getElementById('hti-diagram-lightbox')).toBeNull();
  });

  it('opens PlantUML lightbox via zoom button and closes with Escape key', () => {
    const host = createPlantUMLFixture();
    const zoomBtn = host.querySelector('.hti-rich-diagram-zoom') as HTMLElement;
    zoomBtn.click();

    const lightbox = document.getElementById('hti-diagram-lightbox');
    expect(lightbox).not.toBeNull();
    expect(lightbox?.getAttribute('aria-label')).toContain('PlantUML');
    expect(lightbox?.querySelector('.hti-diagram-lightbox-stage img')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('hti-diagram-lightbox')).toBeNull();
  });

  it('does not open when diagram has an error', () => {
    const host = createMermaidFixture();
    host.classList.add('hti-rich-mermaid-error');
    const svgBox = host.querySelector('.hti-rich-mermaid-svg') as HTMLElement;
    svgBox.click();
    expect(document.getElementById('hti-diagram-lightbox')).toBeNull();
  });
});

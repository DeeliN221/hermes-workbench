// Self-hosted PlantUML 1.2026.8 browser engine. Loaded only for PlantUML diagrams.
import './viz-global.js';
import './themes.js';
import './openiconic.js';
import './emoji.js';
import { renderToString } from './plantuml.js';
window.PLANTUML_STDLIB_BASE = new URL('.', import.meta.url).href;
window.workbenchPlantUML = { renderToString };

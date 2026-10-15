/** Build Workbench from readable source instead of relying on read-only release bundles. */
import './platform-status';
import './recovered-runtime.css';
// Keep the complete Chinese literal pack in the canonical build.  The
// achievements plugin is a Hermes-native bundle, so it cannot rely on the
// Workbench runtime's smaller embedded dictionary alone.
import './zh-locale';
import './recovered-runtime.js';
import { installKanbanDeleteBoardScope } from './kanban-delete-board-scope';

installKanbanDeleteBoardScope();

import "./project-navigation.css";
import "./cron-mobile.css";
import { installWorkbenchVersionSettings } from './workbench-version-settings';

installWorkbenchVersionSettings();

import './minecraft-sidebar.css';
import './minecraft-theme.css';
import './selectable-markdown.css';

import './kanban-workflow.css';

import { installFilesDirectoryNavigation } from './files-directory-navigation';
installFilesDirectoryNavigation();

import './profile-controls.css';

import './recent-home.css';

import './compact-actions.css';

import { installMobileSettings } from './mobile-settings';
installMobileSettings();

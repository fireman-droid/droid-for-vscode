import { PinwheelIcon } from '@droidvisx/chat-ui/ui/pinwheel-icon';
import { SelectionIndicator } from '@droidvisx/chat-ui/ui/selection-indicator';
import { Boxes, MessageSquare, PanelLeft, Settings2, TextCursorInput, Workflow } from 'lucide-react';
import { MANAGEMENT_PAGES, type ManagementPage } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlays';

const names = { general: '常规', models: '模型', completion: '智能补全', sessions: '会话', missions: 'Missions' };
const icons = { general: Settings2, models: Boxes, completion: TextCursorInput, sessions: MessageSquare, missions: Workflow };

export function ManagementSidebar({ page, collapsed, version, onToggle, onNavigate }: {
  readonly page: ManagementPage;
  readonly collapsed: boolean;
  readonly version: string | undefined;
  readonly onToggle: () => void;
  readonly onNavigate: (page: ManagementPage) => void;
}) {
  return <aside className="management-sidebar">
    <Tooltip content={collapsed ? '展开侧栏' : '收起侧栏'}>
      <Button variant="plain" size="icon-sm" className="management-sidebar-toggle"
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed}
        aria-controls="management-navigation" onClick={onToggle}><PanelLeft /></Button>
    </Tooltip>
    <nav id="management-navigation" aria-label="管理页面" data-animated-indicator>
      {MANAGEMENT_PAGES.map(key => {
        const Icon = icons[key];
        return <Tooltip key={key} content={names[key]}><Button variant="plain" size="none"
          className="management-nav" aria-label={names[key]} aria-current={page === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}><Icon /><span className="management-nav-label">{names[key]}</span></Button></Tooltip>;
      })}
      <SelectionIndicator activeSelector='[aria-current="page"]' variant="surface" />
    </nav>
    <div className="management-sidebar-footer">
      <small className="management-version"><PinwheelIcon className="size-3.5 shrink-0" /><span>Droid {version ?? ''}</span></small>
    </div>
  </aside>;
}

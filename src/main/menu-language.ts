interface MenuLabels {
  items: readonly { label: string; submenu?: MenuLabels }[]
}

const labels: Record<string, string> = {
  File: '文件', Edit: '编辑', View: '视图', Window: '窗口', Help: '帮助',
  'About Electron': '关于 Electron', 'About EnglishAsk': '关于 EnglishAsk',
  Services: '服务', 'Hide Electron': '隐藏 Electron', 'Hide EnglishAsk': '隐藏 EnglishAsk',
  'Hide Others': '隐藏其他应用', 'Show All': '显示全部', Quit: '退出',
  'Quit Electron': '退出 Electron', 'Quit EnglishAsk': '退出 EnglishAsk',
  Close: '关闭窗口', 'Close Window': '关闭窗口', Undo: '撤销', Redo: '重做',
  Cut: '剪切', Copy: '复制', Paste: '粘贴', 'Paste and Match Style': '粘贴并匹配样式',
  Delete: '删除', 'Select All': '全选', Speech: '朗读', 'Start Speaking': '开始朗读',
  'Stop Speaking': '停止朗读', Reload: '重新加载', 'Force Reload': '强制重新加载',
  'Toggle Developer Tools': '开发者工具', 'Actual Size': '实际大小',
  'Zoom In': '放大', 'Zoom Out': '缩小', 'Toggle Full Screen': '切换全屏',
  'Enter Full Screen': '进入全屏', 'Exit Full Screen': '退出全屏',
  Minimize: '最小化', Zoom: '缩放窗口', 'Bring All to Front': '全部置于前台',
  'Learn More': '了解更多', Documentation: '文档', 'Community Discussions': '社区讨论',
  'Search Issues': '搜索问题', 'Report Issue': '报告问题'
}

// Keep Electron's existing roles, shortcuts and callbacks; change labels only.
export function localizeMenuLabels(menu: MenuLabels): void {
  for (const item of menu.items) {
    item.label = labels[item.label.replace(/&/g, '')] ?? item.label
    if (item.submenu) localizeMenuLabels(item.submenu)
  }
}

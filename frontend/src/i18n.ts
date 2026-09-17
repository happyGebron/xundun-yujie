import type { Locale } from './api'

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    product: '巡盾御界', subtitle: '空地一体化巡坝指挥台', university: '西南大学', overview: '态势', analysis: '分析', scenarios: '场景', coordination: '协同', replay: '回放',
    skip: '跳转到主要工作区', connect: '连接中', live: '实时', retrying: '正在重连', offline: '离线轮询', cycle: '周期', coverage: '覆盖', link: '链路',
    start: '启动任务', pause: '暂停任务', step: '单步', reset: '重置任务', ready: '待命', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败',
    mapTitle: '坝区协同态势', mapEyebrow: '实时任务工作面', grid: '仿真网格', uavTrack: 'UAV 航迹', ugvRoute: 'UGV 路径', riskPoint: '风险点', obstacle: '障碍区',
    riskQueue: '风险队列', highPriority: '项高风险', onlineUnits: '在线单元', localSpeed: '局部速度', safeClearance: '安全净空', currentRisk: '当前风险', fusionScore: '融合分数',
    assigned: '执行单元', unassigned: '等待分派', source: '来源', position: '坐标', evidence: '证据构成', confirm: '确认风险', dismiss: '排除风险', note: '复核备注', saveReview: '保存复核',
    noRisk: '当前任务没有风险点', analysisTitle: '算法分析', analysisIntro: '上传图像、热成像矩阵、传感器时序或短视频。原始文件在处理完成后删除。',
    rgb: 'RGB 图像', video: '短视频', thermal: '热成像 CSV', sensor: '传感器 CSV', bindLocation: '将结果加入当前任务', xCoord: '横坐标 X', yCoord: '纵坐标 Y',
    upload: '提交分析', multimodalSample: '运行多模态样例', videoSample: '运行视频样例', fileRules: '图像 20 MB；CSV 5 MB；MP4 100 MB / 60 秒', noAnalysis: '尚无分析记录',
    validating: '校验中', uploading: '上传中', queued: '排队中', processing: '处理中', analysisCompleted: '分析完成', analysisFailed: '分析失败', quality: '数据质量', score: '异常分数', weight: '有效权重', contribution: '融合贡献',
    resultEvidence: '结果证据', keyframes: '视频关键帧', riskCurve: '逐帧风险曲线', candidateRegions: '候选区域', sha: '文件哈希', technicalBoundary: '输出用于算法演示，不替代工程检测结论。',
    scenariosTitle: '建立仿真任务', scenariosIntro: '选择场景并调整有限参数；相同种子会复现相同地图和事件顺序。', seed: '随机种子', riskCount: '风险点数量', obstacleCount: '障碍物数量', initialLink: '初始链路质量', createMission: '创建任务', selectedScenario: '当前场景',
    coordinationTitle: '空地协同控制', assignment: '任务分配', pathPlanning: '路径规划', localControl: 'DWA 局部控制', communication: '通信协同', algorithm: '算法', totalCost: '总代价', runtime: '运行时间', expanded: '扩展节点', routeLength: '路径长度', matrix: '代价矩阵',
    hungarian: '匈牙利算法', greedy: '贪心分配', aStar: 'A*', dijkstra: 'Dijkstra', noComparison: '启动任务后显示同一快照下的算法对比。', candidates: '候选轨迹', chosen: '当前控制', prediction: '预测时域',
    faults: '受控故障', meshFault: '链路衰减', obstacleFault: '动态障碍', thermalFault: '热源漂移', gpsFault: '定位降级', relay: '中继节点', normal: '正常', meshRelay: '空中中继',
    replayTitle: '任务历史与事件回放', missionHistory: '任务记录', eventTimeline: '事件时间线', previous: '上一事件', next: '下一事件', playReplay: '播放回放', pauseReplay: '暂停回放', eventFilter: '事件类型', allEvents: '全部事件', noEvents: '当前任务没有事件记录',
    export: '导出', exportJson: '完整 JSON', exportRisks: '风险 CSV', exportEvents: '事件 CSV', exportComparisons: '算法 CSV', print: '打印报告', created: '创建时间', updated: '更新时间',
    reportTitle: '巡检任务报告', reportBoundary: '本报告来自软件算法和二维协同仿真，不构成工程安全评估。', summary: '任务摘要', analyses: '算法分析记录', reviews: '人工复核',
    status: '状态', battery: '电量', mode: '模式', target: '目标', speed: '速度', heading: '航向', selected: '已选择', events: '事件', analysesCount: '分析记录',
    retry: '重试', loading: '正在载入本地任务数据', requestFailed: '操作未完成', stateSynced: '状态已同步', missionCreated: '任务已创建', commandApplied: '命令已执行', analysisSubmitted: '分析任务已提交', reviewSaved: '复核结果已保存', faultInjected: '故障已注入',
    low: '低', medium: '中', high: '高', pending: '待复核', field_verified: '现场已核', confirmed: '已确认', dismissed: '已排除', navigating: '导航中', scanning: '扫描中', idle: '待命', holding: '保持位置', verifying: '现场复核', offlineAgent: '离线',
    'routine-inspection': '日常巡检', 'rainfall-seepage': '降雨渗漏', 'link-degradation': '通信衰减', 'dynamic-obstacle': '动态障碍',
    'aerial-scan': '航线扫描', 'ground-verification': '地面复核', 'on-site-verification': '现场复核', standby: '待命', 'mesh-relay': '通信中继',
    version: 'V2.0.0 · 算法与协同仿真', deleteOriginals: '原始上传文件不保存', noSelection: '请选择一条记录', locale: 'English',
  },
  'en-US': {
    product: 'Xundun Yujie', subtitle: 'Air-ground dam patrol console', university: 'Southwest University', overview: 'Overview', analysis: 'Analysis', scenarios: 'Scenarios', coordination: 'Coordination', replay: 'Replay',
    skip: 'Skip to primary workspace', connect: 'Connecting', live: 'Live', retrying: 'Reconnecting', offline: 'Offline polling', cycle: 'Cycle', coverage: 'Coverage', link: 'Link',
    start: 'Start mission', pause: 'Pause mission', step: 'Step', reset: 'Reset mission', ready: 'Ready', running: 'Running', paused: 'Paused', completed: 'Completed', failed: 'Failed',
    mapTitle: 'Dam coordination view', mapEyebrow: 'Live operational surface', grid: 'simulation grid', uavTrack: 'UAV track', ugvRoute: 'UGV route', riskPoint: 'Risk', obstacle: 'Obstacle',
    riskQueue: 'Risk queue', highPriority: 'high priority', onlineUnits: 'Online units', localSpeed: 'Local speed', safeClearance: 'Safe clearance', currentRisk: 'Selected risk', fusionScore: 'Fusion score',
    assigned: 'Assigned unit', unassigned: 'Awaiting assignment', source: 'Source', position: 'Position', evidence: 'Evidence', confirm: 'Confirm risk', dismiss: 'Dismiss risk', note: 'Review note', saveReview: 'Save review',
    noRisk: 'This mission has no risk locations', analysisTitle: 'Algorithm analysis', analysisIntro: 'Upload an image, thermal matrix, sensor series, or short video. Raw files are deleted after processing.',
    rgb: 'RGB image', video: 'Short video', thermal: 'Thermal CSV', sensor: 'Sensor CSV', bindLocation: 'Add result to current mission', xCoord: 'X coordinate', yCoord: 'Y coordinate',
    upload: 'Submit analysis', multimodalSample: 'Run multimodal sample', videoSample: 'Run video sample', fileRules: 'Image 20 MB; CSV 5 MB; MP4 100 MB / 60 s', noAnalysis: 'No analysis records yet',
    validating: 'Validating', uploading: 'Uploading', queued: 'Queued', processing: 'Processing', analysisCompleted: 'Completed', analysisFailed: 'Failed', quality: 'Data quality', score: 'Anomaly score', weight: 'Effective weight', contribution: 'Fusion contribution',
    resultEvidence: 'Result evidence', keyframes: 'Video keyframes', riskCurve: 'Frame risk curve', candidateRegions: 'Candidate regions', sha: 'File hash', technicalBoundary: 'Results demonstrate algorithms and do not replace engineering inspection.',
    scenariosTitle: 'Create simulation mission', scenariosIntro: 'Choose a scenario and tune bounded parameters. The same seed reproduces the same map and event order.', seed: 'Random seed', riskCount: 'Risk locations', obstacleCount: 'Obstacles', initialLink: 'Initial link quality', createMission: 'Create mission', selectedScenario: 'Selected scenario',
    coordinationTitle: 'Air-ground coordination', assignment: 'Task assignment', pathPlanning: 'Path planning', localControl: 'DWA local control', communication: 'Communications', algorithm: 'Algorithm', totalCost: 'Total cost', runtime: 'Runtime', expanded: 'Expanded nodes', routeLength: 'Path length', matrix: 'Cost matrix',
    hungarian: 'Hungarian', greedy: 'Greedy', aStar: 'A*', dijkstra: 'Dijkstra', noComparison: 'Start a mission to compare algorithms on the same snapshot.', candidates: 'Candidate trajectories', chosen: 'Selected control', prediction: 'Prediction horizon',
    faults: 'Controlled faults', meshFault: 'Link degradation', obstacleFault: 'Dynamic obstacle', thermalFault: 'Thermal drift', gpsFault: 'Positioning loss', relay: 'Relay node', normal: 'Normal', meshRelay: 'Aerial relay',
    replayTitle: 'Mission history and event replay', missionHistory: 'Mission records', eventTimeline: 'Event timeline', previous: 'Previous', next: 'Next', playReplay: 'Play replay', pauseReplay: 'Pause replay', eventFilter: 'Event type', allEvents: 'All events', noEvents: 'This mission has no events',
    export: 'Export', exportJson: 'Full JSON', exportRisks: 'Risks CSV', exportEvents: 'Events CSV', exportComparisons: 'Algorithms CSV', print: 'Print report', created: 'Created', updated: 'Updated',
    reportTitle: 'Patrol mission report', reportBoundary: 'This report comes from software algorithms and 2D coordination simulation; it is not an engineering safety assessment.', summary: 'Mission summary', analyses: 'Analysis records', reviews: 'Manual reviews',
    status: 'Status', battery: 'Battery', mode: 'Mode', target: 'Target', speed: 'Speed', heading: 'Heading', selected: 'Selected', events: 'Events', analysesCount: 'Analyses',
    retry: 'Retry', loading: 'Loading local mission data', requestFailed: 'Operation failed', stateSynced: 'State synchronized', missionCreated: 'Mission created', commandApplied: 'Command applied', analysisSubmitted: 'Analysis queued', reviewSaved: 'Review saved', faultInjected: 'Fault injected',
    low: 'Low', medium: 'Medium', high: 'High', pending: 'Pending', field_verified: 'Field verified', confirmed: 'Confirmed', dismissed: 'Dismissed', navigating: 'Navigating', scanning: 'Scanning', idle: 'Idle', holding: 'Holding', verifying: 'Verifying', offlineAgent: 'Offline',
    'routine-inspection': 'Routine inspection', 'rainfall-seepage': 'Rainfall seepage', 'link-degradation': 'Link degradation', 'dynamic-obstacle': 'Dynamic obstacle',
    'aerial-scan': 'Aerial scan', 'ground-verification': 'Ground verification', 'on-site-verification': 'On-site verification', standby: 'Standby', 'mesh-relay': 'Mesh relay',
    version: 'V2.0.0 · Algorithms and coordination simulation', deleteOriginals: 'Raw uploads are not retained', noSelection: 'Select a record', locale: '中文',
  },
}

export function t(locale: Locale, key: string, values?: Record<string, string | number>) {
  let value = messages[locale][key] ?? messages['en-US'][key] ?? key
  if (values) Object.entries(values).forEach(([name, replacement]) => { value = value.replace(`{${name}}`, String(replacement)) })
  return value
}

export function initialLocale(): Locale {
  try {
    return localStorage.getItem('xundun.locale') === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem('xundun.locale', locale)
  } catch {
    return
  }
}

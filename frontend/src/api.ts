export type Locale = 'zh-CN' | 'en-US'
export type ConnectionState = 'connecting' | 'live' | 'retrying' | 'offline'
export type MissionStatus = 'ready' | 'running' | 'paused' | 'completed' | 'failed'
export type AgentStatus = 'idle' | 'scanning' | 'assigned' | 'navigating' | 'verifying' | 'holding' | 'offline'

export type Agent = {
  id: string
  type: 'UAV' | 'UGV'
  name_key: string
  position: [number, number]
  battery: number
  link: number
  status: AgentStatus
  mode: string
  heading_deg: number
  linear_velocity: number
  angular_velocity: number
  target_risk: string | null
  route: [number, number][]
  trail: [number, number][]
}

export type Risk = {
  id: string
  name_key: string
  name_zh: string
  name_en: string
  position: [number, number]
  severity: 'high' | 'medium' | 'low'
  score: number
  status: string
  assigned: string | null
  source: string
  evidence: Record<string, unknown>
}

export type AlgorithmResult = {
  algorithm: string
  path: [number, number][]
  cost: number
  length: number
  expanded_nodes: number
  runtime_ms: number
  reachable: boolean
}

export type AssignmentMethod = {
  pairs: { agent_id: string; risk_id: string; cost: number }[]
  total_cost: number
  runtime_ms: number
  assigned: number
  unassigned: number
}

export type MissionState = {
  version: string
  mission: {
    id: string
    scenario_id: string
    scenario_name: string
    seed: number
    status: MissionStatus
    speed: number
    cycle: number
    created_at: string
    updated_at: string
  }
  config: { parameters: { risk_count: number; obstacle_count: number; link_quality: number }; scenario: Scenario; [key: string]: unknown }
  grid: { width: number; height: number; obstacles: [number, number][]; dynamic_obstacles: [number, number][] }
  agents: Agent[]
  risks: Risk[]
  mesh: { health: number; mode: string; relay: string | null; fault: string | null }
  summary: { risk_count: number; high_risk_count: number; online_agents: number; coverage: number }
  comparisons: {
    assignment: null | { agents: string[]; risks: string[]; matrix: number[][]; hungarian: AssignmentMethod; greedy: AssignmentMethod }
    paths: { agent_id: string; risk_id: string; a_star: AlgorithmResult; dijkstra: AlgorithmResult }[]
  }
  last_control: {
    method: string
    prediction_horizon_s?: number
    heading_deg: number
    speed_mps: number
    angular_velocity: number
    clearance_cells: number
    chosen: DwaCandidate | null
    candidates: DwaCandidate[]
  }
  timeline: TimelineEvent[]
  stream_sequence: number
}

export type DwaCandidate = {
  linear_velocity: number
  angular_velocity: number
  clearance: number
  score: number
  collision_free: boolean
  trajectory: [number, number][]
}

export type TimelineEvent = {
  type: string
  code: string
  level: string
  data: Record<string, unknown>
  sequence?: number
  timestamp?: string
  text_zh?: string
  text_en?: string
}

export type Scenario = {
  id: string
  name_zh: string
  name_en: string
  description_zh: string
  description_en: string
  risk_bias: number
  defaults: { risk_count: number; obstacle_count: number; link_quality: number }
}

export type MissionSummary = {
  id: string
  scenario_id: string
  scenario_name: string
  status: MissionStatus
  cycle: number
  speed: number
  coverage: number
  risk_count: number
  created_at: string
  updated_at: string
}

export type EventRecord = {
  sequence: number
  type: string
  level: string
  timestamp: string
  data: TimelineEvent
  snapshot: MissionState
}

export type ModalityResult = {
  quality: number
  score: number
  level: 'high' | 'medium' | 'low'
  explanation_codes: string[]
  artifact?: string
  artifacts?: string[]
  regions?: { bbox: [number, number, number, number]; area: number; score?: number; peak_z?: number }[]
  curve?: { time_s: number; score: number; level: string }[]
  keyframes?: { time_s: number; score: number; artifact: string }[]
  series?: { timestamp: number; value: number }[]
  [key: string]: unknown
}

export type Analysis = {
  id: string
  mission_id: string | null
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  modalities: Record<string, { filename: string; mime: string; bytes: number; sha256: string; sample?: boolean }>
  result: null | {
    modalities: Record<string, ModalityResult>
    fusion: {
      score: number
      level: 'high' | 'medium' | 'low'
      effective_weights: Record<string, number>
      contributions: Record<string, number>
      explanation_codes: string[]
    }
    artifacts: string[]
  }
  error: null | { code: string; message: string }
  created_at: string
  updated_at: string
}

export class ApiProblem extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } })
  const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
  if (!response.ok) throw new ApiProblem(payload.error?.code ?? 'REQUEST_FAILED', payload.error?.message ?? `Request failed (${response.status})`, response.status)
  return payload as T
}

export const api = {
  scenarios: () => json<Scenario[]>('/api/v2/scenarios'),
  missions: () => json<MissionSummary[]>('/api/v2/missions'),
  mission: (id: string) => json<MissionState>(`/api/v2/missions/${id}`),
  events: (id: string, after = 0) => json<EventRecord[]>(`/api/v2/missions/${id}/events?after_sequence=${after}`),
  analyses: (missionId?: string) => json<Analysis[]>(`/api/v2/analyses${missionId ? `?mission_id=${encodeURIComponent(missionId)}` : ''}`),
  analysis: (id: string) => json<Analysis>(`/api/v2/analyses/${id}`),
  createMission: (body: { scenario_id: string; seed: number; parameters: { risk_count: number; obstacle_count: number; link_quality: number } }) =>
    json<MissionState>('/api/v2/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  command: (missionId: string, command: string, value?: number) =>
    json<MissionState>(`/api/v2/missions/${missionId}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, value }) }),
  review: (missionId: string, riskId: string, decision: 'confirmed' | 'dismissed', note?: string) =>
    json<MissionState>(`/api/v2/missions/${missionId}/risks/${riskId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note: note || null }) }),
  fault: (missionId: string, kind: string) => json<MissionState>(`/api/v2/missions/${missionId}/faults?kind=${encodeURIComponent(kind)}`, { method: 'POST' }),
  upload: (body: FormData) => json<{ analysis_id: string; status: string; sha256_manifest: Record<string, string> }>('/api/v2/analyses', { method: 'POST', body }),
  sample: (body: { mission_id?: string; kind: 'multimodal' | 'video'; x?: number; y?: number }) =>
    json<{ analysis_id: string; status: string }>('/api/v2/analyses/sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}

export function artifactUrl(filename: string) {
  return `/api/v2/artifacts/${encodeURIComponent(filename)}`
}

type StreamHandlers = {
  onState: (state: MissionState) => void
  onAnalysis: (data: Record<string, unknown>) => void
  onConnection: (status: ConnectionState) => void
  onError: (message: string) => void
}

export function subscribeMission(missionId: string, initialSequence: number, handlers: StreamHandlers) {
  let stopped = false
  let socket: WebSocket | null = null
  let reconnectTimer = 0
  let pollingTimer = 0
  let attempt = 0
  let sequence = initialSequence
  const delays = [1000, 2000, 4000, 8000, 15000]

  const stopPolling = () => {
    if (pollingTimer) window.clearInterval(pollingTimer)
    pollingTimer = 0
  }

  const poll = async () => {
    try {
      const state = await api.mission(missionId)
      sequence = Math.max(sequence, state.stream_sequence)
      handlers.onState(state)
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : 'Polling failed')
    }
  }

  const startPolling = () => {
    if (pollingTimer) return
    void poll()
    pollingTimer = window.setInterval(() => void poll(), 5000)
  }

  const connect = () => {
    if (stopped) return
    handlers.onConnection(attempt === 0 ? 'connecting' : attempt >= 4 ? 'offline' : 'retrying')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${scheme}://${window.location.host}/api/v2/missions/${missionId}/stream?after_sequence=${sequence}`)
    socket.onopen = () => {
      attempt = 0
      stopPolling()
      handlers.onConnection('live')
    }
    socket.onmessage = event => {
      const message = JSON.parse(event.data) as { type: string; sequence: number; data: MissionState | { snapshot?: MissionState } | Record<string, unknown> }
      if (message.sequence && message.sequence <= sequence && message.type === 'event') return
      sequence = Math.max(sequence, message.sequence || 0)
      if (message.type === 'snapshot') handlers.onState(message.data as MissionState)
      if (message.type === 'event' && 'snapshot' in message.data && message.data.snapshot) handlers.onState(message.data.snapshot as MissionState)
      if (message.type === 'analysis_progress') handlers.onAnalysis(message.data as Record<string, unknown>)
    }
    socket.onerror = () => socket?.close()
    socket.onclose = () => {
      if (stopped) return
      attempt += 1
      handlers.onConnection(attempt >= 4 ? 'offline' : 'retrying')
      if (attempt >= 4) startPolling()
      reconnectTimer = window.setTimeout(connect, delays[Math.min(attempt - 1, delays.length - 1)])
    }
  }

  connect()
  return () => {
    stopped = true
    window.clearTimeout(reconnectTimer)
    stopPolling()
    socket?.close()
  }
}

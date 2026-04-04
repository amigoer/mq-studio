import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Search, Loader2, Copy, CalendarIcon, Maximize2, Send, X, RotateCw } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn, formatErrorMessage } from '@/lib/utils'
import { useSettings } from '@/hooks/useSettings'
import type { MessageItem } from '../../bindings/rocket-leaf/internal/model/models.js'
import { MessageStatus } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as messageApi from '@/api/message'
import type { QueryCondition } from '@/api/message'
import * as topicApi from '@/api/topic'
import * as clusterApi from '@/api/cluster'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const DEFAULT_MAX_RESULTS = 32

const DELAY_LEVEL_OPTIONS = [
  { value: 0, label: '不延迟' },
  { value: 1, label: '1s' },
  { value: 2, label: '5s' },
  { value: 3, label: '10s' },
  { value: 4, label: '30s' },
  { value: 5, label: '1m' },
  { value: 6, label: '2m' },
  { value: 7, label: '3m' },
  { value: 8, label: '4m' },
  { value: 9, label: '5m' },
  { value: 10, label: '6m' },
  { value: 11, label: '7m' },
  { value: 12, label: '8m' },
  { value: 13, label: '9m' },
  { value: 14, label: '10m' },
  { value: 15, label: '20m' },
  { value: 16, label: '30m' },
  { value: 17, label: '1h' },
  { value: 18, label: '2h' },
]

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** 当前列表数据来源：未拉取 / 用户点击进阶查询 */
type FetchKind = 'none' | 'condition'

/** 尝试解析 JSON，返回解析结果或 null */
function tryParseJSON(s: string): unknown | null {
  if (!s?.trim()) return null
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

/** 格式化 JSON 字符串 */
function formatJSONString(s: string): string {
  const parsed = tryParseJSON(s)
  if (parsed === null) return s
  try {
    return JSON.stringify(parsed, null, 2)
  } catch {
    return s
  }
}

/** 简单 JSON 语法高亮：key 绿、字符串值 琥珀、数字 蓝 */
function highlightJSON(jsonStr: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  const re = /"(?:[^"\\]|\\.)*"(?=\s*:)|:?\s*"(?:[^"\\]|\\.)*"|:?\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonStr)) !== null) {
    if (m.index > lastIndex) parts.push(jsonStr.slice(lastIndex, m.index))
    const token = m[0]
    const rest = jsonStr.slice(re.lastIndex)
    const isKey = token.startsWith('"') && token.endsWith('"') && /^\s*:/.test(rest)
    if (isKey) {
      parts.push(<span key={m.index} className="text-emerald-700 dark:text-emerald-400">{token}</span>)
    } else if (/^:?\s*"/.test(token)) {
      parts.push(<span key={m.index} className="text-amber-700 dark:text-amber-400">{token}</span>)
    } else if (/^:?\s*-?\d/.test(token)) {
      parts.push(<span key={m.index} className="text-sky-600 dark:text-sky-400">{token}</span>)
    } else {
      parts.push(token)
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < jsonStr.length) parts.push(jsonStr.slice(lastIndex))
  return parts.length > 0 ? parts : jsonStr
}

/** 将字符串转为十六进制视图（每行 16 字节） */
function toHexView(s: string): string {
  if (!s) return '（空）'
  const encoder = new TextEncoder()
  const bytes = encoder.encode(s)
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16)
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
    const ascii = Array.from(chunk)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('')
    lines.push(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${ascii}`)
  }
  return lines.length > 0 ? lines.join('\n') : '（空）'
}

/** RocketMQ 系统属性 Key 集合，用于与业务属性区分 */
const SYSTEM_PROP_KEYS = new Set([
  'RECONSUME_TIMES', 'MAX_RECONSUME_TIMES', 'STORE_SIZE', 'MSG_REGION', 'KEYS', 'TAGS', 'REAL_TOPIC',
  'UNIQ_KEY', 'DELAY', 'TRANSACTION_PREPARED', '__TRAN_MSG', 'BORN_HOST', 'STORE_HOST', 'BORN_TIMESTAMP',
  'STORE_TIMESTAMP', 'QUEUE_ID', 'SYS_FLAG', 'MIN_OFFSET', 'MAX_OFFSET', 'CONSUME_START_TIME',
])

/** 将 datetime-local 字符串转为 Date，无效则返回 undefined */
function parseDatetimeLocal(s: string): Date | undefined {
  if (!s?.trim()) return undefined
  const d = new Date(s.trim())
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** 将 Date 格式化为 datetime-local 的 value (YYYY-MM-DDTHH:mm) */
function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTimestamp(timestamp: number, timezone: 'local' | 'utc', formatType: 'datetime' | 'ms'): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  if (formatType === 'ms') return String(timestamp)

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'

  if (timezone === 'utc') {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} UTC`
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function getMessageStoreTime(message: MessageItem, timezone: 'local' | 'utc', formatType: 'datetime' | 'ms'): string {
  if (typeof message.storeTimestamp === 'number' && message.storeTimestamp > 0) {
    return formatTimestamp(message.storeTimestamp, timezone, formatType)
  }
  return message.storeTime?.trim() || '—'
}

function getPayloadPreview(text: string, maxBytes: number): {
  text: string
  totalBytes: number
  truncated: boolean
} {
  const source = text ?? ''
  const bytes = textEncoder.encode(source)
  if (maxBytes <= 0 || bytes.length <= maxBytes) {
    return {
      text: source,
      totalBytes: bytes.length,
      truncated: false,
    }
  }

  let end = Math.min(maxBytes, bytes.length)
  while (end > 0 && end < bytes.length) {
    const currentByte = bytes[end]
    if (currentByte == null || (currentByte & 0b1100_0000) !== 0b1000_0000) {
      break
    }
    end--
  }

  return {
    text: textDecoder.decode(bytes.slice(0, Math.max(end, 0))),
    totalBytes: bytes.length,
    truncated: true,
  }
}

function DateTimePicker({
  value,
  onChange,
  id,
  labelId,
  placeholder = '选择日期时间',
}: {
  value: string
  onChange: (v: string) => void
  id: string
  labelId: string
  placeholder?: string
}) {
  const date = parseDatetimeLocal(value)
  const [open, setOpen] = useState(false)
  const [timePart, setTimePart] = useState(() => {
    if (date) return format(date, 'HH:mm')
    return '00:00'
  })

  const handleSelect = useCallback(
    (d: Date | undefined) => {
      if (!d) return
      const parts = timePart.split(':')
      const h = Number(parts[0]) || 0
      const min = Number(parts[1]) || 0
      d.setHours(h, min, 0, 0)
      onChange(toDatetimeLocalValue(d))
    },
    [timePart, onChange]
  )

  const handleTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = e.target.value
      setTimePart(t)
      const base = date ?? new Date()
      const parts = t.split(':')
      const h = Number(parts[0]) || 0
      const min = Number(parts[1]) || 0
      base.setHours(h, min, 0, 0)
      onChange(toDatetimeLocalValue(base))
    },
    [date, onChange]
  )

  useEffect(() => {
    if (date) setTimePart(format(date, 'HH:mm'))
  }, [value])

  const displayText = date ? format(date, 'yyyy/MM/dd HH:mm', { locale: zhCN }) : ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-labelledby={labelId}
          title={displayText || placeholder}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground',
            'hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-0'
          )}
        >
          <span className={displayText ? 'text-foreground' : 'text-muted-foreground'}>
            {displayText || placeholder}
          </span>
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          locale={zhCN}
        />
        <div className="border-t border-border/40 p-3">
          <label id={`${id}-time-label`} htmlFor={`${id}-time`} className="mb-1.5 block text-xs text-muted-foreground">
            时间
          </label>
          <input
            id={`${id}-time`}
            type="time"
            value={timePart}
            onChange={handleTimeChange}
            title="选择时间"
            aria-labelledby={`${id}-time-label`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** 消息状态/类型，用于 Badge 展示 */
type MessageBadgeType = 'normal' | 'retry' | 'dlq' | 'delay' | 'transaction'

function getMessageBadgeType(m: MessageItem): MessageBadgeType {
  const status = m.status
  const props = m.properties ?? {}
  if (props['TRANSACTION_PREPARED'] != null || props['__TRAN_MSG'] != null) return 'transaction'
  if (props['DELAY'] != null || props['__RETRY_TOPIC'] != null && props['REAL_TOPIC'] != null) return 'delay'
  if (status === MessageStatus.MsgRetry) return 'retry'
  if (status === MessageStatus.MsgDLQ) return 'dlq'
  return 'normal'
}

function MessageBadge({ type }: { type: MessageBadgeType }) {
  const [label, className] = {
    normal: ['正常', 'bg-muted/70 text-muted-foreground'],
    retry: ['重试', 'bg-amber-500/15 text-amber-700 dark:text-amber-400'],
    dlq: ['死信', 'bg-red-500/15 text-red-700 dark:text-red-400'],
    delay: ['延时', 'bg-sky-500/15 text-sky-700 dark:text-sky-400'],
    transaction: ['事务', 'bg-violet-500/15 text-violet-700 dark:text-violet-400'],
  }[type]
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', className)}>
      {label}
    </span>
  )
}

/** 将 datetime-local 输入转为 Unix 毫秒 */
function fromDatetimeLocalInput(s: string): number {
  if (!s || !s.trim()) return 0
  const n = new Date(s.trim()).getTime()
  return Number.isNaN(n) ? 0 : n
}

function TopicCombobox({
  value,
  onChange,
  options,
  id,
  labelId,
  placeholder = '选择或输入 Topic',
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  id: string
  labelId: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const filtered = value.trim()
    ? options.filter((o) => o.toLowerCase().includes(value.toLowerCase()))
    : options
  const showList = open && filtered.length > 0

  useEffect(() => {
    if (!showList) return
    const onPointer = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onPointer)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [showList])

  return (
    <div ref={containerRef} className="relative">
      {showList ? (
        <input
          id={id}
          type="text"
          role="combobox"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          title={placeholder}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-mono"
          aria-labelledby={labelId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
        />
      ) : (
        <input
          id={id}
          type="text"
          role="combobox"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          title={placeholder}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-mono"
          aria-labelledby={labelId}
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls={undefined}
        />
      )}
      {showList && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-0.5 min-w-[320px] max-h-48 overflow-y-auto rounded-md border border-border/40 bg-card py-1 scroll-thin"
        >
          {filtered.map((name) => {
            const isSelected = value === name
            return (
              isSelected ? (
                <li
                  key={name}
                  role="option"
                  aria-selected="true"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    onChange(name)
                    setOpen(false)
                  }}
                  className={cn(
                    'cursor-pointer px-3 py-2 font-mono text-sm text-foreground transition-colors hover:bg-accent/70',
                    'bg-accent/50'
                  )}
                >
                  {name}
                </li>
              ) : (
                <li
                  key={name}
                  role="option"
                  aria-selected="false"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    onChange(name)
                    setOpen(false)
                  }}
                  className="cursor-pointer px-3 py-2 font-mono text-sm text-foreground transition-colors hover:bg-accent/70"
                >
                  {name}
                </li>
              )
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function MessageView() {
  const { settings } = useSettings()
  const [clusterName, setClusterName] = useState('')
  const [metaError, setMetaError] = useState<string | null>(null)
  const [topicOptions, setTopicOptions] = useState<string[]>([])
  const [selectedTopic, setSelectedTopic] = useState('')
  const [messageId, setMessageId] = useState('')
  const [messageKey, setMessageKey] = useState('')
  const [messageTag, setMessageTag] = useState('')
  const [startTimeInput, setStartTimeInput] = useState('')
  const [endTimeInput, setEndTimeInput] = useState('')
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS)
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [lastFetchKind, setLastFetchKind] = useState<FetchKind>('none')
  const [selectedMessage, setSelectedMessage] = useState<MessageItem | null>(null)
  const [bodyViewMode, setBodyViewMode] = useState<'raw' | 'hex' | 'json'>('raw')
  const [bodyFormatted, setBodyFormatted] = useState<string | null>(null)
  const [bodyFullscreenOpen, setBodyFullscreenOpen] = useState(false)
  const [showSendPanel, setShowSendPanel] = useState(false)
  const [sendTopic, setSendTopic] = useState('')
  const [sendTags, setSendTags] = useState('')
  const [sendKeys, setSendKeys] = useState('')
  const [sendBody, setSendBody] = useState('')
  const [sendDelayLevel, setSendDelayLevel] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [trackItems, setTrackItems] = useState<{ consumerGroup: string; trackType: string; consumeStatus: string; exceptionDesc: string }[]>([])
  const [trackLoading, setTrackLoading] = useState(false)
  const [resendingGroup, setResendingGroup] = useState<string | null>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    if (selectedMessage) {
      const canFormatJSON = tryParseJSON(selectedMessage.body ?? '') != null
      const shouldFormatJSON = settings.autoFormatJson && canFormatJSON
      setBodyViewMode(shouldFormatJSON ? 'json' : 'raw')
      setBodyFormatted(shouldFormatJSON ? formatJSONString(selectedMessage.body ?? '') : null)
    }
    setTrackItems([])
    setTrackLoading(false)
  }, [selectedMessage, settings.autoFormatJson])

  useEffect(() => {
    setMaxResults(settings.fetchLimit)
  }, [settings.fetchLimit])

  // 拉取 Topic 列表与集群名
  useEffect(() => {
    let cancelled = false
    setMetaError(null)
    Promise.allSettled([topicApi.getTopics(), clusterApi.getClusterInfo()]).then(([topicsResult, clusterResult]) => {
      if (cancelled) return

      let nextError: string | null = null

      if (topicsResult.status === 'fulfilled') {
        const names = (topicsResult.value ?? [])
          .filter((t): t is NonNullable<typeof t> => t != null && t.topic != null)
          .map((t) => t.topic)
          .filter((n) => n.length > 0)
        setTopicOptions([...new Set(names)].sort())
      } else {
        setTopicOptions([])
        nextError = 'Topic 元数据加载失败，请检查连接状态'
      }

      if (clusterResult.status === 'fulfilled') {
        setClusterName(clusterResult.value?.clusterName ?? '')
      } else {
        setClusterName('')
        nextError = nextError ?? '集群元数据加载失败，请检查连接状态'
      }

      setMetaError(nextError)
    })
    return () => { cancelled = true }
  }, [])

  // 选 Topic 后清空上一次查询结果，避免旧数据误导
  useEffect(() => {
    setMessages([])
    setLastFetchKind('none')
    setSelectedMessage(null)
  }, [selectedTopic])

  // 进阶搜索：仅当用户点击「查询」时按条件拉取
  const runConditionQuery = useCallback(async () => {
    const t = selectedTopic.trim()
    if (!t) {
      toast.error('请先选择 Topic')
      return
    }
    setIsLoading(true)
    setSelectedMessage(null)
    const condition: QueryCondition = {
      messageId: messageId.trim() || undefined,
      messageKey: messageKey.trim() || undefined,
      messageTag: messageTag.trim() || undefined,
      startTimeMs: fromDatetimeLocalInput(startTimeInput) || undefined,
      endTimeMs: fromDatetimeLocalInput(endTimeInput) || undefined,
    }
    if (condition.startTimeMs === 0) delete condition.startTimeMs
    if (condition.endTimeMs === 0) delete condition.endTimeMs


    const requestSeq = ++requestSeqRef.current
    try {
      const items = await messageApi.queryMessagesByCondition(
        t,
        condition,
        maxResults > 0 ? maxResults : DEFAULT_MAX_RESULTS
      )
      if (requestSeq !== requestSeqRef.current) return
      setMessages(items)
      setLastFetchKind('condition')
      if (items.length === 0) toast.info('未查询到匹配的消息')
    } catch (e) {
      if (requestSeq !== requestSeqRef.current) return
      const msg = (() => {
        try {
          return formatErrorMessage(e)
        } catch {
          return '查询失败'
        }
      })()
      toast.error(msg.trim().startsWith('{') ? '查询失败' : msg)
      setMessages([])
      setLastFetchKind('condition')
    } finally {
      setIsLoading(false)
    }
  }, [selectedTopic, messageId, messageKey, messageTag, maxResults, startTimeInput, endTimeInput])

  const copyMessageId = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(id).then(() => toast.success('已复制 Message ID')).catch(() => toast.error('复制失败'))
  }, [])

  const copyBody = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('已复制 Body')).catch(() => toast.error('复制失败'))
  }, [])

  const handleSendMessage = useCallback(async () => {
    const t = sendTopic.trim() || selectedTopic.trim()
    if (!t) {
      toast.error('请填写 Topic')
      return
    }
    if (!sendBody.trim()) {
      toast.error('请填写消息内容')
      return
    }
    setIsSending(true)
    try {
      const result = await messageApi.sendMessage(t, sendTags.trim(), sendKeys.trim(), sendBody, sendDelayLevel)
      toast.success(result)
      setSendBody('')
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setIsSending(false)
    }
  }, [sendTopic, selectedTopic, sendTags, sendKeys, sendBody, sendDelayLevel])

  const handleResendMessage = useCallback(async (consumerGroup: string) => {
    if (!selectedMessage) return
    setResendingGroup(consumerGroup)
    try {
      const result = await messageApi.resendMessage(consumerGroup, '', selectedMessage.topic, selectedMessage.messageId)
      toast.success(result || '重投成功')
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setResendingGroup(null)
    }
  }, [selectedMessage])

  const selectedBody = selectedMessage?.body ?? ''
  const payloadPreview = getPayloadPreview(selectedBody, settings.maxPayloadRenderBytes)
  const canPreviewAsJSON = !payloadPreview.truncated && tryParseJSON(selectedBody) != null
  const effectiveBodyText =
    bodyViewMode === 'json'
      ? bodyFormatted ?? formatJSONString(payloadPreview.text)
      : payloadPreview.text

  return (
    <div className="flex h-full flex-col">
      {/* 搜索工具栏 */}
      <div className="shrink-0 border-b border-border/40 bg-muted/10 px-4 py-2.5 space-y-2">
        {/* 第一行：Topic + ID + Key */}
        <div className="flex items-center gap-2.5">
          {clusterName && (
            <span className="shrink-0 rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{clusterName}</span>
          )}
          <div className="w-48 shrink-0">
            <TopicCombobox
              id="msg-topic"
              labelId="msg-topic-label"
              value={selectedTopic}
              onChange={setSelectedTopic}
              options={topicOptions}
              placeholder="Topic"
            />
          </div>
          <input
            id="msg-msgid"
            type="text"
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
            placeholder="Message ID"
            className="h-8 w-56 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-xs font-mono transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Message ID"
          />
          <input
            id="msg-key"
            type="text"
            value={messageKey}
            onChange={(e) => setMessageKey(e.target.value)}
            placeholder="Key"
            className="h-8 w-36 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-xs font-mono transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Message Key"
          />
          <input
            id="msg-tag"
            type="text"
            value={messageTag}
            onChange={(e) => setMessageTag(e.target.value)}
            placeholder="Tag"
            className="h-8 w-36 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-xs font-mono transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Message Tag"
          />
        </div>
        {/* 第二行：时间 + 条数 + 查询 + 发送 */}
        <div className="flex items-center gap-2.5">
          <div className="w-44 shrink-0">
            <DateTimePicker
              id="msg-start"
              labelId="msg-start-label"
              value={startTimeInput}
              onChange={setStartTimeInput}
              placeholder="开始时间"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/60">—</span>
          <div className="w-44 shrink-0">
            <DateTimePicker
              id="msg-end"
              labelId="msg-end-label"
              value={endTimeInput}
              onChange={setEndTimeInput}
              placeholder="结束时间"
            />
          </div>
          <input
            id="msg-max"
            type="number"
            min={1}
            max={128}
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value) || DEFAULT_MAX_RESULTS)}
            className="h-8 w-16 shrink-0 rounded-md border border-border/40 bg-background px-2 text-center text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="条数"
          />
          <button
            type="button"
            onClick={runConditionQuery}
            disabled={isLoading}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            查询
          </button>
          <div className="h-5 w-px shrink-0 bg-border/30" />
          <button
            type="button"
            onClick={() => {
              setShowSendPanel((v) => !v)
              if (!sendTopic && selectedTopic) setSendTopic(selectedTopic)
            }}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/40 px-2.5 text-xs font-medium transition-all hover:bg-accent active:scale-[0.97]',
              showSendPanel && 'bg-accent text-accent-foreground'
            )}
          >
            <Send className="h-3.5 w-3.5" />
            发送消息
          </button>
        </div>
      </div>
      {metaError && (
        <div className="shrink-0 border-b border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {metaError}
        </div>
      )}

      {/* 发送消息模态框 */}
      {showSendPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSendPanel(false) }}
          role="dialog"
          aria-modal="true"
          aria-label="发送消息"
        >
          <div className="w-full max-w-lg rounded-lg border border-border/40 bg-background shadow-xl">
            {/* 标题栏 */}
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <span className="text-sm font-medium">发送消息</span>
              <button
                type="button"
                onClick={() => setShowSendPanel(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* 表单 */}
            <div className="space-y-3 p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="w-48 shrink-0 [&_input]:h-9 [&_input]:py-2 [&_input]:text-sm">
                  <TopicCombobox
                    id="send-topic"
                    labelId="send-topic-label"
                    value={sendTopic}
                    onChange={setSendTopic}
                    options={topicOptions}
                    placeholder="Topic"
                  />
                </div>
                <input
                  type="text"
                  value={sendTags}
                  onChange={(e) => setSendTags(e.target.value)}
                  placeholder="Tags"
                  className="h-9 w-28 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label="Tags"
                />
                <input
                  type="text"
                  value={sendKeys}
                  onChange={(e) => setSendKeys(e.target.value)}
                  placeholder="Keys"
                  className="h-9 w-28 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label="Keys"
                />
                <select
                  value={sendDelayLevel}
                  onChange={(e) => setSendDelayLevel(Number(e.target.value))}
                  className="h-9 shrink-0 rounded-md border border-border/40 bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label="延迟等级"
                  title="延迟等级"
                >
                  {DELAY_LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                placeholder="消息内容，支持多行输入；按 Ctrl/Cmd + Enter 快速发送"
                className="min-h-32 w-full rounded-md border border-border/40 bg-background px-3 py-2.5 text-sm font-mono leading-5 focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="消息内容"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
              />
            </div>
            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-2 border-t border-border/40 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowSendPanel(false)}
                className="inline-flex h-9 items-center rounded-md border border-border/40 px-3.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={isSending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-50"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区：Resizable 左右分栏 */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="h-full" defaultLayout={{ 'msg-list': 40, 'msg-inspector': 60 }}>
          <ResizablePanel id="msg-list" defaultSize={40} minSize={240} collapsible={false} className="flex flex-col min-w-0">
            <div className="shrink-0 border-b border-border/40 px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {messages.length > 0 ? `共 ${messages.length} 条` : '消息列表'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin">
              {isLoading ? (
                <div className="p-2 space-y-1" aria-busy="true" aria-label="加载中">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-border/40 px-2.5 py-2 flex items-center gap-2"
                    >
                      <div className="h-3 flex-1 rounded bg-muted/60 animate-pulse max-w-[180px]" />
                      <div className="h-3 w-12 rounded bg-muted/40 animate-pulse" />
                      <div className="h-4 w-8 rounded bg-muted/40 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : messages.length > 0 ? (
                <ul className="p-2 space-y-1">
                  {messages.map((m) => (
                    <li
                      key={m.messageId ?? m.id}
                      onClick={() => setSelectedMessage(m)}
                      className={cn(
                        'rounded-md border border-border/40 px-2.5 py-2 cursor-pointer transition-colors hover:bg-accent/50',
                        selectedMessage?.messageId === m.messageId && 'bg-accent/50 border-border/60'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate flex-1 font-mono text-xs text-foreground" title={m.messageId ?? ''}>
                          {m.messageId ?? '—'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); copyMessageId(e, m.messageId ?? '') }}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="复制 Message ID"
                          aria-label="复制"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <MessageBadge type={getMessageBadgeType(m)} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        {m.tags != null && m.tags !== '' && (
                          <span className="truncate font-mono" title={m.tags}>{m.tags}</span>
                        )}
                        <span className="shrink-0">
                          {getMessageStoreTime(m, settings.timezone, settings.timestampFormat)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[120px] px-4 text-center text-xs text-muted-foreground">
                  {!selectedTopic.trim()
                    ? '请选择 Topic 开始检索'
                    : lastFetchKind === 'condition'
                      ? '未查询到匹配的消息'
                      : '请输入 Message ID、Key 或时间范围后点击查询'}
                </div>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="msg-inspector" defaultSize={60} minSize={320} collapsible={false} className="flex flex-col min-w-0">
            <div className="shrink-0 border-b border-border/40 px-3 py-1.5">
              <span className="text-xs text-muted-foreground">消息详情</span>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin min-h-0">
              {selectedMessage ? (
                <div className="p-3">
                  <div className="mb-3 space-y-1 text-xs">
                    <p><span className="text-muted-foreground">Topic </span><span className="font-mono text-foreground">{selectedMessage.topic}</span></p>
                    <p><span className="text-muted-foreground">Message ID </span><span className="break-all font-mono text-foreground">{selectedMessage.messageId}</span></p>
                    {(selectedMessage.tags != null && selectedMessage.tags !== '') && (
                      <p><span className="text-muted-foreground">Tags </span><span className="font-mono text-foreground">{selectedMessage.tags}</span></p>
                    )}
                    {(selectedMessage.keys != null && selectedMessage.keys !== '') && (
                      <p><span className="text-muted-foreground">Keys </span><span className="font-mono text-foreground">{selectedMessage.keys}</span></p>
                    )}
                    <p>
                      <span className="text-muted-foreground">存储 </span>
                      <span className="text-foreground">
                        {getMessageStoreTime(selectedMessage, settings.timezone, settings.timestampFormat)}
                      </span>
                    </p>
                  </div>
                  <Tabs defaultValue="body" className="w-full">
                    <TabsList className="h-8 w-full justify-start rounded-md bg-muted/30 p-0.5">
                      <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
                      <TabsTrigger value="properties" className="text-xs">Properties</TabsTrigger>
                      <TabsTrigger value="trace" className="text-xs" onClick={() => {
                        if (selectedMessage && trackItems.length === 0 && !trackLoading) {
                          setTrackLoading(true)
                          messageApi.getMessageTrack(selectedMessage.topic, selectedMessage.messageId)
                            .then(setTrackItems)
                            .catch((e) => toast.error(formatErrorMessage(e)))
                            .finally(() => setTrackLoading(false))
                        }
                      }}>Trace</TabsTrigger>
                    </TabsList>
                    <TabsContent value="body" className="mt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setBodyViewMode('raw')}
                            className={cn('rounded px-2 py-1 text-[10px] font-medium transition-colors', bodyViewMode === 'raw' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}
                            title="原始"
                          >Raw</button>
                          <button
                            type="button"
                            onClick={() => setBodyViewMode('hex')}
                            className={cn('rounded px-2 py-1 text-[10px] font-medium transition-colors', bodyViewMode === 'hex' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}
                            title="十六进制"
                          >Hex</button>
                          {canPreviewAsJSON && (
                            <button
                              type="button"
                              onClick={() => setBodyViewMode('json')}
                              className={cn('rounded px-2 py-1 text-[10px] font-medium transition-colors', bodyViewMode === 'json' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}
                              title="JSON"
                            >JSON</button>
                          )}
                          {bodyViewMode === 'json' && (
                            <button
                              type="button"
                              disabled={!canPreviewAsJSON}
                              onClick={() => setBodyFormatted((prev) => (prev != null ? null : formatJSONString(selectedMessage.body ?? '')))}
                              className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                              title={bodyFormatted != null ? '压缩' : '格式化'}
                            >{bodyFormatted != null ? '压缩' : 'Format'}</button>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => copyBody(selectedMessage.body ?? '')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="复制"><Copy className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => setBodyFullscreenOpen(true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="全屏"><Maximize2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      {payloadPreview.truncated && (
                        <div className="mb-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                          消息体共 {payloadPreview.totalBytes} 字节，当前仅预览前 {settings.maxPayloadRenderBytes} 字节。复制操作仍会复制完整内容。
                        </div>
                      )}
                      <pre className="max-h-64 overflow-auto rounded-md border border-border/40 bg-muted/30 p-3 font-mono text-xs text-foreground whitespace-pre-wrap wrap-break-word scroll-thin">
                        {bodyViewMode === 'hex'
                          ? toHexView(payloadPreview.text)
                          : bodyViewMode === 'json'
                            ? highlightJSON(effectiveBodyText)
                            : (effectiveBodyText !== '' ? effectiveBodyText : '（空）')}
                      </pre>
                    </TabsContent>
                    <TabsContent value="properties" className="mt-2">
                      {selectedMessage.properties != null && Object.keys(selectedMessage.properties).length > 0 ? (() => {
                        const entries = Object.entries(selectedMessage.properties)
                        const systemEntries = entries.filter(([k]) => SYSTEM_PROP_KEYS.has(k))
                        const userEntries = entries.filter(([k]) => !SYSTEM_PROP_KEYS.has(k))
                        return (
                          <div className="space-y-3 text-xs">
                            {systemEntries.length > 0 && (
                              <div>
                                <h3 className="mb-1.5 text-[11px] font-medium text-muted-foreground">系统属性</h3>
                                <ul className="space-y-1 rounded-md border border-border/40 bg-muted/20 py-2">
                                  {systemEntries.map(([k, v]) => (
                                    <li key={k} className="flex justify-between gap-2 px-2.5"><span className="text-muted-foreground">{k}</span><span className="truncate font-mono text-foreground">{v ?? '—'}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {userEntries.length > 0 && (
                              <div>
                                <h3 className="mb-1.5 text-[11px] font-medium text-muted-foreground">业务属性</h3>
                                <ul className="space-y-1 rounded-md border border-border/40 bg-muted/20 py-2">
                                  {userEntries.map(([k, v]) => (
                                    <li key={k} className="flex justify-between gap-2 px-2.5"><span className="text-muted-foreground">{k}</span><span className="truncate font-mono text-foreground">{v ?? '—'}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )
                      })() : (
                        <p className="py-4 text-center text-xs text-muted-foreground">无属性</p>
                      )}
                    </TabsContent>
                    <TabsContent value="trace" className="mt-2">
                      {trackLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="ml-2 text-xs text-muted-foreground">加载轨迹中...</span>
                        </div>
                      ) : trackItems.length > 0 ? (
                        <div className="space-y-2">
                          {trackItems.map((item, idx) => (
                            <div key={idx} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-medium text-foreground truncate">{item.consumerGroup}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleResendMessage(item.consumerGroup)}
                                    disabled={resendingGroup !== null}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                                    title="重投到该消费者组"
                                  >
                                    {resendingGroup === item.consumerGroup ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <RotateCw className="h-3 w-3" />
                                    )}
                                  </button>
                                  <span className={cn(
                                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                    item.trackType === 'CONSUMED' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                                    item.trackType === 'NOT_CONSUME_YET' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                                    item.trackType === 'NOT_ONLINE' && 'bg-red-500/15 text-red-700 dark:text-red-400',
                                    (item.trackType === 'UNKNOWN' || !['CONSUMED', 'NOT_CONSUME_YET', 'NOT_ONLINE'].includes(item.trackType)) && 'bg-muted text-muted-foreground',
                                  )}>
                                    {item.consumeStatus}
                                  </span>
                                </div>
                              </div>
                              {item.exceptionDesc && (
                                <p className="text-[10px] text-muted-foreground truncate" title={item.exceptionDesc}>{item.exceptionDesc}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="py-4 text-center text-xs text-muted-foreground">无消费轨迹</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[160px] px-4 text-center text-xs text-muted-foreground">
                  选择左侧一条消息查看详情
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* 全屏 Body 弹层 */}
      {selectedMessage && bodyFullscreenOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="消息体全屏">
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-medium">消息体</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => copyBody(selectedMessage.body ?? '')} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">复制</button>
              <button type="button" onClick={() => setBodyFullscreenOpen(false)} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">关闭</button>
            </div>
          </div>
          {payloadPreview.truncated && (
            <div className="mx-4 mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              当前全屏视图同样遵循预览阈值，仅展示前 {settings.maxPayloadRenderBytes} 字节。
            </div>
          )}
          <pre className="flex-1 overflow-auto m-4 p-4 rounded-md border bg-muted/50 font-mono text-sm text-foreground whitespace-pre-wrap wrap-break-word scroll-thin">
            {bodyViewMode === 'hex'
              ? toHexView(payloadPreview.text)
              : bodyViewMode === 'json'
                ? highlightJSON(effectiveBodyText)
                : (effectiveBodyText || '（空）')}
          </pre>
        </div>
      )}
    </div>
  )
}

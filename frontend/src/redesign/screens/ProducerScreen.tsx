import { useMemo, useState } from 'react'
import { Send, RotateCcw, X, Check, AlertCircle } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '../shell'
import { useTopics } from '@/hooks/useTopics'
import * as messageApi from '@/api/message'
import { formatErrorMessage } from '@/lib/utils'
import { OfflineEmpty } from '@/components/OfflineEmpty'

const SAMPLE_BODY = `{
  "orderId": "ORD-20250812-08472",
  "userId": 80142,
  "amount": 459.00,
  "items": [
    { "sku": "SKU-A104", "qty": 2 }
  ]
}`

interface HistoryEntry {
  ok: boolean
  topic: string
  tag: string
  key: string
  delay: number
  time: string
  result?: string
  error?: string
}

const DELAY_LEVELS: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ProducerScreen() {
  const { t } = useTranslation()
  const { topics, hasOnline } = useTopics()

  const [topic, setTopic] = useState<string>('')
  const [tag, setTag] = useState('')
  const [key, setKey] = useState('')
  const [delay, setDelay] = useState(0)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const sendableTopics = useMemo(
    () =>
      topics
        .filter((tp) => !tp.topic.startsWith('%RETRY%') && !tp.topic.startsWith('%DLQ%'))
        .map((tp) => tp.topic)
        .sort(),
    [topics],
  )

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(body)
      setBody(JSON.stringify(parsed, null, 2))
    } catch {
      toast.error(t('producer.invalidJson'))
    }
  }

  const handleSend = async () => {
    if (!topic) {
      toast.error(t('producer.validateTopic'))
      return
    }
    if (!body.trim()) {
      toast.error(t('producer.validateBody'))
      return
    }
    setBusy(true)
    try {
      const result = await messageApi.sendMessage(topic, tag, key, body, delay)
      const entry: HistoryEntry = {
        ok: true,
        topic,
        tag,
        key,
        delay,
        time: formatTime(new Date()),
        result,
      }
      setHistory((h) => [entry, ...h].slice(0, 50))
      toast.success(t('producer.sendSuccess'), { description: result })
    } catch (e) {
      const msg = formatErrorMessage(e)
      const entry: HistoryEntry = {
        ok: false,
        topic,
        tag,
        key,
        delay,
        time: formatTime(new Date()),
        error: msg,
      }
      setHistory((h) => [entry, ...h].slice(0, 50))
      toast.error(t('producer.sendError'), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleReset = () => {
    setTag('')
    setKey('')
    setDelay(0)
    setBody('')
  }

  const subtitle = !hasOnline ? t('producer.subtitleNoConn') : t('producer.subtitle')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('producer.title')} subtitle={subtitle} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {!hasOnline ? (
          <OfflineEmpty message={t('producer.subtitleNoConn')} className="h-full" />
        ) : (
          <div className="grid h-full" style={{ gridTemplateColumns: '1fr 380px' }}>
            <div className="scroll-thin min-w-0 overflow-auto" style={{ padding: 24 }}>
              <div style={{ maxWidth: 720 }}>
                <div className="rl-section-label">{t('producer.target')}</div>
                <div className="rl-card" style={{ padding: 16 }}>
                  <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('producer.topic')}{' '}
                        <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                      </div>
                      {sendableTopics.length === 0 ? (
                        <div className="rl-muted text-[12px]" style={{ padding: 8 }}>
                          {t('producer.noTopics')}
                        </div>
                      ) : (
                        <select
                          className="rl-select font-mono-design"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                        >
                          <option value="">{t('producer.topicPlaceholder')}</option>
                          {sendableTopics.map((tp) => (
                            <option key={tp} value={tp}>
                              {tp}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('producer.tag')}{' '}
                        <span className="rl-muted">{t('producer.tagOptional')}</span>
                      </div>
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('producer.tagPlaceholder')}
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('producer.key')}{' '}
                        <span className="rl-muted">{t('producer.tagOptional')}</span>
                      </div>
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('producer.keyPlaceholder')}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">{t('producer.delay')}</div>
                      <select
                        className="rl-select"
                        value={delay}
                        onChange={(e) => setDelay(Number(e.target.value))}
                      >
                        {DELAY_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {t(`producer.delayLevels.${lv}` as const)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mb-2 mt-5 flex items-center justify-between">
                  <div className="rl-section-label" style={{ marginBottom: 0 }}>
                    {t('producer.body')}
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="rl-btn rl-btn-ghost rl-btn-sm"
                      onClick={() => setBody(SAMPLE_BODY)}
                    >
                      {t('producer.loadSample')}
                    </button>
                    <button
                      className="rl-btn rl-btn-ghost rl-btn-sm"
                      onClick={handleFormat}
                      disabled={!body.trim()}
                    >
                      {t('producer.format')}
                    </button>
                  </div>
                </div>
                <textarea
                  className="rl-input font-mono-design"
                  style={{
                    width: '100%',
                    minHeight: 220,
                    padding: 12,
                    fontSize: 12,
                    resize: 'vertical',
                  }}
                  placeholder='{"hello":"world"}'
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />

                <div className="mt-5 flex gap-2">
                  <button
                    className="rl-btn rl-btn-primary"
                    onClick={handleSend}
                    disabled={busy || !topic || !body.trim()}
                  >
                    {busy ? <Spinner size={13} /> : <Send size={13} />}
                    {busy ? t('producer.sending') : t('producer.send')}
                  </button>
                  <button className="rl-btn rl-btn-ghost" onClick={handleReset} disabled={busy}>
                    <RotateCcw size={13} />
                    {t('producer.reset')}
                  </button>
                </div>
              </div>
            </div>

            {/* History */}
            <div
              className="scroll-thin overflow-auto"
              style={{
                borderLeft: '1px solid hsl(var(--border))',
                background: 'hsl(var(--background))',
              }}
            >
              <div
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid hsl(var(--border))',
                }}
              >
                <div className="text-[13px] font-medium">{t('producer.history')}</div>
                <div className="rl-muted mt-1 text-[12px]">{t('producer.historyHint')}</div>
              </div>
              {history.length === 0 ? (
                <div className="rl-muted text-[12px]" style={{ padding: 24, textAlign: 'center' }}>
                  {t('producer.historyEmpty')}
                </div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid hsl(var(--border))',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {h.ok ? (
                        <Check size={11} style={{ color: 'hsl(var(--success))' }} />
                      ) : (
                        <X size={11} style={{ color: 'hsl(var(--destructive))' }} />
                      )}
                      <span className="font-mono-design rl-muted rl-tabular text-[12px]">
                        {h.time}
                      </span>
                      <span
                        className="font-mono-design flex-1 truncate text-[12px]"
                        title={h.topic}
                      >
                        {h.topic}
                      </span>
                    </div>
                    {h.ok ? (
                      <div
                        className="font-mono-design rl-muted mt-1 truncate text-[11px]"
                        title={h.result}
                      >
                        {h.result}
                      </div>
                    ) : (
                      <div
                        className="mt-1 flex items-start gap-1 text-[11px]"
                        style={{ color: 'hsl(var(--destructive))' }}
                      >
                        <AlertCircle size={10} className="mt-0.5 shrink-0" />
                        <span className="break-all">{h.error}</span>
                      </div>
                    )}
                    {(h.tag || h.key || h.delay > 0) && (
                      <div className="rl-muted mt-1 flex flex-wrap gap-2 text-[11px]">
                        {h.tag && <span>tag: {h.tag}</span>}
                        {h.key && <span>key: {h.key}</span>}
                        {h.delay > 0 && <span>delay: L{h.delay}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
